import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig([
  {
    entry: { index: 'src/index.ts', pdf: 'src/pdf/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: false, // pas de .map dans le paquet : évite 4 × ~100 Ko et les avertissements « source map manquante » des bundlers
    clean: true,
    target: 'es2022',
    platform: 'neutral',
    treeshake: true,
    external: ['pdf-lib'],
  },
  {
    // Le CLI, lui, assume Node : il lit des fichiers et rend un code de sortie. Il n'est pas
    // importé par la bibliothèque, donc la promesse « edge et serverless » reste intacte.
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: false,
    clean: false,
    target: 'node20',
    platform: 'node',
    treeshake: true,
    external: ['pdf-lib'],
    banner: { js: '#!/usr/bin/env node' },
    define: { VERSION: JSON.stringify(version) },
  },
]);
