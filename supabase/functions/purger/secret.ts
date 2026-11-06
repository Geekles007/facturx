/**
 * Le secret de la fonction `purger` : seule la tâche de nuit de la base (`pg_cron`, `pg_net`) l'appelle,
 * et elle prouve qui elle est par l'en-tête `x-purge-secret`, égal à la variable `PURGE_SECRET`. La
 * fonction n'a pas d'autre authentification (`verify_jwt = false`, pas de session) : sans ce secret,
 * n'importe qui déclencherait une purge.
 *
 * Fermé par défaut : une variable absente ou vide refuse tout, y compris un en-tête absent ou vide (deux
 * valeurs vides ne s'égalent pas). Les deux valeurs sont comparées en temps constant, après avoir été
 * ramenées à une empreinte de longueur fixe : ni le contenu du secret ni sa longueur ne se déduisent du
 * temps de la réponse.
 */
import { timingSafeEqual } from 'node:crypto';

/** L'empreinte SHA-256 de `texte` : 32 octets, quelle que soit sa longueur. */
async function empreinte(texte: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte)));
}

/** `recu` (l'en-tête `x-purge-secret`) est-il le secret `PURGE_SECRET`, lu à chaque appel ? */
export async function secretValide(recu: string | null): Promise<boolean> {
  const attendu = Deno.env.get('PURGE_SECRET');
  if (!attendu || !recu) return false;
  return timingSafeEqual(await empreinte(recu), await empreinte(attendu));
}
