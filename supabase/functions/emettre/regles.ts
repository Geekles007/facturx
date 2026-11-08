/**
 * Les règles de date de l'émission (spec § 7, étape 5) : « aujourd'hui » est le jour de Paris, et
 * une facture n'est datée ni après lui, ni avant la dernière facture de l'entreprise, pour que la
 * numérotation reste chronologique. En numérotation annuelle, elle n'est pas non plus datée avant le
 * 1er janvier de l'année de la numérotation (Ruling 30) : sans cette borne, une facture de décembre
 * prendrait le rang 1 de la série courante, et celle de janvier commencerait à 2.
 *
 * Le module n'importe que `_shared/dates.ts`, sans dépendance : les tests l'emploient sans la pile.
 */

// La fiche de la tâche 8 nomme `aujourdhuiParis` ici ; il vit dans `_shared/`, avec l'horloge des
// fonctions qui l'emploie aussi.
export { aujourdhuiParis } from '../_shared/dates.ts';

/**
 * Les bornes de la date d'émission si `issueDate` en sort, `undefined` si elle est admise :
 *   - au plus `aujourdhui` ;
 *   - au moins `derniere`, la date de la dernière facture de l'entreprise (`undefined` s'il n'y en a
 *     pas), et au moins `debutAnnee`, le 1er janvier de l'année de la numérotation quand elle est
 *     annuelle (`undefined` sinon). La plus tardive des deux bornes basses est `min`.
 * Les bornes elles-mêmes sont admises. Des dates ISO se comparent comme des chaînes.
 */
export function controlerDate(
  issueDate: string,
  aujourdhui: string,
  derniere: string | undefined,
  debutAnnee?: string,
): { min: string | undefined; max: string } | undefined {
  const min =
    derniere === undefined || (debutAnnee !== undefined && debutAnnee > derniere)
      ? debutAnnee
      : derniere;
  if (issueDate > aujourdhui || (min !== undefined && issueDate < min)) {
    return { min, max: aujourdhui };
  }
  return undefined;
}
