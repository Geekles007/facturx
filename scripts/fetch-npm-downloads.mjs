/**
 * Relève le nombre de téléchargements du paquet sur npm et l'écrit dans site/npm-downloads.json,
 * que la page d'accueil affiche :
 *
 *   pnpm downloads:fetch
 *
 * Le relevé a lieu ici, pendant la construction, et non dans le navigateur du visiteur : la page
 * ne contacte toujours aucun tiers, il n'y a donc toujours rien à consentir, et le chiffre
 * s'affiche même si l'API npm est indisponible au moment de la visite.
 *
 * Contrepartie : le chiffre date du dernier déploiement. Le fichier porte donc la fin de la
 * période mesurée, que la page affiche à côté du nombre — figé, il reste daté plutôt que faux.
 *
 * Une API indisponible n'arrête pas la construction : le fichier n'est pas écrit (ou garde sa
 * valeur précédente) et la page s'affiche simplement sans ce chiffre.
 */

import { realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Le paquet publié, celui dont la page annonce la version. */
export const PACKAGE = 'facturx-sdk';
/** 30 jours glissants : le point « last-month » de l'API publique de npm, sans clé ni compte. */
export const ENDPOINT = `https://api.npmjs.org/downloads/point/last-month/${PACKAGE}`;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Réduit la réponse de l'API au strict nécessaire, en refusant tout ce qui ne ressemble pas à un
 * relevé : mieux vaut pas de chiffre du tout qu'un chiffre inventé ou mal daté.
 */
export function readDownloadsPoint(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`réponse inattendue : objet attendu, reçu ${JSON.stringify(payload)}`);
  }
  const { downloads, start, end, package: name } = payload;
  if (name !== PACKAGE) {
    throw new Error(
      `réponse inattendue : paquet ${JSON.stringify(name)} au lieu de « ${PACKAGE} »`,
    );
  }
  if (!Number.isInteger(downloads) || downloads < 0) {
    throw new Error(`réponse inattendue : « downloads » vaut ${JSON.stringify(downloads)}`);
  }
  for (const [champ, valeur] of [
    ['start', start],
    ['end', end],
  ]) {
    if (typeof valeur !== 'string' || !ISO_DAY.test(valeur)) {
      throw new Error(`réponse inattendue : « ${champ} » vaut ${JSON.stringify(valeur)}`);
    }
  }
  if (end < start) throw new Error(`réponse inattendue : période ${start} → ${end} à l'envers`);
  return { package: name, downloads, start, end };
}

async function main() {
  const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'site/npm-downloads.json');
  let point;
  try {
    const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`${ENDPOINT} → HTTP ${res.status}`);
    point = readDownloadsPoint(await res.json());
  } catch (error) {
    // Un chiffre d'agrément ne fait pas échouer la construction du site.
    console.warn(`téléchargements npm : indisponibles (${error.message}).`);
    console.warn('  → la page d’accueil s’affichera sans ce chiffre.');
    return;
  }
  writeFileSync(target, `${JSON.stringify(point, null, 2)}\n`);
  console.log(
    `téléchargements npm : ${point.downloads} sur 30 jours (${point.start} → ${point.end}) → site/npm-downloads.json`,
  );
}

// Exécuté directement : on relève. Importé (par son test) : on n'expose que les fonctions.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
