# Implementation Plan — Interactive Product Widgets (follow-up: 4 changes + UI polish)

Scope: enhance the two already-working MCP Apps tools (`explore-product`, `getproductbyid`) in
`c:\Users\anshv\Desktop\PayAlly\mcp-app`. All work is applied directly in the user's repo (NO worktree).

## Facts confirmed from the codebase / installed types (do not re-derive)

- **Build/test commands** (from `package.json`): `npm run build:ui` runs `node web/build.mjs`
  (Tailwind 4 CLI → single CSS string, then esbuild bundles each widget and prepends a style
  injector into `web/dist/<name>.js`). `npm start` runs `tsx src/index.ts` with a `prestart` that
  runs `build:ui`. There is **no test framework** in this repo — verification is typecheck + UI
  build + server boot.
- **Typecheck**: `npx tsc --noEmit` (tsconfig: Node16 module/moduleResolution, `strict`, `rootDir ./src`,
  `include ["src/**/*"]`). `web/` is OUTSIDE `rootDir`, so `tsc --noEmit` only typechecks `src/`;
  the widgets are typechecked by esbuild at `build:ui` time. All relative imports in `src/` MUST keep
  the `.js` extension.
- **ext-apps server-tool-call method** (confirmed in
  `node_modules/@modelcontextprotocol/ext-apps/dist/src/app.d.ts`):
  `app.callServerTool(params: { name: string; arguments?: Record<string, unknown> }, options?)`
  → `Promise<CallToolResult>`. Tool-execution errors come back as `result.isError: true` (not thrown);
  transport/host failures throw. Capability probe: `app.getHostCapabilities()?.serverTools` is the
  flag for "host can proxy tool calls to the MCP server".
- **ext-apps message fallback**: `app.sendMessage({ role: "user", content: [{ type: "text", text }] })`
  → `Promise<{ isError?: boolean }>`.
- **Tool visibility** (`McpUiToolMeta.visibility` in `spec.types.d.ts`): default is `["model","app"]`,
  and `"app"` already means "callable by the app from this server". **No visibility change is needed**
  for `getproductbyid` — the default already allows the carousel to call it. (Record this explicitly;
  do NOT add a `visibility` field.)
- **CSP shape** (`McpUiResourceCsp` in `spec.types.d.ts`): `connectDomains` → CSP `connect-src`
  (fetch/XHR/WebSocket); `resourceDomains` → `img-src`/`script-src`/`style-src`/`font-src`/`media-src`.
  The docs show subdomain wildcards (`https://*.example.com`). A bare any-host form is NOT explicitly
  documented. Plan: set `connectDomains: ['https://api.payally.world', 'https://*']` and keep
  `resourceDomains: ['https://*']`. **Verify the wildcard is accepted by the host at runtime**; if
  `'https://*'` is rejected, fall back to `'*'`. Record in code comments which form was used.
- **`useApp` return** (`react/useApp.d.ts`): `{ app: App | null; isConnected: boolean; error: Error | null }`.
  `useToolResult.tsx` currently calls `useApp` but only returns `{ data, isConnected }` — it discards
  `app`. We will expose `app` so the carousel can call `callServerTool`.
- **apps-sdk-ui components** (listed under `node_modules/@openai/apps-sdk-ui/dist/types/components/`):
  there is **NO `Skeleton` and NO `Spinner`** component. `ShimmerText` exists but is text-only
  (`as`/`children`/`className`). Decision: build a small Tailwind `animate-pulse` skeleton using
  token surface colors (`bg-token-surface-secondary`, `border-token-border-default`) for image/card
  placeholders; optionally use `ShimmerText` for text lines. Do not add heavy custom CSS.
- **`Image` component** (`components/Image/Image.d.ts`): `ComponentProps<"img"> & { forceRenderAfterLoadFail?: boolean }`,
  exposes `onLoad` / `onError`. Useful for the direct-URL fallback (Change 1).
- **Change 3 status**: already correct in both tools. `explore-product` returns
  `structuredContent: { query, products, ...(nextPageToken?) }` + `content` summary
  `Found N product(s) for "query".`; `getproductbyid` returns `structuredContent: product` (full
  Product) + `content` `Product: <title> (<id>).`. **The only Change-3 work is to CONFIRM this and
  leave it unchanged. Do NOT stringify the API response into `content`.**

## Ordering rationale

