/**
 * Server-side image → base64 data URI encoder.
 *
 * The widget runs in a sandboxed iframe under Claude's CSP, which blocks the
 * client-side fetch-in-iframe approach that previously lived in
 * `web/src/useBase64Image.ts`. So the SERVER fetches each product image and
 * hands the widget a ready-to-render `data:<mime>;base64,...` URI; the widget's
 * `<img src>` then just works with zero client fetching.
 *
 * Uses global `fetch` (Node 18+, already required by `src/payally-api.ts`), so
 * no new dependency is introduced.
 *
 * This function intentionally stays simple and lets failures throw — the
 * CALLER wraps each encode in a per-image try/catch and falls back to the
 * ORIGINAL url string so one broken image never breaks the whole response.
 */
export async function toDataUri(imageUrl: string): Promise<string> {
  const r = await fetch(imageUrl);
  if (!r.ok) throw new Error(`image fetch ${r.status} for ${imageUrl}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const mime = r.headers.get('content-type') || 'image/jpeg';
  return 'data:' + mime + ';base64,' + buf.toString('base64');
}
