/**
 * Les mesures de la confirmation de D74 contre le projet déployé (docs/compte.md, « Confirmer D74 »).
 * Depuis la racine du dépôt, après `pnpm build && pnpm compte:preparer` :
 *
 *   deno run -A --no-lock --config supabase/functions/deno.json scripts/mesure-rendu/mesurer.ts <commande>
 *
 * Commandes :
 *   logo <sortie.png> [--grand]
 *       un logo PNG sous 1 Mio : du bruit RVBA de 510 × 510 (presque incompressible), ou, avec --grand,
 *       des aplats de 4 000 × 4 000 (quelques Ko, mais 64 Mo de pixels à décoder).
 *   rendu --config <nom> --regular <ttf> --gras <ttf> [--logo <png|jpg>] [--lignes 50] [--extreme]
 *         [--redeployer] --sortie <fichier.jsonl>
 *       la fonction jetable `mesure-rendu` : le froid (trois requêtes d'un seul rendu sur un worker
 *       neuf), puis le chaud (au moins 20 rendus de rang 1 ou plus, en lots de 3 au plus, réduits
 *       jusqu'à 1 sur un refus). Chaque réponse est ajoutée au fichier, brute.
 *   bilan <fichier.jsonl>…
 *       médiane, p95, froid import compris, refus ; puis la règle de D74 (sortie 0 : tenue,
 *       1 : dépassée, 3 : mesures incomplètes).
 *   rafale [--nombre 5] [--lignes 50] [--police <ttf>] [--logo <png|jpg>]
 *       des émissions simultanées par `emettre`, sur des brouillons du compte d'essai.
 *   corps <dossier>
 *       écrit les deux corps de 10 Mio de l'essai mémoire et en vérifie la forme, sans rien envoyer.
 *   memoire
 *       envoie ces corps à `importer` et à `emettre` ; un 422 est attendu des deux.
 *
 * Environnement (rendu, rafale, memoire) : MESURE_URL (https://<ref>.supabase.co), MESURE_CLE_PUBLIQUE
 * (la clé publique du projet), MESURE_EMAIL et MESURE_MOT_DE_PASSE (un compte d'essai confirmé, qu'on
 * supprime ensuite). Rien de cela n'est affiché.
 */

import { deflateSync } from 'node:zlib';
import { createClient } from '@supabase/supabase-js';
import {
  lireObjetPortable,
  OUVRANTS_MAX,
  PLAFOND_CORPS,
  PROFONDEUR_MAX,
  VIRGULES_MAX,
} from '../../supabase/functions/_shared/corps.ts';
import { toBase64, toPortableJson } from '../../supabase/functions/_vendor/shared/portable.ts';
import {
  apparenceDeTest,
  factureDeTest,
  NUMERO_PROPOSE,
} from '../../supabase/functions/tests/aide.ts';

/** Le budget de D74 : la moitié des 2 s de CPU d'une requête. */
const SEUIL_MS = 1000;
const FROIDS_VOULUS = 3;
const CHAUDS_VOULUS = 20;

// ---------------------------------------------------------------------------------------------------
// Arguments et environnement

function options(args: string[]): { libres: string[]; valeurs: Map<string, string | true> } {
  const libres: string[] = [];
  const valeurs = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) libres.push(a);
    else if (i + 1 < args.length && !args[i + 1].startsWith('--'))
      valeurs.set(a.slice(2), args[++i]);
    else valeurs.set(a.slice(2), true);
  }
  return { libres, valeurs };
}

function arreter(message: string): never {
  console.error(`mesurer : ${message}`);
  Deno.exit(2);
}