The base64 util (item 1) is a leaf dependency of both widgets (items 3, 4), so it comes first.
The CSP change (item 2) is server-side and independent but MUST land before/with the base64 fetch or
the fetch is blocked by CSP — do it early. Items 3 and 4 are the two widgets; each leaves the repo
buildable on its own. Item 5 is server-side confirmation (Change 3). Item 6 is the full verification.

---

- [ ] 1. Create a client-side base64 image hook/util at `web/src/useBase64Image.ts`.
      Export `useBase64Image(url?: string): { src: string | undefined; status: "loading" | "ready" | "error" }`.
      Behavior: when `url` is falsy, return `{ src: undefined, status: "ready" }`. Otherwise maintain a
      **module-level `Map<string, string>` cache** keyed by the original URL. On mount/url-change: if the
      URL is cached, return the cached data URI immediately with `status: "ready"`. Else set `status: "loading"`,
      `fetch(url)`, read `res.blob()`, and use **`FileReader.readAsDataURL`** to produce a real base64 data
      URI (`data:<mime>;base64,...`); on success cache it and set `{ src: dataUri, status: "ready" }`. On ANY
      failure (network/CORS/CSP/decode) **fall back to the original `url`** with `status: "error"` so the
      `<Image>` can still attempt a direct load — never return `undefined` when a URL exists. Guard against
      setting state after unmount (an `isCancelled`/`AbortController` flag). Prefer `readAsDataURL` (no object
      URLs, so no revoke needed); if a future variant uses `URL.createObjectURL`, revoke on cleanup.
      Files: `web/src/useBase64Image.ts` (new)
      Verify: `npm run build:ui` succeeds (esbuild typechecks + bundles the new module when imported in
      items 3/4). File compiles with no esbuild errors.

- [ ] 2. Widen CSP `connectDomains` to allow fetching image bytes from arbitrary CDNs, on BOTH ui:// resources.
      In each resource's `_meta.ui.csp`, change `connectDomains` from `['https://api.payally.world']` to
      `['https://api.payally.world', 'https://*']` (keep the PayAlly API host). Keep
      `resourceDomains: ['https://*']` unchanged (direct-URL fallback). Add a comment noting the wildcard
      form and that if the host rejects `'https://*'` it must be changed to `'*'` (verify at runtime per the
      CSP note above). The base64 fetch in item 1 is a `connect-src` request, so this MUST be in place for it
      to work; `resourceDomains` still covers the direct-URL `<img>` fallback.
      Files: `src/tools/explore-product.ts`, `src/tools/get-product-by-id.ts`
      Verify: `npx tsc --noEmit` passes (no type regressions in the resource `_meta` objects).

- [ ] 3. Expose the `App` instance from `useToolResult` so widgets can call server tools.
      Change the return type to `{ data: T | null; isConnected: boolean; app: App | null }` and return `app`
      from the existing `useApp(...)` call (it is already destructured but currently dropped). Re-export the
      `App` type if needed (it is already imported via `type { App }`). Do not change the existing
      `toolresult` wiring or `useHostStyles` call.
      Files: `web/src/useToolResult.tsx`
      Verify: `npm run build:ui` succeeds; no esbuild type error in the two widget entrypoints that consume
      the hook.

