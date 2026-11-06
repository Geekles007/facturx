/**
 * Le jour de Paris. Les dates d'affaires (émission, paiement, relance) se comptent en Europe/Paris,
 * alors que le serveur tourne en UTC. Le module n'importe rien : les règles de l'émission et leurs
 * tests l'emploient sans la pile.
 */

const PARIS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Le jour de `maintenant` à Paris, en ISO `AAAA-MM-JJ`. À 00 h 30 à Paris, la date UTC est encore
 * celle de la veille.
 */
export function aujourdhuiParis(maintenant: Date): string {
  const parties = Object.fromEntries(
    PARIS.formatToParts(maintenant).map((partie) => [partie.type, partie.value]),
  );
  return `${parties.year}-${parties.month}-${parties.day}`;
}

/**
 * Le premier jour que Postgres admet pour une date d'affaires écrite par les fonctions. `isValidIsoDate`
 * du SDK et le lecteur XML lisent l'an 0 (`0000-01-01`) comme 1900 ; le type `date` le refuse (22008), et
 * ce serait un 500. Une date de l'an 0 est donc refusée en amont, après `isValidIsoDate`.
 */
export const PREMIER_JOUR = '0001-01-01';

/** La date ISO valide `iso` est-elle enregistrable (année 0001 au moins) ? */
export const dateAdmise = (iso: string): boolean => iso >= PREMIER_JOUR;
