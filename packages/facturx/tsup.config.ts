import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', pdf: 'src/pdf/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: false, // pas de .map dans le paquet : évite 4 × ~100 Ko et les avertissements « source map manquante » des bundlers
  clean: true,
  target: 'es2022',
  platform: 'neutral',
  treeshake: true,
  external: ['pdf-lib'],
});
