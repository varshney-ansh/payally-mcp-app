# Implementation Plan — Two interactive (read-only) MCP App tools

Scope: add `explore-product` (inline Embla carousel) and `getproductbyid` (inline card) to the
existing PayAlly MCP server using the standard MCP Apps extension (`@modelcontextprotocol/ext-apps`)
for the protocol and `@openai/apps-sdk-ui` (React 18/19 + Tailwind 4) for the visuals. A new `web/`
build pipeline (React + Tailwind 4 + esbuild, Embla bundled locally) produces one self-contained JS
bundle per widget that the server inlines into each `ui://` resource.

Read-only: the widgets only render the product data they receive. NO cross-tool calls, NO action
buttons, NO follow-up messages. The carousel keeps prev/next arrows + drag-to-scroll (view
navigation only).

One user-confirmed decision vs the original task brief (authoritative):
- Merchant id comes ONLY from `process.env.PAYPAL_MERCHANT_ID` (passed to each tool as the
  `merchantIdFallback` arg). Do NOT read `authInfo.extra.paypal_merchant_id`. The new tool callbacks
  do not read `authInfo` at all, and `resolveMerchantId(authInfo, fallback)` becomes unused.

Explicitly NOT changed (the user did NOT ask to remove AuthInfo):
- KEEP the `AuthInfo` tool in `src/index.ts` exactly as-is, along with all Auth0 middleware and the
  `getUserProfile` import it uses. Just ADD the two new tool registrations next to it in the `/mcp`
  handler.

## Key findings from exploration (ground truth for the implementer)

- `registerAppTool(server, name, config, cb)` and `registerAppResource(server, name, uri, config, readCb)`
  come from `@modelcontextprotocol/ext-apps/server`. `RESOURCE_MIME_TYPE` (= `text/html;profile=mcp-app`)
  is exported from the same module. Confirmed in
  `node_modules/@modelcontextprotocol/ext-apps/dist/src/server/index.d.ts`.
- Tool↔view link: `config._meta = { ui: { resourceUri: 'ui://widget/<name>.html' }, ... }`. The helper
  also auto-populates the legacy `ui/resourceUri` key for old hosts.
- `inputSchema`/`outputSchema` accept a zod object (`z.object({...})`) — preferred — or a raw shape
  (deprecated). Use `z.object({...})`.
- The app-tool callback signature mirrors the base SDK `ToolCallback`: `(args, ctx)`. Since merchant id
  is env-only now, the callbacks do NOT need `ctx`/`authInfo`.
- CSP goes on the RESOURCE, not the tool. `McpUiToolMeta.csp` is typed `never`. Put
  `_meta.ui.csp = { connectDomains: [...], resourceDomains: [...] }` on the object returned by the
  `registerAppResource` read callback's content item (`contents[0]._meta.ui.csp`). Confirmed in
  `spec.types.d.ts` (`McpUiResourceCsp`, `McpUiResourceMeta`, `McpUiToolMeta`).
- Product image CDN is `https://cdn.trychannel3.com` (from the sample `image.url`). So
  `resourceDomains: ['https://cdn.trychannel3.com']` and `connectDomains: ['https://api.payally.world']`.
  Embla is bundled locally, so NO `cdn.jsdelivr.net` entry (the existing draft's jsdelivr CSP + CDN
  import must be dropped).
- View side (React): `useApp` + `useHostStyles` from `@modelcontextprotocol/ext-apps/react`; subscribe
  to results via `app.addEventListener('toolresult', handler)` (preferred over the deprecated
  `app.ontoolresult` setter) registered in `useApp`'s `onAppCreated` so no notification is missed.
  The `toolresult` params are a `CallToolResult`; read `params.structuredContent`. Confirmed in
  `react/useApp.d.ts`, `app.d.ts`, `spec.types.d.ts` (`McpUiToolResultNotification.params: CallToolResult`).
