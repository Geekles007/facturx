import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Le Studio importe le profil sRGB comme des octets (`loader: binary` d'esbuild à la construction) ;
  // les tests le chargent de la même façon.
  plugins: [
    {
      name: 'octets-icc',
      load(id) {
        if (!id.endsWith('.icc')) return undefined;
        return `export default new Uint8Array([${[...readFileSync(id)].join(',')}]);`;
      },
    },
  ],
  test: {
    include: ['site-src/**/*.test.ts', 'site-src/**/*.test.tsx', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
});
