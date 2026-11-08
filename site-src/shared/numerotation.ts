/**
 * La numérotation des factures, partagée entre le Studio et les Edge Functions : même gabarit, même
 * rang, même vérification des caractères des deux côtés.
 *
 * Le module n'importe rien. `pnpm compte:preparer` le copie tel quel pour Deno, qui ne résout pas
 * un `./x.js` vers `./x.ts` comme esbuild ou vitest.
 */

export interface Numbering {
  /** Gabarit : `{AAAA}` année, `{AA}` année sur deux chiffres, `{MM}` mois, `{N…}` compteur sur autant de chiffres. */
  pattern: string;
  /** Prochain numéro de la séquence. */
  next: number;
  /** Recommencer à 1 chaque année. */
  yearly: boolean;
  /** Année du dernier numéro attribué, pour la remise à zéro annuelle. */
  year: number;
}

/** Numéro obtenu avec `pattern` pour le rang `n` à la date `iso`. */
export function formatNumber(pattern: string, n: number, iso: string): string {
  const [year = '2026', month = '01'] = iso.split('-');
  return pattern
    .replace(/\{(AAAA|YYYY)\}/g, year)
    .replace(/\{(AA|YY)\}/g, year.slice(2))
    .replace(/\{MM\}/g, month)
    .replace(/\{(N+)\}/g, (_, width: string) => String(n).padStart(width.length, '0'));
}

/** Rang à utiliser pour une facture datée de `iso`, remise à zéro annuelle comprise. */
export function nextRank(numbering: Numbering, iso: string): number {
  const year = Number(iso.slice(0, 4));
  return numbering.yearly && year > numbering.year ? 1 : numbering.next;
}

/**
 * Rang d'un numéro composé avec `pattern` (`F-2026-0042` → 42), ou `undefined` s'il n'en suit pas
 * le gabarit — un numéro saisi à la main, par exemple.
 */
export function rankOf(pattern: string, id: string): number | undefined {
  let groups = 0;
  const source = pattern
    .split(/(\{(?:AAAA|YYYY|AA|YY|MM|N+)\})/)
    .map((part) => {
      if (/^\{(AAAA|YYYY)\}$/.test(part)) return '\\d{4}';
      if (/^\{(AA|YY|MM)\}$/.test(part)) return '\\d{2}';
      if (/^\{N+\}$/.test(part)) {
        groups++;
        return '(\\d+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  if (groups !== 1) return undefined;
  const match = new RegExp(`^${source}$`).exec(id.trim());
  return match ? Number(match[1]) : undefined;
}

/**
 * La numérotation après l'émission d'une facture datée de `iso`. Si le numéro émis suit le
 * gabarit avec un rang plus élevé que prévu, la séquence repart de lui : jamais de retour en arrière.
 */
export function advance(numbering: Numbering, iso: string, id?: string): Numbering {
  const year = Number(iso.slice(0, 4));
  const issued = id === undefined ? undefined : rankOf(numbering.pattern, id);
  const next = Math.max(nextRank(numbering, iso), issued ?? 0) + 1;
  return { ...numbering, next, year: Math.max(year, numbering.year) };
}

/** BR-FR-01 et BR-FR-02 : 35 caractères au plus, parmi A-Z a-z 0-9 - + _ /. */
export function numberProblems(id: string): ('length' | 'chars')[] {
  const out: ('length' | 'chars')[] = [];
  if (id.length > 35) out.push('length');
  if (id !== '' && !/^[A-Za-z0-9+_/-]+$/.test(id)) out.push('chars');
  return out;
}

/** Nom de fichier sûr, tiré du numéro de facture. */
export const fileStem = (id: string): string =>
  id.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'facture';
