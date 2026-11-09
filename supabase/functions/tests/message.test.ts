/**
 * Le message de relance (`relancer/message.ts`, spec § 9, étape 3), sans la pile : ce qu'un texte saisi
 * par l'utilisateur peut faire dans l'e-mail qui part sous le nom de l'entreprise. Le corps est échappé
 * avant le gabarit HTML, l'objet et le nom de l'expéditeur ne portent ni retour à la ligne ni guillemet,
 * le destinataire est une seule adresse. L'habillage (spec e-mails, § 6) : le nom de l'entreprise en
 * tête, un encadré de la facture, la mention du PDF et le pied, dans la langue du texte.
 */
import { assert, assertEquals, assertThrows } from '@std/assert';
import { date, echapper, type Langue, montant, paragraphes } from '../_vendor/shared/courriel.ts';
import { destinataireValide } from '../_vendor/shared/destinataire.ts';
import { fromBase64 } from '../_vendor/shared/portable.ts';
import { composer, type MessageBrevo, nettoyerObjet, uneLigne } from '../relancer/message.ts';
import { avecEnv } from './aide.ts';

const EXPEDITEUR = 'relances@facturx.test';

const base = {
  objet: 'Relance de la facture F-2026-0001',
  corps: 'Bonjour,\n\nLa facture F-2026-0001 est échue.\nMerci.',
  entreprise: 'Atelier Exemple SAS',
  destinataire: 'compta@client-demo.fr',
  replyTo: 'facturation@exemple.fr',
  numero: 'F-2026-0001',
  pdf: new TextEncoder().encode('%PDF-1.7\n'),
  langue: 'fr' as Langue,
  resteDu: 125000,
  devise: 'EUR',
  echeance: '2026-11-08',
};

/** `composer`, l'adresse d'expédition étant celle de l'environnement (`RELANCES_EXPEDITEUR`). */
function compose(m: Partial<typeof base> = {}): Promise<MessageBrevo> {
  return avecEnv({ RELANCES_EXPEDITEUR: EXPEDITEUR }, () => composer({ ...base, ...m }));
}

/** Le pied que `composer` met au bas du message, pour l'entreprise de la base. */
const PIED_FR =
  'Envoyé par Atelier Exemple SAS avec facturx. Pour lui écrire, répondez à cet e-mail.';

Deno.test('le corps est échappé', async () => {
  const m = await compose({ corps: '<script>x</script>\n\nMerci' });
  assert(!m.htmlContent.includes('<script>'));
  assert(m.htmlContent.includes('&lt;script&gt;'));
  // Le texte reste celui que l'utilisateur a relu, tel quel, au milieu de l'habillage.
  assert(m.textContent.includes('\n\n<script>x</script>\n\nMerci\n\n'));
});

Deno.test('l’habillage en français : en-tête, encadré, mention du PDF et pied', async () => {
  const { htmlContent: html } = await compose();
  assert(html.startsWith('<!doctype html>'));
  assert(html.includes('<html lang="fr">'));
  // Le nom de l'entreprise en tête, dans la cellule d'en-tête du cadre.
  assert(html.includes('font-weight:600;color:#0a0a0a">Atelier Exemple SAS</td>'));
  for (const libelle of ['Facture', 'Reste dû', 'Échéance']) {
    assert(html.includes(`>${libelle}</td>`), libelle);
  }
  // L'encadré dit ce que le texte du Studio dit : même montant, même date.
  assert(html.includes(`>${montant(125000, 'EUR', 'fr')}</td>`));
  assert(html.includes('>08/11/2026</td>'));
  assert(html.includes('>F-2026-0001</td>'));
  assert(html.includes('F-2026-0001.pdf est joint à cet e-mail.'));
  assert(html.includes(PIED_FR));
  // Le préheader, caché, reprend l'encadré.
  assert(
    html.includes(
      `Facture F-2026-0001 · Reste dû ${montant(125000, 'EUR', 'fr')} · Échéance 08/11/2026</div>`,
    ),
  );
  // Aucune ressource distante : rien ne se charge à l'ouverture.
  for (const motif of ['src=', 'href=', 'url(', '@import', '<link', '<img']) {
    assert(!html.includes(motif), motif);
  }
});

