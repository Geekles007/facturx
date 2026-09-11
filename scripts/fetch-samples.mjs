/**
 * Récupère des factures Factur-X / CII produites par d'autres outils (non versionnées, git-ignorées),
 * à des commits épinglés, pour test/third-party.test.ts.
 *
 *   pnpm samples:fetch            # ne télécharge que ce qui manque ou si un commit épinglé a changé
 *   pnpm samples:fetch --force
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCES = {
  /** ZUGFeRD/corpus (Apache-2.0) : factures EN 16931 de la suite de tests allemande (KoSIT), en CII et en Factur-X. */
  corpus: {
    commit: 'd891458e9822e34271a5438497bf924e89955979',
    base: 'https://raw.githubusercontent.com/ZUGFeRD/corpus',
    files: [
      ...[
        '1_Teilrechnung',
        '2_Teilrechnung',
        'AbweichenderZahlungsempf',
        'Betriebskostenabrechnung',
        'Einfach',
        'Einfach_DueDate',
        'Einfach_negativePaymentDue',
        'Elektron',
        'ElektronischeAdresse',
        'Gutschrift',
        'Haftpflichtversicherung_Versicherungssteuer',
        'Innergemeinschaftliche_Lieferungen',
        'Kraftfahrversicherung_Bruttopreise',
        'Miete',
        'OEPNV',
        'Physiotherapeut',
        'Rabatte',
        'RechnungsUebertragung',
        'Rechnungskorrektur',
        'Reisekostenabrechnung',
        'SEPA_Prenotification',
        'Sachversicherung_berechneter_Steuersatz',
      ].map((n) => `XML-Rechnung/CII/EN16931_${n}.cii.xml`),
      ...[
        'Einfach',
        '1_Teilrechnung',
        'Gutschrift',
        'Rabatte',
        'SEPA_Prenotification',
        'ElektronischeAdresse',
      ].map((n) => `XML-Rechnung/FX/EN16931_${n}.pdf`),
    ],
  },
  /** ZUGFeRD/mustangproject (Apache-2.0) : Factur-X FR (EN 16931, MINIMUM, BASIC, EXTENDED) et PDF. */
  mustang: {
    commit: 'abf4544f4d555b8c42e0c4edf7d6241a1d3da2c3',
    base: 'https://raw.githubusercontent.com/ZUGFeRD/mustangproject',
    files: [
      'library/src/test/resources/factur-x.xml',
      'library/src/test/resources/factur-x_invoicingPeriod.xml',
      'library/src/test/resources/factur-x-extended.xml',
      'library/src/test/resources/cii/Factur-X_basic.xml',
      'library/src/test/resources/cii/facturFrMinimum.xml',
      'library/src/test/resources/cii/UC11_F202600022_EXTENDED_FX_CII_BT-X-589Only_on_GROUP_Line.xml',
      'library/src/test/resources/EN16931_Einfach.pdf',
      'library/src/test/resources/EN16931_1_Teilrechnung.pdf',
    ],
  },
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const samplesDir = join(root, 'packages', 'facturx', 'test', 'samples');
const force = process.argv.includes('--force');

async function main() {
  for (const [name, src] of Object.entries(SOURCES)) {
    const dir = join(samplesDir, name);
    mkdirSync(dir, { recursive: true });
    const marker = join(dir, '.commit');
    const stale =
      force || !existsSync(marker) || readFileSync(marker, 'utf8').trim() !== src.commit;
    for (const path of src.files) {
      const target = join(dir, path.split('/').pop());
      if (!stale && existsSync(target)) continue;
      const res = await fetch(`${src.base}/${src.commit}/${path}`);
      if (!res.ok) throw new Error(`${res.status} ${path}`);
      writeFileSync(target, Buffer.from(await res.arrayBuffer()));
      console.log(`↓ ${name}/${path.split('/').pop()}`);
    }
    writeFileSync(marker, `${src.commit}\n`);
  }
  console.log('✓ fichiers tiers prêts');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
