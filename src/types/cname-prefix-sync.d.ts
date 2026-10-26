/**
 * Local type declaration for `@uploadcare/cname-prefix/sync`.
 *
 * The package ships its sync entry's types as `dist/sync.d.ts` which does
 * `export * from './src/sync/index'` — a relative re-export with no `.js`
 * extension, which fails to resolve under `moduleResolution: Node16`. The
 * runtime module resolves and works correctly (returns the prefixed CDN base);
 * only the published barrel declaration is broken for Node16 consumers. This
 * ambient declaration restores the typed export used in `src/uploadcare.ts`.
 */
declare module '@uploadcare/cname-prefix/sync' {
  export const getPrefixedCdnBaseSync: (publicKey: string, cdnBase: string) => string;
  export const isPrefixedCdnBase: (url: string) => boolean;
}
