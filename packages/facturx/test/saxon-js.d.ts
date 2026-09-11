/** Déclarations minimales pour saxon-js (pas de types fournis), limitées à ce que le test utilise. */
declare module 'saxon-js' {
  interface TransformOptions {
    stylesheetFileName?: string;
    stylesheetText?: string;
    sourceText?: string;
    sourceFileName?: string;
    destination?: 'serialized' | 'document' | 'application' | 'raw';
  }
  interface TransformResult {
    principalResult: unknown;
  }
  const SaxonJS: {
    transform(options: TransformOptions, execution: 'sync'): TransformResult;
    transform(options: TransformOptions, execution?: 'async'): Promise<TransformResult>;
    getProcessorInfo(): { productVersion: string };
  };
  export default SaxonJS;
}
