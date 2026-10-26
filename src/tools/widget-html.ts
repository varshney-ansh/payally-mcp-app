import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Reads a pre-built widget bundle from web/dist and wraps it in a minimal HTML
 * document with a #root mount point and an inline ES-module script tag.
 */
export function readWidgetHtml(bundleFileName: string): string {
  const bundlePath = path.join(dir, '../../web/dist', bundleFileName);
  const bundle = readFileSync(bundlePath, 'utf-8');
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body><div id="root"></div><script type="module">' +
    bundle +
    '</script></body></html>'
  );
}
