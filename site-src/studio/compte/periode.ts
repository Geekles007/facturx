/**
 * Les dates du tableau de bord : la période choisie (le mois ou l'année d'un jour donné) et le
 * décompte des jours des échéances. Des dates d'affaires `AAAA-MM-JJ`, sans heure ni fuseau : le jour
 * de départ est celui de Paris (`aujourdhuiParis`), comme en base, et le calcul se fait en UTC, où
 * aucun changement d'heure ne fait sauter un jour.
 *
 * Chargé par `import()` avec la navigation du compte.
 */

export type TypePeriode = 'mois' | 'annee';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Le jour `AAAA-MM-JJ`, lu en UTC ; une date illisible ou impossible (30 février) lève. */
function lire(jour: string): Date {
  const m = DATE.exec(jour);
  const date = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : undefined;
  if (!date || ecrire(date) !== jour) throw new RangeError(`date illisible : « ${jour} »`);
  return date;
}

const ecrire = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * La période qui contient `aujourdhui`, bornes incluses : du premier au dernier jour de son mois, ou
 * du 1er janvier au 31 décembre de son année.
 */
export function periode(type: TypePeriode, aujourdhui: string): { debut: string; fin: string } {
  const jour = lire(aujourdhui);
  const annee = jour.getUTCFullYear();
  if (type === 'annee') return { debut: `${annee}-01-01`, fin: `${annee}-12-31` };
  const mois = jour.getUTCMonth();
  // Le jour 0 du mois suivant est le dernier de celui-ci : 28, 29, 30 ou 31.
  return {
    debut: ecrire(new Date(Date.UTC(annee, mois, 1))),
    fin: ecrire(new Date(Date.UTC(annee, mois + 1, 0))),
  };
}

/** Le jour `n` jours après `jour` (avant, si `n` est négatif). */
export function ajouterJours(jour: string, n: number): string {
  const date = lire(jour);
  date.setUTCDate(date.getUTCDate() + n);
  return ecrire(date);
}
