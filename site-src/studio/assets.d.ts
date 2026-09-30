/** Profil ICC chargé tel quel par esbuild (`loader: binary`). */
declare module '*.icc' {
  const bytes: Uint8Array;
  export default bytes;
}
