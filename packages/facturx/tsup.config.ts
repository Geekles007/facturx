import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', pdf: 'src/pdf/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'neutral',
  treeshake: true,
  external: ['pdf-lib'],
});