Deno.test('l’habillage en anglais : libellés, mention et pied', async () => {
  const m = await compose({ langue: 'en' });
  const html = m.htmlContent;
  assert(html.includes('<html lang="en">'));
  for (const libelle of ['Invoice', 'Amount due', 'Due date']) {
    assert(html.includes(`>${libelle}</td>`), libelle);
  }
  for (const libelle of ['Reste dû', 'Échéance']) assert(!html.includes(libelle), libelle);
  assert(html.includes(`>${montant(125000, 'EUR', 'en')}</td>`));
  assert(html.includes('>08/11/2026</td>'));
  assert(html.includes('F-2026-0001.pdf is attached to this email.'));
  assert(html.includes('Sent by Atelier Exemple SAS with facturx.'));
  assert(html.includes('To reach them, reply to this email.'));
  assert(
    html.includes(
      `Invoice F-2026-0001 · Amount due ${montant(125000, 'EUR', 'en')} · Due date 08/11/2026</div>`,
    ),
  );
});

Deno.test('l’encadré suit la devise et la langue : 1 250,00 USD en anglais', async () => {
  const m = await compose({ devise: 'USD', langue: 'en' });
  assert(m.htmlContent.includes('>US$1,250.00</td>'));
  assert(m.textContent.includes('Amount due: US$1,250.00\n'));
});

Deno.test('sans nom d’entreprise : pas d’en-tête, le pied ne nomme personne', async () => {
  for (const entreprise of ['', '   ', '"\n"']) {
    const m = await compose({ entreprise });
    // L'en-tête est la seule cellule de ce style au-dessus de la carte.
    assert(!m.htmlContent.includes('padding:0 4px 16px'), JSON.stringify(entreprise));
    assert(m.htmlContent.includes('>Envoyé avec facturx.</td>'));
    assert(!m.htmlContent.includes('Envoyé par'));
    assert(m.textContent.endsWith('\n--\nEnvoyé avec facturx.'));
  }
  const en = await compose({ entreprise: '', langue: 'en' });
  assert(en.htmlContent.includes('>Sent with facturx.</td>'));
  assert(en.textContent.endsWith('\n--\nSent with facturx.'));
});

Deno.test('le nom de l’entreprise dans l’habillage : nettoyé, échappé', async () => {
  const m = await compose({ entreprise: 'A <b>&</b> "B"' });
  // Chevrons et guillemets sont retirés, comme pour l'expéditeur ; l'esperluette est échappée.
  assert(!m.htmlContent.includes('<b>'));
  assert(!m.htmlContent.includes('"B"'));
  assert(!m.htmlContent.includes('&</b>'));
  assert(m.htmlContent.includes('>A b&amp;/b B</td>'));
  assert(m.htmlContent.includes('Envoyé par A b&amp;/b B avec facturx.'));
  assert(m.textContent.includes('Envoyé par A b&/b B avec facturx.'));
  assertEquals(m.sender.name, 'A b&/b B via facturx');
});

Deno.test('la version texte : la facture, le texte relu, le PDF et le pied', async () => {
  const m = await compose();
  const nbsp = '\u00a0';
  assertEquals(
    m.textContent,
    [
      'Facture F-2026-0001',
      `Reste dû${nbsp}: ${montant(125000, 'EUR', 'fr')}`,
      `Échéance${nbsp}: ${date('2026-11-08', 'fr')}`,
      '',
      base.corps,
      '',
      'F-2026-0001.pdf est joint à cet e-mail.',
      '--',
      PIED_FR,
    ].join('\n'),
  );
  assertEquals(date('2026-11-08', 'fr'), '08/11/2026');
  // Les lignes vides autour du texte relu ne s'ajoutent pas à celles du gabarit.
  const marge = await compose({ corps: '\n  Merci\n\n' });
  assert(marge.textContent.includes('\n\nMerci\n\nF-2026-0001.pdf'));

  const en = await compose({ langue: 'en' });
  assertEquals(
    en.textContent,
    [
      'Invoice F-2026-0001',
      `Amount due: ${montant(125000, 'EUR', 'en')}`,
      'Due date: 08/11/2026',
      '',
      base.corps,
      '',
      'F-2026-0001.pdf is attached to this email.',
      '--',
      'Sent by Atelier Exemple SAS with facturx. To reach them, reply to this email.',
    ].join('\n'),
  );
});

