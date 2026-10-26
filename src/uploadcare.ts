import { UploadClient } from '@uploadcare/upload-client';
import { getPrefixedCdnBaseSync } from '@uploadcare/cname-prefix/sync';

/**
 * Server-side Uploadcare CDN delivery.
 *
 * Product images come from ARBITRARY brand domains, so they cannot be
 * CSP-allowlisted and a bare https wildcard is not honored by the host (Claude).
 * The fix: ingest each product image into Uploadcare via upload-from-URL to
 * get a stable UUID, then serve it from Uploadcare's single, allowlistable CDN
 * origin (optimized on the fly via the `/-/preview/` operation). Only the
 * WIDGET-facing `structuredContent` carries these delivery urls; the
 * MODEL-facing `content` keeps the ORIGINAL brand urls.
 */

const pubKey = process.env.UPLOADCARE_PUBLIC_KEY ?? 'c92034e89436168ebefd';

const client = new UploadClient({ publicKey: pubKey });

// Compute the project's prefixed CDN base ONCE at module load (do not hardcode
// the prefix). For `c92034e89436168ebefd` this resolves to
// `https://5ru1fvsr9k.ucarecd.net`.
const cdnBase = getPrefixedCdnBaseSync(pubKey, 'https://ucarecd.net');

/** The single CDN origin to allowlist in the resource CSP (`img-src`). */
export const uploadcareCdnOrigin = new URL(cdnBase).origin;

// Memoize by original url. Storing the in-flight Promise (not just the resolved
// string) both caches resolved results and de-dupes concurrent ingests of the
// same url (carousel cards sharing an image). On failure the key is deleted so
// a transient failure is not cached as permanent.
const cache = new Map<string, Promise<string>>();

/**
 * Ingest `originalUrl` into Uploadcare and return a delivery url of the shape
 * `${cdnBase}/<uuid>/-/preview/<w>x<h>/`. NEVER throws: on any failure (ingest
 * error, bad url, timeout) it returns the ORIGINAL url unchanged so the widget
 * can fall back to the brand url + inline-SVG placeholder.
 */
export async function toUploadcareImage(
  originalUrl: string,
  opts?: { preview?: string },
): Promise<string> {
  if (!originalUrl) return originalUrl;

  const cached = cache.get(originalUrl);
  if (cached) return cached;

  const preview = opts?.preview ?? '1000x1000';
  const pending = (async () => {
    try {
      const { uuid } = await client.uploadFile(originalUrl);
      return `${cdnBase}/${uuid}/-/preview/${preview}/`;
    } catch {
      // Don't poison the cache with a permanent fallback — allow later retries.
      cache.delete(originalUrl);
      return originalUrl;
    }
  })();

  cache.set(originalUrl, pending);
  return pending;
}
