// Les règles de date de l'émission (spec § 7, étape 5, et Ruling 30), sans la pile.
import { assertEquals } from '@std/assert';
import { aujourdhuiParis, controlerDate } from '../emettre/regles.ts';

Deno.test('aujourd’hui à Paris quand UTC est encore la veille', () => {
  assertEquals(aujourdhuiParis(new Date('2026-11-04T23:30:00Z')), '2026-11-05');
});

Deno.test('date future refusée, date antérieure à la dernière facture refusée, bornes admises', () => {
  assertEquals(controlerDate('2026-11-06', '2026-11-05', '2026-11-01'), {
    min: '2026-11-01',
    max: '2026-11-05',
  });
  assertEquals(controlerDate('2026-10-31', '2026-11-05', '2026-11-01'), {
    min: '2026-11-01',
    max: '2026-11-05',
  });
  assertEquals(controlerDate('2026-11-01', '2026-11-05', '2026-11-01'), undefined);
  assertEquals(controlerDate('2026-11-05', '2026-11-05', undefined), undefined);
});

Deno.test('numérotation annuelle : pas avant le 1er janvier de son année, la borne la plus tardive', () => {
  // Sans facture encore, une date de l'année précédente est refusée ; le 1er janvier est admis.
  assertEquals(controlerDate('2026-12-30', '2027-01-03', undefined, '2027-01-01'), {
    min: '2027-01-01',
    max: '2027-01-03',
  });
  assertEquals(controlerDate('2027-01-01', '2027-01-03', undefined, '2027-01-01'), undefined);
  // La dernière facture, plus tardive que le 1er janvier, reste la borne basse…
  assertEquals(controlerDate('2027-01-01', '2027-01-03', '2027-01-02', '2027-01-01'), {
    min: '2027-01-02',
    max: '2027-01-03',
  });
  // … et le 1er janvier l'emporte sur une dernière facture de l'année précédente.
  assertEquals(controlerDate('2026-12-31', '2027-01-03', '2026-12-31', '2027-01-01'), {
    min: '2027-01-01',
    max: '2027-01-03',
  });
});