Deno.test('l’objet ne peut pas injecter d’en-tête', () => {
  assertEquals(nettoyerObjet('Relance\r\nBcc: x@y'), 'Relance Bcc: x@y');
});

Deno.test('expéditeur et réponse', async () => {
  const m = await compose({ entreprise: 'Atelier "Exemple"\nSAS' });
  assertEquals(m.sender.name, 'Atelier Exemple SAS via facturx');
  assertEquals(m.replyTo.email, base.replyTo);
});

Deno.test('echapper : les cinq caractères du HTML, & en premier', () => {
  assertEquals(
    echapper(`<a href="x" onclick='y'>&</a>`),
    '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
  );
  // Un texte déjà échappé l'est encore une fois : il s'affiche tel que saisi.
  assertEquals(echapper('&lt;'), '&amp;lt;');
  assertEquals(echapper('Bonjour é 40 €'), 'Bonjour é 40 €');
});

Deno.test('nettoyerObjet : retours à la ligne, tabulations et caractères de contrôle', () => {
  assertEquals(nettoyerObjet('a\nBcc: x@y'), 'a Bcc: x@y');
  assertEquals(nettoyerObjet('a\rBcc: x@y'), 'a Bcc: x@y');
  assertEquals(nettoyerObjet('a\r\n\r\n\tb'), 'a b');
  assertEquals(nettoyerObjet('a\u0000b\u001bc\u007fd\u0085e'), 'a b c d e');
  // Les séparateurs de ligne d'Unicode font aussi finir une ligne.
  assertEquals(nettoyerObjet('a b c'), 'a b c');
  assertEquals(nettoyerObjet('  \r\nRelance\r\n  '), 'Relance');
  assertEquals(nettoyerObjet('\r\n'), '');
  for (const hostile of ['x\r\nBcc: a@b.fr', 'x\nTo: a@b.fr', 'x\u0000\r\n\r\n<html>']) {
    assert(![...nettoyerObjet(hostile)].some((c) => c.charCodeAt(0) < 0x20));
  }
});

Deno.test('nettoyerObjet : 200 caractères au plus, sans couper un caractère en deux', () => {
  assertEquals(nettoyerObjet('a'.repeat(250)), 'a'.repeat(200));
  assertEquals(nettoyerObjet('a'.repeat(200)), 'a'.repeat(200));
  // Un émoji compte pour un caractère : le couper au milieu laisserait une moitié de paire.
  const coupe = nettoyerObjet('😀'.repeat(250));
  assertEquals(Array.from(coupe).length, 200);
  assertEquals(coupe, '😀'.repeat(200));
  // La coupe se fait après le nettoyage, et ne laisse pas d'espace en bout.
  assertEquals(nettoyerObjet(`${'a'.repeat(199)}\n${'b'.repeat(50)}`), `${'a'.repeat(199)}`);
});

Deno.test('le gabarit : paragraphes sur les lignes vides, <br> sur les retours simples', async () => {
  const corps = 'Bonjour,\n\nLa facture est échue.\nMerci.\r\n\r\n  \r\nCordialement';
  const m = await compose({ corps });
  // Les paragraphes sont ceux du module partagé, ceux que les e-mails du compte emploient aussi.
  assert(m.htmlContent.includes(paragraphes(corps)));
  assert(m.htmlContent.includes('Bonjour,</p>'));
  assert(m.htmlContent.includes('La facture est échue.<br>Merci.</p>'));
  assert(m.htmlContent.includes('Cordialement</p>'));
  assertEquals(m.htmlContent.match(/<p class="texte"/g)?.length, 3);
  // Le texte relu est entre l'encadré et la mention du PDF.
  const html = m.htmlContent;
  assert(html.indexOf('>Échéance</td>') < html.indexOf('Bonjour,'));
  assert(html.indexOf('Cordialement') < html.indexOf('est joint à cet e-mail.'));
  assert(html.startsWith('<!doctype html>'));
});

