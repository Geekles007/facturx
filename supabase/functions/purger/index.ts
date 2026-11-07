/**
 * Edge Function `purger` (spec § 7 et § 12), appelée chaque nuit par `pg_cron` et `pg_net`
 * (migration 000600) :
 *
 *   POST /functions/v1/purger   en-tête `x-purge-secret` égal à `PURGE_SECRET` ; corps ignoré
 *
 * Réponse 200 `{ orphelins, comptes }` : le nombre de PDF orphelins effacés et d'entreprises purgées.
 * Sans le secret (ou si la variable manque : elle est fermée par défaut), 401 `SESSION`, et rien n'est
 * lu ni effacé ; une autre méthode que POST, 405. Cette fonction efface pour de bon : elle n'a pas
 * d'autre garde que ce secret (`secret.ts`).
 *
 * 1. Les PDF orphelins. Un PDF est déposé avant la facture qui le désigne (`emettre`, `importer`) : si
 *    l'enregistrement échoue, il reste sans facture. Chaque objet du bucket `factures` créé depuis plus
 *    d'un jour dont le nom n'est le `pdf_chemin` d'aucune facture est effacé. Un PDF rattaché à une
 *    facture n'est jamais effacé, quel que soit son âge, ni rien d'un autre bucket. En local, la passe
 *    efface aussi les traces du simulateur de `relancer` (`simule/…`), qui ne sont rattachées à rien.
 * 2. Les comptes. Pour chaque entreprise dont la suppression a été demandée il y a plus de 30 jours :
 *    a. ses objets des buckets `factures` et `fichiers`, sous `{entreprise}/…` ;
 *    b. ses utilisateurs, dans Supabase Auth ;
 *    c. ses lignes, par un seul `delete from entreprises` dans une transaction de purge
 *       (`facturx.purge`, spec § 6), qui descend en cascade dans toutes ses tables.
 * 3. Les traces d'Auth. Le serveur d'authentification journalise dans `auth.audit_log_entries`
 *    l'inscription, chaque connexion, chaque renouvellement de session et la suppression elle-même
 *    (`user_deleted`), avec l'identifiant et l'adresse e-mail de l'utilisateur (et, pour certains
 *    évènements, l'adresse IP) : `auth.admin.deleteUser` ne les efface pas, et en ajoute une. Les
 *    entrées de chaque utilisateur supprimé — une entrée `user_deleted` le nomme, et il n'est plus
 *    dans `auth.users` — sont effacées, celle de la suppression comprise. C'est elle qui désigne
 *    l'utilisateur à la passe suivante si celle-ci échoue : l'étape se rejoue comme les autres. Elle
 *    vaut pour tout utilisateur supprimé, y compris à la main depuis le tableau de bord.
 *
 * L'ordre (Storage, Auth, base) n'est pas celui de la spec § 12 (base, puis Auth) : il donne le même
 * résultat, mais une passe interrompue se rejoue. La suppression de l'entreprise est la dernière étape,
 * et c'est elle qui retire l'entreprise de la liste des comptes à purger : tant qu'elle n'a pas eu lieu,
 * l'entreprise garde sa date et la passe suivante reprend tout, les étapes a et b étant idempotentes (un
 * objet ou un utilisateur déjà partis ne sont pas une erreur). Dans l'ordre de la spec, un échec à
 * l'étape Auth laisserait des utilisateurs sans entreprise, que plus rien ne désignerait.
 *
 * Une erreur sur une entreprise ne bloque ni les autres ni les orphelins : elle est journalisée (son
 * identifiant, aucune donnée personnelle), puis la passe continue, et se termine par 500 `INTERNE` dont
 * `details` porte quand même `{ orphelins, comptes, echecs }`. Ce qui n'a pas pu être fait l'est la
 * nuit suivante. Les passes se rejouent sans dommage, y compris deux à la fois.
 *
 * Un utilisateur qui est aussi membre d'une autre entreprise n'est pas supprimé : il emporterait avec
 * lui son appartenance à celle-là (`membres.user_id` descend en cascade). Son appartenance à
 * l'entreprise purgée part avec elle. v1 n'a qu'une entreprise par compte ; la garde ne coûte rien.
 *
 * La demande de suppression est relue juste avant les effacements (une demande retirée à la main entre
 * la liste et ce moment n'est pas purgée). Une fois l'effacement commencé, l'entreprise est supprimée par
 * son identifiant, sans condition d'échéance : `supprimer-compte` n'annule plus une demande de plus de 30
 * jours, aucune annulation ne peut donc aboutir pendant la passe, et l'entreprise ne reste jamais à moitié
 * effacée (sans Storage ni utilisateurs, mais avec ses lignes, hors de portée de toute passe). Reste la
 * demande qui franchit les 30 jours à la milliseconde même d'une annulation : l'annulation, validée après
 * la relecture, ne la sauve pas.
 */
