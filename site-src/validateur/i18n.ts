/**
 * Libellés du validateur, en français et en anglais.
 *
 * Un seul bundle sert les deux pages : la langue est lue sur `<html lang>`. Dupliquer le code
 * pour le traduire garantirait qu'une des deux versions prenne du retard sur l'autre — c'est
 * exactement ce qui est arrivé trois fois cette semaine aux numéros de version du dépôt.
 */

export interface Strings {
  severity: Record<'fatal' | 'warning' | 'tolerated', string>;
  status: Record<'ok' | 'failed' | 'skipped', string>;
  /** Motifs de tolérance, par code de règle — évite de traduire par correspondance de texte. */
  tolerated: Record<string, string>;
  steps: { pdf: string; sdk: string };
  /** Descriptif de chaque juge, par identifiant ; le nom, lui, ne se traduit pas. */
  judgeDetail: Record<string, string>;
  /** Unités d'octets : Ko/Mo en français, KB/MB en anglais. */
  units: { kb: string; mb: string };
  noFindings: string;
  toleratedPrefix: (reason: string) => string;
  unreadable: string;
  nonConformant: (failed: number) => string;
  incomplete: (skipped: number) => string;
  conformant: string;
  download: string;
  analysing: (filename: string) => string;
  interrupted: string;
  done: (judges: number) => string;
  unexpected: (message: string) => string;
  exampleUnavailable: string;
  idle: string;
  profile: (name: string) => string;
  framework: (code: string) => string;
  reportFilename: (stem: string) => string;
}

const fr: Strings = {
  severity: { fatal: 'bloquant', warning: 'avertissement', tolerated: 'toléré' },
  status: { ok: 'Conforme', failed: 'Non conforme', skipped: 'Non exécuté' },
  tolerated: {
    'PEPPOL-EN16931-R008':
      'règle PEPPOL : ram:ApplicableHeaderTradeDelivery est obligatoire dans le XSD Factur-X même sans information de livraison',
    'CII-SR-450':
      'la norme française porte le SIRET en GlobalID 0009 et le code de routage en ID 0224 : les deux coexistent (BR-FR-09/24)',
    'CII-SR-475':
      'BR-FR-17 qualifie chaque pièce jointe par sa description, ce qui suppose une description par pièce',
  },
  steps: { pdf: 'Lecture du PDF', sdk: 'Lecture et validation par le SDK' },
  judgeDetail: {
    sdk: 'modèle EN 16931 et règles françaises',
    cen: 'schematron officiel CII',
    facturx: 'schematron du profil 1.09',
    brfr: 'schematron Flux 2 V1.3.0',
  },
  units: { kb: 'Ko', mb: 'Mo' },
  noFindings: 'Aucune anomalie relevée.',
  toleratedPrefix: (reason) => `Toléré : ${reason}`,
  unreadable: 'Lecture impossible',
  nonConformant: (n) => `Non conforme — ${n} juge${n > 1 ? 's' : ''} en échec`,
  incomplete: (n) => `Verdict incomplet — ${n} juge${n > 1 ? 's' : ''} n'a pas pu s'exécuter`,
  conformant: 'Conforme aux quatre jeux de règles',
  download: 'Télécharger le rapport JSON',
  analysing: (f) => `Analyse de ${f}…`,
  interrupted: 'Analyse interrompue.',
  done: (n) => `Analyse terminée — ${n} jeux de règles exécutés.`,
  unexpected: (m) => `Erreur inattendue : ${m}`,
  exampleUnavailable: 'Exemple indisponible sur ce déploiement.',
  idle: 'Aucun fichier analysé pour le moment.',
  profile: (name) => `profil ${name}`,
  framework: (code) => `cadre ${code}`,
  reportFilename: (stem) => `rapport-${stem}.json`,
};

const en: Strings = {
  severity: { fatal: 'blocking', warning: 'warning', tolerated: 'tolerated' },
  status: { ok: 'Conformant', failed: 'Not conformant', skipped: 'Not run' },
  tolerated: {
    'PEPPOL-EN16931-R008':
      'PEPPOL rule: ram:ApplicableHeaderTradeDelivery is mandatory in the Factur-X XSD even with no delivery information',
    'CII-SR-450':
      'the French standard carries the SIRET in GlobalID 0009 and the routing code in ID 0224: both coexist (BR-FR-09/24)',
    'CII-SR-475':
      'BR-FR-17 qualifies each attachment by its description, which implies one description per attachment',
  },
  steps: { pdf: 'Reading the PDF', sdk: 'Reading and validating with the SDK' },
  judgeDetail: {
    sdk: 'EN 16931 model and French rules',
    cen: 'official CII schematron',
    facturx: 'profile 1.09 schematron',
    brfr: 'Flux 2 schematron V1.3.0',
  },
  units: { kb: 'KB', mb: 'MB' },
  noFindings: 'No findings.',
  toleratedPrefix: (reason) => `Tolerated: ${reason}`,
  unreadable: 'Could not be read',
  nonConformant: (n) => `Not conformant — ${n} judge${n > 1 ? 's' : ''} failed`,
  incomplete: (n) => `Incomplete verdict — ${n} judge${n > 1 ? 's' : ''} could not run`,
  conformant: 'Conformant to all four rule sets',
  download: 'Download the JSON report',
  analysing: (f) => `Analysing ${f}…`,
  interrupted: 'Analysis interrupted.',
  done: (n) => `Analysis complete — ${n} rule sets run.`,
  unexpected: (m) => `Unexpected error: ${m}`,
  exampleUnavailable: 'That example is not available on this deployment.',
  idle: 'No file analysed yet.',
  profile: (name) => `${name} profile`,
  framework: (code) => `framework ${code}`,
  reportFilename: (stem) => `report-${stem}.json`,
};

/** Table de libellés correspondant à la langue déclarée par le document. */
export const strings = (): Strings =>
  document.documentElement.lang.toLowerCase().startsWith('en') ? en : fr;