- Embla React API: `const [emblaRef, emblaApi] = useEmblaCarousel(opts)`; put `ref={emblaRef}` on the
  viewport; `emblaApi.scrollPrev/scrollNext/canScrollPrev/canScrollNext`, `emblaApi.on('select'|'reInit', ...)`.
  Drag-to-scroll is on by default. (https://www.embla-carousel.com/docs/v8/get-started/react)
- apps-sdk-ui components import per-path, e.g. `@openai/apps-sdk-ui/components/Badge`,
  `@openai/apps-sdk-ui/components/Image`, `@openai/apps-sdk-ui/components/Icon` (named icons such as
  `Star`, `StarFilled`, `ChevronLeft`, `ChevronRight`, `ShoppingBag`, `Tag` — all confirmed present),
  `@openai/apps-sdk-ui/components/EmptyMessage`. Use display components only. Global CSS must begin with
  `@import 'tailwindcss';` `@import '@openai/apps-sdk-ui/css';` `@source '../node_modules/@openai/apps-sdk-ui';`.
- tsconfig has `rootDir: ./src`, so `web/` must live OUTSIDE `src/`. `npm start` = `tsx src/index.ts`
  only runs the server; it does not build the UI. The server reads the built bundle text at
  resource-registration time with `node:fs` `readFileSync`, resolving the path for ESM via
  `fileURLToPath(import.meta.url)` → from `src/tools/*.ts` the bundle is at `../../web/dist/<name>.js`.
- The server `Product` shape lives in `src/payally-types/product.ts`; `ProductSchema` (zod) in
  `src/payally-types/schema.ts`. `getProductById(productId, merchantId)` in `src/payally-api.ts` is
  reused as-is. `exploreProducts` is EXTENDED (see below) to take optional price filters.

## Price filters on explore-product (new requirement)

The `explore-product` tool gains TWO optional numeric caller arguments (model/user supplied — NOT the
merchant id, which stays env-only and server-side):
- `min_price`: `z.number().optional().describe('Minimum product price filter.')`
- `max_price`: `z.number().optional().describe('Maximum product price filter.')`

Wire-through:
- `src/payally-api.ts`: change `exploreProducts(query, merchantId)` →
  `exploreProducts(query: string, merchantId: string, opts: { minPrice?: number; maxPrice?: number } = {})`.
  After setting `query` and `merchantid`, add ONLY when defined:
  `if (opts.minPrice !== undefined) url.searchParams.set('min_price', String(opts.minPrice));` and the
  same for `max_price` from `opts.maxPrice`. Each param is omitted entirely when undefined; behavior is
  unchanged when both are absent. Example URL:
  `https://api.payally.world/v1/explore-products?query=snow&merchantid=DZWR8V78BHZ6G&min_price=200&max_price=500`.
- `src/tools/explore-product.ts`: inputSchema becomes
  `z.object({ query: z.string().min(1).describe(...), min_price: z.number().optional().describe('Minimum product price filter.'), max_price: z.number().optional().describe('Maximum product price filter.') })`;
  the callback calls `exploreProducts(query, merchantId, { minPrice: min_price, maxPrice: max_price })`.
- outputSchema stays `{ query, products, nextPageToken? }`; echoing the price filters in
  structuredContent is optional and not a blocker.

## Cleanup / deletions

- DELETE `src/ui/explore-product.html.ts` and `src/ui/get-product-by-id.html.ts` (hand-rolled vanilla
  HTML, includes a "View details" button + callTool/sendFollowUp — superseded and violates read-only).
- In `src/tools/shared.ts`: remove `UI_MIME_TYPE`, `registerWidget`, `uiTemplateMeta`. Since the new
  tools use env-only merchant id, `resolveMerchantId` becomes unused — remove it too, along with the
  `Auth`/`McpServer` imports it needed. Leave `src/tools/shared.ts` either deleted or reduced with no
  dead code. No code may reference the deleted files.
- DO NOT touch the `AuthInfo` tool in `src/index.ts` or the `getUserProfile` import — leave them as-is.

---

## Ordered steps

- [ ] 1. Install dependencies for the UI pipeline.
      Add deps: `react`, `react-dom`, `embla-carousel-react`. Add devDeps: `esbuild`, `tailwindcss@^4`,
      `@tailwindcss/cli`, `@types/react`, `@types/react-dom`. (`@modelcontextprotocol/ext-apps` and
      `@openai/apps-sdk-ui` are already installed.)
      Files: `package.json`, `package-lock.json`
      Verify: `npm ls react react-dom embla-carousel-react esbuild tailwindcss @tailwindcss/cli` exits 0.

- [ ] 2. Create the shared web product types and global stylesheet.
      Duplicate the `Product`/`Money`/`ProductImage`/`ProductVariant` interfaces into `web/src/types.ts`
      (web is outside `rootDir`, so importing from `../src` would pull server files into the UI build —
      duplicate instead). Create `web/src/styles.css` starting with the three required at-rules
      (`@import 'tailwindcss';`, `@import '@openai/apps-sdk-ui/css';`, `@source '../node_modules/@openai/apps-sdk-ui';`
      — note the `@source` path is relative to `web/src/`, so use `'../../node_modules/@openai/apps-sdk-ui'`).
      Files: `web/src/types.ts`, `web/src/styles.css`
      Verify: files exist; compiled in later steps.

- [ ] 3. Build a shared React mount + tool-result hook used by both widgets.
      Create `web/src/useToolResult.ts(x)` exporting a hook that calls `useApp({ appInfo, capabilities: {} })`,
      applies `useHostStyles(app, app?.getHostContext())`, and in `onAppCreated` registers
      `app.addEventListener('toolresult', p => setData(p.structuredContent))`. Returns the latest
      `structuredContent` (typed per widget) plus `isConnected`. Treat all rendered values as untrusted
      (guard/coerce; apps-sdk-ui `Image` handles broken URLs).
      Files: `web/src/useToolResult.tsx`
      Verify: compiles in the bundle build (step 6).

- [ ] 4. Implement the explore-product carousel widget (read-only).
      Create `web/src/explore-product.tsx`: entry mounts into `#root`. Uses `useEmblaCarousel({ align:'start',
      dragFree:true, containScroll:'trimSnaps' })`, viewport `ref={emblaRef}`, a flex container of product
      cards. Each card: `Image` (product `image.url` ?? `images[0].url`), title, seller, price (Intl
      currency), rating via `Star`/`StarFilled` + count if present. Prev/next arrow buttons wired to
      `emblaApi.scrollPrev/scrollNext`, disabled via `canScrollPrev/canScrollNext` updated on
      `select`/`reInit`. Empty state via `EmptyMessage`. NO action buttons, NO cross-tool calls.
      Files: `web/src/explore-product.tsx`
      Verify: builds in step 6.

- [ ] 5. Implement the getproductbyid card widget (read-only).
      Create `web/src/get-product-by-id.tsx`: entry mounts into `#root`. Renders one product — large
      `Image`, title, seller, `category` (Badge), description, price, rating if present. Purely visual.
      Files: `web/src/get-product-by-id.tsx`
      Verify: builds in step 6.

- [ ] 6. Add the esbuild + Tailwind build scripts and wire npm scripts.
      Create `web/build.mjs` that, for each entry (`explore-product`, `get-product-by-id`): (a) runs
      `@tailwindcss/cli` (or its programmatic build) over `web/src/styles.css` to produce the widget CSS,
      (b) esbuild-bundles the `.tsx` entry to `web/dist/<name>.js` (`format:'esm'`, `bundle:true`,
      `minify:true`, `jsx:'automatic'`), (c) prepends a small runtime snippet that injects the compiled
      CSS into a `<style>` tag so the bundle is fully self-contained (the server wraps it as
      `<div id="root"></div><script type="module">…bundle…</script>`). Add npm scripts: `build:ui` →
      `node web/build.mjs`; `prestart` → `npm run build:ui` so `npm start` always builds first.
      Files: `web/build.mjs`, `package.json`
      Verify: `npm run build:ui` exits 0 and `web/dist/explore-product.js` + `web/dist/get-product-by-id.js`
      exist and are non-empty.

- [ ] 7. Add a shared server helper to read a bundle and build the resource HTML.
      In `src/tools/` add a small helper (e.g. `widget-html.ts`) exporting
      `readWidgetHtml(bundleFileName: string): string` that resolves `../../web/dist/<file>` via
      `fileURLToPath(import.meta.url)` + `readFileSync`, and returns
      `'<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module">' + bundle + '</script></body></html>'`.
      Files: `src/tools/widget-html.ts`
      Verify: imported and used in steps 8–9; type-checks via `npx tsc --noEmit`.

- [ ] 7b. Extend `exploreProducts` in `src/payally-api.ts` with optional price filters.
      Change the signature to `exploreProducts(query: string, merchantId: string, opts: { minPrice?: number; maxPrice?: number } = {})`.
      Keep `url.searchParams.set('query', query)` and `set('merchantid', merchantId)`, then add
      `if (opts.minPrice !== undefined) url.searchParams.set('min_price', String(opts.minPrice));` and the
      same for `max_price` from `opts.maxPrice`. Omit each when undefined. Leave `getProductById` unchanged.
      Files: `src/payally-api.ts`
      Verify: `npx tsc --noEmit` passes; existing two-arg callers still type-check (opts defaults to {}).

- [ ] 8. Rewrite `src/tools/explore-product.ts` to use ext-apps helpers (env-only merchant id, price filters).
      Register the resource with `registerAppResource(server, 'explore-product-widget', 'ui://widget/explore-product.html',
      { description }, async () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: readWidgetHtml('explore-product.js'),
      _meta: { ui: { prefersBorder: true, csp: { connectDomains: ['https://api.payally.world'],
      resourceDomains: ['https://cdn.trychannel3.com'] } } } }] }))`. Register the tool with
      `registerAppTool(server, 'explore-product', { title, description, inputSchema: z.object({ query: z.string().min(1).describe(...),
      min_price: z.number().optional().describe('Minimum product price filter.'), max_price: z.number().optional().describe('Maximum product price filter.') }),
      outputSchema: z.object({ query: z.string(), products: z.array(ProductSchema), nextPageToken: z.string().optional() }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: 'ui://widget/explore-product.html' }, 'openai/toolInvocation/invoking': 'Searching products…',
      'openai/toolInvocation/invoked': 'Products ready' } }, async ({ query, min_price, max_price }) => { const merchantId =
      merchantIdFallback; const { products, nextPageToken } = await exploreProducts(query, merchantId, { minPrice: min_price, maxPrice: max_price });
      return { structuredContent: { query, products, ...(nextPageToken ? { nextPageToken } : {}) },
      content: [{ type: 'text', text: summary }] }; })`. `min_price`/`max_price` are OPTIONAL caller args
      (numbers only) forwarded to the API and omitted when undefined — NOT the merchant id. The export stays
      `registerExploreProduct(server, merchantIdFallback)`; do NOT read authInfo.
      Remove imports of the deleted UI/html module, `resolveMerchantId`, `uiTemplateMeta`, `registerWidget`,
      and `Auth`.
      Files: `src/tools/explore-product.ts`
      Verify: `npx tsc --noEmit` passes.

- [ ] 9. Rewrite `src/tools/get-product-by-id.ts` the same way.
      `registerAppResource` for `ui://widget/get-product-by-id.html` (text = `readWidgetHtml('get-product-by-id.js')`,
      same CSP). `registerAppTool(server, 'getproductbyid', { inputSchema: z.object({ productId: z.string().min(1) }),
      outputSchema: ProductSchema, annotations: { readOnlyHint:true, openWorldHint:true }, _meta: { ui: { resourceUri },
      'openai/toolInvocation/invoking': 'Fetching product…', 'openai/toolInvocation/invoked': 'Product ready' } },
      async ({ productId }) => { const merchantId = process.env.PAYPAL_MERCHANT_ID as string; const product =
      await getProductById(productId, merchantId); return { structuredContent: product, content: [{ type:'text',
      text: \`Product: \${product.title}\` }] }; })`. Env-only merchant id; no authInfo. Remove deleted imports.
      Files: `src/tools/get-product-by-id.ts`
      Verify: `npx tsc --noEmit` passes.

- [ ] 10. Clean up `src/tools/shared.ts` and delete the vanilla HTML drafts.
      Delete `src/ui/explore-product.html.ts` and `src/ui/get-product-by-id.html.ts` (and the `src/ui/`
      dir if empty). In `src/tools/shared.ts` remove `UI_MIME_TYPE`, `registerWidget`, `uiTemplateMeta`,
      and `resolveMerchantId` (now unused) along with the unused `Auth`/`McpServer` imports; delete the
      file entirely if nothing remains.
      Files: `src/tools/shared.ts` (reduce/delete), `src/ui/explore-product.html.ts` (delete),
      `src/ui/get-product-by-id.html.ts` (delete)
      Verify: `npx tsc --noEmit` passes with no references to deleted symbols.

- [ ] 11. Wire the two new tools in `src/index.ts` (keep AuthInfo).
      Inside the per-request `/mcp` handler, after creating `mcpServer`, LEAVE the existing `AuthInfo`
      `registerTool` block and the `getUserProfile` import exactly as-is. ADD, next to it,
      `registerExploreProduct(mcpServer, PAYPAL_MERCHANT_ID)` and
      `registerGetProductById(mcpServer, PAYPAL_MERCHANT_ID)`, plus the two imports. Keep all Auth0
      middleware and the `requireAuth` guard untouched.
      Files: `src/index.ts`
      Verify: `npx tsc --noEmit` passes.

- [ ] 12. Full build + smoke verification.
      Run `npm run build:ui` (bundles exist/non-empty), then `npx tsc --noEmit` (server type-checks).
      Start the server with the required env (`PAYPAL_MERCHANT_ID=DZWR8V78BHZ6G` plus Auth0 vars from
      `.env`) via `npm start`; confirm it logs "PayAlly MCP Server started". Because `/mcp` requires a
      valid Auth0 bearer token, a full tool-call smoke test needs a token; if none is available, verify
      instead that (a) the server boots, (b) `web/dist/*.js` contain the inlined CSS + React bundle, and
      (c) each `ui://` resource HTML string contains `<div id="root">` and `<script type="module">`.
      Document this limitation in the final report.
      Files: none (verification only)
      Verify: `npm run build:ui` exits 0; `npx tsc --noEmit` exits 0; server boots and logs the startup line.