import { admin, sql } from '../_shared/db.ts';
import { erreur, json, resumer, traiter } from '../_shared/erreurs.ts';
import { echue } from '../_shared/suppression.ts';
import { supprimerUtilisateur } from './auth.ts';
import { secretConfigure, secretValide } from './secret.ts';

/** Âge à partir duquel un PDF sans facture est un orphelin (spec § 7), en jours. */
const AGE_ORPHELIN_JOURS = 1;

/** Objets effacés par appel à l'API Storage. */
const LOT = 100;

/**
 * Combien de temps la suppression d'une entreprise attend une ligne que quelqu'un tient (une relance
 * en cours d'envoi tient la facture et l'entreprise par leurs clés étrangères), en secondes. Au-delà,
 * l'entreprise est reprise la nuit suivante.
 */
const ATTENTE_VERROU = 5;

function journaliser(evenement: string, e: unknown, entreprise?: string): void {
  console.error(JSON.stringify({ purger: evenement, entreprise, erreur: resumer(e) }));
}

/** Efface ces objets du bucket par l'API Storage (une ligne de `storage.objects` n'efface pas le fichier). */
async function effacer(bucket: string, noms: string[]): Promise<number> {
  const { data, error } = await admin().storage.from(bucket).remove(noms);
  if (error) throw error;
  return data.length;
}

/**
 * Les PDF orphelins : par lots, dans l'ordre des noms, en reprenant après le dernier nom lu (un objet
 * que l'API n'aurait pas effacé n'est ainsi jamais relu en boucle). Rend ce qui est effacé, et si la
 * passe s'est arrêtée sur une erreur.
 */
async function purgerOrphelins(): Promise<{ effaces: number; echec: boolean }> {
  let effaces = 0;
  try {
    let apres = '';
    for (;;) {
      const lot = await sql<{ name: string }[]>`
        select o.name from storage.objects o
         where o.bucket_id = 'factures'
           and o.created_at < now() - make_interval(days => ${AGE_ORPHELIN_JOURS})
           and o.name > ${apres}
           and not exists (select 1 from public.factures f where f.pdf_chemin = o.name)
         order by o.name
         limit ${LOT}`;
      if (lot.length === 0) return { effaces, echec: false };
      effaces += await effacer(
        'factures',
        lot.map((objet) => objet.name),
      );
      apres = lot[lot.length - 1].name;
    }
  } catch (e) {
    journaliser('PDF orphelins non effacés, repris à la prochaine passe', e);
    return { effaces, echec: true };
  }
}

/**
 * Les traces d'Auth des utilisateurs supprimés (voir l'en-tête, étape 3) ; rend combien d'entrées sont
 * effacées, et si l'étape a échoué. Deux requêtes : la liste des supprimés (une lecture du journal),
 * puis, s'il y en a, l'effacement, la liste passée comme un seul tableau. Le rôle `postgres` a le droit
 * d'effacer dans ce journal ; s'il le perdait, l'échec serait journalisé, et la passe finirait en 500.
 */
async function effacerTracesDAuth(): Promise<{ effacees: number; echec: boolean }> {
  try {
    const supprimes = await sql<{ id: string }[]>`
      select distinct a.payload -> 'traits' ->> 'user_id' as id
        from auth.audit_log_entries a
       where a.payload ->> 'action' = 'user_deleted'
         and a.payload -> 'traits' ->> 'user_id' is not null
         and not exists (
           select 1 from auth.users u where u.id::text = a.payload -> 'traits' ->> 'user_id')`;
    const ids = supprimes.map((l) => l.id);
    if (ids.length === 0) return { effacees: 0, echec: false };
    const effacees = await sql`
      delete from auth.audit_log_entries
       where payload ->> 'actor_id' = any(${ids}::text[])
          or payload -> 'traits' ->> 'user_id' = any(${ids}::text[])`;
    return { effacees: effacees.count, echec: false };
  } catch (e) {
    journaliser('traces d’Auth non effacées, reprises à la prochaine passe', e);
    return { effacees: 0, echec: true };
  }
}

/**
 * Efface tout le dossier `{entrepriseId}/` d'un bucket (à toute profondeur : un compte peut déposer
 * dans `fichiers` sous le nom qu'il veut), puis vérifie qu'il est vide. Les noms sont lus dans la base,
 * le dossier se termine par `/` : celui d'une autre entreprise ne commence jamais par le même texte.
 */
