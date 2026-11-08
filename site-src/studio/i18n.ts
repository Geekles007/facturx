/**
 * Libellés du Studio, en français et en anglais. La langue est celle de `<html lang>` : une page
 * par langue, un seul bundle. La table anglaise a le type de la française : un libellé oublié
 * est une erreur de compilation, pas un trou dans l'interface.
 *
 * La langue de l'interface n'est pas celle du document : on peut éditer en français une facture
 * rédigée en anglais (réglage « Langue du document » de l'onglet Apparence).
 */

import type { SepaQrUnavailableReason } from 'facturx-sdk';
import type { PrintedMention } from 'facturx-sdk/pdf';

const fr = {
  lang: 'fr' as 'fr' | 'en',
  app: {
    studio: 'Studio',
    untitled: 'Sans numéro',
    tabs: { content: 'Contenu', appearance: 'Apparence', check: 'Contrôle', code: 'Code' },
    mobile: { edit: 'Éditer', preview: 'Aperçu' },
    new: 'Nouveau',
    newBlank: 'Facture vierge',
    newSample: "Revoir l'exemple",
    duplicate: 'Dupliquer cette facture',
    creditNote: 'Créer un avoir sur cette facture',
    open: 'Ouvrir un fichier…',
    library: 'Bibliothèque',
    issue: 'Émettre la facture',
    issueShort: 'Émettre',
    download: 'Télécharger',
    downloadPdf: 'PDF Factur-X',
    downloadPdfNoIssue: 'PDF Factur-X, sans émettre',
    downloadXml: 'XML CII seul',
    downloadJson: 'Document Studio (.json)',
    storageMemory:
      "Stockage local indisponible : vos saisies seront perdues à la fermeture de l'onglet. Téléchargez le document Studio pour le garder.",
    sample:
      "C'est un exemple, conforme de bout en bout. Remplacez les informations par les vôtres, ou partez d'une page blanche.",
    startBlank: 'Commencer une facture vierge',
    issuedBanner: (date: string) => `Facture émise le ${date} : elle ne se modifie plus.`,
    issuedHint: 'Pour la corriger, émettez un avoir ; pour en faire une autre, dupliquez-la.',
    close: 'Fermer',
    back: 'Retour',
    cancel: 'Annuler',
    save: 'Enregistrer',
    remove: 'Supprimer',
    more: "Plus d'options",
    less: "Moins d'options",
    optional: 'facultatif',
    required: 'obligatoire',
    copy: 'Copier',
    copied: 'Copié',
    dropHere: 'Déposez une facture pour la reprendre dans le Studio',
    importing: (file: string) => `Lecture de ${file}…`,
    imported: (source: string) =>
      `Facture reprise depuis ${source}. Vérifiez-la, puis émettez-la sous votre numéro.`,
    sources: {
      pdf: 'un PDF Factur-X',
      cii: 'un XML CII',
      ubl: 'un XML UBL',
      studio: 'un document Studio',
    } as Record<string, string>,
    importFailed: (message: string) => `Import impossible : ${message}`,
    loading: 'Chargement du Studio…',
    replaceConfirm: 'Remplacer la facture en cours ? Les saisies non émises seront perdues.',
    readOnly: 'Facture émise : lecture seule',
    /** Le pied de l'éditeur sans compte : la seule variante où « rien ne quitte ce navigateur » est vrai. */
    footPrivacy:
      "Sans compte, rien de ce que vous saisissez ne quitte ce navigateur : le Studio n'envoie vos factures, clients et réglages à aucun serveur, ils restent ici. Un seul signal part, sans contenu, quand un PDF Factur-X est produit — pour savoir si l'outil sert, sans cookie ni rien de votre facture ; comme toute requête, il laisse votre adresse IP au journal du serveur (voir la politique de confidentialité).",
    /** Le pied de l'éditeur avec un compte : où sont les données, et qui peut les lire. */
    footPrivacyCompte:
      "Avec un compte, vos factures, clients et réglages sont conservés sur un serveur en Europe, à Paris, chez Supabase, une société américaine. L'hébergeur les chiffre au repos, mais le service les lit : il le faut pour émettre, numéroter et relancer. Le brouillon ouvert est aussi recopié dans ce navigateur. Comme sans compte, un signal sans contenu part vers ce site quand un PDF Factur-X est produit.",
    footLegal:
      'Le Studio ne constitue pas un conseil juridique et ne remplace pas la plateforme agréée qui transmettra vos factures.',
    footLinks: {
      home: 'Accueil',
      validator: 'Validateur',
      source: 'Code source',
      privacy: 'Confidentialité',
      fonts: 'Licences des polices',
    },
    sections: 'Sections',
  },
  status: {
    ok: 'Conforme',
    checking: 'Contrôle…',
    issues: (n: number) => `${n} point${n > 1 ? 's' : ''} à corriger`,
    officialOk: 'et validée par les schematrons officiels',
  },
  issueDialog: {
    title: (id: string) => `Émettre la facture ${id} ?`,
    body: "Elle rejoindra l'historique, et la numérotation passera au numéro suivant. Une facture émise ne se modifie plus : pour la corriger, vous émettrez un avoir.",
    confirm: 'Émettre et télécharger',
    duplicateNumber:
      'Ce numéro figure déjà dans votre historique : deux factures ne peuvent pas porter le même.',
    issued: (id: string) => `Facture ${id} émise et téléchargée.`,
    blocked: 'Corrigez les points signalés : seule une facture conforme se télécharge.',
    failed: (message: string) => `Le PDF n'a pas pu être produit : ${message}`,
    compte: {
      title: 'Émettre cette facture ?',
      body: "Le serveur lui attribue le numéro suivant de votre numérotation, la contrôle et produit son PDF Factur-X ; elle rejoint l'historique. Une facture émise ne se modifie plus : pour la corriger, vous émettrez un avoir.",
      confirm: 'Émettre',
    },
  },
  sections: {
    document: 'Document',
    seller: 'Vendeur',
    buyer: 'Client',
    lines: 'Lignes',
    adjustments: 'Remises et frais',
    exemptions: 'Exonérations de TVA',
    delivery: 'Livraison',
    payment: 'Paiement',
    references: 'Références',
    notes: 'Notes et mentions',
    attachments: 'Pièces jointes',
  },
  document: {
    type: 'Type de document',
    number: 'Numéro',
    numberHint: 'Unique, dans une séquence chronologique et continue.',
    numberAssigned:
      "Attribué à l'émission : le serveur donne le numéro suivant de votre numérotation.",
    nextNumber: 'Numéro suivant',
    issueDate: "Date d'émission",
    nature: "Nature de l'opération",
    natureHint: 'Mention obligatoire de la réforme ; elle détermine le cadre de facturation.',
    currency: 'Devise',
    avoirDevise: (citees: string) =>
      `Facture citée dans une autre devise : ${citees}. Un avoir est dans la devise de la facture qu'il corrige ; le serveur refusera de l'émettre.`,
    businessProcess: 'Cadre de facturation (BT-23)',
    processing: 'Traitement attendu (BR-FR-20)',
    vatOnDebits: 'TVA sur les débits',
    vatOnDebitsHint:
      "Si vous avez opté pour le paiement de la TVA d'après les débits : la mention est alors imprimée.",
    taxPointDate: "Date d'exigibilité de la TVA",
    buyerReference: 'Référence acheteur (BT-10)',
    buyerReferenceHint: 'Code service Chorus Pro, référence interne du client.',
    numberLength: '35 caractères au plus (BR-FR-01).',
    numberChars: 'Lettres sans accent, chiffres et - + _ / seulement (BR-FR-02).',
    numberDuplicate: 'Ce numéro figure déjà dans votre historique.',
  },
  party: {
    name: 'Raison sociale',
    buyerName: 'Nom ou raison sociale',
    tradingName: 'Nom commercial',
    siren: 'SIREN',
    siret: 'SIRET',
    vatId: 'N° de TVA intracommunautaire',
    computeVat: 'Calculer depuis le SIREN',
    taxRegistrationId: 'Identifiant fiscal local',
    legalInfo: 'Mentions légales',
    legalInfoHint:
      'Forme juridique, capital, RCS — par exemple « SAS au capital de 10 000 € — RCS Paris 443 061 841 ».',
    compose: 'Composer la mention',
    legalForm: 'Forme juridique',
    capital: 'Capital (€)',
    rcsCity: 'Greffe (ville du RCS)',
    insert: 'Insérer',
    line1: 'Adresse',
    line2: "Complément d'adresse",
    postCode: 'Code postal',
    city: 'Ville',
    country: 'Pays',
    subdivision: 'Région',
    contact: 'Contact',
    contactName: 'Nom du contact',
    phone: 'Téléphone',
    email: 'E-mail',
    electronic: 'Adresse électronique',
    electronicHint: 'Adresse de routage de la réforme : schéma 0225, SIREN ou SIREN_SUFFIXE.',
    fromSiren: 'Reprendre le SIREN',
    scheme: 'Schéma',
    routingCode: 'Code de routage (0224)',
    consumer: 'Particulier (B2C)',
    consumerHint: "Un particulier n'a ni SIREN ni adresse électronique à fournir.",
    identity: 'Identité',
    identifiers: 'Identifiants',
    saveCompany: 'Enregistrer comme mon entreprise',
    companySaved: 'Entreprise enregistrée : elle sera reprise sur vos prochaines factures.',
    pickClient: 'Reprendre un client…',
    saveClient: 'Enregistrer ce client',
    clientSaved: 'Client enregistré.',
    clientUpdated: 'Client mis à jour.',
    sirenInvalid: 'Clé de contrôle incorrecte : vérifiez les neuf chiffres.',
  },
  payee: {
    title: 'Bénéficiaire du paiement',
    enable: 'Le paiement est dû à un tiers (affacturage…)',
    name: 'Nom',
    id: 'SIRET',
    legalId: 'SIREN',
  },
  lines: {
    add: 'Ajouter une ligne',
    fromCatalog: 'Depuis le catalogue',
    emptyCatalog: 'Catalogue vide : enregistrez une ligne pour la réutiliser.',
    designation: 'Désignation',
    description: 'Description',
    quantity: 'Qté',
    unit: 'Unité',
    unitPrice: 'Prix unitaire HT',
    vat: 'TVA',
    amount: 'Montant HT',
    details: 'Détails',
    duplicate: 'Dupliquer',
    remove: 'Supprimer',
    moveUp: 'Monter',
    moveDown: 'Descendre',
    saveProduct: 'Enregistrer au catalogue',
    productSaved: 'Ligne ajoutée au catalogue.',
    itemId: 'Référence article',
    buyerItemId: 'Référence client',
    gtin: 'EAN / GTIN',
    origin: "Pays d'origine",
    periodStart: 'Période : du',
    periodEnd: 'au',
    note: 'Note de ligne',
    orderLine: 'Ligne du bon de commande',
    accounting: 'Compte comptable client',
    grossPrice: 'Prix brut HT',
    grossPriceHint: 'Prix avant remise sur prix ; la remise est transmise à part.',
    baseQuantity: 'Prix pour une quantité de',
    baseQuantityHint: 'Pour un prix « aux 100 » : 100. Vide : à l’unité.',
    allowances: 'Remises de ligne',
    charges: 'Frais de ligne',
    addAllowance: 'Remise',
    addCharge: 'Frais',
    totalHT: 'Total HT',
    totalVAT: 'TVA',
    totalTTC: 'Total TTC',
    due: 'Net à payer',
    untitled: 'Ligne sans désignation',
  },
  adjustments: {
    hint: "Sur l'ensemble de la facture ; une remise sur plusieurs taux de TVA est répartie au prorata.",
    addAllowance: 'Ajouter une remise',
    addCharge: 'Ajouter des frais',
    allowance: 'Remise',
    charge: 'Frais',
    reason: 'Libellé',
    reasonCode: 'Motif normalisé',
    percent: '%',
    amount: 'Montant',
    value: 'Valeur',
    vat: 'TVA',
    vatAuto: 'Répartie par taux',
    prepaid: 'Acomptes déjà versés (TTC)',
    prepaidHint: 'Déduits du net à payer ; référencez les factures d’acompte dans « Références ».',
    rounding: 'Arrondi',
    defaultAllowance: 'Remise',
    defaultCharge: 'Frais',
  },
  exemptions: {
    hint: 'Chaque régime sans TVA appelle une mention ; elle est imprimée et transmise dans le XML.',
    code: 'Motif (VATEX)',
    text: 'Mention imprimée',
    categories: {
      E: 'Exonération',
      AE: 'Autoliquidation',
      K: 'Livraison intracommunautaire',
      G: 'Export',
      O: 'Hors champ',
    } as Record<string, string>,
  },
  delivery: {
    hint: 'Date de la vente ou de la prestation : mention obligatoire (art. L441-9 C. com.).',
    date: 'Date',
    period: 'Période',
    dateLabel: 'Date de livraison ou d’exécution',
    start: 'Début',
    end: 'Fin',
    address: 'Livré à une autre adresse que celle du client',
    addressServices:
      "Pour une prestation de services, la norme ne demande pas d'adresse de livraison (BR-FR-14) : ne l'indiquez que si elle a un sens, un lieu d'intervention par exemple.",
    partyName: 'Destinataire',
    locationId: 'Identifiant du lieu',
  },
  payment: {
    dueDate: "Date d'échéance",
    onReceipt: 'À réception',
    days30: '30 jours',
    days45eom: '45 j fin de mois',
    days60: '60 jours',
    terms: 'Conditions',
    structured: 'Mentions guidées',
    text: 'Texte libre',
    penalty: 'Pénalités de retard (% l’an)',
    penaltyHint: "Au moins trois fois le taux d'intérêt légal (art. L441-10).",
    indemnity: 'Indemnité forfaitaire (€)',
    indemnityHint: '40 € : montant fixé par l’article D441-5.',
    discount: 'Escompte pour paiement anticipé',
    noDiscount: 'Aucun',
    withDiscount: 'Oui',
    discountRate: 'Taux (%)',
    discountDays: 'Sous (jours)',
    termsText: 'Conditions de paiement',
    termsTextHint: 'Le texte doit contenir les pénalités, l’indemnité de 40 € et l’escompte.',
    generated: 'Mentions imprimées et transmises',
    means: 'Moyens de paiement',
    addMeans: 'Ajouter un moyen de paiement',
    type: 'Moyen',
    iban: 'IBAN',
    bic: 'BIC',
    accountName: 'Titulaire du compte',
    mandate: 'Référence du mandat (RUM)',
    creditorId: 'Identifiant créancier SEPA (ICS)',
    debitedIban: 'IBAN du compte débité',
    label: 'Libellé',
    remittance: 'Référence de paiement',
    remittanceHint: 'Que le client rappellera en payant ; le numéro de facture, le plus souvent.',
    ibanInvalid: 'IBAN invalide : la clé de contrôle ne correspond pas.',
  },
  references: {
    hint: 'Le bon de commande est une mention obligatoire lorsqu’il a été émis par l’acheteur.',
    purchaseOrder: 'Bon de commande',
    contract: 'Contrat',
    project: 'Projet',
    salesOrder: 'Commande (vendeur)',
    despatchAdvice: "Avis d'expédition",
    receivingAdvice: 'Avis de réception',
    tenderOrLot: "Lot ou appel d'offres",
    invoicedObject: 'Objet facturé',
    buyerAccountingReference: 'Référence comptable',
    preceding: 'Factures de référence',
    precedingHint:
      "Pour un avoir, une facture rectificative ou une facture définitive après acompte : la facture d'origine.",
    precedingRequired: "Obligatoire pour ce type de document : indiquez la facture d'origine.",
    addPreceding: 'Ajouter une facture',
    precedingId: 'Numéro',
    precedingDate: 'Date',
    others: 'Autres références',
  },
  notes: {
    hint: 'Pénalités, indemnité, escompte et traitement attendu sont écrits pour vous, depuis le paiement.',
    add: 'Ajouter une note',
    subject: 'Sujet',
    text: 'Texte',
    presets: 'Mentions courantes',
    presetList: [
      {
        code: 'ACC',
        label: 'Subrogation (affacturage)',
        text: "Pour être libératoire, votre règlement doit être effectué directement à l'ordre de [affactureur], qui le reçoit par subrogation.",
      },
      {
        code: 'REG',
        label: 'Association agréée',
        text: "Membre d'une association agréée, le règlement par chèque est accepté.",
      },
      { code: 'ABL', label: 'Entrepreneur individuel', text: 'Entrepreneur individuel (EI)' },
      { code: 'BLU', label: 'Éco-participation', text: 'Dont éco-participation : 0,00 € HT.' },
      { code: 'AAI', label: 'Remerciement', text: 'Merci pour votre confiance.' },
    ],
  },
  attachments: {
    hint: 'Embarquées en base64 dans le XML : bon de commande, bon de livraison, relevé…',
    addFile: 'Joindre un fichier',
    addLink: 'Référencer un lien',
    id: 'Identifiant',
    kind: 'Nature',
    uri: 'Adresse (URL)',
    tooLarge: 'Fichier trop lourd : 20 Mo au plus par pièce.',
    badType: 'Type refusé : PDF, PNG, JPEG, CSV, XLSX ou ODS (BR-CL-24).',
  },
  appearance: {
    template: 'Modèle',
    templates: {
      classic: ['Classique', 'Sobre et intemporel'],
      modern: ['Moderne', 'Bandeau de couleur'],
      minimal: ['Épuré', 'Beaucoup d’air'],
      letterhead: ['En-tête', 'Papier à lettre'],
      cards: ['Cartes', 'Blocs teintés'],
      compact: ['Compact', 'Pour les longues factures'],
    } as Record<string, [string, string]>,
    color: 'Couleur',
    customColor: 'Couleur personnalisée',
    contrast: 'Le texte posé sur la couleur reste lisible : il est assombri ou inversé si besoin.',
    font: 'Police',
    fontImport: 'Importer une police…',
    fontImportHint:
      'TTF ou OTF statique, comme sur votre papier à en-tête ; la graisse forte est facultative.',
    fontRegular: 'Fichier régulier',
    fontBold: 'Fichier gras (facultatif)',
    fontCustom: 'Votre police',
    fontLoading: 'Chargement de la police…',
    logo: 'Logo',
    logoAdd: 'Ajouter un logo',
    logoReplace: 'Remplacer',
    logoRemove: 'Retirer',
    logoHint: 'PNG, JPEG ou SVG (converti en PNG, fond transparent conservé).',
    logoPosition: 'Position',
    left: 'À gauche',
    right: 'À droite',
    logoSize: 'Hauteur',
    layout: 'Mise en page',
    layoutHint: 'Chaque modèle est un jeu de ces réglages ; ajustez-les un à un.',
    reset: 'Revenir au modèle',
    styles: {
      header: ['En-tête', { plain: 'Simple', band: 'Bandeau', letterhead: 'Papier à lettre' }],
      parties: ['Vendeur et client', { plain: 'Texte', boxed: 'Cartes' }],
      tableHeader: ['En-tête du tableau', { rule: 'Filet', filled: 'Aplat', tinted: 'Teinté' }],
      rows: ['Lignes du tableau', { rules: 'Filets', zebra: 'Alternées', plain: 'Sans' }],
      totals: ['Totaux', { plain: 'Alignés', boxed: 'Encadrés' }],
      amountDue: ['Net à payer', { text: 'Texte', filled: 'Pavé' }],
      titleCase: ['Titre', { normal: 'Normal', upper: 'Capitales' }],
      density: ['Densité', { comfortable: 'Aérée', compact: 'Compacte' }],
      corners: ['Angles', { square: 'Droits', rounded: 'Arrondis' }],
    } as Record<string, [string, Record<string, string>]>,
    language: 'Langue du document',
    languages: { fr: 'Français', en: 'Anglais' },
    languageHint: 'Libellés, nombres et dates. Les mentions légales restent en français.',
    page: 'Format de page',
    labels: 'Libellés',
    labelsHint:
      'Renommez les en-têtes. Le titre du document et les mentions légales, eux, ne se renomment pas.',
    labelNames: {
      seller: 'Vendeur',
      buyer: 'Acheteur',
      designation: 'Désignation',
      quantity: 'Quantité',
      unitPrice: 'Prix unitaire',
      vat: 'TVA',
      netAmount: 'Montant',
      amountDue: 'Net à payer',
      paymentTerms: 'Conditions',
      notes: 'Informations',
      scanToPay: 'Légende du QR code',
    } as Record<string, string>,
    display: 'Afficher',
    displays: {
      lineNumbers: 'Numéros de ligne',
      itemDetails: 'Références des articles',
      contacts: 'Contacts',
      electronicAddresses: 'Adresses électroniques',
      paymentDetails: 'Coordonnées bancaires',
      paymentQrCode: 'QR code de paiement SEPA',
      references: 'Références facultatives',
      facturxNotice: 'Mention « Facture électronique Factur-X »',
    } as Record<string, string>,
    qrHint:
      'Lu par les applications bancaires (format EPC) : bénéficiaire, IBAN, montant à payer et référence, sans rien saisir.',
    qrUnavailable: {
      'credit-note': 'Pas de QR code sur un avoir : c’est vous qui remboursez.',
      currency: 'Pas de QR code : un virement SEPA se fait en euros.',
      amount: 'Pas de QR code : rien à payer, ou un montant au-delà de ce que permet le format.',
      'no-transfer': 'Pas de QR code : ajoutez un virement avec votre IBAN, dans Paiement.',
      'invalid-iban': 'Pas de QR code : l’IBAN du virement est invalide.',
      'no-name': 'Pas de QR code : le nom du vendeur manque.',
      'too-long': 'Pas de QR code : nom et référence de paiement trop longs pour le format.',
    } satisfies Record<SepaQrUnavailableReason, string>,
    footer: 'Pied de page',
    footerHint: 'Deux lignes au plus : RCS, capital, code APE, site…',
    footerFromLegal: 'Reprendre les mentions légales',
    locked: 'Toujours imprimé',
    lockedText:
      "Numéro, dates, identités et identifiants des parties, nature de l'opération, livraison, bon de commande, facture d'origine, TVA et ses mentions, échéance, pénalités, indemnité et escompte : aucun réglage ne les retire.",
    saveDefault: 'Utiliser pour mes prochaines factures',
    defaultSaved: 'Apparence retenue pour vos prochaines factures.',
  },
  check: {
    verdictOk: 'Conforme : prête à être émise',
    verdictIssues: (n: number) => `${n} point${n > 1 ? 's' : ''} à corriger avant d'émettre`,
    verdictServeur: "Refusée par le serveur : à corriger avant d'émettre",
    sdk: 'Contrôle du SDK',
    sdkDetail: 'Modèle EN 16931, arithmétique au centime, règles françaises BR-FR.',
    serveur: 'Refusée par le serveur',
    serveurDetail:
      "À l'émission, le serveur a relevé ces anomalies sur la facture affichée : corrigez-les, puis émettez de nouveau.",
    noIssues: 'Aucune anomalie.',
    fix: 'Corriger',
    official: 'Validateurs officiels',
    officialDetail:
      'Les trois schematrons de référence, exécutés dans votre navigateur sur le XML produit.',
    run: 'Lancer les validateurs',
    rerun: 'Relancer',
    running: 'Exécution…',
    waiting: 'Ils se prononcent une fois les points du SDK corrigés.',
    stale: 'La facture a changé depuis le dernier passage.',
    judges: {
      cen: ['EN 16931 (CEN)', 'schematron officiel CII'],
      facturx: ['Factur-X EN 16931', 'schematron du profil 1.09.2'],
      brfr: ['BR-FR (XP Z12-012)', 'schematron Flux 2 V1.4.0.04'],
    } as Record<string, [string, string]>,
    judgeOk: 'Conforme',
    judgeFailed: 'Non conforme',
    judgeSkipped: 'Non exécuté',
    tolerated: 'toléré',
    warning: 'avertissement',
    fatal: 'bloquant',
    mentions: 'Mentions imprimées sur la page',
    mentionsDetail:
      'Relevées par la mise en page elle-même : ce que le lecteur voit, et que le XML transporte.',
    glyphs: 'Caractères absents de la police',
    glyphsDetail:
      'Ils deviendraient des glyphes vides, refusés par PDF/A : changez de police ou remplacez-les.',
    input: {
      number: 'Nombre illisible.',
      decimals: (scale: number) => `${scale} décimale${scale > 1 ? 's' : ''} au plus.`,
      negative: 'Valeur positive attendue.',
      vat: 'Taux de TVA inconnu.',
      gross: 'Le prix brut doit être au moins égal au prix net.',
    },
    verapdf:
      'Le contrôle PDF/A-3 (veraPDF) exige Java : il est exécuté sur chaque version du SDK en intégration continue, pas dans le navigateur.',
    mentionLabels: {
      title: 'Type de document',
      number: 'Numéro de facture',
      issueDate: "Date d'émission",
      seller: 'Identité du vendeur',
      sellerId: 'SIREN ou SIRET du vendeur',
      sellerVatId: 'N° de TVA du vendeur',
      sellerLegalInfo: 'Forme juridique, capital, RCS',
      buyer: "Identité de l'acheteur",
      buyerId: "SIREN de l'acheteur",
      buyerVatId: "N° de TVA de l'acheteur",
      deliveryDate: 'Date ou période de livraison',
      deliveryAddress: 'Adresse de livraison',
      operationCategory: "Nature de l'opération",
      purchaseOrder: 'Bon de commande',
      precedingInvoices: "Facture d'origine",
      selfBilling: 'Mention « Autofacturation »',
      lines: 'Désignation, quantités, prix unitaires',
      vatBreakdown: 'TVA par taux',
      vatExemption: "Mention d'exonération",
      vatOnDebits: 'Option pour la TVA sur les débits',
      taxPointDate: "Date d'exigibilité de la TVA",
      totals: 'Totaux HT, TVA et TTC',
      prepaid: 'Acomptes déduits',
      dueDate: "Date d'échéance",
      latePenalty: 'Pénalités de retard',
      recoveryIndemnity: 'Indemnité forfaitaire de 40 €',
      earlyPaymentDiscount: "Conditions d'escompte",
      paymentTerms: 'Conditions de paiement',
      paymentMeans: 'Moyens de paiement',
    } satisfies Record<PrintedMention, string>,
  },
  code: {
    intro:
      "Le Studio n'emploie que l'API publique du SDK. Voici les appels exacts qui produisent ce document — à coller dans votre application.",
    ts: 'TypeScript',
    xml: 'XML CII',
    json: 'Objet Invoice',
    install: 'Installation',
    xmlInvalid:
      'Le XML est produit une fois la facture conforme : le SDK refuse de générer un document invalide.',
  },
  preview: {
    fit: 'Ajuster à la largeur',
    zoomIn: 'Agrandir',
    zoomOut: 'Réduire',
    pages: (n: number) => `${n} page${n > 1 ? 's' : ''}`,
    updating: 'Mise à jour…',
    hint: 'Cliquez sur un élément de la facture pour le modifier.',
    error: (message: string) => `Aperçu indisponible : ${message}`,
    page: (n: number) => `Page ${n}`,
  },
  library: {
    title: 'Bibliothèque',
    tabs: {
      company: 'Mon entreprise',
      clients: 'Clients',
      products: 'Catalogue',
      history: 'Historique',
      numbering: 'Numérotation',
      backup: 'Sauvegarde',
    },
    companyIntro:
      'Reprise sur chaque nouvelle facture. Modifiez-la ici ou depuis le bloc « Vendeur ».',
    fromCurrent: 'Reprendre le vendeur de la facture en cours',
    defaults: 'Préférences des nouvelles factures',
    paymentDays: 'Délai de paiement (jours)',
    endOfMonth: 'Fin de mois',
    defaultVat: 'TVA par défaut',
    defaultNature: 'Nature par défaut',
    saved: 'Enregistré.',
    clientsEmpty:
      'Aucun client enregistré. Utilisez « Enregistrer ce client » dans le bloc Client.',
    productsEmpty: 'Catalogue vide. Utilisez « Enregistrer au catalogue » depuis une ligne.',
    historyEmpty: 'Aucune facture émise pour l’instant.',
    search: 'Rechercher',
    use: 'Facturer',
    addToInvoice: 'Ajouter à la facture',
    open: 'Ouvrir',
    redownload: 'Télécharger',
    duplicate: 'Dupliquer',
    credit: 'Avoir',
    balance: 'Facturer le solde',
    balanceHint:
      'Facture définitive : les acomptes sélectionnés sont référencés et déduits (withDeposits).',
    selectDeposits: 'Acomptes à déduire',
    createBalance: 'Créer la facture définitive',
    pattern: 'Gabarit des numéros',
    patternHint:
      '{AAAA} année, {AA} année sur deux chiffres, {MM} mois, {NNNN} compteur sur quatre chiffres.',
    nextRank: 'Prochain rang',
    nextRankTooLow: (minimum: number) =>
      `${minimum} au moins : la numérotation du compte ne redescend pas, pour ne jamais réattribuer un numéro. Rien n'est envoyé.`,
    yearly: 'Repartir de 1 chaque année',
    nextPreview: 'Prochain numéro',
    numberingWarning:
      'La numérotation doit rester continue : ne sautez pas de numéro, et ne revenez jamais en arrière sur un numéro déjà émis.',
    backupIntro:
      "Tout est conservé dans ce navigateur, et seulement là. Une sauvegarde vous protège d'un nettoyage des données du site ou d'un changement d'ordinateur.",
    backupIntroCompte:
      "Vos données sont conservées sur le serveur du compte. Cette sauvegarde est un fichier à garder où vous voulez, sans les PDF des factures ; pour l'archive complète, avec le PDF de chaque facture, utilisez « Exporter mes données » dans le menu du compte.",
    export: 'Télécharger une sauvegarde',
    restore: 'Restaurer une sauvegarde…',
    restored: 'Sauvegarde restaurée.',
    restoreFailed: "Ce fichier n'est pas une sauvegarde du Studio.",
    counts: (clients: number, products: number, invoices: number) =>
      `${clients} client${clients > 1 ? 's' : ''}, ${products} article${products > 1 ? 's' : ''}, ${invoices} facture${invoices > 1 ? 's' : ''} émise${invoices > 1 ? 's' : ''}`,
    deleteConfirm: 'Supprimer définitivement ?',
    issuedOn: (date: string) => `émise le ${date}`,
  },
  compte: {
    signIn: 'Se connecter',
    create: 'Créer un compte gratuit',
    createShort: 'Créer un compte',
    signOut: 'Se déconnecter',
    menu: 'Mon compte',
    dialogTitle: {
      connexion: 'Se connecter',
      inscription: 'Créer un compte gratuit',
      oubli: 'Mot de passe oublié',
    },
    signUpIntro:
      'Avec un compte, vos factures, clients et réglages sont conservés sur un serveur en Europe, et vous les retrouvez sur tous vos appareils. Sans compte, rien ne change : tout reste dans ce navigateur.',
    forgotIntro:
      'Indiquez votre adresse : nous vous envoyons un lien pour choisir un nouveau mot de passe.',
    email: 'Adresse e-mail',
    password: 'Mot de passe',
    forgot: 'Mot de passe oublié ?',
    acceptBefore: "J'accepte les ",
    acceptLink: 'CGU',
    submit: {
      connexion: 'Se connecter',
      inscription: 'Créer mon compte',
      oubli: 'Envoyer le lien',
    },
    missingFields: "Renseignez l'adresse e-mail et le mot de passe.",
    missingEmail: "Renseignez l'adresse e-mail.",
    acceptRequired: 'Acceptez les CGU pour créer un compte.',
    confirmationSent: (email: string) =>
      `Un e-mail de confirmation est parti vers ${email}. Ouvrez le lien qu'il contient : dans ce navigateur, votre compte s'ouvre aussitôt ; depuis un autre appareil, il suffira de vous connecter ensuite.`,
    resetSent: (email: string) =>
      `Si un compte existe pour ${email}, un lien pour choisir un nouveau mot de passe vient d'y être envoyé.`,
    link: {
      expired:
        'Ce lien a expiré ou a déjà servi. Connectez-vous ; sinon, demandez un nouveau lien avec « Mot de passe oublié ? ».',
      noSession:
        "Ce lien n'a pas pu ouvrir de session dans ce navigateur : il a sans doute été ouvert ailleurs que là où vous l'aviez demandé, ou il a déjà servi. Si c'était la confirmation de votre adresse, elle est confirmée : connectez-vous. S'il s'agissait d'un nouveau mot de passe, redemandez un lien avec « Mot de passe oublié ? ».",
      autreAdresse:
        "Lien accepté. Pour terminer le changement d'adresse, ouvrez aussi le lien envoyé à l'autre adresse : jusque-là, l'adresse du compte ne change pas.",
    },
    errors: {
      credentials: 'Adresse ou mot de passe incorrect.',
      notConfirmed:
        "Cette adresse n'est pas encore confirmée : ouvrez le lien de l'e-mail de confirmation.",
      exists: 'Un compte existe déjà avec cette adresse.',
      weak: 'Ce mot de passe est trop faible : choisissez-en un plus long ou plus varié.',
      invalidEmail: "Cette adresse e-mail n'est pas valide.",
      rateLimit: "Trop de tentatives ou d'e-mails envoyés : réessayez dans quelques minutes.",
      signupClosed: 'Les inscriptions sont fermées pour le moment.',
      network: 'Le serveur est injoignable : vérifiez votre connexion, puis réessayez.',
      samePassword: "Choisissez un mot de passe différent de l'actuel.",
      reauth:
        'Changer le mot de passe demande une connexion récente : déconnectez-vous, reconnectez-vous, puis recommencez.',
      session: 'Votre session a expiré : reconnectez-vous, puis recommencez.',
      other: "L'opération a échoué. Réessayez dans un instant.",
      loadFailed: "Le module de connexion n'a pas pu être chargé : vérifiez votre connexion.",
    },
    conservation: {
      horsLigne:
        'Hors ligne, non enregistré : votre saisie reste dans ce navigateur et partira au retour du réseau.',
      sessionExpiree:
        'Votre session a expiré : reconnectez-vous pour enregistrer. Votre saisie est gardée dans ce navigateur.',
      reconnecter: 'Se reconnecter',
      reprise:
        'Votre session a expiré. Reconnectez-vous : votre saisie est gardée, et elle sera enregistrée aussitôt.',
      conflit:
        "Ce brouillon a été modifié ailleurs (un autre onglet ou un autre appareil) : votre saisie n'est pas enregistrée.",
      conflitSousVue:
        "Le brouillon ouvert est en conflit avec une autre version (modifié ou supprimé ailleurs), et ce n'est pas lui qui s'affiche : ouvrez-le pour décider de votre saisie.",
      ouvrirConflit: 'Ouvrir ce brouillon',
      supprime:
        "Ce brouillon a été supprimé ailleurs (un autre onglet ou un autre appareil) : votre saisie n'est pas enregistrée, mais elle reste ici.",
      recreer: 'Le recréer avec ma saisie',
      recharger: 'Recharger la version enregistrée',
      garder: 'Garder la mienne',
      garderConfirm:
        'Remplacer la version enregistrée ailleurs par la vôtre ? Ce qui y a été saisi sera perdu.',
      recharge: 'Brouillon rechargé.',
      garde: 'Votre version est enregistrée.',
      supprimeAilleurs:
        "Ce brouillon n'existe plus sur le serveur (émis ou supprimé ailleurs) : votre saisie est enregistrée comme un nouveau brouillon.",
      refus:
        "Le serveur a refusé d'enregistrer cette modification : elle reste affichée, mais n'est pas conservée.",
      recul:
        'La numérotation ne peut pas reculer : le prochain numéro doit rester au moins celui du serveur.',
      fichier:
        'Fichier refusé : un logo PNG ou JPEG de 1 Mo au plus, ou une police TTF de 2 Mo au plus.',
      fichierDimensions: (largeur: number, hauteur: number) =>
        `Logo refusé : ${largeur} × ${hauteur} pixels au plus. Choisissez-le de nouveau dans le Studio, qui le réduit lui-même.`,
      enAttente: {
        reseau:
          "Hors ligne : la saisie du brouillon ouvert n'est pas encore sur le serveur. Changez de document au retour du réseau, pour ne pas la perdre.",
        session:
          "Session expirée : reconnectez-vous d'abord. La saisie du brouillon ouvert n'est pas encore sur le serveur, et changer de document la perdrait.",
        conflit:
          'Ce brouillon est en conflit : rechargez la version enregistrée ou gardez la vôtre avant de changer de document.',
        supprime:
          'Ce brouillon a été supprimé ailleurs : recréez-le avec votre saisie avant de changer de document.',
        refus: (cause: string) =>
          `Le serveur refuse ce brouillon${cause ? ` (${cause})` : ''} : changer de document perdrait votre saisie. Corrigez-la, ou abandonnez-la.`,
        injoignable:
          'Le serveur du compte ne répond pas : changer de document attend son retour, pour ne rien perdre de votre saisie.',
        enCours:
          "Votre saisie change encore pendant l'enregistrement : changez de document une fois la frappe arrêtée.",
      },
      injoignable:
        "Le serveur du compte ne répond pas : vos factures, clients et réglages n'ont pas pu être lus. Votre saisie reste dans ce navigateur, et tout reprendra dès qu'il répondra.",
      injoignableVerrou:
        "Le serveur du compte ne répond pas : l'entreprise et la numérotation affichées ne sont pas les vôtres, elles ne se modifient pas avant son retour.",
      injoignableFichier:
        "Le serveur du compte ne répond pas : ce fichier ne peut pas y être déposé maintenant. Réessayez dès qu'il répondra.",
      rechargerPage: 'Recharger la page',
      miseDeCote:
        "Une saisie que le serveur n'avait pas reçue n'a pas pu être relue dans ce navigateur au démarrage : elle a été mise de côté, rien n'en est perdu. Rouvrez-la pour en faire un brouillon.",
      rouvrirMiseDeCote: 'La rouvrir',
      brouillonRefuse: (cause: string) =>
        `Le serveur refuse ce brouillon (${cause}) : votre saisie n'est pas enregistrée, mais elle reste ici. Corrigez-la, ou abandonnez-la.`,
      abandonner: 'Abandonner cette saisie',
      abandonnerConfirm:
        "Abandonner cette saisie ? Tout ce que le serveur a refusé sera perdu : le brouillon revient à sa dernière version enregistrée, ou disparaît s'il ne l'a jamais été.",
      abandonne: 'Saisie abandonnée : le brouillon est revenu à sa dernière version enregistrée.',
    },
    brouillons: {
      titre: 'Brouillons',
      intro:
        'Vos brouillons sont enregistrés sur votre compte : vous les retrouvez sur tous vos appareils.',
      nouveau: 'Nouveau brouillon',
      ouvrir: 'Ouvrir',
      ouvert: 'ouvert',
      supprimerConfirm: (nom: string) =>
        `Supprimer le brouillon ${nom} ? Il ne pourra pas être récupéré.`,
      vide: "Aucun brouillon pour l'instant : la facture que vous saisirez sera le premier.",
      sansClient: 'client à saisir',
      modifie: (date: string) => `modifié le ${date}`,
      chargement: 'Chargement…',
      echec:
        "L'opération n'a pas abouti : vérifiez votre connexion, puis réessayez dans un instant.",
      introuvable: "Ce brouillon n'existe plus : il a été émis ou supprimé ailleurs.",
      nonEnregistre: 'pas encore enregistré',
      repli:
        "Le brouillon suivant n'a pas pu être ouvert : une facture vierge s'ouvre à sa place. Vos autres brouillons ne sont pas touchés.",
      reprendre: 'Reprendre',
      moduleNonCharge:
        "Le module des brouillons n'a pas pu être chargé : vérifiez votre connexion, puis rechargez la page (votre saisie est enregistrée avant).",
    },
    /** Les refus des Edge Functions (spec § 13), quelle que soit l'opération. */
    erreurs: {
      nonConfirme:
        "Confirmez d'abord l'adresse e-mail du compte : ouvrez le lien de l'e-mail de confirmation, puis réessayez.",
      suppression:
        "La suppression de votre compte est demandée (peut-être depuis un autre appareil) : rechargez la page, qui vous proposera de l'annuler. Vous pouvez toujours exporter vos données.",
      droits:
        "Ce compte n'a accès à aucune entreprise : reconnectez-vous ; si cela persiste, écrivez-nous.",
      brouillonModifie:
        'Ce brouillon a changé ailleurs depuis son ouverture (un autre onglet ou un autre appareil) : rechargez la version enregistrée, ou gardez la vôtre, puis recommencez.',
      date: "La date d'émission sort des dates admises.",
      /** `compteur` faux : le gabarit n'a pas de compteur (`{NNNN}`), il ne donne qu'un numéro. */
      doublon: (numero: string, compteur: boolean) =>
        compteur
          ? `Le numéro ${numero || 'attribué'} et les milliers qui le suivent dans votre numérotation sont déjà pris : changez le gabarit de la numérotation, puis recommencez.`
          : `Le numéro ${numero || 'attribué'} est déjà pris, et votre gabarit de numérotation n'a pas de compteur ({NNNN}) qui en donnerait un autre : ajoutez-en un, ou changez le gabarit, puis recommencez.`,
      pdfDejaDepose: 'Le PDF de cette facture est déjà déposé.',
      limite: (heure: string | undefined) =>
        heure
          ? `Trop de demandes en peu de temps : réessayez après ${heure}.`
          : 'Trop de demandes en peu de temps : réessayez dans quelques minutes.',
      /** La fin d'une attente qui n'est pas aujourd'hui (« réessayez après le … à … »). */
      dateEtHeure: (date: string, heure: string) => `le ${date} à ${heure}`,
      envoi: "Le service d'envoi a refusé l'e-mail : il n'est pas parti. Réessayez dans un moment.",
      interne: (requete: string | undefined) =>
        requete
          ? `Erreur du serveur : réessayez dans un instant ; si elle persiste, citez l'identifiant ${requete}.`
          : 'Erreur du serveur : réessayez dans un instant.',
      tropGros:
        'La demande dépasse 10 Mo, le plus que le serveur accepte : allégez ou retirez des pièces jointes, puis recommencez.',
      inconnue: 'Le serveur a refusé la demande : réessayez dans un instant.',
      avoirDevise:
        "La devise de cet avoir n'est pas celle de la facture qu'il cite : un avoir est dans la devise de la facture qu'il corrige.",
      /** Un logo trop grand en pixels pour le rendu du serveur (Ruling 62). */
      logoDimensions: (largeur: number, hauteur: number, maxLargeur: number, maxHauteur: number) =>
        `Le logo mesure ${largeur} × ${hauteur} pixels : ${maxLargeur} × ${maxHauteur} au plus. Choisissez-le de nouveau (onglet Apparence ou page Entreprise) : le Studio le réduira.`,
    },
    /** Émettre en mode compte : la facture part au serveur, qui la numérote. */
    emission: {
      aucunNumero: "Aucun numéro n'a été consommé.",
      emise: (numero: string) => `Facture ${numero} émise.`,
      exemple:
        "L'exemple n'est pas un brouillon de votre compte : modifiez-le, ou partez d'une facture vierge, pour l'émettre.",
      /** Pourquoi le brouillon n'a pas pu être enregistré avant l'émission. */
      nonEnregistre: {
        injoignable:
          "Le serveur du compte ne répond pas : le brouillon n'est pas enregistré, et la facture n'est pas émise.",
        session:
          "Votre session a expiré : reconnectez-vous. Le brouillon n'est pas enregistré, et la facture n'est pas émise.",
        reseau:
          "Hors ligne : le brouillon n'est pas enregistré, et la facture n'est pas émise. Émettez-la au retour du réseau.",
        conflit:
          'Ce brouillon a été modifié ailleurs : rechargez la version enregistrée ou gardez la vôtre, puis émettez.',
        supprime:
          'Ce brouillon a été supprimé ailleurs : recréez-le avec votre saisie, puis émettez.',
        refus: (cause: string) =>
          `Le serveur refuse ce brouillon (${cause}) : corrigez-le, puis émettez.`,
        delai:
          "Le serveur n'a pas confirmé l'enregistrement du brouillon à temps : la facture n'est pas émise. Réessayez dans un instant.",
        autre:
          "Le brouillon n'a pas pu être enregistré sur le serveur : la facture n'est pas émise. Réessayez dans un instant.",
      },
      enCours:
        "Votre saisie change encore pendant l'enregistrement : émettez une fois la frappe arrêtée.",
      tropGros:
        'La facture et ses pièces jointes dépassent 10 Mo, le plus que le serveur accepte : allégez ou retirez des pièces jointes, puis émettez de nouveau.',
      incertain:
        "La réponse du serveur n'est pas arrivée : la facture est peut-être émise. Réessayez : si elle l'a été, le nouvel essai la retrouve, sans émettre de seconde facture ni consommer d'autre numéro.",
      session: 'Votre session a expiré : reconnectez-vous, puis émettez de nouveau.',
      refusSansDetail:
        'Le serveur refuse cette facture sans dire pourquoi : vérifiez-la, puis émettez de nouveau.',
      refus: (n: number) =>
        n > 1
          ? `Le serveur refuse cette facture (${n} anomalies) : voyez l'onglet Contrôle.`
          : "Le serveur refuse cette facture : voyez l'onglet Contrôle.",
      date: (min: string | undefined, max: string) =>
        min
          ? `La date d'émission doit être comprise entre le ${min} et le ${max} : la numérotation reste chronologique.`
          : `La date d'émission ne peut pas dépasser le ${max}.`,
      chargement:
        "Le module d'émission n'a pas pu être chargé : la facture n'est pas émise. Vérifiez votre connexion, puis rechargez la page (votre saisie est enregistrée avant).",
      indisponible:
        "Le compte n'est pas chargé dans cette page : rechargez-la, puis émettez de nouveau. La facture n'est pas émise.",
      dejaEmise:
        'Cette facture est déjà émise : pour en faire une autre, dupliquez-la ; pour la corriger, émettez un avoir.',
      precedenteEnCours:
        "Une émission précédente de ce brouillon est encore en train d'aboutir : patientez un instant, puis réessayez. Si elle a abouti, le nouvel essai retrouvera la facture, sans en émettre une seconde.",
      erreurLocale:
        "Le Studio n'a pas pu préparer l'émission : rien n'est parti. Rechargez la page, puis émettez de nouveau.",
      avoirDevise:
        "Cet avoir n'est pas dans la devise de la facture qu'il cite : choisissez la devise de cette facture (Document, plus d'options), puis émettez de nouveau.",
      renvoyer: "Renvoyer l'e-mail de confirmation",
      confirmationRenvoyee: (email: string) =>
        `Un nouvel e-mail de confirmation est parti vers ${email} : ouvrez le lien qu'il contient, puis émettez de nouveau.`,
      dejaEmis: (numero: string) =>
        `Ce brouillon a déjà été émis (facture ${numero}) : la facture s'ouvre, et aucune seconde facture n'est émise.`,
      dejaEmisGarde: (numero: string) =>
        `La facture ${numero} a bien été émise ; votre saisie depuis est gardée dans un nouveau brouillon.`,
      emiseNonAffichee: (numero: string) =>
        `Ce brouillon a déjà été émis (facture ${numero}), mais l'historique n'a pas pu être relu : retrouvez la facture dans l'historique dès que le réseau répond.`,
    },
    /** La navigation du mode compte (spec § 10), à la place du bouton Bibliothèque. */
    navigation: {
      titre: 'Menu',
      tableau: 'Tableau de bord',
      factures: 'Factures',
      nouvelle: 'Nouvelle facture',
      brouillons: 'Brouillons',
      clients: 'Clients',
      catalogue: 'Catalogue',
      entreprise: 'Entreprise',
      chargement:
        "Le module des factures n'a pas pu être chargé : vérifiez votre connexion, puis rechargez la page (votre saisie est enregistrée avant).",
    },
    /** Les factures émises, leur statut de paiement, leurs paiements et leurs relances. */
    suivi: {
      statuts: {
        a_payer: 'À payer',
        payee_en_partie: 'Payée en partie',
        en_retard: 'En retard',
        payee: 'Payée',
        a_rembourser: 'À rembourser',
      },
      moyens: {
        virement: 'Virement',
        cheque: 'Chèque',
        especes: 'Espèces',
        carte: 'Carte',
        prelevement: 'Prélèvement',
        autre: 'Autre',
      },
      erreurs: {
        excessif:
          "Ce paiement dépasse le reste dû de la facture (avoirs déduits) : il n'est pas enregistré. Vérifiez le montant.",
        date: "Un paiement ne peut pas être daté du futur (date de Paris) : il n'est pas enregistré.",
        avoir: 'Un avoir ne se paie pas : aucun paiement ne peut y être enregistré.',
        annulation: 'Un paiement annulé le reste : son annulation ne se modifie plus.',
        dejaAnnule: "Ce paiement est déjà annulé, ou n'existe plus : rien n'a changé.",
        droits: "Cette facture n'est pas accessible depuis ce compte : rien n'a été enregistré.",
        session:
          "Votre session a expiré : reconnectez-vous, puis recommencez. Rien n'a été enregistré.",
        reseau: 'Le serveur est injoignable : vérifiez votre connexion, puis réessayez.',
        serveur: 'Erreur du serveur : réessayez dans un instant.',
        invalide:
          'Le serveur refuse ces valeurs : vérifiez la date, le montant et le moyen de paiement.',
        autre: "Le serveur a refusé l'opération : réessayez dans un instant.",
        sansCompte: "Le compte n'est pas chargé dans cette page : rechargez-la, puis recommencez.",
        introuvable:
          "Cette facture n'a pas de suivi : c'est un avoir, ou elle n'est pas de ce compte.",
        rienAPayer: "Cette facture n'a plus rien à payer : rien n'a été enregistré.",
        resteChange:
          "Le reste dû a changé depuis son affichage (un paiement ou un avoir enregistré ailleurs) : rien n'a été enregistré. Vérifiez le nouveau montant, puis recommencez.",
        pdfIndisponible:
          "PDF indisponible : le fichier de cette facture n'est pas sur le serveur. Ses données restent dans la fiche.",
        inattendue:
          'Erreur inattendue du Studio (détail dans la console du navigateur) : rechargez la page ; si une opération était en cours, vérifiez son résultat avant de la recommencer.',
      },
      montant: {
        vide: 'Saisissez le montant du paiement.',
        illisible: "Ce montant n'est pas lisible : saisissez un nombre, par exemple 1 250,00.",
        decimales: 'Deux décimales au plus.',
        positif: 'Le montant doit être supérieur à zéro.',
      },
      liste: {
        titre: 'Factures',
        intro:
          'Vos factures émises et leur statut de paiement, tenu par le serveur. Les avoirs, qui ne se paient pas, ne figurent pas ici.',
        statut: 'Statut',
        client: 'Client',
        tous: 'Tous',
        du: 'Émises du',
        au: 'au',
        effacer: 'Effacer les filtres',
        chargement: 'Chargement…',
        vide: "Aucune facture émise pour l'instant : celles que vous émettrez apparaîtront ici.",
        videFiltres: 'Aucune facture ne correspond à ces filtres.',
        reessayer: 'Réessayer',
        nombre: (n: number) => `${n} facture${n > 1 ? 's' : ''}`,
        emise: (date: string) => `émise le ${date}`,
        echeance: (date: string) => `échéance le ${date}`,
        retard: (jours: number) => `${jours} jour${jours > 1 ? 's' : ''} de retard`,
        reste: (montant: string) => `reste ${montant}`,
        aRembourser: (montant: string) => `à rembourser ${montant}`,
        periode: 'La date de début dépasse la date de fin : aucune facture ne peut y tomber.',
      },
      fiche: {
        titre: 'Fiche de la facture',
        retour: 'Toutes les factures',
        chargement: 'Chargement de la fiche…',
        netAPayer: 'Net à payer',
        encaisse: 'Encaissé',
        avoirs: 'Avoirs',
        resteDu: 'Reste dû',
        sansEcheance: 'sans échéance',
        pdf: 'PDF de la facture',
        pdfChargement: 'Chargement du PDF…',
        telecharger: 'Télécharger le PDF',
        sansLecteur:
          "Ce navigateur n'affiche pas les PDF dans la page : téléchargez celui de la facture pour le lire.",
        paiements: 'Paiements',
        aucunPaiement: 'Aucun paiement enregistré.',
        annuleLe: (date: string) => `annulé le ${date}`,
        annuler: 'Annuler ce paiement',
        annulerConfirm: (montant: string, date: string) =>
          `Annuler le paiement de ${montant} du ${date} ? Il restera affiché, barré, et ne comptera plus.`,
        annule: 'Paiement annulé : il reste affiché, barré.',
        enregistrer: 'Enregistrer un paiement',
        marquer: 'Marquer comme payée',
        marquerConfirm: (montant: string) =>
          `Enregistrer un paiement du reste dû, ${montant}, à la date d'aujourd'hui ?`,
        enregistre: 'Paiement enregistré.',
        marquee: 'Facture marquée comme payée.',
        date: 'Date du paiement',
        montant: 'Montant',
        moyen: 'Moyen de paiement',
        note: 'Note',
        noteAide: 'Facultative : référence du virement, numéro du chèque…',
        resteDuAide: (montant: string) => `Reste dû : ${montant}.`,
        dateFuture: 'Cette date est dans le futur : le serveur refusera le paiement.',
        dateVide: 'Saisissez la date du paiement.',
        valider: 'Enregistrer le paiement',
        relances: 'Relances',
        aucuneRelance: 'Aucune relance envoyée.',
        niveau: (n: number) => `Relance de niveau ${n}`,
        envoyee: (date: string, destinataire: string) => `envoyée le ${date} à ${destinataire}`,
        incertaine: (date: string, destinataire: string) =>
          `peut-être partie le ${date} vers ${destinataire} : le service d'envoi n'a pas répondu à temps ; elle compte dans la limite`,
        refusee: (date: string, destinataire: string) =>
          `refusée par le service d'envoi le ${date} (${destinataire}) : elle n'est pas partie`,
        relancer: 'Relancer',
        dupliquer: 'Dupliquer',
        avoir: 'Faire un avoir',
        solde: 'Facturer le solde',
        formulaireIntrouvable:
          "Le contenu de cette facture n'a pas pu être relu : réessayez dans un instant.",
        relue: (message: string) => `La fiche n'a pas pu être relue. ${message}`,
      },
    },
    /** Le tableau de bord du compte (spec § 8) : ses chiffres par devise, ses retards, ses échéances. */
    tableau: {
      titre: 'Tableau de bord',
      intro:
        "Chiffres tenus par le serveur, une devise à la fois : rien n'est converti ni additionné d'une devise à l'autre.",
      periode: 'Période',
      mois: 'Ce mois-ci',
      annee: 'Cette année',
      intervalle: (debut: string, fin: string) => `du ${debut} au ${fin}`,
      devise: (code: string) => `Montants en ${code}`,
      factureHt: 'Facturé HT',
      factureHtAide: 'avoirs déduits',
      encaisse: 'Encaissé',
      resteAEncaisser: 'Reste à encaisser',
      enRetard: 'En retard',
      nombre: (n: number) => `${n} facture${n > 1 ? 's' : ''}`,
      aDate: 'Reste à encaisser et retards : à ce jour, quelle que soit la période.',
      retards: 'Factures en retard',
      aucunRetard: 'Aucune facture en retard.',
      relancer: 'Relancer',
      echeances: (jours: number) => `Échéances des ${jours} prochains jours`,
      aucuneEcheance: (jours: number) => `Aucune échéance dans les ${jours} prochains jours.`,
      aujourdhui: "échéance aujourd'hui",
      chargement: 'Chargement…',
      retour: 'Tableau de bord',
    },
    /** La relance d'une facture en retard (spec § 9) : le dialogue qui la prépare et l'envoie. */
    relance: {
      titre: (numero: string) => `Relancer la facture ${numero}`,
      titreSansNumero: 'Relancer une facture',
      chargement: 'Préparation de la relance…',
      niveaux: { 1: 'rappel courtois', 2: 'rappel ferme', 3: 'dernier rappel' },
      langues: { fr: 'en français', en: 'en anglais' },
      presentation: (niveau: number, nom: string, langue: string, deLaFacture: boolean) =>
        `Relance de niveau ${niveau}, ${nom}, rédigée ${langue}${deLaFacture ? ', la langue de la facture' : " (la langue de la facture n'a pas pu être lue)"}. Relisez-la et modifiez-la librement : le PDF de la facture est joint à l'e-mail.`,
      particulier:
        "Client particulier : le dernier rappel ne cite ni pénalités de retard ni indemnité forfaitaire de recouvrement, qui ne s'appliquent qu'entre professionnels.",
      pasEnRetard:
        "Cette facture n'est pas en retard (son échéance n'est pas passée, ou rien n'est dû) : le serveur refusera la relance.",
      destinataire: 'Destinataire',
      destinataireVide:
        "La facture ne porte pas d'adresse e-mail pour ce client : saisissez celle à qui écrire.",
      destinataireInvalide:
        'Adresse e-mail non valide : une seule adresse, sans espace ni caractère spécial.',
      objet: 'Objet',
      corps: 'Message',
      corpsAide:
        "Texte brut, 10 000 caractères au plus : il part tel que vous l'écrivez, mis en page par le serveur.",
      envoyer: 'Envoyer la relance',
      envoi: 'Envoi en cours…',
      envoyee: (niveau: number, destinataire: string) =>
        `Relance de niveau ${niveau} envoyée à ${destinataire}.`,
      envoyeeAide:
        "« Envoyée » : le service d'envoi a accepté l'e-mail, rien ne dit qu'il a été lu. La relance figure dans la fiche de la facture.",
      incertaine:
        'La relance est peut-être partie ; elle compte dans la limite. Vérifiez avant de relancer.',
      sansReponse:
        "La réponse du serveur n'est pas arrivée : la relance est peut-être partie. Vérifiez les relances de la fiche avant de relancer.",
      aucuneEnvoyee: "Aucune relance n'est partie.",
      /** Les refus de `relancer` que la réaction commune (`erreurs.ts`) ne dit pas pour une relance. */
      refus: {
        session: 'Votre session a expiré : reconnectez-vous, puis relancez.',
        droits: "Cette facture n'est pas accessible depuis ce compte.",
        siren:
          "Le SIREN de votre entreprise n'est pas renseigné : complétez la fiche de l'entreprise, puis relancez.",
        pasDeRetard:
          "Cette facture n'est plus en retard : son échéance n'est pas passée, ou rien n'est dû.",
        destinataire:
          'Le serveur refuse cette adresse : une seule adresse e-mail est attendue, sans espace ni caractère spécial.',
        objet: "L'objet est vide, ou contient un caractère que le serveur refuse.",
        corps:
          'Le message est vide, dépasse 10 000 caractères, ou contient un caractère que le serveur refuse.',
        illisible: 'Le serveur ne lit pas cette demande : rechargez la page, puis recommencez.',
        /** Une limite dont la réponse ne dit pas la cause. */
        limite: (moment: string | undefined) =>
          moment
            ? `Une limite des relances est atteinte : réessayez après ${moment}.`
            : 'Une limite des relances est atteinte : réessayez plus tard.',
        /** La limite que la réponse nomme (`details.cause`). */
        limites: {
          delai: (moment: string | undefined) =>
            `Cette facture a déjà été relancée il y a moins de trois jours : ${moment ? `réessayez après ${moment}` : 'réessayez plus tard'}.`,
          jour: (moment: string | undefined) =>
            `Vingt relances ont déjà été envoyées aujourd'hui, le plus par jour : ${moment ? `réessayez après ${moment}` : 'réessayez demain'}.`,
          tentatives: (moment: string | undefined) =>
            `Trop de tentatives d'envoi ont été refusées aujourd'hui par le service d'envoi : ${moment ? `réessayez après ${moment}` : 'réessayez demain'}.`,
          verrou: (_moment: string | undefined) =>
            "Une autre relance de l'entreprise est en cours d'envoi : réessayez dans quelques secondes.",
        },
      },
      ouvrirEntreprise: "Ouvrir la fiche de l'entreprise",
      renvoyer: "Renvoyer l'e-mail de confirmation",
      confirmationRenvoyee: (email: string) =>
        `Un nouvel e-mail de confirmation est parti vers ${email} : ouvrez le lien qu'il contient, puis relancez.`,
    },
    /** Importer dans le compte ce que le Studio a gardé dans ce navigateur, sans compte. */
    importation: {
      menu: 'Importer les données de ce navigateur',
      titre: 'Importer les données de ce navigateur',
      lecture: 'Lecture des données de ce navigateur…',
      aucune:
        "Ce navigateur ne garde aucune donnée du Studio utilisé sans compte : il n'y a rien à importer.",
      trouve: (elements: string) =>
        `Ce navigateur garde des données du Studio utilisé sans compte : ${elements}.`,
      trouves: {
        entreprise: 'votre entreprise',
        clients: (n: number) => `${n} client${n > 1 ? 's' : ''}`,
        produits: (n: number) => `${n} article${n > 1 ? 's' : ''} du catalogue`,
        factures: (n: number) => `${n} facture${n > 1 ? 's' : ''} émise${n > 1 ? 's' : ''}`,
        brouillon: 'un brouillon en cours',
      },
      /** « a, b et c ». */
      liste: (parties: string[]) =>
        parties.length > 1
          ? `${parties.slice(0, -1).join(', ')} et ${parties[parties.length - 1]}`
          : (parties[0] ?? ''),
      reprise:
        "Un import précédent n'est pas allé au bout : reprenez-le. Ce qui est déjà dans le compte n'y est pas importé deux fois.",
      repriseFactures: (n: number) =>
        `Un import précédent n'est pas allé au bout : ${n} facture${n > 1 ? 's attendent' : ' attend'} encore. La reprise n'envoie qu'elle${n > 1 ? 's' : ''}.`,
      repriseBrouillon:
        "Votre brouillon en cours n'est pas encore devenu un brouillon du compte : la reprise le reprend.",
      explication:
        "L'import ajoute à votre compte ce qu'il n'a pas encore et ne remplace rien de ce qu'il a : les clients et les articles qui n'y sont pas ; chaque facture, relue dans son PDF Factur-X, avec son numéro ; le brouillon en cours, comme un brouillon de plus. Votre entreprise, votre apparence par défaut et les réglages de la numérotation (gabarit, remise à zéro) ne sont repris que si ceux du compte n'ont jamais été renseignés ; la numérotation ne recule jamais. Rien n'est effacé de ce navigateur.",
      plusTard: 'Vous pourrez aussi le faire plus tard, depuis « Mon compte ».',
      importer: 'Importer dans mon compte',
      pasMaintenant: 'Pas maintenant',
      enCours: 'Import en cours : gardez cette page ouverte.',
      bibliotheque: 'Entreprise, apparence, clients et catalogue…',
      progression: (n: number, total: number) => `Facture ${n} sur ${total}…`,
      termine: 'Import terminé.',
      arrete: "L'import s'est arrêté avant la fin.",
      bilan: {
        factures: (n: number) =>
          n === 0
            ? 'Aucune nouvelle facture importée.'
            : `${n} facture${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''}.`,
        bibliotheque: (clients: number, produits: number) =>
          `${clients} client${clients > 1 ? 's' : ''} et ${produits} article${produits > 1 ? 's' : ''} du catalogue repris.`,
        doublons: (numeros: string[]) =>
          `Déjà dans le compte, laissées telles quelles : ${numeros.join(', ')}.`,
        dejaLa: (clients: number, produits: number) =>
          `Déjà dans le compte, laissés tels quels : ${clients} client${clients > 1 ? 's' : ''} et ${produits} article${produits > 1 ? 's' : ''}.`,
        conserves: (elements: string) =>
          `Gardés tels qu'ils sont dans le compte, à la place de ceux de ce navigateur : ${elements}.`,
        conservesNoms: {
          entreprise: "l'entreprise",
          apparence: "l'apparence par défaut",
          numerotation: 'le gabarit et la remise à zéro de la numérotation',
        },
        numerosPris: (numeros: string[]) =>
          `Numéro déjà pris par une autre facture du compte : ${numeros.join(', ')}. Ces factures ne sont ni dans le compte ni dans son export : gardez une sauvegarde de ce navigateur.`,
        refusees: 'Non importées :',
        echecs: 'Non repris :',
        enAttente: (n: number) => `${n} facture${n > 1 ? 's' : ''} en attente :`,
        numerotation: (rang: number) => `Numérotation reprise : prochain rang ${rang}.`,
        numerotationEnAvance:
          "Numérotation : les factures importées sont d'une année plus récente que celle de la numérotation du compte ; la prochaine émission de cette année-là prendra le premier numéro libre après elles.",
      },
      reprendra:
        'Il reprendra de lui-même à cette heure-là si vous laissez ce dialogue ouvert ; sinon, reprenez-le plus tard depuis « Mon compte ».',
      reprendre: "Reprendre l'import",
      brouillon: {
        repris: "Votre brouillon en cours est ouvert : c'est désormais un brouillon du compte.",
        nonRepris:
          "Votre brouillon en cours n'a pas pu devenir un brouillon du compte : il reste dans ce navigateur, et l'import peut être repris.",
        dejaRepris: 'Votre brouillon en cours est déjà un brouillon du compte.',
      },
      /** Ce qui n'a pas pu être repris, dans le bilan. */
      elements: {
        entreprise: "l'entreprise",
        apparence: "l'apparence par défaut",
        fichier: (nom: string) => `le fichier ${nom}`,
        client: (nom: string) => `le client ${nom}`,
        produit: (nom: string) => `l'article ${nom}`,
        numerotation: 'la numérotation',
      },
      /** Pourquoi une facture n'est pas importée, ou un élément pas repris. */
      raisons: {
        pdfAbsent: 'son PDF ne se trouve pas dans ce navigateur',
        pdfIllisible: "son PDF n'est pas lisible",
        facturx: (detail: string | undefined) =>
          `le serveur n'y lit pas de facture Factur-X${detail ? ` (${detail})` : ''}`,
        tropLourde: 'elle dépasse 10 Mo, le plus que le serveur accepte',
        dateFuture: (date: string) =>
          `sa date d'émission${date ? `, le ${date},` : ''} est postérieure à aujourd'hui ; le compte la refuse, car elle bloquerait toute nouvelle émission, et elle reste dans ce navigateur`,
        refus: 'refusé par le serveur',
        session: "votre session a expiré (reconnectez-vous, puis reprenez l'import)",
        reseau: "le serveur ne répond pas (reprenez l'import plus tard)",
      },
      /** Pourquoi l'import s'arrête : ce qui reste attend une reprise. */
      arrets: {
        limite: (moment: string | undefined) =>
          moment
            ? `Le serveur accepte 500 imports par heure : l'import pourra reprendre après ${moment}.`
            : "Le serveur accepte 500 imports par heure : reprenez l'import dans une heure.",
        session: "Votre session a expiré : reconnectez-vous, puis reprenez l'import.",
        reseau:
          "Le serveur ne répond pas : reprenez l'import plus tard. Ce qui est déjà dans le compte n'y sera pas importé deux fois.",
      },
      erreur:
        "L'import n'a pas pu commencer : les données de ce navigateur ne se lisent pas, ou le compte n'est pas prêt. Rechargez la page, puis réessayez.",
    },
    /** Exporter les données du compte : une archive zip. */
    export: {
      menu: 'Exporter mes données',
      chargement:
        "Le module d'export n'a pas pu être chargé : vérifiez votre connexion, puis rechargez la page.",
      enCours: "Préparation de l'archive : vos données et le PDF de chaque facture…",
      fait: (pdf: number, manquants: number) =>
        `Archive téléchargée : vos données et ${pdf} PDF.${manquants > 0 ? ` ${manquants} PDF manquant${manquants > 1 ? 's sont listés' : ' est listé'} dans donnees.json.` : ''}`,
      sansCompte: 'Connectez-vous pour exporter les données du compte.',
      session:
        "Votre session a expiré : reconnectez-vous, puis exportez de nouveau. Aucune archive n'a été produite.",
      reseau:
        "Le serveur ne répond pas : réessayez dans un instant. Aucune archive n'a été produite.",
      echec:
        "L'export n'a pas abouti : réessayez dans un instant. Aucune archive n'a été produite.",
      tropGrand:
        "Le compte dépasse ce qu'une archive zip simple peut contenir (65 535 fichiers, 4 Go, ou quelques centaines de Mo de PDF) : aucune archive n'a été produite. Écrivez-nous pour obtenir vos données.",
    },
    /** La page Entreprise (spec § 10) : profil vendeur, logo, numérotation, et le compte. */
    entreprise: {
      titre: 'Entreprise',
      intro:
        'Votre entreprise telle que vos factures la présentent, la numérotation des prochaines, et votre compte.',
      profil: 'Profil vendeur',
      logo: 'Logo',
      logoIntro: (largeur: number, hauteur: number) =>
        `Le logo de vos prochaines factures : PNG ou JPEG, 1 Mo et ${largeur} × ${hauteur} pixels au plus. Celui de la facture ouverte se change dans l'onglet Apparence.`,
      logoAucun: 'Pas de logo sur vos prochaines factures.',
      logoChoisir: 'Choisir un logo…',
      logoRemplacer: 'Remplacer…',
      logoRetirer: 'Retirer',
      logoTropGros:
        "Ce logo pèse plus de 1 Mo : réduisez-le, puis recommencez. Rien n'a été envoyé.",
      logoType: "Ce fichier n'est ni un PNG ni un JPEG : rien n'a été envoyé.",
      logoDimensions: (largeur: number, hauteur: number) =>
        `Ce logo dépasse ${largeur} × ${hauteur} pixels : réduisez-le, puis recommencez. Rien n'a été envoyé.`,
      logoIllisible: "Cette image n'a pas pu être lue : rien n'a été envoyé.",
      logoEnregistre: 'Logo enregistré pour vos prochaines factures.',
      logoRetire: 'Logo retiré de vos prochaines factures.',
      numerotation: 'Numérotation',
      numerotationIntro:
        "Le serveur attribue les numéros à l'émission, dans cette suite, en sautant ceux qui sont déjà pris. Le prochain rang peut monter, jamais redescendre.",
      compte: 'Compte',
      donnees: 'Vos données',
      exportIntro:
        'Une archive zip : vos données, que le Studio sans compte sait restaurer, et le PDF de chaque facture.',
      exportFait: (heure: string) => `Archive téléchargée à ${heure}.`,
    },
    /** Changer d'adresse ou de mot de passe, et le nouveau mot de passe après un lien de réinitialisation. */
    motDePasse: {
      adresse: 'Adresse e-mail',
      confirmee: 'confirmée',
      nonConfirmee: 'pas encore confirmée',
      nouvelleAdresse: 'Nouvelle adresse',
      changerAdresse: "Changer d'adresse",
      adresseManquante: 'Saisissez la nouvelle adresse.',
      memeAdresse: "C'est déjà l'adresse du compte.",
      adresseEnvoyee: (actuelle: string, nouvelle: string) =>
        `Pour terminer, ouvrez le lien envoyé à ${nouvelle}, puis celui envoyé à ${actuelle}. Jusque-là, l'adresse du compte reste ${actuelle}.`,
      titre: 'Mot de passe',
      nouveau: 'Nouveau mot de passe',
      confirmation: 'Retapez-le',
      changer: 'Changer le mot de passe',
      manquant: 'Saisissez le nouveau mot de passe, deux fois.',
      differents: 'Les deux saisies diffèrent : retapez le nouveau mot de passe.',
      change: 'Mot de passe changé.',
      recuperationTitre: 'Choisissez un nouveau mot de passe',
      recuperationIntro:
        'Le lien reçu par e-mail vous a connecté : choisissez maintenant le mot de passe que vous utiliserez désormais.',
      plusTard: 'Plus tard',
    },
    /** Supprimer le compte en deux temps, et l'écran d'un compte dont la suppression est demandée (spec § 12). */
    suppression: {
      titre: 'Supprimer le compte',
      intro:
        "Vos factures doivent être conservées dix ans : cette obligation légale vous incombe, pas à facturx. Avant de supprimer votre compte, exportez vos données : l'archive sera la seule copie qui vous restera.",
      exportDabord:
        "Exportez d'abord vos données, ci-dessus : sans cet export, la suppression ne se demande pas.",
      demander: 'Supprimer mon compte…',
      confirmerTitre: 'Supprimer votre compte ?',
      confirmerDelai: (date: string) =>
        `Le compte sera effacé le ${date}, 30 jours après cette demande. D'ici là, il ne sert plus qu'à exporter vos données ou à annuler la suppression : vous ne pourrez plus émettre, importer ni relancer.`,
      confirmerEfface:
        'Seront effacés : vos factures et leurs PDF, les paiements et les relances, les brouillons, les clients, le catalogue, votre entreprise avec sa numérotation, son logo et ses polices, puis le compte lui-même.',
      confirmerCopie: (heure: string) =>
        `L'archive exportée à ${heure} sera la seule copie de vos données : gardez-la dix ans, le temps pendant lequel la loi vous oblige à conserver vos factures.`,
      confirmerPdfManquants: (n: number) =>
        `Il lui manque ${n > 1 ? `${n} PDF de factures, listés` : 'le PDF d’une facture, listé'} dans donnees.json : exportez de nouveau avant de demander la suppression.`,
      confirmerEmisesDepuis: (n: number) =>
        `${n > 1 ? `${n} factures ont été émises` : 'Une facture a été émise'} depuis cet export : ${n > 1 ? 'elles ne sont' : 'elle n’est'} pas dans l'archive. Exportez de nouveau avant de demander la suppression.`,
      reexporter: 'Exporter de nouveau',
      confirmer: 'Demander la suppression',
      garder: 'Garder mon compte',
      ecranTitre: 'Suppression du compte demandée',
      demandeeLe: (email: string, date: string) =>
        `La suppression du compte ${email} a été demandée le ${date}.`,
      purgeLe: (date: string) =>
        `Le ${date}, tout sera effacé : les factures et leurs PDF, les paiements, les relances, les brouillons, les clients, le catalogue, l'entreprise, puis le compte lui-même.`,
      jusqueLa:
        "D'ici là, vous pouvez annuler la suppression : le compte reprend tel qu'il était. Vous pouvez aussi exporter vos données, autant de fois qu'il le faut.",
      echue:
        "Le délai de 30 jours est écoulé : l'effacement peut commencer à tout moment, et la suppression ne s'annule plus. Exportez vos données tant que c'est possible.",
      annuler: 'Annuler la suppression',
      annulee: 'Suppression annulée : votre compte reprend.',
      tropTard: (date: string) =>
        `La suppression demandée le ${date} remonte à plus de 30 jours : elle ne peut plus être annulée, et l'effacement a pu commencer.`,
      tropTardSansDate:
        "La suppression a été demandée il y a plus de 30 jours : elle ne peut plus être annulée, et l'effacement a pu commencer.",
      session: 'Votre session a expiré : reconnectez-vous, puis recommencez.',
      reseau: "Le serveur ne répond pas : rien n'a changé. Réessayez dans un instant.",
      chargement:
        "L'écran du compte n'a pas pu être chargé : vérifiez votre connexion, puis rechargez la page.",
    },
    /** Se déconnecter sur un poste partagé : ce navigateur ne garde rien du compte. */
    deconnexion: {
      nonEnvoye: (elements: string[]) =>
        `Pas encore enregistré sur le serveur : ${
          elements.length > 1
            ? `${elements.slice(0, -1).join(', ')} et ${elements[elements.length - 1]}`
            : (elements[0] ?? '')
        }. En vous déconnectant, vous le perdez : ce navigateur ne garde rien du compte après la déconnexion. Se déconnecter quand même ?`,
      elements: {
        draft: 'la saisie du brouillon ouvert',
        miseDeCote: 'une saisie mise de côté',
        company: "l'entreprise",
        numbering: 'la numérotation',
        apparence: "l'apparence par défaut",
        clients: 'des clients',
        products: 'des articles du catalogue',
        files: 'des fichiers (logo, polices)',
        enCours: 'des enregistrements encore en route',
        autre: "d'autres modifications",
      },
      enCours: 'Enregistrement de vos dernières modifications avant la déconnexion…',
    },
  },
};

