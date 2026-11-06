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
    privacy: 'Rien ne quitte votre navigateur',
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
    footPrivacy:
      "Rien de ce que vous saisissez ne quitte ce navigateur : le Studio n'a pas de serveur, vos factures, clients et réglages restent ici. Un seul signal part, sans contenu, quand un PDF Factur-X est produit — pour savoir si l'outil sert, sans cookie, sans identifiant, sans rien de votre facture.",
    footLegal:
      'Le Studio ne constitue pas un conseil juridique et ne remplace pas la plateforme agréée qui transmettra vos factures.',
    footLinks: {
      home: 'Accueil',
      validator: 'Validateur',
      source: 'Code source',
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
    yearly: 'Repartir de 1 chaque année',
    nextPreview: 'Prochain numéro',
    numberingWarning:
      'La numérotation doit rester continue : ne sautez pas de numéro, et ne revenez jamais en arrière sur un numéro déjà émis.',
    backupIntro:
      "Tout est conservé dans ce navigateur, et seulement là. Une sauvegarde vous protège d'un nettoyage des données du site ou d'un changement d'ordinateur.",
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
    },
    /** Les refus des Edge Functions (spec § 13), quelle que soit l'opération. */
    erreurs: {
      nonConfirme:
        "Confirmez d'abord l'adresse e-mail du compte : ouvrez le lien de l'e-mail de confirmation, puis réessayez.",
      suppression:
        'La suppression de votre compte est demandée : annulez-la depuis « Mon compte » pour reprendre. Vous pouvez toujours exporter vos données.',
      droits:
        "Ce compte n'a accès à aucune entreprise : reconnectez-vous ; si cela persiste, écrivez-nous.",
      brouillonModifie:
        'Ce brouillon a changé ailleurs depuis son ouverture (un autre onglet ou un autre appareil) : rechargez la version enregistrée, ou gardez la vôtre, puis recommencez.',
      date: "La date d'émission sort des dates admises.",
      doublon: (numero: string) =>
        `Le numéro ${numero || 'attribué'} existe déjà : relevez le prochain numéro de votre numérotation, puis recommencez.`,
      pdfDejaDepose: 'Le PDF de cette facture est déjà déposé.',
      limite: (heure: string | undefined) =>
        heure
          ? `Trop de demandes en peu de temps : réessayez après ${heure}.`
          : 'Trop de demandes en peu de temps : réessayez dans quelques minutes.',
      envoi: "Le service d'envoi a refusé l'e-mail : il n'est pas parti. Réessayez dans un moment.",
      interne: (requete: string | undefined) =>
        requete
          ? `Erreur du serveur : réessayez dans un instant ; si elle persiste, citez l'identifiant ${requete}.`
          : 'Erreur du serveur : réessayez dans un instant.',
      tropGros:
        'La demande dépasse 10 Mo, le plus que le serveur accepte : allégez ou retirez des pièces jointes, puis recommencez.',
      inconnue: 'Le serveur a refusé la demande : réessayez dans un instant.',
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
        "Le module du compte n'a pas pu être chargé : vérifiez votre connexion. La facture n'est pas émise.",
      indisponible:
        "Le compte n'est pas chargé dans cette page : rechargez-la, puis émettez de nouveau. La facture n'est pas émise.",
      dejaEmise:
        'Cette facture est déjà émise : pour en faire une autre, dupliquez-la ; pour la corriger, émettez un avoir.',
      erreurLocale:
        "Le Studio n'a pas pu préparer l'émission : rien n'est parti. Rechargez la page, puis émettez de nouveau.",
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
  },
};

export type Strings = typeof fr;

const en: Strings = {
  lang: 'en',
  app: {
    studio: 'Studio',
    untitled: 'No number',
    privacy: 'Nothing leaves your browser',
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
      'Nothing you type leaves this browser: the Studio has no server, and your invoices, customers and settings stay here. A single signal is sent, with no content, when a Factur-X PDF is produced — to know whether the tool is used, with no cookie, no identifier, nothing from your invoice.',
    footLegal:
      'The Studio is not legal advice and does not replace the approved platform that will transmit your invoices.',
    footLinks: {
      home: 'Home',
      validator: 'Validator',
      source: 'Source code',
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
    yearly: 'Restart at 1 every year',
    nextPreview: 'Next number',
    numberingWarning:
      'Numbering must stay continuous: do not skip numbers, and never reuse one already issued.',
    backupIntro:
      'Everything is kept in this browser, and only there. A backup protects you from a site-data cleanup or a change of computer.',
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
    },
    erreurs: {
      nonConfirme:
        'First confirm the email address of your account: open the link in the confirmation email, then try again.',
      suppression:
        'Deletion of your account has been requested: cancel it from “My account” to resume. You can still export your data.',
      droits:
        'This account has no access to any company: sign in again; if this persists, write to us.',
      brouillonModifie:
        'This draft was changed elsewhere since it was opened (another tab or another device): reload the saved version, or keep yours, then start again.',
      date: 'The issue date is outside the allowed dates.',
      doublon: (numero: string) =>
        `Number ${numero || 'assigned'} already exists: raise the next number of your sequence, then start again.`,
      pdfDejaDepose: 'The PDF of this invoice has already been uploaded.',
      limite: (heure: string | undefined) =>
        heure
          ? `Too many requests in a short time: try again after ${heure}.`
          : 'Too many requests in a short time: try again in a few minutes.',
      envoi: 'The sending service refused the email: it was not sent. Try again in a while.',
      interne: (requete: string | undefined) =>
        requete
          ? `Server error: try again in a moment; if it persists, quote the identifier ${requete}.`
          : 'Server error: try again in a moment.',
      tropGros:
        'The request exceeds 10 MB, the most the server accepts: shrink or remove attachments, then start again.',
      inconnue: 'The server refused the request: try again in a moment.',
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
        'The account module could not be loaded: check your connection. The invoice is not issued.',
      indisponible:
        'The account is not loaded in this page: reload it, then issue again. The invoice is not issued.',
      dejaEmise:
        'This invoice is already issued: to make another one, duplicate it; to correct it, issue a credit note.',
      erreurLocale:
        'The Studio could not prepare the issue: nothing was sent. Reload the page, then issue again.',
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