async function viderDossier(bucket: 'factures' | 'fichiers', entrepriseId: string): Promise<void> {
  const dossier = `${entrepriseId}/`;
  let apres = '';
  for (;;) {
    const lot = await sql<{ name: string }[]>`
      select name from storage.objects
       where bucket_id = ${bucket} and starts_with(name, ${dossier}) and name > ${apres}
       order by name
       limit ${LOT}`;
    if (lot.length === 0) break;
    await effacer(
      bucket,
      lot.map((objet) => objet.name),
    );
    apres = lot[lot.length - 1].name;
  }
  const [{ restants }] = await sql<{ restants: number }[]>`
    select count(*)::int as restants from storage.objects
     where bucket_id = ${bucket} and starts_with(name, ${dossier})`;
  if (restants > 0) throw new Error(`${restants} objet(s) restent dans ${bucket}/${entrepriseId}/`);
}

/**
 * Purge l'entreprise ; rend `true` si c'est ce passage qui l'a supprimée. Lève si une étape échoue : la
 * passe suivante reprend (voir l'en-tête).
 */
async function purgerEntreprise(id: string): Promise<boolean> {
  // La demande est relue : elle a pu être annulée depuis la liste des entreprises échues.
  const [toujours] = await sql`select 1 from public.entreprises where id = ${id} and ${echue()}`;
  if (!toujours) return false;

  // a. Le Storage.
  await viderDossier('factures', id);
  await viderDossier('fichiers', id);

  // b. Auth. Lus dans `membres` avant d'être supprimés : la suppression d'un utilisateur emporte son
  // appartenance. Un utilisateur d'une autre entreprise est laissé (voir l'en-tête).
  const utilisateurs = await sql<{ user_id: string }[]>`
    select m.user_id from public.membres m
     where m.entreprise_id = ${id}
       and not exists (
         select 1 from public.membres autre
          where autre.user_id = m.user_id and autre.entreprise_id <> m.entreprise_id)`;
  for (const { user_id } of utilisateurs) await supprimerUtilisateur(user_id);

  // c. La base, en une transaction de purge : la suppression descend en cascade dans toutes les tables
  // de l'entreprise, y compris celles que ses déclencheurs figent hors purge. Par identifiant, sans
  // redemander l'échéance : le Storage et les utilisateurs sont partis, l'entreprise doit suivre, sans
  // quoi ses lignes resteraient sans membre ni date, et personne ne les reprendrait. L'échéance est
  // garantie par `supprimer-compte` (une demande échue n'est plus annulable). `lock_timeout` : une
  // relance en cours d'envoi tient l'entreprise (`relancer`) ; la suppression ne l'attend pas au-delà de
  // quelques secondes, l'entreprise est reprise la nuit suivante.
  const supprimees = await sql.begin(async (tx) => {
    await tx`select set_config('lock_timeout', ${`${ATTENTE_VERROU}s`}, true)`;
    await tx`set local facturx.purge = 'on'`;
    return await tx`delete from public.entreprises where id = ${id} returning id`;
  });
  if (supprimees.length === 0) {
    console.warn(JSON.stringify({ purger: 'entreprise déjà supprimée', entreprise: id }));
  }
  return supprimees.length > 0;
}

Deno.serve(
  traiter(async (req) => {
    if (!(await secretValide(req.headers.get('x-purge-secret')))) {
      // Une fonction sans secret utilisable refuse tout : sans ce journal, l'oubli passerait pour un 401
      // ordinaire.
      if (!secretConfigure()) {
        console.error(
          JSON.stringify({
            purger: 'PURGE_SECRET est absent, vide ou indigne d’un projet hébergé',
          }),
        );
      }
      throw erreur(401, 'SESSION', 'Secret de purge absent ou invalide.');
    }
    if (req.method !== 'POST') {
      const refus = erreur(405, 'METHODE', 'Seule la méthode POST est admise.');
      refus.headers.set('allow', 'POST');
      return refus;
    }

    let echecs = 0;
    const orphelins = await purgerOrphelins();
    if (orphelins.echec) echecs++;

    const echues = await sql<{ id: string }[]>`
      select id from public.entreprises where ${echue()} order by suppression_demandee_le, id`;
    let comptes = 0;
    for (const { id } of echues) {
      try {
        if (await purgerEntreprise(id)) comptes++;
      } catch (e) {
        echecs++;
        journaliser('entreprise non purgée, reprise à la prochaine passe', e, id);
      }
    }
    // Après les comptes : les traces de leurs utilisateurs, supprimés à l'instant, partent cette nuit.
    if ((await effacerTracesDAuth()).echec) echecs++;

    const bilan = { orphelins: orphelins.effaces, comptes };
    if (echecs > 0) {
      return erreur(
        500,
        'INTERNE',
        `La purge n’est pas allée au bout (${echecs} échec(s)) : voir les journaux de la fonction. Le reste est fait, la prochaine passe reprend.`,
        { ...bilan, echecs },
      );
    }
    return json(bilan);
  }),
);