- [ ] 4. Rework `web/src/explore-product.tsx`: base64 images, clickable cards → `getproductbyid`, skeletons,
      and UI polish (Changes 1, 2-consumer, 4).
      (a) **Base64 image** — in `ProductCard`, replace the raw `imageUrl` `<Image src=...>` with
      `useBase64Image(imageUrl)`; while `status === "loading"` render a `bg-token-surface-secondary`
      `animate-pulse` placeholder sized to the existing `aspect-square` box; when ready/error render
      `<Image src={src} forceRenderAfterLoadFail={false} ... />` (error status still passes the original URL
      from the hook so the direct-URL fallback loads). Keep the existing `ShoppingBag` empty-image fallback
      when there is no URL at all.
      (b) **Clickable card → getproductbyid** — pull `app` from `useToolResult`. Make each card a focusable,
      keyboard-accessible control: render the card as a `<button type="button">` (or a `div` with
      `role="button"`, `tabIndex={0}`, `onKeyDown` handling Enter/Space) with a visible hover/active state
      (`hover:border-token-border-heavy hover:shadow-md active:scale-[0.99] transition`). On activate, call a
      shared helper `openProduct(app, product.id)`: if `app?.getHostCapabilities()?.serverTools` is truthy,
      `await app.callServerTool({ name: "getproductbyid", arguments: { productId: product.id } })` and log
      `result.isError`; otherwise (or on thrown transport error) fall back to
      `app.sendMessage({ role: "user", content: [{ type: "text", text: \`Show me product ${product.id}\` }] })`.
      Guard for `app == null` (not yet connected) by disabling the affordance. Do NOT use `window.openai`.
      Keep the embla carousel + prev/next arrows and drag-to-scroll exactly as-is; clicking a card must not
      fire on a drag (embla `dragFree` is on — gate the click so a drag doesn't trigger navigation, e.g. via
      embla's pointer state or a small drag-threshold guard).
      (c) **Skeleton loading** — when `!data` (tool result pending) render a carousel row of 4–6 skeleton
      cards (same `basis-[220px]` card shell with an `animate-pulse` image block + two short pulse lines)
      instead of returning the empty state immediately. Keep the existing `EmptyMessage` ONLY for the
      genuine "data arrived but products.length === 0" case.
      (d) **Polish** — keep token classes (`token-surface-*`, `token-text-*`, `token-border-*`) so light/dark
      follows the host theme via the existing `useHostStyles`; consistent spacing, rounded-2xl cards, subtle
      border + `shadow-sm`/hover `shadow-md`, clear typography hierarchy. Lean on Tailwind utilities +
      apps-sdk-ui; no heavy custom CSS.
      Files: `web/src/explore-product.tsx` (and consumes `web/src/useBase64Image.ts`, `web/src/useToolResult.tsx`)
      Verify: `npm run build:ui` succeeds and emits `web/dist/explore-product.js`.

- [ ] 5. Rework `web/src/get-product-by-id.tsx`: base64 images (main + every gallery thumbnail), skeleton,
      and UI polish (Changes 1, 4). This widget is read-only — no click-to-call.
      (a) **Base64 image** — in `Gallery`, run the active main image and each thumbnail through
      `useBase64Image(...)`. Because hooks can't be called in a `.map`, add a small presentational
      `Base64Img({ url, altText, className })` component that calls `useBase64Image(url)` internally and
      renders an `animate-pulse` placeholder while loading, then `<Image>` with the data URI (falling back to
      the original URL on error). Use it for both the main image and each thumbnail button.
      (b) **Skeleton loading** — the current `!data || !data.id` branch renders an `EmptyMessage` "Loading
      product…". Replace it with a proper skeleton card matching the final layout: an `animate-pulse` square
      image block on the left and several pulse lines (title/seller/price/description) on the right, inside the
      same `rounded-2xl border` card shell. Keep an `EmptyMessage` only if you want a distinct genuinely-empty
      state, but the pending state should be a skeleton.
      (c) **Polish** — same token-driven theming and minimal modern styling as item 4; keep the existing
      `Badge`/`Rating`/price/description layout and the multi-image gallery (that gallery is the Change-9
      "show all images" behavior already shipped — preserve it).
      Files: `web/src/get-product-by-id.tsx` (and consumes `web/src/useBase64Image.ts`)
      Verify: `npm run build:ui` succeeds and emits `web/dist/get-product-by-id.js`.

- [ ] 6. Confirm Change 3 (no code change expected). Re-read both tool files and verify `content` is the SHORT
      human summary and `structuredContent` carries the FULL fetched data (`explore-product`: `{ query,
      products, nextPageToken? }` with the complete products array; `getproductbyid`: the full `Product`).
      If and only if either is missing data, fix the `structuredContent` object — but do NOT move raw JSON
      into `content`. Record in the task findings that `content` was intentionally left as the summary.
      Files: `src/tools/explore-product.ts`, `src/tools/get-product-by-id.ts` (read-only confirmation; edit
      only if structuredContent is incomplete)
      Verify: `npx tsc --noEmit` passes.

- [ ] 7. Full verification pass (end-to-end).
      Run, in order: (1) `npx tsc --noEmit` — server typechecks clean. (2) `npm run build:ui` — both
      `web/dist/*.js` bundles rebuild with no esbuild/Tailwind errors. (3) Server boot check: start the server
      (`npm start`, or set the minimum env and run `tsx src/index.ts`) and confirm it logs
      `PayAlly MCP Server started: ...` and does NOT throw. `npm start` runs `prestart` (`build:ui`) first, so
      this also re-validates the UI build. Note: a full boot requires `AUTH0_DOMAIN` (and the server reads
      `PAYPAL_MERCHANT_ID`); if those env vars are unavailable in this environment, state that the boot step
      could not be run and rely on tsc + build:ui as the verification, since no auth/Auth0 code was touched.
      Files: none (verification only)
      Verify: all three commands succeed (or the boot step is explicitly reported as env-blocked with the
      reason).

## Constraints re-checked against the plan (must not regress)

- Standard MCP Apps protocol only (ext-apps `callServerTool` / `sendMessage` / `getHostCapabilities`);
  **no `window.openai`, no ChatGPT-only APIs** — portable across Claude/ChatGPT/any compliant host.
- Merchant id stays env-only (`PAYPAL_MERCHANT_ID` → `merchantIdFallback`); never a tool arg. Untouched.
- OAuth/Auth0 middleware + `/mcp` protection untouched (`src/index.ts`, `src/auth0.ts` not modified).
  No AuthInfo tool added.
- `min_price`/`max_price` optional numeric passthrough preserved (not touched).
- User-visible `content` stays a short summary; full data rides in `structuredContent` (Change 3 confirmed).
- Widget visual presentation stays its normal cards/carousel; the only new interaction is the
  explore-product card click → `getproductbyid` (Change 2). `get-product-by-id` stays read-only.

## Open items / assumptions

- **CSP wildcard form**: `'https://*'` is the planned value (spec documents subdomain wildcards but not a
  bare any-host form). If the target host rejects it, switch to `'*'` and record which was used. This is the
  one runtime-verifiable unknown; both widgets keep `resourceDomains: ['https://*']` so the direct-URL
  `<img>` fallback still loads even if the base64 `connect-src` fetch is blocked.
- **Drag vs click on the carousel**: embla runs with `dragFree: true`; the card click handler must not fire
  at the end of a drag. Gate the click with embla's pointer/drag state or a small movement threshold.
- No test framework exists; verification is `npx tsc --noEmit` + `npm run build:ui` + server boot. If adding
  a test runner is desired later it is out of scope for this follow-up.

## Design system — "mishmash®" (ADDED after planning; supersedes the generic "minimal modern" direction for Change 4)

A follow-up requirement replaced the generic "minimal modern" styling direction with the concrete
**mishmash®** design system. This is a **CSS/styling-only** change: the JSX structure, component tree,
element hierarchy, and the base64 / click / skeleton logic are all unchanged — only Tailwind classes and
design tokens were restyled. The reviewer should treat this palette as the intended design.

Aesthetic: a paper-boutique look — achromatic chrome (near-black ink, white paper, grey hairlines), **FLAT**
(no shadows, no gradients; depth = surface contrast `#ffffff → #f2f2f2 → #e3e3e3` + 1px hairline borders).
Product photography is the only color. Light theme.

Tokens added to `web/src/styles.css` as Tailwind v4 `@theme` (the required
`@import "tailwindcss"; @import "@openai/apps-sdk-ui/css"; @source …` lines were kept intact):

- Colors: `--color-ink #171717`, `--color-paper-white #ffffff`, `--color-bone #f2f2f2`,
  `--color-ash #e3e3e3`, `--color-smoke #c7c7c7`, `--color-graphite #a1a1a1`, `--color-iron #858585`,
  `--color-buttercream #f4debb` (accent surface only), `--color-amber-tag #f9cb86` (pills / selected only).
- Font: `--font-circular` with an **offline-safe** system fallback (no webfont/network import), applied as
  the widget base font on `html, body`.
- Type scale tokens (`--text-caption` 10px … `--text-heading-lg` 38px) with paired line-heights.
- Radius tokens: `--radius-card` 12px (cards/buttons/images), `--radius-input` 4px (inputs/nav),
  `--radius-pill` 9999px (tags/pills). Only these three radii are used.

Component mapping (styling only): product cards = white surface, `rounded-card`, 1px `border-ash`, compact
padding; title 16px/500 ink, price 14px/400 ink, seller/meta `text-iron`. Category uses the existing
apps-sdk-ui `Badge` component **restyled** (not replaced) to an amber (`bg-amber-tag`) ink-text pill via
`pill` + `className` tokens. Gallery thumbnails = `rounded-card` + 1px `border-ash`; active thumbnail uses a
subtle amber ring/border. Rating stars kept achromatic (ink). Skeletons use `bg-bone` with `rounded-card`,
flat. Carousel nav arrows are achromatic (ink icon, white bg, 1px `border-ash`, flat — no shadow). `EmptyMessage`
text restyled achromatic (`text-ink` / `text-iron`).

Discipline enforced: amber/buttercream are punctuation only (never button fills, body text, or large bands);
no shadows/gradients anywhere.
