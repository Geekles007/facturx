import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // `VERSION` est injecté à la construction par tsup ; on le déclare ici pour que le CLI se
  // comporte en test exactement comme une fois empaqueté.
  define: { VERSION: JSON.stringify(version) },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
