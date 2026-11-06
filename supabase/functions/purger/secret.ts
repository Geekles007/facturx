/**
 * Le secret de la fonction `purger` : seule la tâche de nuit de la base (`pg_cron`, `pg_net`) l'appelle,
 * et elle prouve qui elle est par l'en-tête `x-purge-secret`, égal à la variable `PURGE_SECRET`. La
 * fonction n'a pas d'autre authentification (`verify_jwt = false`, pas de session) : sans ce secret,
 * n'importe qui déclencherait une purge.
 *
 * Fermé par défaut : une variable absente ou vide refuse tout, y compris un en-tête absent ou vide (deux
 * valeurs vides ne s'égalent pas). Sur un projet hébergé par Supabase, un secret trop court (moins de 32
 * caractères) ou celui d'exemple de `.env.example` est refusé de même, comme `relancer` y refuse
 * `simule` : copier le fichier d'exemple en production ne doit pas ouvrir la purge au premier qui le
 * lit dans le dépôt. Les deux valeurs sont comparées en temps constant, après avoir été ramenées à une
 * empreinte de longueur fixe : ni le contenu du secret ni sa longueur ne se déduisent du temps de la
 * réponse.
 */
import { timingSafeEqual } from 'node:crypto';
import { projetHeberge } from '../_shared/contexte.ts';

/** La valeur de `PURGE_SECRET` dans `.env.example` (publique, dans le dépôt). */
export const SECRET_D_EXEMPLE = 'secret-de-purge-pour-les-essais-locaux';

/** Longueur minimale d'un secret sur un projet hébergé. */
export const LONGUEUR_MINIMALE = 32;

/** L'empreinte SHA-256 de `texte` : 32 octets, quelle que soit sa longueur. */
async function empreinte(texte: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte)));
}

/** Le secret de l'environnement, ou `undefined` s'il est absent, vide ou indigne de ce projet. */
function secretAttendu(): string | undefined {
  const secret = Deno.env.get('PURGE_SECRET');
  if (!secret) return undefined;
  if (projetHeberge() && (secret === SECRET_D_EXEMPLE || secret.length < LONGUEUR_MINIMALE)) {
    return undefined;
  }
  return secret;
}

/** Un secret utilisable est-il configuré ? Sinon la fonction refuse tout. */
export function secretConfigure(): boolean {
  return secretAttendu() !== undefined;
}

/** `recu` (l'en-tête `x-purge-secret`) est-il le secret `PURGE_SECRET`, lu à chaque appel ? */
export async function secretValide(recu: string | null): Promise<boolean> {
  const attendu = secretAttendu();
  if (!attendu || !recu) return false;
  return timingSafeEqual(await empreinte(recu), await empreinte(attendu));
}