export type Strings = typeof fr;

const en: Strings = {
  lang: 'en',
  app: {
    studio: 'Studio',
    untitled: 'No number',
    tabs: { content: 'Content', appearance: 'Appearance', check: 'Check', code: 'Code' },
    mobile: { edit: 'Edit', preview: 'Preview' },
    new: 'New',
    newBlank: 'Blank invoice',
    newSample: 'See the example again',
    duplicate: 'Duplicate this invoice',
    creditNote: 'Credit note for this invoice',
    open: 'Open a file…',
    library: 'Library',
    issue: 'Issue the invoice',
    issueShort: 'Issue',
    download: 'Download',
    downloadPdf: 'Factur-X PDF',
    downloadPdfNoIssue: 'Factur-X PDF, without issuing',
    downloadXml: 'CII XML only',
    downloadJson: 'Studio document (.json)',
    storageMemory:
      'Local storage is unavailable: your work will be lost when this tab closes. Download the Studio document to keep it.',
    sample:
      'This is an example, compliant end to end. Replace the details with your own, or start from a blank page.',
    startBlank: 'Start a blank invoice',
    issuedBanner: (date: string) => `Invoice issued on ${date}: it can no longer be changed.`,
    issuedHint: 'To correct it, issue a credit note; to make another one, duplicate it.',
    close: 'Close',
    back: 'Back',
    cancel: 'Cancel',
    save: 'Save',
    remove: 'Delete',
    more: 'More options',
    less: 'Fewer options',
    optional: 'optional',
    required: 'required',
    copy: 'Copy',
    copied: 'Copied',
    dropHere: 'Drop an invoice to open it in the Studio',
    importing: (file: string) => `Reading ${file}…`,
    imported: (source: string) =>
      `Invoice imported from ${source}. Check it, then issue it under your own number.`,
    sources: {
      pdf: 'a Factur-X PDF',
      cii: 'a CII XML',
      ubl: 'a UBL XML',
      studio: 'a Studio document',
    },
    importFailed: (message: string) => `Import failed: ${message}`,
    loading: 'Loading the Studio…',
    replaceConfirm: 'Replace the current invoice? Anything not issued will be lost.',
    readOnly: 'Issued invoice: read only',
    footPrivacy:
      'Without an account, nothing you type leaves this browser: the Studio sends your invoices, customers and settings to no server, they stay here. A single signal is sent, with no content, when a Factur-X PDF is produced — to know whether the tool is used, with no cookie and nothing from your invoice; like any request, it leaves your IP address in the server log (see the privacy policy).',
    footPrivacyCompte:
      'With an account, your invoices, customers and settings are kept on a server in Europe, in Paris, by Supabase, an American company. The host encrypts them at rest, but the service reads them: it has to, to issue, number and send reminders. The open draft is also copied into this browser. As without an account, a signal with no content is sent to this site when a Factur-X PDF is produced.',
    footLegal:
      'The Studio is not legal advice and does not replace the approved platform that will transmit your invoices.',
    footLinks: {
      home: 'Home',
      validator: 'Validator',
      source: 'Source code',
      privacy: 'Privacy',
      fonts: 'Font licences',
    },
    sections: 'Sections',
  },
  status: {
    ok: 'Compliant',
    checking: 'Checking…',
    issues: (n: number) => `${n} issue${n > 1 ? 's' : ''} to fix`,
    officialOk: 'and validated by the official schematrons',
  },
  issueDialog: {
    title: (id: string) => `Issue invoice ${id}?`,
    body: 'It will join your history, and numbering will move to the next number. An issued invoice can no longer be changed: to correct it, you will issue a credit note.',
    confirm: 'Issue and download',
    duplicateNumber: 'This number is already in your history: two invoices cannot share it.',
    issued: (id: string) => `Invoice ${id} issued and downloaded.`,
    blocked: 'Fix the reported issues: only a compliant invoice can be downloaded.',
    failed: (message: string) => `The PDF could not be produced: ${message}`,
    compte: {
      title: 'Issue this invoice?',
      body: 'The server gives it the next number in your sequence, checks it and produces its Factur-X PDF; it joins your history. An issued invoice can no longer be changed: to correct it, you will issue a credit note.',
      confirm: 'Issue',
    },
  },
  sections: {
    document: 'Document',
    seller: 'Seller',
    buyer: 'Customer',
    lines: 'Lines',
    adjustments: 'Allowances and charges',
    exemptions: 'VAT exemptions',
    delivery: 'Delivery',
    payment: 'Payment',
    references: 'References',
    notes: 'Notes',
    attachments: 'Attachments',
  },
  document: {
    type: 'Document type',
    number: 'Number',
    numberHint: 'Unique, in a chronological and continuous sequence.',
    numberAssigned: 'Assigned on issue: the server gives the next number in your sequence.',
    nextNumber: 'Next number',
    issueDate: 'Issue date',
    nature: 'Nature of the transaction',
    natureHint: 'Mandatory under the French reform; it sets the billing framework.',
    currency: 'Currency',
    avoirDevise: (citees: string) =>
      `Cited invoice in another currency: ${citees}. A credit note is in the currency of the invoice it corrects; the server will refuse to issue it.`,
    businessProcess: 'Billing framework (BT-23)',
    processing: 'Expected processing (BR-FR-20)',
    vatOnDebits: 'VAT on debits',
    vatOnDebitsHint: 'If you opted to pay VAT on an accrual basis: the statement is then printed.',
    taxPointDate: 'VAT point date',
    buyerReference: 'Buyer reference (BT-10)',
    buyerReferenceHint: 'Chorus Pro service code, customer internal reference.',
    numberLength: '35 characters at most (BR-FR-01).',
    numberChars: 'Unaccented letters, digits and - + _ / only (BR-FR-02).',
    numberDuplicate: 'This number is already in your history.',
  },
  party: {
    name: 'Legal name',
    buyerName: 'Name or legal name',
    tradingName: 'Trading name',
    siren: 'SIREN',
    siret: 'SIRET',
    vatId: 'VAT number',
    computeVat: 'Derive from SIREN',
    taxRegistrationId: 'Local tax ID',
    legalInfo: 'Legal information',
    legalInfoHint:
      'Legal form, share capital, registration — e.g. “SAS au capital de 10 000 € — RCS Paris 443 061 841”.',
    compose: 'Compose',
    legalForm: 'Legal form',
    capital: 'Share capital (€)',
    rcsCity: 'Registry (RCS city)',
    insert: 'Insert',
    line1: 'Address',
    line2: 'Address line 2',
    postCode: 'Postcode',
    city: 'City',
    country: 'Country',
    subdivision: 'Region',
    contact: 'Contact',
    contactName: 'Contact name',
    phone: 'Phone',
    email: 'Email',
    electronic: 'Electronic address',
    electronicHint: 'Routing address of the French reform: scheme 0225, SIREN or SIREN_SUFFIX.',
    fromSiren: 'Use the SIREN',
    scheme: 'Scheme',
    routingCode: 'Routing code (0224)',
    consumer: 'Consumer (B2C)',
    consumerHint: 'A consumer has no SIREN or electronic address to provide.',
    identity: 'Identity',
    identifiers: 'Identifiers',
    saveCompany: 'Save as my company',
    companySaved: 'Company saved: it will be used on your next invoices.',
    pickClient: 'Use a saved customer…',
    saveClient: 'Save this customer',
    clientSaved: 'Customer saved.',
    clientUpdated: 'Customer updated.',
    sirenInvalid: 'Wrong check digit: check the nine digits.',
  },
  payee: {
    title: 'Payee',
    enable: 'Payment is due to a third party (factoring…)',
    name: 'Name',
    id: 'SIRET',
    legalId: 'SIREN',
  },
  lines: {
    add: 'Add a line',
    fromCatalog: 'From the catalogue',
    emptyCatalog: 'Empty catalogue: save a line to reuse it.',
    designation: 'Description',
    description: 'Details',
    quantity: 'Qty',
    unit: 'Unit',
    unitPrice: 'Unit price excl. VAT',
    vat: 'VAT',
    amount: 'Net amount',
    details: 'Details',
    duplicate: 'Duplicate',
    remove: 'Delete',
    moveUp: 'Move up',
    moveDown: 'Move down',
    saveProduct: 'Save to catalogue',
    productSaved: 'Line saved to the catalogue.',
    itemId: 'Item reference',
    buyerItemId: 'Buyer reference',
    gtin: 'EAN / GTIN',
    origin: 'Country of origin',
    periodStart: 'Period: from',
    periodEnd: 'to',
    note: 'Line note',
    orderLine: 'Purchase order line',
    accounting: 'Buyer accounting code',
    grossPrice: 'Gross price excl. VAT',
    grossPriceHint: 'Price before the price discount; the discount is sent separately.',
    baseQuantity: 'Price for a quantity of',
    baseQuantityHint: 'For a price “per 100”: 100. Empty: per unit.',
    allowances: 'Line allowances',
    charges: 'Line charges',
    addAllowance: 'Allowance',
    addCharge: 'Charge',
    totalHT: 'Total excl. VAT',
    totalVAT: 'VAT',
    totalTTC: 'Total incl. VAT',
    due: 'Amount due',
    untitled: 'Untitled line',
  },
  adjustments: {
    hint: 'On the whole invoice; an allowance over several VAT rates is split pro rata.',
    addAllowance: 'Add an allowance',
    addCharge: 'Add a charge',
    allowance: 'Allowance',
    charge: 'Charge',
    reason: 'Label',
    reasonCode: 'Standard reason',
    percent: '%',
    amount: 'Amount',
    value: 'Value',
    vat: 'VAT',
    vatAuto: 'Split by rate',
    prepaid: 'Deposits already paid (incl. VAT)',
    prepaidHint: 'Deducted from the amount due; reference the deposit invoices under “References”.',
    rounding: 'Rounding',
    defaultAllowance: 'Remise',
    defaultCharge: 'Frais',
  },
  exemptions: {
    hint: 'Each VAT-free regime requires a statement; it is printed and sent in the XML.',
    code: 'Reason (VATEX)',
    text: 'Printed statement',
    categories: {
      E: 'Exemption',
      AE: 'Reverse charge',
      K: 'Intra-EU supply',
      G: 'Export',
      O: 'Out of scope',
    },
  },
  delivery: {
    hint: 'Date of the sale or service: mandatory (French commercial code, art. L441-9).',
    date: 'Date',
    period: 'Period',
    dateLabel: 'Delivery or performance date',
    start: 'Start',
    end: 'End',
    address: 'Delivered to another address than the customer’s',
    addressServices:
      'For a supply of services, the standard does not ask for a delivery address (BR-FR-14): only give one if it means something, such as the place where the work is done.',
    partyName: 'Recipient',
    locationId: 'Location ID',
  },
  payment: {
    dueDate: 'Due date',
    onReceipt: 'On receipt',
    days30: '30 days',
    days45eom: '45 days EOM',
    days60: '60 days',
    terms: 'Terms',
    structured: 'Guided statements',
    text: 'Free text',
    penalty: 'Late payment interest (% per year)',
    penaltyHint: 'At least three times the legal interest rate (art. L441-10).',
    indemnity: 'Fixed recovery fee (€)',
    indemnityHint: '€40: amount set by article D441-5.',
    discount: 'Early payment discount',
    noDiscount: 'None',
    withDiscount: 'Yes',
    discountRate: 'Rate (%)',
    discountDays: 'Within (days)',
    termsText: 'Payment terms',
    termsTextHint: 'The text must state the late interest, the €40 fee and the discount.',
    generated: 'Statements printed and sent',
    means: 'Payment means',
    addMeans: 'Add a payment means',
    type: 'Means',
    iban: 'IBAN',
    bic: 'BIC',
    accountName: 'Account holder',
    mandate: 'Mandate reference',
    creditorId: 'SEPA creditor ID',
    debitedIban: 'Debited IBAN',
    label: 'Label',
    remittance: 'Payment reference',
    remittanceHint: 'For the customer to quote when paying; usually the invoice number.',
    ibanInvalid: 'Invalid IBAN: the check digits do not match.',
  },
  references: {
    hint: 'The purchase order is mandatory on the invoice when the buyer issued one.',
    purchaseOrder: 'Purchase order',
    contract: 'Contract',
    project: 'Project',
    salesOrder: 'Sales order',
    despatchAdvice: 'Despatch advice',
    receivingAdvice: 'Receiving advice',
    tenderOrLot: 'Tender or lot',
    invoicedObject: 'Invoiced object',
    buyerAccountingReference: 'Accounting reference',
    preceding: 'Related invoices',
    precedingHint:
      'For a credit note, a corrected invoice or a final invoice after deposit: the original invoice.',
    precedingRequired: 'Required for this document type: give the original invoice.',
    addPreceding: 'Add an invoice',
    precedingId: 'Number',
    precedingDate: 'Date',
    others: 'Other references',
  },
  notes: {
    hint: 'Late interest, recovery fee, discount and processing are written for you, from the payment section.',
    add: 'Add a note',
    subject: 'Subject',
    text: 'Text',
    presets: 'Common statements',
    presetList: [
      {
        code: 'ACC',
        label: 'Assignment (factoring)',
        text: "Pour être libératoire, votre règlement doit être effectué directement à l'ordre de [affactureur], qui le reçoit par subrogation.",
      },
      {
        code: 'REG',
        label: 'Approved association',
        text: "Membre d'une association agréée, le règlement par chèque est accepté.",
      },
      { code: 'ABL', label: 'Sole trader', text: 'Entrepreneur individuel (EI)' },
      { code: 'BLU', label: 'Eco-contribution', text: 'Dont éco-participation : 0,00 € HT.' },
      { code: 'AAI', label: 'Thank you', text: 'Thank you for your business.' },
    ],
  },
  attachments: {
    hint: 'Embedded as base64 in the XML: purchase order, delivery note, statement…',
    addFile: 'Attach a file',
    addLink: 'Reference a link',
    id: 'Identifier',
    kind: 'Kind',
    uri: 'Address (URL)',
    tooLarge: 'File too large: 20 MB at most per attachment.',
    badType: 'Type refused: PDF, PNG, JPEG, CSV, XLSX or ODS (BR-CL-24).',
  },
  appearance: {
    template: 'Template',
    templates: {
      classic: ['Classic', 'Sober and timeless'],
      modern: ['Modern', 'Colour band'],
      minimal: ['Minimal', 'Plenty of air'],
      letterhead: ['Letterhead', 'Business letter'],
      cards: ['Cards', 'Tinted blocks'],
      compact: ['Compact', 'For long invoices'],
    },
    color: 'Colour',
    customColor: 'Custom colour',
    contrast: 'Text on the colour stays readable: it is darkened or inverted when needed.',
    font: 'Font',
    fontImport: 'Import a font…',
    fontImportHint: 'Static TTF or OTF, like on your letterhead; the bold weight is optional.',
    fontRegular: 'Regular file',
    fontBold: 'Bold file (optional)',
    fontCustom: 'Your font',
    fontLoading: 'Loading the font…',
    logo: 'Logo',
    logoAdd: 'Add a logo',
    logoReplace: 'Replace',
    logoRemove: 'Remove',
    logoHint: 'PNG, JPEG or SVG (converted to PNG, transparency kept).',
    logoPosition: 'Position',
    left: 'Left',
    right: 'Right',
    logoSize: 'Height',
    layout: 'Layout',
    layoutHint: 'Each template is a set of these settings; adjust them one by one.',
    reset: 'Back to the template',
    styles: {
      header: ['Header', { plain: 'Plain', band: 'Band', letterhead: 'Letterhead' }],
      parties: ['Seller and customer', { plain: 'Text', boxed: 'Cards' }],
      tableHeader: ['Table header', { rule: 'Rule', filled: 'Solid', tinted: 'Tinted' }],
      rows: ['Table rows', { rules: 'Rules', zebra: 'Striped', plain: 'None' }],
      totals: ['Totals', { plain: 'Aligned', boxed: 'Boxed' }],
      amountDue: ['Amount due', { text: 'Text', filled: 'Block' }],
      titleCase: ['Title', { normal: 'Normal', upper: 'Capitals' }],
      density: ['Density', { comfortable: 'Airy', compact: 'Compact' }],
      corners: ['Corners', { square: 'Square', rounded: 'Rounded' }],
    },
    language: 'Document language',
    languages: { fr: 'French', en: 'English' },
    languageHint: 'Labels, numbers and dates. The French legal statements stay in French.',
    page: 'Page size',
    labels: 'Labels',
    labelsHint:
      'Rename the headings. The document title and the legal statements cannot be renamed.',
    labelNames: {
      seller: 'Seller',
      buyer: 'Buyer',
      designation: 'Description',
      quantity: 'Quantity',
      unitPrice: 'Unit price',
      vat: 'VAT',
      netAmount: 'Amount',
      amountDue: 'Amount due',
      paymentTerms: 'Terms',
      notes: 'Notes',
      scanToPay: 'QR code caption',
    },
    display: 'Show',
    displays: {
      lineNumbers: 'Line numbers',
      itemDetails: 'Item references',
      contacts: 'Contacts',
      electronicAddresses: 'Electronic addresses',
      paymentDetails: 'Bank details',
      paymentQrCode: 'SEPA payment QR code',
      references: 'Optional references',
      facturxNotice: '“Factur-X electronic invoice” notice',
    },
    qrHint:
      'Read by banking apps (EPC format): payee, IBAN, amount due and reference, with nothing to type.',
    qrUnavailable: {
      'credit-note': 'No QR code on a credit note: you are the one refunding.',
      currency: 'No QR code: SEPA transfers are made in euros.',
      amount: 'No QR code: nothing to pay, or an amount beyond what the format allows.',
      'no-transfer': 'No QR code: add a credit transfer with your IBAN, under Payment.',
      'invalid-iban': 'No QR code: the transfer’s IBAN is invalid.',
      'no-name': 'No QR code: the seller’s name is missing.',
      'too-long': 'No QR code: name and payment reference are too long for the format.',
    },
    footer: 'Footer',
    footerHint: 'Two lines at most: registration, capital, activity code, website…',
    footerFromLegal: 'Use the legal information',
    locked: 'Always printed',
    lockedText:
      'Number, dates, parties and their identifiers, nature of the transaction, delivery, purchase order, original invoice, VAT and its statements, due date, late interest, recovery fee and discount: no setting removes them.',
    saveDefault: 'Use for my next invoices',
    defaultSaved: 'Appearance kept for your next invoices.',
  },
  check: {
    verdictOk: 'Compliant: ready to issue',
    verdictIssues: (n: number) => `${n} issue${n > 1 ? 's' : ''} to fix before issuing`,
    verdictServeur: 'Refused by the server: fix it before issuing',
    sdk: 'SDK check',
    sdkDetail: 'EN 16931 model, cent-exact arithmetic, French BR-FR rules.',
    serveur: 'Refused by the server',
    serveurDetail:
      'When issuing, the server found these issues in the invoice shown: fix them, then issue again.',
    noIssues: 'No issues.',
    fix: 'Fix',
    official: 'Official validators',
    officialDetail: 'The three reference schematrons, run in your browser on the XML produced.',
    run: 'Run the validators',
    rerun: 'Run again',
    running: 'Running…',
    waiting: 'They run once the SDK issues are fixed.',
    stale: 'The invoice changed since the last run.',
    judges: {
      cen: ['EN 16931 (CEN)', 'official CII schematron'],
      facturx: ['Factur-X EN 16931', 'profile 1.09.2 schematron'],
      brfr: ['BR-FR (XP Z12-012)', 'Flux 2 schematron V1.4.0.04'],
    },
    judgeOk: 'Compliant',
    judgeFailed: 'Not compliant',
    judgeSkipped: 'Not run',
    tolerated: 'tolerated',
    warning: 'warning',
    fatal: 'blocking',
    mentions: 'Statements printed on the page',
    mentionsDetail:
      'Reported by the layout itself: what the reader sees, and what the XML carries.',
    glyphs: 'Characters missing from the font',
    glyphsDetail:
      'They would become empty glyphs, refused by PDF/A: change the font or replace them.',
    input: {
      number: 'Unreadable number.',
      decimals: (scale: number) => `${scale} decimal${scale > 1 ? 's' : ''} at most.`,
      negative: 'Positive value expected.',
      vat: 'Unknown VAT rate.',
      gross: 'The gross price must be at least the net price.',
    },
    verapdf:
      'The PDF/A-3 check (veraPDF) requires Java: it runs on every SDK release in continuous integration, not in the browser.',
    mentionLabels: {
      title: 'Document type',
      number: 'Invoice number',
      issueDate: 'Issue date',
      seller: 'Seller identity',
      sellerId: 'Seller SIREN or SIRET',
      sellerVatId: 'Seller VAT number',
      sellerLegalInfo: 'Legal form, capital, registration',
      buyer: 'Buyer identity',
      buyerId: 'Buyer SIREN',
      buyerVatId: 'Buyer VAT number',
      deliveryDate: 'Delivery date or period',
      deliveryAddress: 'Delivery address',
      operationCategory: 'Nature of the transaction',
      purchaseOrder: 'Purchase order',
      precedingInvoices: 'Original invoice',
      selfBilling: '“Self-billing” statement',
      lines: 'Items, quantities, unit prices',
      vatBreakdown: 'VAT per rate',
      vatExemption: 'Exemption statement',
      vatOnDebits: 'VAT on debits option',
      taxPointDate: 'VAT point date',
      totals: 'Totals excl. VAT, VAT and incl. VAT',
      prepaid: 'Deposits deducted',
      dueDate: 'Due date',
      latePenalty: 'Late payment interest',
      recoveryIndemnity: '€40 recovery fee',
      earlyPaymentDiscount: 'Discount terms',
      paymentTerms: 'Payment terms',
      paymentMeans: 'Payment means',
    },
  },
  code: {
    intro:
      'The Studio only uses the public SDK API. Here are the exact calls that produce this document — ready to paste into your application.',
    ts: 'TypeScript',
    xml: 'CII XML',
    json: 'Invoice object',
    install: 'Install',
    xmlInvalid:
      'The XML is produced once the invoice is compliant: the SDK refuses to generate an invalid document.',
  },
  preview: {
    fit: 'Fit to width',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    pages: (n: number) => `${n} page${n > 1 ? 's' : ''}`,
    updating: 'Updating…',
    hint: 'Click anything on the invoice to edit it.',
    error: (message: string) => `Preview unavailable: ${message}`,
    page: (n: number) => `Page ${n}`,
  },
  library: {
    title: 'Library',
    tabs: {
      company: 'My company',
      clients: 'Customers',
      products: 'Catalogue',
      history: 'History',
      numbering: 'Numbering',
      backup: 'Backup',
    },
    companyIntro: 'Used on every new invoice. Edit it here or from the “Seller” block.',
    fromCurrent: 'Take the seller of the current invoice',
    defaults: 'New invoice preferences',
    paymentDays: 'Payment term (days)',
    endOfMonth: 'End of month',
    defaultVat: 'Default VAT',
    defaultNature: 'Default nature',
    saved: 'Saved.',
    clientsEmpty: 'No saved customers. Use “Save this customer” in the Customer block.',
    productsEmpty: 'Empty catalogue. Use “Save to catalogue” on a line.',
    historyEmpty: 'No invoice issued yet.',
    search: 'Search',
    use: 'Invoice',
    addToInvoice: 'Add to invoice',
    open: 'Open',
    redownload: 'Download',
    duplicate: 'Duplicate',
    credit: 'Credit note',
    balance: 'Invoice the balance',
    balanceHint: 'Final invoice: the selected deposits are referenced and deducted (withDeposits).',
    selectDeposits: 'Deposits to deduct',
    createBalance: 'Create the final invoice',
    pattern: 'Number pattern',
    patternHint: '{AAAA} year, {AA} two-digit year, {MM} month, {NNNN} four-digit counter.',
    nextRank: 'Next rank',
    nextRankTooLow: (minimum: number) =>
      `${minimum} at least: the account's numbering never goes down, so that no number is ever assigned twice. Nothing is sent.`,
    yearly: 'Restart at 1 every year',
    nextPreview: 'Next number',
    numberingWarning:
      'Numbering must stay continuous: do not skip numbers, and never reuse one already issued.',
    backupIntro:
      'Everything is kept in this browser, and only there. A backup protects you from a site-data cleanup or a change of computer.',
    backupIntroCompte:
      "Your data is kept on the account's server. This backup is a file to keep wherever you like, without the invoice PDFs; for the full archive, with the PDF of each invoice, use “Export my data” in the account menu.",
    export: 'Download a backup',
    restore: 'Restore a backup…',
    restored: 'Backup restored.',
    restoreFailed: 'This file is not a Studio backup.',
    counts: (clients: number, products: number, invoices: number) =>
      `${clients} customer${clients > 1 ? 's' : ''}, ${products} item${products > 1 ? 's' : ''}, ${invoices} issued invoice${invoices > 1 ? 's' : ''}`,
    deleteConfirm: 'Delete permanently?',
    issuedOn: (date: string) => `issued on ${date}`,
  },
  compte: {
    signIn: 'Sign in',
    create: 'Create a free account',
    createShort: 'Create an account',
    signOut: 'Sign out',
    menu: 'My account',
    dialogTitle: {
      connexion: 'Sign in',
      inscription: 'Create a free account',
      oubli: 'Forgot your password',
    },
    signUpIntro:
      'With an account, your invoices, customers and settings are kept on a server in Europe, and you find them on all your devices. Without one, nothing changes: everything stays in this browser.',
    forgotIntro: 'Enter your address: we will email you a link to choose a new password.',
    email: 'Email address',
    password: 'Password',
    forgot: 'Forgot your password?',
    acceptBefore: 'I accept the ',
    acceptLink: 'terms of use',
    submit: {
      connexion: 'Sign in',
      inscription: 'Create my account',
      oubli: 'Send the link',
    },
    missingFields: 'Enter your email address and password.',
    missingEmail: 'Enter your email address.',
    acceptRequired: 'Accept the terms of use to create an account.',
    confirmationSent: (email: string) =>
      `A confirmation email is on its way to ${email}. Open the link it contains: in this browser your account opens right away; from another device, you will just need to sign in afterwards.`,
    resetSent: (email: string) =>
      `If an account exists for ${email}, a link to choose a new password has just been sent there.`,
    link: {
      expired:
        'This link has expired or has already been used. Sign in; otherwise, request a new link with “Forgot your password?”.',
      noSession:
        'This link could not open a session in this browser: it was probably opened somewhere other than where you requested it, or it has already been used. If it was to confirm your address, the address is confirmed: sign in. If it was for a new password, request another link with “Forgot your password?”.',
      autreAdresse:
        'Link accepted. To finish changing your address, also open the link sent to the other address: until then, the address of the account does not change.',
    },
    errors: {
      credentials: 'Wrong email address or password.',
      notConfirmed: 'This address is not confirmed yet: open the link in the confirmation email.',
      exists: 'An account already exists with this address.',
      weak: 'This password is too weak: choose a longer or more varied one.',
      invalidEmail: 'This email address is not valid.',
      rateLimit: 'Too many attempts or emails sent: try again in a few minutes.',
      signupClosed: 'Sign-ups are closed for the moment.',
      network: 'The server cannot be reached: check your connection, then try again.',
      samePassword: 'Choose a password different from the current one.',
      reauth:
        'Changing the password requires a recent sign-in: sign out, sign in again, then start over.',
      session: 'Your session has expired: sign in again, then start over.',
      other: 'The operation failed. Try again in a moment.',
      loadFailed: 'The sign-in module could not be loaded: check your connection.',
    },
    conservation: {
      horsLigne:
        'Offline, not saved: your work stays in this browser and will be sent when the network is back.',
      sessionExpiree:
        'Your session has expired: sign in again to save. Your work is kept in this browser.',
      reconnecter: 'Sign in again',
      reprise:
        'Your session has expired. Sign in again: your work is kept, and it will be saved right away.',
      conflit:
        'This draft was changed elsewhere (another tab or another device): your work is not saved.',
      conflitSousVue:
        'The open draft conflicts with another version (changed or deleted elsewhere), and it is not the one shown: open it to decide what happens to your work.',
      ouvrirConflit: 'Open this draft',
      supprime:
        'This draft was deleted elsewhere (another tab or another device): your work is not saved, but it stays here.',
      recreer: 'Recreate it with my work',
      recharger: 'Reload the saved version',
      garder: 'Keep mine',
      garderConfirm:
        'Replace the version saved elsewhere with yours? What was entered there will be lost.',
      recharge: 'Draft reloaded.',
      garde: 'Your version is saved.',
      supprimeAilleurs:
        'This draft no longer exists on the server (issued or deleted elsewhere): your work is saved as a new draft.',
      refus: 'The server refused to save this change: it is still displayed, but it is not kept.',
      recul: 'Numbering cannot go backwards: the next number must stay at least the server’s.',
      fichier: 'File refused: a PNG or JPEG logo of 1 MB at most, or a TTF font of 2 MB at most.',
      fichierDimensions: (largeur: number, hauteur: number) =>
        `Logo refused: ${largeur} × ${hauteur} pixels at most. Choose it again in the Studio, which shrinks it itself.`,
      enAttente: {
        reseau:
          'Offline: what you typed in the open draft is not on the server yet. Switch documents once the network is back, so as not to lose it.',
        session:
          'Session expired: sign in again first. What you typed in the open draft is not on the server yet, and switching documents would lose it.',
        conflit:
          'This draft is in conflict: reload the saved version or keep yours before switching documents.',
        supprime:
          'This draft was deleted elsewhere: recreate it with your work before switching documents.',
        refus: (cause: string) =>
          `The server refuses this draft${cause ? ` (${cause})` : ''}: switching documents would lose what you typed. Correct it, or discard it.`,
        injoignable:
          'The account server is not responding: switching documents waits for it, so that nothing you typed is lost.',
        enCours:
          'What you type keeps changing while it is being saved: switch documents once you stop typing.',
      },
      injoignable:
        'The account server is not responding: your invoices, customers and settings could not be read. Your work stays in this browser, and everything resumes as soon as it responds.',
      injoignableVerrou:
        'The account server is not responding: the company and numbering shown are not yours, and they cannot be changed until it is back.',
      injoignableFichier:
        'The account server is not responding: this file cannot be uploaded now. Try again as soon as it responds.',
      rechargerPage: 'Reload the page',
      miseDeCote:
        'Something you typed that the server had not received could not be read back in this browser at startup: it has been set aside, nothing of it is lost. Reopen it to make it a draft.',
      rouvrirMiseDeCote: 'Reopen it',
      brouillonRefuse: (cause: string) =>
        `The server refuses this draft (${cause}): what you typed is not saved, but it stays here. Correct it, or discard it.`,
      abandonner: 'Discard this work',
      abandonnerConfirm:
        'Discard this work? Everything the server refused will be lost: the draft goes back to its last saved version, or disappears if it was never saved.',
      abandonne: 'Work discarded: the draft is back to its last saved version.',
    },
    brouillons: {
      titre: 'Drafts',
      intro: 'Your drafts are saved to your account: you find them on all your devices.',
      nouveau: 'New draft',
      ouvrir: 'Open',
      ouvert: 'open',
      supprimerConfirm: (nom: string) => `Delete the draft ${nom}? It cannot be recovered.`,
      vide: 'No drafts yet: the invoice you enter will be the first.',
      sansClient: 'customer to enter',
      modifie: (date: string) => `modified on ${date}`,
      chargement: 'Loading…',
      echec: 'The operation did not go through: check your connection, then try again in a moment.',
      introuvable: 'This draft no longer exists: it was issued or deleted elsewhere.',
      nonEnregistre: 'not saved yet',
      repli:
        'The next draft could not be opened: a blank invoice opens instead. Your other drafts are untouched.',
      reprendre: 'Resume',
      moduleNonCharge:
        'The drafts module could not be loaded: check your connection, then reload the page (what you typed is saved first).',
    },
    erreurs: {
      nonConfirme:
        'First confirm the email address of your account: open the link in the confirmation email, then try again.',
      suppression:
        'Deletion of your account has been requested (perhaps from another device): reload the page, which will offer to cancel it. You can still export your data.',
      droits:
        'This account has no access to any company: sign in again; if this persists, write to us.',
      brouillonModifie:
        'This draft was changed elsewhere since it was opened (another tab or another device): reload the saved version, or keep yours, then start again.',
      date: 'The issue date is outside the allowed dates.',
      doublon: (numero: string, compteur: boolean) =>
        compteur
          ? `Number ${numero || 'assigned'} and the thousands that follow it in your sequence are already taken: change the numbering pattern, then start again.`
          : `Number ${numero || 'assigned'} is already taken, and your numbering pattern has no counter ({NNNN}) to give another one: add one, or change the pattern, then start again.`,
      pdfDejaDepose: 'The PDF of this invoice has already been uploaded.',
      limite: (heure: string | undefined) =>
        heure
          ? `Too many requests in a short time: try again after ${heure}.`
          : 'Too many requests in a short time: try again in a few minutes.',
      dateEtHeure: (date: string, heure: string) => `${date} at ${heure}`,
      envoi: 'The sending service refused the email: it was not sent. Try again in a while.',
      interne: (requete: string | undefined) =>
        requete
          ? `Server error: try again in a moment; if it persists, quote the identifier ${requete}.`
          : 'Server error: try again in a moment.',
      tropGros:
        'The request exceeds 10 MB, the most the server accepts: shrink or remove attachments, then start again.',
      inconnue: 'The server refused the request: try again in a moment.',
      avoirDevise:
        'The currency of this credit note is not that of the invoice it cites: a credit note is in the currency of the invoice it corrects.',
      logoDimensions: (largeur: number, hauteur: number, maxLargeur: number, maxHauteur: number) =>
        `The logo is ${largeur} × ${hauteur} pixels: ${maxLargeur} × ${maxHauteur} at most. Choose it again (Appearance tab or Company page): the Studio will shrink it.`,
    },
    emission: {
      aucunNumero: 'No number was used.',
      emise: (numero: string) => `Invoice ${numero} issued.`,
      exemple:
        'The sample is not a draft of your account: edit it, or start from a blank invoice, to issue it.',
      nonEnregistre: {
        injoignable:
          'The account server is not responding: the draft is not saved, and the invoice is not issued.',
        session:
          'Your session has expired: sign in again. The draft is not saved, and the invoice is not issued.',
        reseau:
          'Offline: the draft is not saved, and the invoice is not issued. Issue it once the network is back.',
        conflit:
          'This draft was changed elsewhere: reload the saved version or keep yours, then issue.',
        supprime: 'This draft was deleted elsewhere: recreate it with your input, then issue.',
        refus: (cause: string) => `The server refuses this draft (${cause}): fix it, then issue.`,
        delai:
          'The server did not confirm saving the draft in time: the invoice is not issued. Try again in a moment.',
        autre:
          'The draft could not be saved on the server: the invoice is not issued. Try again in a moment.',
      },
      enCours: 'Your input keeps changing while saving: issue once you stop typing.',
      tropGros:
        'The invoice and its attachments exceed 10 MB, the most the server accepts: shrink or remove attachments, then issue again.',
      incertain:
        'The server’s answer did not arrive: the invoice may have been issued. Try again: if it was, the new attempt finds it, without issuing a second invoice or using another number.',
      session: 'Your session has expired: sign in again, then issue again.',
      refusSansDetail:
        'The server refuses this invoice without saying why: check it, then issue again.',
      refus: (n: number) =>
        n > 1
          ? `The server refuses this invoice (${n} issues): see the Check tab.`
          : 'The server refuses this invoice: see the Check tab.',
      date: (min: string | undefined, max: string) =>
        min
          ? `The issue date must be between ${min} and ${max}: numbering stays chronological.`
          : `The issue date cannot be later than ${max}.`,
      chargement:
        'The issuing module could not be loaded: the invoice is not issued. Check your connection, then reload the page (what you typed is saved first).',
      indisponible:
        'The account is not loaded in this page: reload it, then issue again. The invoice is not issued.',
      dejaEmise:
        'This invoice is already issued: to make another one, duplicate it; to correct it, issue a credit note.',
      precedenteEnCours:
        'A previous issue of this draft is still completing: wait a moment, then try again. If it went through, the new attempt will find the invoice without issuing a second one.',
      erreurLocale:
        'The Studio could not prepare the issue: nothing was sent. Reload the page, then issue again.',
      avoirDevise:
        'This credit note is not in the currency of the invoice it cites: choose that invoice’s currency (Document, more options), then issue again.',
      renvoyer: 'Resend the confirmation email',
      confirmationRenvoyee: (email: string) =>
        `A new confirmation email was sent to ${email}: open the link it contains, then issue again.`,
      dejaEmis: (numero: string) =>
        `This draft was already issued (invoice ${numero}): the invoice opens, and no second invoice is issued.`,
      dejaEmisGarde: (numero: string) =>
        `Invoice ${numero} was indeed issued; what you typed since is kept in a new draft.`,
      emiseNonAffichee: (numero: string) =>
        `This draft was already issued (invoice ${numero}), but the history could not be read: find the invoice in the history once the network responds.`,
    },
    navigation: {
      titre: 'Menu',
      tableau: 'Dashboard',
      factures: 'Invoices',
      nouvelle: 'New invoice',
      brouillons: 'Drafts',
      clients: 'Clients',
      catalogue: 'Catalogue',
      entreprise: 'Company',
      chargement:
        'The invoices module could not be loaded: check your connection, then reload the page (what you typed is saved first).',
    },
    suivi: {
      statuts: {
        a_payer: 'Unpaid',
        payee_en_partie: 'Partly paid',
        en_retard: 'Overdue',
        payee: 'Paid',
        a_rembourser: 'To refund',
      },
      moyens: {
        virement: 'Bank transfer',
        cheque: 'Cheque',
        especes: 'Cash',
        carte: 'Card',
        prelevement: 'Direct debit',
        autre: 'Other',
      },
      erreurs: {
        excessif:
          'This payment exceeds the amount left to pay on the invoice (credit notes deducted): it is not recorded. Check the amount.',
        date: 'A payment cannot be dated in the future (Paris date): it is not recorded.',
        avoir: 'A credit note is not paid: no payment can be recorded on it.',
        annulation: 'A cancelled payment stays cancelled: its cancellation can no longer change.',
        dejaAnnule: 'This payment is already cancelled, or no longer exists: nothing changed.',
        droits: 'This invoice is not accessible from this account: nothing was recorded.',
        session: 'Your session has expired: sign in again, then retry. Nothing was recorded.',
        reseau: 'The server cannot be reached: check your connection, then try again.',
        serveur: 'Server error: try again in a moment.',
        invalide:
          'The server rejects these values: check the date, the amount and the payment method.',
        autre: 'The server refused the operation: try again in a moment.',
        sansCompte: 'The account is not loaded in this page: reload it, then try again.',
        introuvable:
          'This invoice has no payment tracking: it is a credit note, or it does not belong to this account.',
        rienAPayer: 'Nothing is left to pay on this invoice: nothing was recorded.',
        resteChange:
          'The amount left to pay changed since it was shown (a payment or a credit note recorded elsewhere): nothing was recorded. Check the new amount, then try again.',
        pdfIndisponible:
          'PDF unavailable: the file of this invoice is not on the server. Its data stays in the record.',
        inattendue:
          'Unexpected Studio error (details in the browser console): reload the page; if an operation was under way, check its result before doing it again.',
      },
      montant: {
        vide: 'Enter the payment amount.',
        illisible: 'This amount cannot be read: enter a number, for example 1,250.00.',
        decimales: 'Two decimals at most.',
        positif: 'The amount must be greater than zero.',
      },
      liste: {
        titre: 'Invoices',
        intro:
          'Your issued invoices and their payment status, kept by the server. Credit notes, which are not paid, are not listed here.',
        statut: 'Status',
        client: 'Client',
        tous: 'All',
        du: 'Issued from',
        au: 'to',
        effacer: 'Clear filters',
        chargement: 'Loading…',
        vide: 'No invoice issued yet: the ones you issue will show up here.',
        videFiltres: 'No invoice matches these filters.',
        reessayer: 'Try again',
        nombre: (n: number) => `${n} invoice${n === 1 ? '' : 's'}`,
        emise: (date: string) => `issued ${date}`,
        echeance: (date: string) => `due ${date}`,
        retard: (jours: number) => `${jours} day${jours > 1 ? 's' : ''} overdue`,
        reste: (montant: string) => `${montant} left`,
        aRembourser: (montant: string) => `${montant} to refund`,
        periode: 'The start date is after the end date: no invoice can fall in between.',
      },
      fiche: {
        titre: 'Invoice record',
        retour: 'All invoices',
        chargement: 'Loading the record…',
        netAPayer: 'Amount due',
        encaisse: 'Received',
        avoirs: 'Credit notes',
        resteDu: 'Left to pay',
        sansEcheance: 'no due date',
        pdf: 'Invoice PDF',
        pdfChargement: 'Loading the PDF…',
        telecharger: 'Download the PDF',
        sansLecteur:
          'This browser does not show PDFs inside the page: download the invoice PDF to read it.',
        paiements: 'Payments',
        aucunPaiement: 'No payment recorded.',
        annuleLe: (date: string) => `cancelled ${date}`,
        annuler: 'Cancel this payment',
        annulerConfirm: (montant: string, date: string) =>
          `Cancel the payment of ${montant} dated ${date}? It will stay listed, struck through, and no longer count.`,
        annule: 'Payment cancelled: it stays listed, struck through.',
        enregistrer: 'Record a payment',
        marquer: 'Mark as paid',
        marquerConfirm: (montant: string) =>
          `Record a payment of the amount left to pay, ${montant}, dated today?`,
        enregistre: 'Payment recorded.',
        marquee: 'Invoice marked as paid.',
        date: 'Payment date',
        montant: 'Amount',
        moyen: 'Payment method',
        note: 'Note',
        noteAide: 'Optional: transfer reference, cheque number…',
        resteDuAide: (montant: string) => `Left to pay: ${montant}.`,
        dateFuture: 'This date is in the future: the server will refuse the payment.',
        dateVide: 'Enter the payment date.',
        valider: 'Record the payment',
        relances: 'Reminders',
        aucuneRelance: 'No reminder sent.',
        niveau: (n: number) => `Level ${n} reminder`,
        envoyee: (date: string, destinataire: string) => `sent ${date} to ${destinataire}`,
        incertaine: (date: string, destinataire: string) =>
          `possibly sent ${date} to ${destinataire}: the sending service did not answer in time; it counts towards the limit`,
        refusee: (date: string, destinataire: string) =>
          `refused by the sending service on ${date} (${destinataire}): it was not sent`,
        relancer: 'Send a reminder',
        dupliquer: 'Duplicate',
        avoir: 'Issue a credit note',
        solde: 'Invoice the balance',
        formulaireIntrouvable:
          'The content of this invoice could not be read again: try again in a moment.',
        relue: (message: string) => `The record could not be read again. ${message}`,
      },
    },
    tableau: {
      titre: 'Dashboard',
      intro:
        'Figures kept by the server, one currency at a time: nothing is converted or added up across currencies.',
      periode: 'Period',
      mois: 'This month',
      annee: 'This year',
      intervalle: (debut: string, fin: string) => `${debut} to ${fin}`,
      devise: (code: string) => `Amounts in ${code}`,
      factureHt: 'Invoiced excl. VAT',
      factureHtAide: 'net of credit notes',
      encaisse: 'Received',
      resteAEncaisser: 'Left to collect',
      enRetard: 'Overdue',
      nombre: (n: number) => `${n} invoice${n === 1 ? '' : 's'}`,
      aDate: 'Left to collect and overdue: as of today, whatever the period.',
      retards: 'Overdue invoices',
      aucunRetard: 'No overdue invoice.',
      relancer: 'Send a reminder',
      echeances: (jours: number) => `Due in the next ${jours} days`,
      aucuneEcheance: (jours: number) => `Nothing due in the next ${jours} days.`,
      aujourdhui: 'due today',
      chargement: 'Loading…',
      retour: 'Dashboard',
    },
    relance: {
      titre: (numero: string) => `Send a reminder for invoice ${numero}`,
      titreSansNumero: 'Send a reminder',
      chargement: 'Preparing the reminder…',
      niveaux: { 1: 'polite reminder', 2: 'firm reminder', 3: 'final reminder' },
      langues: { fr: 'in French', en: 'in English' },
      presentation: (niveau: number, nom: string, langue: string, deLaFacture: boolean) =>
        `Level ${niveau} reminder, ${nom}, written ${langue}${deLaFacture ? ', the language of the invoice' : ' (the language of the invoice could not be read)'}. Read it over and edit it freely: the invoice PDF is attached to the email.`,
      particulier:
        'Consumer client: the final reminder mentions neither late-payment penalties nor the fixed recovery fee, which only apply between businesses.',
      pasEnRetard:
        'This invoice is not overdue (its due date has not passed, or nothing is owed): the server will refuse the reminder.',
      destinataire: 'Recipient',
      destinataireVide:
        'The invoice has no email address for this client: enter the one to write to.',
      destinataireInvalide:
        'Invalid email address: a single address, without spaces or special characters.',
      objet: 'Subject',
      corps: 'Message',
      corpsAide:
        'Plain text, 10,000 characters at most: it is sent as you write it, laid out by the server.',
      envoyer: 'Send the reminder',
      envoi: 'Sending…',
      envoyee: (niveau: number, destinataire: string) =>
        `Level ${niveau} reminder sent to ${destinataire}.`,
      envoyeeAide:
        '“Sent”: the sending service accepted the email; nothing says it has been read. The reminder is listed on the invoice record.',
      incertaine:
        'The reminder may have been sent; it counts towards the limit. Check before sending another.',
      sansReponse:
        "The server's answer did not arrive: the reminder may have been sent. Check the record's reminders before sending another.",
      aucuneEnvoyee: 'No reminder was sent.',
      refus: {
        session: 'Your session has expired: sign in again, then send the reminder.',
        droits: 'This invoice is not accessible from this account.',
        siren:
          'The SIREN of your company is missing: complete the company record, then send the reminder.',
        pasDeRetard:
          'This invoice is no longer overdue: its due date has not passed, or nothing is owed.',
        destinataire:
          'The server refuses this address: a single email address is expected, without spaces or special characters.',
        objet: 'The subject is empty, or contains a character the server refuses.',
        corps:
          'The message is empty, exceeds 10,000 characters, or contains a character the server refuses.',
        illisible: 'The server cannot read this request: reload the page, then start again.',
        limite: (moment: string | undefined) =>
          moment
            ? `A reminder limit has been reached: try again after ${moment}.`
            : 'A reminder limit has been reached: try again later.',
        limites: {
          delai: (moment: string | undefined) =>
            `This invoice was already reminded less than three days ago: ${moment ? `try again after ${moment}` : 'try again later'}.`,
          jour: (moment: string | undefined) =>
            `Twenty reminders have already been sent today, the daily maximum: ${moment ? `try again after ${moment}` : 'try again tomorrow'}.`,
          tentatives: (moment: string | undefined) =>
            `Too many sending attempts were refused today by the sending service: ${moment ? `try again after ${moment}` : 'try again tomorrow'}.`,
          verrou: (_moment: string | undefined) =>
            'Another reminder of your company is being sent: try again in a few seconds.',
        },
      },
      ouvrirEntreprise: 'Open the company record',
      renvoyer: 'Resend the confirmation email',
      confirmationRenvoyee: (email: string) =>
        `A new confirmation email was sent to ${email}: open the link it contains, then send the reminder again.`,
    },
    importation: {
      menu: 'Import the data from this browser',
      titre: 'Import the data from this browser',
      lecture: 'Reading the data kept in this browser…',
      aucune:
        'This browser keeps no data from the Studio used without an account: there is nothing to import.',
      trouve: (elements: string) =>
        `This browser keeps data from the Studio used without an account: ${elements}.`,
      trouves: {
        entreprise: 'your company',
        clients: (n: number) => `${n} client${n === 1 ? '' : 's'}`,
        produits: (n: number) => `${n} catalogue item${n === 1 ? '' : 's'}`,
        factures: (n: number) => `${n} issued invoice${n === 1 ? '' : 's'}`,
        brouillon: 'a draft in progress',
      },
      liste: (parties: string[]) =>
        parties.length > 1
          ? `${parties.slice(0, -1).join(', ')} and ${parties[parties.length - 1]}`
          : (parties[0] ?? ''),
      reprise:
        'A previous import did not finish: resume it. Nothing already in the account is imported twice.',
      repriseFactures: (n: number) =>
        `A previous import did not finish: ${n} invoice${n === 1 ? ' is' : 's are'} still waiting. Resuming sends only ${n === 1 ? 'it' : 'them'}.`,
      repriseBrouillon:
        'Your draft in progress has not become an account draft yet: resuming carries it over.',
      explication:
        "Importing adds to your account what it does not have yet, and replaces nothing it has: the clients and items that are not in it; each invoice, read again from its Factur-X PDF, with its number; the draft in progress, as one more draft. Your company, default appearance and numbering settings (pattern, yearly reset) are carried over only if the account's were never filled in; numbering never goes back. Nothing is erased from this browser.",
      plusTard: 'You can also do it later, from “My account”.',
      importer: 'Import into my account',
      pasMaintenant: 'Not now',
      enCours: 'Import in progress: keep this page open.',
      bibliotheque: 'Company, appearance, clients and catalogue…',
      progression: (n: number, total: number) => `Invoice ${n} of ${total}…`,
      termine: 'Import complete.',
      arrete: 'The import stopped before the end.',
      bilan: {
        factures: (n: number) =>
          n === 0 ? 'No new invoice imported.' : `${n} invoice${n === 1 ? '' : 's'} imported.`,
        bibliotheque: (clients: number, produits: number) =>
          `${clients} client${clients === 1 ? '' : 's'} and ${produits} catalogue item${produits === 1 ? '' : 's'} carried over.`,
        doublons: (numeros: string[]) =>
          `Already in the account, left as they are: ${numeros.join(', ')}.`,
        dejaLa: (clients: number, produits: number) =>
          `Already in the account, left as they are: ${clients} client${clients === 1 ? '' : 's'} and ${produits} item${produits === 1 ? '' : 's'}.`,
        conserves: (elements: string) =>
          `Kept as they are in the account, instead of this browser's: ${elements}.`,
        conservesNoms: {
          entreprise: 'the company',
          apparence: 'the default appearance',
          numerotation: 'the numbering pattern and yearly reset',
        },
        numerosPris: (numeros: string[]) =>
          `Number already taken by another invoice of the account: ${numeros.join(', ')}. These invoices are neither in the account nor in its export: keep a backup of this browser.`,
        refusees: 'Not imported:',
        echecs: 'Not carried over:',
        enAttente: (n: number) => `${n} invoice${n === 1 ? '' : 's'} waiting:`,
        numerotation: (rang: number) => `Numbering carried over: next rank ${rang}.`,
        numerotationEnAvance:
          "Numbering: the imported invoices are from a more recent year than the account's numbering; the next invoice issued in that year will take the first free number after them.",
      },
      reprendra:
        'It will resume by itself at that time if you leave this dialog open; otherwise, resume it later from “My account”.',
      reprendre: 'Resume the import',
      brouillon: {
        repris: 'Your draft in progress is open: it is now an account draft.',
        nonRepris:
          'Your draft in progress could not become an account draft: it stays in this browser, and the import can be resumed.',
        dejaRepris: 'Your draft in progress is already an account draft.',
      },
      elements: {
        entreprise: 'the company',
        apparence: 'the default appearance',
        fichier: (nom: string) => `the file ${nom}`,
        client: (nom: string) => `the client ${nom}`,
        produit: (nom: string) => `the item ${nom}`,
        numerotation: 'the numbering',
      },
      raisons: {
        pdfAbsent: 'its PDF is not in this browser',
        pdfIllisible: 'its PDF cannot be read',
        facturx: (detail: string | undefined) =>
          `the server finds no Factur-X invoice in it${detail ? ` (${detail})` : ''}`,
        tropLourde: 'it exceeds 10 MB, the most the server accepts',
        dateFuture: (date: string) =>
          `its issue date${date ? `, ${date},` : ''} is after today; the account refuses it, as it would block any new issue, and it stays in this browser`,
        refus: 'refused by the server',
        session: 'your session has expired (sign in again, then resume the import)',
        reseau: 'the server is not responding (resume the import later)',
      },
      arrets: {
        limite: (moment: string | undefined) =>
          moment
            ? `The server accepts 500 imports per hour: the import can resume after ${moment}.`
            : 'The server accepts 500 imports per hour: resume the import in an hour.',
        session: 'Your session has expired: sign in again, then resume the import.',
        reseau:
          'The server is not responding: resume the import later. Nothing already in the account will be imported twice.',
      },
      erreur:
        'The import could not start: the data in this browser cannot be read, or the account is not ready. Reload the page, then try again.',
    },
    export: {
      menu: 'Export my data',
      chargement:
        'The export module could not be loaded: check your connection, then reload the page.',
      enCours: 'Preparing the archive: your data and the PDF of each invoice…',
      fait: (pdf: number, manquants: number) =>
        `Archive downloaded: your data and ${pdf} PDF${pdf === 1 ? '' : 's'}.${manquants > 0 ? ` ${manquants} missing PDF${manquants === 1 ? ' is' : 's are'} listed in donnees.json.` : ''}`,
      sansCompte: 'Sign in to export the account data.',
      session:
        'Your session has expired: sign in again, then export again. No archive was produced.',
      reseau: 'The server is not responding: try again in a moment. No archive was produced.',
      echec: 'The export did not complete: try again in a moment. No archive was produced.',
      tropGrand:
        'The account exceeds what a plain zip archive can hold (65,535 files, 4 GB, or a few hundred MB of PDFs): no archive was produced. Write to us to get your data.',
    },
    entreprise: {
      titre: 'Company',
      intro:
        'Your company as your invoices present it, the numbering of the next ones, and your account.',
      profil: 'Seller profile',
      logo: 'Logo',
      logoIntro: (largeur: number, hauteur: number) =>
        `The logo of your next invoices: PNG or JPEG, 1 MB and ${largeur} × ${hauteur} pixels at most. The one of the open invoice is changed in the Appearance tab.`,
      logoAucun: 'No logo on your next invoices.',
      logoChoisir: 'Choose a logo…',
      logoRemplacer: 'Replace…',
      logoRetirer: 'Remove',
      logoTropGros: 'This logo is larger than 1 MB: shrink it, then try again. Nothing was sent.',
      logoType: 'This file is neither a PNG nor a JPEG: nothing was sent.',
      logoDimensions: (largeur: number, hauteur: number) =>
        `This logo exceeds ${largeur} × ${hauteur} pixels: shrink it, then try again. Nothing was sent.`,
      logoIllisible: 'This image could not be read: nothing was sent.',
      logoEnregistre: 'Logo saved for your next invoices.',
      logoRetire: 'Logo removed from your next invoices.',
      numerotation: 'Numbering',
      numerotationIntro:
        'The server assigns the numbers on issue, in this sequence, skipping those already taken. The next rank can go up, never down.',
      compte: 'Account',
      donnees: 'Your data',
      exportIntro:
        'A zip archive: your data, which the Studio without an account can restore, and the PDF of each invoice.',
      exportFait: (heure: string) => `Archive downloaded at ${heure}.`,
    },
    motDePasse: {
      adresse: 'Email address',
      confirmee: 'confirmed',
      nonConfirmee: 'not confirmed yet',
      nouvelleAdresse: 'New address',
      changerAdresse: 'Change address',
      adresseManquante: 'Enter the new address.',
      memeAdresse: 'This is already the address of the account.',
      adresseEnvoyee: (actuelle: string, nouvelle: string) =>
        `To finish, open the link sent to ${nouvelle}, then the one sent to ${actuelle}. Until then, the address of the account remains ${actuelle}.`,
      titre: 'Password',
      nouveau: 'New password',
      confirmation: 'Type it again',
      changer: 'Change the password',
      manquant: 'Enter the new password, twice.',
      differents: 'The two entries differ: type the new password again.',
      change: 'Password changed.',
      recuperationTitre: 'Choose a new password',
      recuperationIntro:
        'The link you received by email signed you in: now choose the password you will use from now on.',
      plusTard: 'Later',
    },
    suppression: {
      titre: 'Delete the account',
      intro:
        'Your invoices must be kept for ten years: this legal obligation is yours, not facturx’s. Before deleting your account, export your data: the archive will be the only copy you have left.',
      exportDabord:
        'First export your data, above: without this export, deletion cannot be requested.',
      demander: 'Delete my account…',
      confirmerTitre: 'Delete your account?',
      confirmerDelai: (date: string) =>
        `The account will be erased on ${date}, 30 days after this request. Until then, it only serves to export your data or to cancel the deletion: you will no longer be able to issue, import or send reminders.`,
      confirmerEfface:
        'What will be erased: your invoices and their PDFs, payments and reminders, drafts, clients, the catalogue, your company with its numbering, logo and fonts, then the account itself.',
      confirmerCopie: (heure: string) =>
        `The archive exported at ${heure} will be the only copy of your data: keep it for ten years, the time during which the law requires you to keep your invoices.`,
      confirmerPdfManquants: (n: number) =>
        `It lacks ${n > 1 ? `the PDFs of ${n} invoices, listed` : 'the PDF of one invoice, listed'} in donnees.json: export again before requesting deletion.`,
      confirmerEmisesDepuis: (n: number) =>
        `${n > 1 ? `${n} invoices have been issued` : 'One invoice has been issued'} since this export: ${n > 1 ? 'they are' : 'it is'} not in the archive. Export again before requesting deletion.`,
      reexporter: 'Export again',
      confirmer: 'Request deletion',
      garder: 'Keep my account',
      ecranTitre: 'Account deletion requested',
      demandeeLe: (email: string, date: string) =>
        `Deletion of the account ${email} was requested on ${date}.`,
      purgeLe: (date: string) =>
        `On ${date}, everything will be erased: invoices and their PDFs, payments, reminders, drafts, clients, the catalogue, the company, then the account itself.`,
      jusqueLa:
        'Until then, you can cancel the deletion: the account resumes as it was. You can also export your data, as many times as needed.',
      echue:
        'The 30-day period is over: erasure may start at any moment, and the deletion can no longer be cancelled. Export your data while you still can.',
      annuler: 'Cancel the deletion',
      annulee: 'Deletion cancelled: your account resumes.',
      tropTard: (date: string) =>
        `The deletion requested on ${date} is more than 30 days old: it can no longer be cancelled, and erasure may have started.`,
      tropTardSansDate:
        'The deletion was requested more than 30 days ago: it can no longer be cancelled, and erasure may have started.',
      session: 'Your session has expired: sign in again, then start over.',
      reseau: 'The server is not responding: nothing has changed. Try again in a moment.',
      chargement:
        'The account screen could not be loaded: check your connection, then reload the page.',
    },
    deconnexion: {
      nonEnvoye: (elements: string[]) =>
        `Not saved on the server yet: ${
          elements.length > 1
            ? `${elements.slice(0, -1).join(', ')} and ${elements[elements.length - 1]}`
            : (elements[0] ?? '')
        }. If you sign out, you lose it: this browser keeps nothing of the account after signing out. Sign out anyway?`,
      elements: {
        draft: 'what you typed in the open draft',
        miseDeCote: 'something you typed that was set aside',
        company: 'the company',
        numbering: 'the numbering',
        apparence: 'the default appearance',
        clients: 'clients',
        products: 'catalogue items',
        files: 'files (logo, fonts)',
        enCours: 'saves still on their way',
        autre: 'other changes',
      },
      enCours: 'Saving your latest changes before signing out…',
    },
  },
};

/** Table de la langue déclarée par la page. */
export const t: Strings =
  typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('en')
    ? en
    : fr;

/** Date ISO dans la langue de l'interface. */
export function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return t.lang === 'fr'
    ? `${match[3]}/${match[2]}/${match[1]}`
    : `${match[1]}-${match[2]}-${match[3]}`;
}

/** Montant en centimes dans la langue de l'interface. */
export function formatMoney(value: number, currency = 'EUR'): string {
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  const whole = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, t.lang === 'fr' ? '\u202f' : ',');
  const fraction = String(abs % 100).padStart(2, '0');
  const symbol = currency === 'EUR' ? '€' : currency;
  return t.lang === 'fr'
    ? `${sign}${whole},${fraction}\u00a0${symbol}`
    : `${sign}${symbol === '€' ? '€' : `${symbol} `}${whole}.${fraction}`;
}