Deno.test('le gabarit : rien de ce qui est saisi n’échappe à l’échappement', async () => {
  const hostile = [
    '<img src=x onerror=alert(1)>',
    '"><script>alert(1)</script>',
    "'><svg/onload=alert(1)>",
    '<a href="javascript:alert(1)">cliquez</a>',
    '</p><iframe src="https://exemple.fr"></iframe>',
    '<u>sur\n<i>deux lignes</i></u>',
  ].join('\n\n');
  const balisesDe = (html: string) =>
    [...new Set([...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((trouvee) => trouvee[1].toLowerCase()))]
      .sort()
      .join(' ');
  const { htmlContent } = await compose({ corps: hostile });
  // Le gabarit est fixe : avec un texte hostile, il ne contient que les balises qu'un texte ordinaire
  // (deux paragraphes, un retour à la ligne) lui fait porter.
  const ordinaire = await compose({ corps: 'Bonjour\nMerci\n\nCordialement' });
  assertEquals(balisesDe(htmlContent), balisesDe(ordinaire.htmlContent));
  for (const motif of ['<img', '<script', '<svg', '<iframe', '<a ', '<u>', '<i>']) {
    assert(!htmlContent.includes(motif), motif);
  }
  // Les guillemets sont neutralisés aussi : ce qui était saisi ne ferme aucun attribut.
  assert(htmlContent.includes('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert((await compose({ corps: hostile })).textContent.includes(`\n\n${hostile}\n\n`));
});

Deno.test('le message : destinataire, objet nettoyé, expéditeur de l’environnement', async () => {
  const m = await compose({ objet: 'Relance\r\nBcc: x@y' });
  assertEquals(m.to, [{ email: 'compta@client-demo.fr' }]);
  assertEquals(m.subject, 'Relance Bcc: x@y');
  assertEquals(m.sender, { name: 'Atelier Exemple SAS via facturx', email: EXPEDITEUR });
  assertEquals(m.replyTo, { email: 'facturation@exemple.fr' });
  assertEquals(Object.keys(m).sort(), [
    'attachment',
    'htmlContent',
    'replyTo',
    'sender',
    'subject',
    'textContent',
    'to',
  ]);
});

Deno.test('le nom de l’expéditeur : ni guillemet, ni retour à la ligne, ni chevron', async () => {
  for (const [nom, attendu] of [
    ['Atelier "Exemple"', 'Atelier Exemple via facturx'],
    ['Atelier\r\nBcc: x@y', 'Atelier Bcc: x@y via facturx'],
    ['Atelier\\ <evil@x.fr>', 'Atelier evil@x.fr via facturx'],
    ['  Atelier   Exemple  ', 'Atelier Exemple via facturx'],
    // Sans nom d'entreprise, l'expéditeur n'est plus que le service.
    ['', 'facturx'],
    ['"\n"', 'facturx'],
    // Un caractère de sens d'écriture ne retourne pas ce qui suit le nom (« … via facturx »).
    ['Atelier‮', 'Atelier via facturx'],
    ['At​elier⁦ Exemple⁩', 'Atelier Exemple via facturx'],
    ['﻿‮', 'facturx'],
  ]) {
    const m = await compose({ entreprise: nom });
    assertEquals(m.sender.name, attendu);
    // Le pied et l'en-tête emploient le même nom, sans le « via facturx ».
    const sansSuffixe = attendu === 'facturx' ? '' : attendu.replace(/ via facturx$/, '');
    assert(
      sansSuffixe === ''
        ? m.textContent.endsWith('\n--\nEnvoyé avec facturx.')
        : m.textContent.includes(`Envoyé par ${sansSuffixe} avec facturx.`),
      JSON.stringify(nom),
    );
  }
  // Cent caractères au plus, comme le nom de l'expéditeur.
  const long = await compose({ entreprise: 'x'.repeat(150) });
  assertEquals(long.sender.name, `${'x'.repeat(100)} via facturx`);
  assert(long.textContent.includes(`Envoyé par ${'x'.repeat(100)} avec facturx.`));
});

Deno.test('nettoyerObjet : les caractères de mise en forme sont retirés (sens d’écriture, largeur nulle)', () => {
  assertEquals(nettoyerObjet('Facture‮ 1234'), 'Facture 1234');
  assertEquals(nettoyerObjet('Re​lance⁦ due⁩'), 'Relance due');
  assertEquals(nettoyerObjet('﻿Relance­'), 'Relance');
  // Retirés avant les fins de ligne : ils ne séparent pas deux mots, et ne cachent pas un retour.
  assertEquals(nettoyerObjet('a​\r\nBcc: x@y'), 'a Bcc: x@y');
  assertEquals(nettoyerObjet('‮​'), '');
  // Un caractère accentué, une lettre arabe, un émoji simple restent.
  assertEquals(nettoyerObjet('Relance é ع 🙂'), 'Relance é ع 🙂');
});

Deno.test('uneLigne : une ligne, de la longueur demandée, sans caractère de contrôle', () => {
  assertEquals(
    uneLigne('<202611061200.1@smtp-relay.mailin.fr>', 200),
    '<202611061200.1@smtp-relay.mailin.fr>',
  );
  assertEquals(uneLigne(`id\u0000\r\n${'x'.repeat(500)}`, 20), `id ${'x'.repeat(17)}`);
  assertEquals(uneLigne('\u0000\u0001', 20), '');
});

Deno.test('la pièce jointe : le PDF en base64, sous le nom du numéro', async () => {
  const m = await compose();
  assertEquals(m.attachment.length, 1);
  assertEquals(m.attachment[0].name, 'F-2026-0001.pdf');
  assertEquals(fromBase64(m.attachment[0].content), base.pdf);
  // Le nom vient de `fileStem` : un numéro n'emmène pas de chemin.
  assertEquals(
    (await compose({ numero: 'F/2026/../0001' })).attachment[0].name,
    'F-2026-..-0001.pdf',
  );
  assertEquals((await compose({ numero: '' })).attachment[0].name, 'facture.pdf');
  // Un PDF de plusieurs centaines de Kio ne déborde pas la pile.
  const gros = Uint8Array.from({ length: 700_000 }, (_, i) => (i * 31 + 7) % 256);
  assertEquals(fromBase64((await compose({ pdf: gros })).attachment[0].content), gros);
});

Deno.test('sans adresse d’expédition, composer lève au lieu d’envoyer sans expéditeur', async () => {
  for (const valeur of [undefined, '', '   ']) {
    await avecEnv({ RELANCES_EXPEDITEUR: valeur }, () => {
      assertThrows(() => composer(base), Error, 'RELANCES_EXPEDITEUR');
    });
  }
});

Deno.test('destinataireValide : une seule adresse, sans rien qui en ajoute une autre', () => {
  for (const bonne of [
    'compta@client-demo.fr',
    'a@b.fr',
    'prenom.nom+facture@sous.domaine.example.com',
    "o'brien@exemple.ie",
    'a_b-c@xn--caf-dma.fr',
  ]) {
    assert(destinataireValide(bonne), bonne);
  }
  for (const mauvaise of [
    '',
    'a',
    'a@b',
    '@b.fr',
    'a@',
    'a@.fr',
    'a@b..fr',
    'a@b.fr.',
    'a@-b.fr',
    '.a@b.fr',
    'a..b@b.fr',
    'a@b.fr, c@d.fr',
    'a@b.fr,c@d.fr',
    'a@b.fr;c@d.fr',
    'a@b.fr c@d.fr',
    ' a@b.fr',
    'a@b.fr ',
    'a@b.fr\nBcc: c@d.fr',
    'a@b.fr\r\nBcc: c@d.fr',
    'a@b.fr c@d.fr',
    'a@b.fr\u0000',
    'a@b@c.fr',
    '<a@b.fr>',
    'Nom <a@b.fr>',
    '"a b"@c.fr',
    '(x)a@b.fr',
    'a@[127.0.0.1]',
    `${'a'.repeat(65)}@b.fr`,
    `a@${'b'.repeat(250)}.fr`,
  ]) {
    assert(!destinataireValide(mauvaise), JSON.stringify(mauvaise));
  }
});
