/**
 * Le PDF Factur-X d'une facture émise (spec § 7, étape 9), rendu par le SDK avec les options que le
 * Studio donne à son aperçu (`_vendor/shared/rendu.ts`) : ce qui sort du serveur est ce que
 * l'utilisateur a vu.
 *
 * Les polices viennent du bucket public `polices` (gardées en mémoire du worker : elles ne changent
 * qu'au déploiement), ou du bucket `fichiers` pour une police importée ; le logo, de `fichiers`. Ce
 * qui dépend de l'utilisateur et fait échouer le rendu (fichier illisible, caractère absent de la
 * police, option invalide) est une anomalie de l'apparence : 422, et non 500.
 */
import type { Invoice } from 'facturx-sdk';
import { embedFacturX, FacturXPdfError, renderInvoicePdf } from 'facturx-sdk/pdf';
import { FICHIERS_POLICES } from '../_vendor/shared/polices.ts';
import { fromBase64 } from '../_vendor/shared/portable.ts';
import { type Assets, type RenderAppearance, renderOptions } from '../_vendor/shared/rendu.ts';
import { SRGB_ICC_BASE64 } from '../_vendor/srgb.ts';
import { admin } from './db.ts';
import { type Anomalie, anomalies } from './erreurs.ts';
import { lireFichier } from './fichiers.ts';

/** L'`Appearance` du Studio, telle que l'émission la reçoit et la lit. */
export interface ApparenceEmise extends Omit<RenderAppearance, 'logo'> {
  /** Famille de `FICHIERS_POLICES`, ou `custom` pour une police importée. */
  font: string;
  logo?:
    | { key: string; type: 'png' | 'jpeg'; position: 'left' | 'right'; height: number }
    | undefined;
  customFont?: { regularKey: string; boldKey?: string | undefined } | undefined;
}

const MESSAGE = 'L’apparence de la facture est refusée : aucun numéro n’a été consommé.';

const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Vérifie la forme de l'apparence reçue, ce que le rendu lit sans le contrôler lui-même ; les valeurs
 * (modèle, couleur, format de page) sont contrôlées par le SDK au rendu. Lève 422 `ANOMALIES`.
 */
export function lireApparence(valeur: unknown): ApparenceEmise {
  const refus = (champ: string, attendu: string) =>
    anomalies(
      [{ code: 'CORPS', path: `appearance.${champ}`, message: `${champ} : ${attendu} attendu.` }],
      MESSAGE,
    );
  if (!estObjet(valeur)) {
    throw anomalies(
      [{ code: 'CORPS', path: 'appearance', message: 'Apparence absente ou illisible.' }],
      MESSAGE,
    );
  }
  for (const champ of ['template', 'accent', 'font', 'footer', 'pageSize']) {
    if (typeof valeur[champ] !== 'string') throw refus(champ, 'une chaîne');
  }
  for (const champ of ['style', 'labels', 'display']) {
    if (!estObjet(valeur[champ])) throw refus(champ, 'un objet');
  }
  if (valeur.language !== 'fr' && valeur.language !== 'en') throw refus('language', 'fr ou en');

  const logo = valeur.logo ?? undefined;
  if (logo !== undefined) {
    if (!estObjet(logo) || typeof logo.key !== 'string') throw refus('logo', 'une clé de fichier');
    if (logo.type !== 'png' && logo.type !== 'jpeg') throw refus('logo.type', 'png ou jpeg');
  }
  const police = valeur.customFont ?? undefined;
  if (police !== undefined) {
    if (!estObjet(police) || typeof police.regularKey !== 'string') {
      throw refus('customFont', 'une clé de fichier');
    }
    if (police.boldKey != null && typeof police.boldKey !== 'string') {
      throw refus('customFont.boldKey', 'une clé de fichier');
    }
  }
  return { ...valeur, logo, customFont: police } as ApparenceEmise;
}