function env(nom: string): string {
  const valeur = Deno.env.get(nom)?.trim();
  if (!valeur) arreter(`${nom} : à définir (docs/compte.md).`);
  return valeur;
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------
// Le compte d'essai

interface Session {
  url: string;
  cle: string;
  jwt: string;
  entrepriseId: string;
  // biome-ignore lint/suspicious/noExplicitAny: le client typé n'apporte rien à un outil de mesure
  client: any;
}

async function session(): Promise<Session> {
  const url = env('MESURE_URL').replace(/\/+$/, '');
  const cle = env('MESURE_CLE_PUBLIQUE');
  const client = createClient(url, cle, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const connexion = await client.auth.signInWithPassword({
    email: env('MESURE_EMAIL'),
    password: env('MESURE_MOT_DE_PASSE'),
  });
  if (connexion.error || !connexion.data.session) {
    arreter(
      `connexion du compte d'essai refusée : ${connexion.error?.message ?? 'pas de session'}`,
    );
  }
  const membre = await client.from('membres').select('entreprise_id').single();
  if (membre.error) arreter(`entreprise du compte d'essai introuvable : ${membre.error.message}`);
  return {
    url,
    cle,
    jwt: connexion.data.session.access_token,
    entrepriseId: membre.data.entreprise_id,
    client,
  };
}

interface Reponse {
  http: number;
  client_ms: number;
  // biome-ignore lint/suspicious/noExplicitAny: réponse JSON brute, consignée telle quelle
  corps: any;
}

async function appeler(s: Session, fonction: string, texte: string): Promise<Reponse> {
  const debut = performance.now();
  let http = 0;
  let corps: unknown;
  try {
    const reponse = await fetch(`${s.url}/functions/v1/${fonction}`, {
      method: 'POST',
      headers: {
        apikey: s.cle,
        authorization: `Bearer ${s.jwt}`,
        'content-type': 'application/json',
      },
      body: texte,
      signal: AbortSignal.timeout(180_000),
    });
    http = reponse.status;
    const brut = await reponse.text();
    try {
      corps = JSON.parse(brut);
    } catch {
      corps = brut.slice(0, 300);
    }
  } catch (e) {
    corps = `réseau : ${e instanceof Error ? e.message : String(e)}`;
  }
  return { http, client_ms: Math.round(performance.now() - debut), corps };
}

/** Le type d'une image d'après ses premiers octets, comme le serveur. */
function typeImage(octets: Uint8Array): 'png' | 'jpeg' {
  if (octets[0] === 0x89 && octets[1] === 0x50 && octets[2] === 0x4e && octets[3] === 0x47) {
    return 'png';
  }
  if (octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) return 'jpeg';
  arreter('le logo doit être un PNG ou un JPEG.');
}

// ---------------------------------------------------------------------------------------------------
// logo

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(octets: Uint8Array): number {
  let c = 0xffffffff;
  for (const o of octets) c = CRC[(c ^ o) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloc(type: string, donnees: Uint8Array): Uint8Array {
  const sortie = new Uint8Array(12 + donnees.length);
  const vue = new DataView(sortie.buffer);
  vue.setUint32(0, donnees.length);
  sortie.set(new TextEncoder().encode(type), 4);
  sortie.set(donnees, 8);
  vue.setUint32(8 + donnees.length, crc32(sortie.subarray(4, 8 + donnees.length)));
  return sortie;
}

/** Un PNG RVBA 8 bits, `pixel(x, y)` donnant les quatre composantes. */
function png(
  largeur: number,
  hauteur: number,
  pixel: (x: number, y: number) => number[],
): Uint8Array {
  const ligne = 1 + largeur * 4;
  const brut = new Uint8Array(ligne * hauteur);
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) brut.set(pixel(x, y), y * ligne + 1 + x * 4);
  }
  const entete = new Uint8Array(13);
  const vue = new DataView(entete.buffer);
  vue.setUint32(0, largeur);
  vue.setUint32(4, hauteur);
  entete.set([8, 6, 0, 0, 0], 8);
  const parties = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    bloc('IHDR', entete),
    bloc('IDAT', new Uint8Array(deflateSync(brut))),
    bloc('IEND', new Uint8Array()),
  ];
  const sortie = new Uint8Array(parties.reduce((n, p) => n + p.length, 0));
  let position = 0;
  for (const p of parties) {
    sortie.set(p, position);
    position += p.length;
  }
  return sortie;
}

function logo(sortie: string, grand: boolean): void {
  const octets = grand
    ? // Quatre bandes de couleur unie : l'image d'un logo exporté en très grand.
      png(
        4000,
        4000,
        (_, y) =>
          [
            [176, 65, 62, 255],
            [17, 17, 17, 255],
            [255, 255, 255, 0],
          ][y % 3],
      )
    : png(510, 510, () => {
        const v = crypto.getRandomValues(new Uint8Array(4));
        return [v[0], v[1], v[2], v[3]];
      });
  if (octets.length > 1024 * 1024) arreter(`logo de ${octets.length} octets : au-delà de 1 Mio.`);
  Deno.writeFileSync(sortie, octets);
  console.log(`${sortie} : ${octets.length} octets, ${grand ? '4000 × 4000' : '510 × 510'} RVBA`);
}

// ---------------------------------------------------------------------------------------------------
// rendu

interface Releve {
  config: string;
  extreme: boolean;
  lignes: number;
  phase: 'froid' | 'chaud';
  lot: number;
  http: number;
  client_ms: number;
  requete?: number;
  rang_premier?: number;
  modules_ms?: number;
  rendus?: number[];
  pages?: number;
  pdf_octets?: number;
  memoire?: unknown;
  erreur?: unknown;
  date: string;
}

async function rendu(o: Map<string, string | true>): Promise<void> {
  const config = o.get('config');
  const regular = o.get('regular');
  const gras = o.get('gras');
  const fichier = o.get('sortie');
  if (typeof config !== 'string' || typeof regular !== 'string' || typeof gras !== 'string') {
    arreter('rendu : --config, --regular et --gras sont requis.');
  }
  if (typeof fichier !== 'string') arreter('rendu : --sortie <fichier.jsonl> est requis.');
  const lignes = Number(o.get('lignes') ?? 50);
  const extreme = o.get('extreme') === true;
  const redeployer = o.get('redeployer') === true;
  const cheminLogo = o.get('logo');
  const logoOctets = typeof cheminLogo === 'string' ? Deno.readFileSync(cheminLogo) : undefined;
  const corps = (runs: number) =>
    JSON.stringify({
      regular: toBase64(Deno.readFileSync(regular)),
      bold: toBase64(Deno.readFileSync(gras)),
      ...(logoOctets
        ? { logo: { base64: toBase64(logoOctets), type: typeImage(logoOctets) } }
        : {}),
      lignes,
      runs,
    });

  const s = await session();
  const releves: Releve[] = [];
  const consigner = async (phase: Releve['phase'], lot: number): Promise<Releve> => {
    const r = await appeler(s, 'mesure-rendu', corps(lot));
    const ok = r.http === 200 && Array.isArray(r.corps?.rendus);
    const releve: Releve = {
      config,
      extreme,
      lignes,
      phase,
      lot,
      http: r.http,
      client_ms: r.client_ms,
      ...(ok
        ? {
            requete: r.corps.requete,
            rang_premier: r.corps.rang_premier,
            modules_ms: r.corps.modules_ms,
            rendus: r.corps.rendus,
            pages: r.corps.pages,
            pdf_octets: r.corps.pdf_octets,
            memoire: r.corps.memoire,
          }
        : { erreur: r.corps }),
      date: new Date().toISOString(),
    };
    releves.push(releve);
    await Deno.writeTextFile(fichier, `${JSON.stringify(releve)}\n`, { append: true });
    const resume = ok
      ? `requête ${releve.requete} du worker, rang ${releve.rang_premier}, rendus ${releve.rendus?.join(' / ')} ms`
      : `REFUS ${JSON.stringify(releve.erreur).slice(0, 160)}`;
    console.log(
      `${config} ${lignes} l. ${phase} lot ${lot} : HTTP ${r.http}, ${r.client_ms} ms — ${resume}`,
    );
    return releve;
  };

  // Le froid : un seul rendu, sur un worker neuf (sa première requête). Un worker se retire de lui-même
  // après environ 1 s de CPU (mesure locale) ; sinon, --redeployer en force un neuf à chaque essai.
  let froids = 0;
  for (let essai = 1; essai <= 12 && froids < FROIDS_VOULUS; essai++) {
    if (redeployer) {
      const deploiement = await new Deno.Command('supabase', {
        args: [
          'functions',
          'deploy',
          'mesure-rendu',
          '--import-map',
          'supabase/functions/deno.json',
          '--yes',
        ],
        stdout: 'null',
        stderr: 'inherit',
      }).output();
      if (!deploiement.success) arreter('le redéploiement de mesure-rendu a échoué.');
      await attendre(5000);
    } else if (essai > 1) {
      await attendre(3000);
    }
    const r = await consigner('froid', 1);
    if (r.http !== 200) break;
    if (r.requete === 1) froids++;
  }
  if (froids < FROIDS_VOULUS) {
    console.log(
      `froid : ${froids} worker(s) neuf(s) sur ${FROIDS_VOULUS} ; relancer avec --redeployer.`,
    );
  }

  // Le chaud : des lots de 3 rendus au plus ; un refus réduit le lot, jusqu'à un seul rendu.
  let lot = 3;
  let chauds = 0;
  for (let n = 0; n < 40 && chauds < CHAUDS_VOULUS; n++) {
    const r = await consigner('chaud', lot);
    if (r.rendus) {
      chauds += r.rendus.filter((_, i) => (r.rang_premier ?? 0) + i >= 1).length;
    } else if (lot > 1) {
      lot--;
    } else {
      console.log('un rendu seul est refusé : la règle de D74 tranche (voir bilan).');
      break;
    }
  }
  bilan(releves);
}

// ---------------------------------------------------------------------------------------------------
// bilan

const arrondi = (ms: number) => Math.round(ms * 10) / 10;

function statistiques(ms: number[]) {
  const trie = [...ms].sort((a, b) => a - b);
  const n = trie.length;
  if (n === 0) return undefined;
  const mediane = n % 2 ? trie[(n - 1) / 2] : (trie[n / 2 - 1] + trie[n / 2]) / 2;
  return {
    n,
    mediane: arrondi(mediane),
    p95: arrondi(trie[Math.ceil(0.95 * n) - 1]),
    max: arrondi(trie[n - 1]),
  };
}

type Etat = 'tenu' | 'dépassé' | 'incomplet';

function bilan(releves: Releve[]): Etat {
  const groupes = new Map<string, Releve[]>();
  for (const r of releves) {
    const cle = `${r.config}\u0000${r.lignes}`;
    groupes.set(cle, [...(groupes.get(cle) ?? []), r]);
  }
  const echecs: { config: string; extreme: boolean }[] = [];
  let incomplet = false;
  for (const groupe of groupes.values()) {
    const { config, lignes, extreme } = groupe[0];
    const chauds: number[] = [];
    const froids: { rendu: number; importCompris: number }[] = [];
    for (const r of groupe) {
      if (!r.rendus) continue;
      r.rendus.forEach((ms, i) => {
        if ((r.rang_premier ?? 0) + i >= 1) chauds.push(ms);
      });
      if (r.lot === 1 && r.requete === 1 && r.rang_premier === 0) {
        froids.push({ rendu: r.rendus[0], importCompris: (r.modules_ms ?? 0) + r.rendus[0] });
      }
    }
    const refus = groupe.filter((r) => !r.rendus);
    const refusSeul = refus.filter((r) => r.lot === 1);
    const chaud = statistiques(chauds);
    const froidMax = froids.length ? Math.max(...froids.map((f) => f.importCompris)) : undefined;
    const modules = groupe.find((r) => r.requete === 1 && r.modules_ms !== undefined)?.modules_ms;

    console.log(`\n== ${config}, ${lignes} lignes${extreme ? ' (cas extrême)' : ''}`);
    console.log(
      chaud
        ? `chaud : ${chaud.n} rendus, médiane ${chaud.mediane} ms, p95 ${chaud.p95} ms, max ${chaud.max} ms`
        : 'chaud : aucun rendu',
    );
    console.log(
      froids.length
        ? `froid : ${froids.map((f) => `${arrondi(f.importCompris)} (dont rendu ${f.rendu})`).join(', ')} ms, import compris`
        : 'froid : aucun worker neuf mesuré',
    );
    if (modules !== undefined && modules > 10_000) {
      console.log(
        `modules_ms = ${modules} ms : l'origine du temps n'est pas la naissance du worker ; lire les journaux (docs/compte.md).`,
      );
    }
    if (refus.length) {
      console.log(
        `refus : ${refus.map((r) => `HTTP ${r.http} sur un lot de ${r.lot}`).join(', ')}`,
      );
    }
    if (lignes !== 50) continue;
    const depasse =
      (chaud !== undefined && chaud.p95 > SEUIL_MS) ||
      (froidMax !== undefined && froidMax >= SEUIL_MS) ||
      refusSeul.length > 0;
    if (depasse) {
      echecs.push({ config, extreme });
      console.log(`→ règle de D74 dépassée (seuil ${SEUIL_MS} ms, ou un rendu seul refusé)`);
    } else if (!chaud || chaud.n < CHAUDS_VOULUS || froids.length < FROIDS_VOULUS) {
      incomplet = true;
      console.log(
        `→ incomplet : il faut ${CHAUDS_VOULUS} rendus à chaud et ${FROIDS_VOULUS} froids`,
      );
    } else {
      console.log('→ tenu');
    }
  }

  console.log('');
  if (echecs.length === 0) {
    if (incomplet) {
      console.log('BILAN : incomplet — compléter les mesures avant de conclure.');
      return 'incomplet';
    }
    console.log("BILAN : D74 confirmée pour ces configurations — l'émission rend dans sa requête.");
    return 'tenu';
  }
  if (echecs.every((e) => e.extreme)) {
    console.log(
      `BILAN : seul le cas extrême dépasse (${echecs.map((e) => e.config).join(', ')}) — décision de l'utilisateur : plafonner les polices et logos (poids ou dimensions), ou la tâche 9.`,
    );
  } else {
    console.log(
      `BILAN : règle de D74 dépassée (${echecs.map((e) => e.config).join(', ')}) — la tâche 9 (rendu différé) s'applique.`,
    );
  }
  return 'dépassé';
}

// ---------------------------------------------------------------------------------------------------
// rafale

async function rafale(o: Map<string, string | true>): Promise<void> {
  const nombre = Number(o.get('nombre') ?? 5);
  const lignes = Number(o.get('lignes') ?? 50);
  const s = await session();
  const e = s.entrepriseId;

  // L'apparence du Studio par défaut, avec la police et le logo donnés, déposés dans `fichiers`.
  const apparence: Record<string, unknown> = apparenceDeTest();
  const deposer = async (cle: string, chemin: string, type: string) => {
    const { error } = await s.client.storage
      .from('fichiers')
      .upload(`${e}/${cle}`, Deno.readFileSync(chemin), { contentType: type, upsert: true });
    if (error) arreter(`dépôt de ${chemin} refusé : ${error.message}`);
  };
  const police = o.get('police');
  if (typeof police === 'string') {
    await deposer('mesure-police', police, 'font/ttf');
    apparence.font = 'custom';
    apparence.customFont = { regularKey: 'mesure-police' };
  }
  const cheminLogo = o.get('logo');
  if (typeof cheminLogo === 'string') {
    const type = typeImage(Deno.readFileSync(cheminLogo));
    await deposer('mesure-logo', cheminLogo, `image/${type}`);
    apparence.logo = { key: 'mesure-logo', type, position: 'left', height: 44 };
  }

  const crees = await s.client
    .from('brouillons')
    .insert(
      Array.from({ length: nombre }, () => ({
        entreprise_id: e,
        form: { id: NUMERO_PROPOSE },
        appearance: apparence,
      })),
    )
    .select('id, version');
  if (crees.error) arreter(`brouillons : ${crees.error.message}`);
  const facture = factureDeTest(lignes);
  console.log(`${nombre} émissions simultanées de ${lignes} lignes…`);
  const debut = performance.now();
  const reponses = await Promise.all(
    (crees.data as { id: string; version: number }[]).map((b) =>
      appeler(
        s,
        'emettre',
        toPortableJson(
          { brouillonId: b.id, version: b.version, invoice: facture, appearance: apparence },
          { compact: true },
        ),
      ),
    ),
  );
  const total = Math.round(performance.now() - debut);
  for (const r of reponses) {
    const quoi = r.http === 201 ? r.corps.numero : JSON.stringify(r.corps).slice(0, 160);
    console.log(`HTTP ${r.http}, ${r.client_ms} ms — ${quoi}`);
  }
  const numeros = reponses.filter((r) => r.http === 201).map((r) => String(r.corps.numero));
  const rangs = numeros.map((n) => Number(n.match(/(\d+)\D*$/)?.[1])).sort((a, b) => a - b);
  const suivis = rangs.every((r, i) => i === 0 || r === rangs[i - 1] + 1);
  console.log(`rafale : ${total} ms en tout ; ${numeros.length}/${nombre} émises`);
  if (numeros.length !== nombre || new Set(numeros).size !== nombre || !suivis) {
    console.log(
      'RAFALE : ÉCHEC — émissions refusées, ou numéros non consécutifs (journaux de emettre).',
    );
    Deno.exit(1);
  }
  console.log(`RAFALE : tenue — numéros ${numeros.join(', ')}, consécutifs et sans doublon.`);
}

// ---------------------------------------------------------------------------------------------------
// corps et memoire : la pire forme admise connue (supabase/functions/tests/decodage-large.ts),
// placée là où chaque fonction la lit jusqu'au bout avant de refuser le corps.

/** Un conteneur qui devient un `Uint8Array` de 12 octets : le plus lourd à vivre, mesuré. */
const OCTETS = '{"$bytes":"AAAAAAAAAAAAAAAA"}';

/**
 * `avant` + `{"€":` + la pire forme + `}` + `apres` : 64 niveaux, 100 000 conteneurs, 150 000 virgules
 * et 10 Mio au total, une fois comptés ceux que l'enveloppe prend déjà (`niveaux` ouverts autour de
 * l'objet `{"€":…}`, `conteneurs` et `virgules` dans `avant` et `apres`). Sans enveloppe (0, 0, 0),
 * c'est la forme de `pire()` dans decodage-large.ts, au remplissage près (compté ici en octets UTF-8,
 * comme le plafond du corps).
 */
function pireCorps(
  avant: string,
  apres: string,
  niveaux: number,
  conteneurs: number,
  virgules: number,
) {
  const tableaux = PROFONDEUR_MAX - niveaux - 2;
  const nombre = OUVRANTS_MAX - conteneurs - 1 - tableaux - 1;
  const entrees = VIRGULES_MAX - virgules - nombre;
  const cles = Array.from({ length: entrees }, (_, i) => `"cle${i}":"valeur-${i}"`).join(',');
  const debut = `${avant}{"€":${'['.repeat(tableaux)}${Array(nombre).fill(OCTETS).join(',')},{"gros":"`;
  const fin = `",${cles}}${']'.repeat(tableaux)}}${apres}`;
  const octets = (t: string) => new TextEncoder().encode(t).length;
  const remplissage = PLAFOND_CORPS - octets(debut) - octets(fin) - 64;
  return `${debut}${'x'.repeat(remplissage)}${fin}`;
}

/** Les deux corps, vérifiés : admis par le pré-examen, aux quatre limites, sous 10 Mio. */
function corpsMemoire(): { importer: string; emettre: string } {
  const corps = {
    // importer lit, contrôle et sérialise `form`, puis refuse le « PDF » (les octets « pas un PDF »,
    // comme dans ses tests : 422 FACTURX) : rien n'est importé.
    importer: pireCorps(
      '{"pdf":{"$bytes":"cGFzIHVuIFBERg=="},"appearance":{},"form":',
      '}',
      1,
      3,
      2,
    ),
    // emettre lit et contrôle `invoice`, puis refuse l'apparence absente (422 CORPS) : rien n'est émis.
    emettre: pireCorps(
      `{"brouillonId":"${crypto.randomUUID()}","version":1,"invoice":`,
      '}',
      1,
      1,
      2,
    ),
  };
  for (const [nom, texte] of Object.entries(corps)) {
    let profondeur = 0;
    let maximum = 0;
    let conteneurs = 0;
    let virgules = 0;
    let dansUneChaine = false;
    for (let i = 0; i < texte.length; i++) {
      const c = texte[i];
      if (dansUneChaine) {
        if (c === '\\') i++;
        else if (c === '"') dansUneChaine = false;
      } else if (c === '"') dansUneChaine = true;
      else if (c === '[' || c === '{') {
        conteneurs++;
        maximum = Math.max(maximum, ++profondeur);
      } else if (c === ']' || c === '}') profondeur--;
      else if (c === ',') virgules++;
    }
    const taille = new TextEncoder().encode(texte).length;
    lireObjetPortable(texte, 'essai mémoire'); // lève si le pré-examen ou le décodage refuse
    const juste =
      maximum === PROFONDEUR_MAX &&
      conteneurs === OUVRANTS_MAX &&
      virgules === VIRGULES_MAX &&
      taille <= PLAFOND_CORPS &&
      taille > PLAFOND_CORPS - 1024;
    console.log(
      `${nom} : ${taille} octets, ${maximum} niveaux, ${conteneurs} conteneurs, ${virgules} virgules${juste ? '' : ' — FORME INATTENDUE'}`,
    );
    if (!juste) Deno.exit(1);
  }
  return corps;
}

async function memoire(): Promise<void> {
  const corps = corpsMemoire();
  const s = await session();
  let tenu = true;
  for (const fonction of ['importer', 'emettre'] as const) {
    const r = await appeler(s, fonction, corps[fonction]);
    const code = typeof r.corps === 'object' ? r.corps?.code : r.corps;
    const attendu = r.http === 422;
    tenu &&= attendu;
    console.log(
      `${fonction} : HTTP ${r.http} ${code ?? ''}, ${r.client_ms} ms${attendu ? '' : ' — 422 attendu : lire les journaux de la fonction'}`,
    );
  }
  console.log(
    tenu
      ? 'MÉMOIRE : tenue — les deux corps de 10 Mio sont lus puis refusés proprement.'
      : 'MÉMOIRE : ÉCHEC — un 546, un 500 ou « Memory limit exceeded » : baisser le plafond du corps.',
  );
  if (!tenu) Deno.exit(1);
}

// ---------------------------------------------------------------------------------------------------

const [commande, ...reste] = Deno.args;
const { libres, valeurs } = options(reste);
switch (commande) {
  case 'logo':
    if (!libres[0]) arreter('logo <sortie.png> [--grand]');
    logo(libres[0], valeurs.get('grand') === true);
    break;
  case 'rendu':
    await rendu(valeurs);
    break;
  case 'bilan': {
    if (libres.length === 0) arreter('bilan <fichier.jsonl>…');
    const releves = libres.flatMap((f) =>
      Deno.readTextFileSync(f)
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as Releve),
    );
    const etat = bilan(releves);
    if (etat !== 'tenu') Deno.exit(etat === 'dépassé' ? 1 : 3);
    break;
  }
  case 'rafale':
    await rafale(valeurs);
    break;
  case 'corps': {
    if (!libres[0]) arreter('corps <dossier>');
    const corps = corpsMemoire();
    Deno.mkdirSync(libres[0], { recursive: true });
    for (const [nom, texte] of Object.entries(corps)) {
      Deno.writeTextFileSync(`${libres[0]}/${nom}.json`, texte);
    }
    break;
  }
  case 'memoire':
    await memoire();
    break;
  default:
    arreter('commande attendue : logo, rendu, bilan, rafale, corps ou memoire (voir l’en-tête).');
}
