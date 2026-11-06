/**
 * Les règles de date de l'émission (spec § 7, étape 5) : « aujourd'hui » est le jour de Paris, et
 * une facture n'est datée ni après lui, ni avant la dernière facture de l'entreprise, pour que la
 * numérotation reste chronologique.
 *
 * Le module n'importe rien : `_shared/contexte.ts` en tire l'horloge de `emettre` et de `relancer`,
 * et les tests l'emploient sans la pile.
 */

const PARIS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Le jour de `maintenant` à Paris, en ISO `AAAA-MM-JJ`. Le serveur tourne en UTC : à 00 h 30 à
 * Paris, la date UTC est encore celle de la veille.
 */
export function aujourdhuiParis(maintenant: Date): string {
  const parties = Object.fromEntries(
    PARIS.formatToParts(maintenant).map((partie) => [partie.type, partie.value]),
  );
  return `${parties.year}-${parties.month}-${parties.day}`;
}

/**
 * Les bornes de la date d'émission si `issueDate` en sort, `undefined` si elle est admise : au plus
 * `aujourdhui`, au moins `derniere`, la date de la dernière facture de l'entreprise (sans borne
 * basse s'il n'y en a pas). Les bornes elles-mêmes sont admises. Des dates ISO se comparent comme des
 * chaînes.
 */
export function controlerDate(
  issueDate: string,
  aujourdhui: string,
  derniere: string | undefined,
): { min: string | undefined; max: string } | undefined {
  if (issueDate > aujourdhui || (derniere !== undefined && issueDate < derniere)) {
    return { min: derniere, max: aujourdhui };
  }
  return undefined;
}
