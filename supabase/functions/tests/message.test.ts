/**
 * Le message de relance (`relancer/message.ts`, spec § 9, étape 3), sans la pile : ce qu'un texte saisi
 * par l'utilisateur peut faire dans l'e-mail qui part sous le nom de l'entreprise. Le corps est échappé
 * avant le gabarit HTML, l'objet et le nom de l'expéditeur ne portent ni retour à la ligne ni guillemet,
 * le destinataire est une seule adresse.
 */
import { assert, assertEquals, assertThrows } from '@std/assert';
import { fromBase64 } from '../_vendor/shared/portable.ts';
import {
  composer,
  destinataireValide,
  echapper,
  type MessageBrevo,
  nettoyerObjet,
} from '../relancer/message.ts';
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
};

/** `composer`, l'adresse d'expédition étant celle de l'environnement (`RELANCES_EXPEDITEUR`). */
function compose(m: Partial<typeof base> = {}): Promise<MessageBrevo> {
  return avecEnv({ RELANCES_EXPEDITEUR: EXPEDITEUR }, () => composer({ ...base, ...m }));
}

Deno.test('le corps est échappé', async () => {
  const m = await compose({ corps: '<script>x</script>\n\nMerci' });
  assert(!m.htmlContent.includes('<script>'));
  assert(m.htmlContent.includes('&lt;script&gt;'));
  assertEquals(m.textContent, '<script>x</script>\n\nMerci');
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
  const m = await compose({
    corps: 'Bonjour,\n\nLa facture est échue.\nMerci.\r\n\r\n  \r\nCordialement',
  });
  assert(m.htmlContent.includes('<p style="margin:0 0 16px">Bonjour,</p>'));
  assert(m.htmlContent.includes('<p style="margin:0 0 16px">La facture est échue.<br>Merci.</p>'));
  assert(m.htmlContent.includes('<p style="margin:0 0 16px">Cordialement</p>'));
  assertEquals(m.htmlContent.match(/<p /g)?.length, 3);
  assert(m.htmlContent.startsWith('<!doctype html>'));
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
  const { htmlContent } = await compose({ corps: hostile });
  // Le gabarit est fixe : il ne contient que ses propres balises.
  const balises = new Set(
    [...htmlContent.matchAll(/<\/?([a-z0-9]+)/gi)].map((trouvee) => trouvee[1].toLowerCase()),
  );
  assertEquals([...balises].sort(), ['body', 'br', 'head', 'html', 'meta', 'p']);
  for (const motif of ['<img', '<script', '<svg', '<iframe', '<a ', '<u>', '<i>']) {
    assert(!htmlContent.includes(motif), motif);
  }
  // Les guillemets sont neutralisés aussi : ce qui était saisi ne ferme aucun attribut.
  assert(htmlContent.includes('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
  assertEquals((await compose({ corps: hostile })).textContent, hostile);
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
  ]) {
    assertEquals((await compose({ entreprise: nom })).sender.name, attendu);
  }
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
