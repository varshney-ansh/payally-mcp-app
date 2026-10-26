import { useEffect, useState } from "react";

/**
 * Client-side base64 image hook.
 *
 * At render time it fetches the given image URL, reads the response blob, and
 * encodes it to a real `data:<mime>;base64,...` URI via
 * `FileReader.readAsDataURL`. The encoded URI is what the widget renders as the
 * `<img src>`, so the image bytes travel as a data URI rather than a live CDN
 * request at paint time.
 *
 * Behavior:
 * - Falsy `url` → `{ src: undefined, status: "ready" }` (caller renders its own
 *   empty-state placeholder).
 * - Cached URL → returns the cached data URI immediately (`status: "ready"`).
 * - Otherwise → `status: "loading"` while fetching/encoding.
 * - ANY failure (network / CORS / CSP / decode) → falls back to the ORIGINAL
 *   `url` with `status: "error"`, so the `<img>` can still attempt a direct
 *   load. It never returns `undefined` when a URL exists — no broken/empty box.
 *
 * The encoded data URIs are memoized in a module-level `Map` keyed by the
 * original URL, shared across every card/thumbnail and across remounts.
 * `readAsDataURL` produces a plain string (no object URL), so there is nothing
 * to revoke on unmount.
 */

export type Base64ImageStatus = "loading" | "ready" | "error";

export interface Base64ImageResult {
  /** The data URI when encoded, or the original URL on fallback. */
  src: string | undefined;
  status: Base64ImageStatus;
}

// Shared across all widget instances for the life of the bundle.
const cache = new Map<string, string>();

function encodeBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("FileReader did not produce a string result."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed."));
    reader.readAsDataURL(blob);
  });
}

export function useBase64Image(url?: string): Base64ImageResult {
  const [result, setResult] = useState<Base64ImageResult>(() => {
    if (!url) return { src: undefined, status: "ready" };
    const cached = cache.get(url);
    if (cached) return { src: cached, status: "ready" };
    return { src: undefined, status: "loading" };
  });

  useEffect(() => {
    if (!url) {
      setResult({ src: undefined, status: "ready" });
      return;
    }

    const cached = cache.get(url);
    if (cached) {
      setResult({ src: cached, status: "ready" });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setResult({ src: undefined, status: "loading" });

    (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const dataUri = await encodeBlob(blob);
        if (cancelled) return;
        cache.set(url, dataUri);
        setResult({ src: dataUri, status: "ready" });
      } catch {
        // Network / CORS / CSP / decode failure: fall back to the original URL
        // so the direct-load <img> path can still try to render it.
        if (cancelled) return;
        setResult({ src: url, status: "error" });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url]);

  return result;
}