const ICC = fromBase64(SRGB_ICC_BASE64);
const policesDuStudio = new Map<string, Promise<Uint8Array>>();

/** Une police du Studio, lue une fois par worker dans le bucket `polices`. */
function policeDuStudio(nom: string): Promise<Uint8Array> {
  let lecture = policesDuStudio.get(nom);
  if (!lecture) {
    lecture = admin()
      .storage.from('polices')
      .download(nom)
      .then(async ({ data, error }) => {
        if (error) throw error;
        return new Uint8Array(await data.arrayBuffer());
      });
    lecture.catch(() => policesDuStudio.delete(nom));
    policesDuStudio.set(nom, lecture);
  }
  return lecture;
}

/**
 * Les polices du rendu, comme le Studio les choisit (`app.tsx`, `loadFamily`) : la police importée
 * (sans gras, la régulière sert aux deux), sinon la famille, et Geist pour une famille inconnue.
 */
async function polices(a: ApparenceEmise, entrepriseId: string): Promise<Assets['fonts']> {
  if (a.font === 'custom' && a.customFont) {
    const regular = await lireFichier(entrepriseId, a.customFont.regularKey, 'ttf');
    const bold = a.customFont.boldKey
      ? await lireFichier(entrepriseId, a.customFont.boldKey, 'ttf')
      : regular;
    return { regular, bold };
  }
  const fichiers = Object.hasOwn(FICHIERS_POLICES, a.font)
    ? FICHIERS_POLICES[a.font]
    : FICHIERS_POLICES.geist;
  const [regular, bold] = await Promise.all([
    policeDuStudio(fichiers.regular),
    policeDuStudio(fichiers.bold),
  ]);
  return { regular, bold };
}

/** Ce que l'utilisateur peut corriger dans une erreur du rendu ; `undefined` pour une panne. */
function anomalieDuRendu(e: FacturXPdfError, a: ApparenceEmise): Anomalie | undefined {
  switch (e.code) {
    case 'INVALID_IMAGE':
      return { code: 'FICHIER', path: 'appearance.logo', message: e.message };
    case 'FONT_INVALID':
    case 'FONT_VARIABLE':
      // Une police du Studio refusée est une panne du déploiement, pas une erreur de l'utilisateur.
      return a.font === 'custom' && a.customFont
        ? { code: 'FICHIER', path: 'appearance.customFont', message: e.message }
        : undefined;
    case 'GLYPH_MISSING':
      return { code: e.code, path: 'appearance.font', message: e.message };
    case 'INVALID_OPTION':
      return { code: e.code, path: 'appearance', message: e.message };
    default:
      return undefined;
  }
}

/** Le PDF/A-3 Factur-X de `invoice` : page rendue, XML CII embarqué, intention de sortie sRGB. */
export async function produirePdf(
  invoice: Invoice,
  appearance: ApparenceEmise,
  entrepriseId: string,
): Promise<Uint8Array> {
  const assets: Assets = { fonts: await polices(appearance, entrepriseId) };
  if (appearance.logo) {
    assets.logo = {
      bytes: await lireFichier(entrepriseId, appearance.logo.key, appearance.logo.type),
      type: appearance.logo.type,
    };
  }
  try {
    // `renderOptions` passe les libellés par `labelsFor`, qui ne garde que ceux que le Studio laisse
    // renommer (`LIBELLES_RENOMMABLES`) : une apparence reçue ne remplace ni une mention légale ni
    // la pagination, et l'aperçu applique la même règle.
    const page = await renderInvoicePdf(invoice, renderOptions(appearance, assets));
    return await embedFacturX(
      page,
      { invoice },
      { creator: 'facturx', outputIntent: { iccProfile: ICC } },
    );
  } catch (e) {
    const anomalie = e instanceof FacturXPdfError ? anomalieDuRendu(e, appearance) : undefined;
    if (anomalie) throw anomalies([anomalie], MESSAGE);
    throw e;
  }
}
