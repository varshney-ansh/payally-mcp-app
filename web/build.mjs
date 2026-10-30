// Builds the two read-only widgets into self-contained ESM bundles.
//
// Each web/dist/<name>.js carries BOTH the minified React widget code AND the
// Astryx CSS it imports (reset.css + astryx.css + the stone theme.css/fonts.css),
// injected as a <style> at runtime. The server only needs to wrap the single
// file in a <script type="module">.
//
// esbuild bundles the `import "...css"` statements in each entry into a sibling
// <name>.css; we read that, prepend a style-injector snippet to the JS, then
// delete the sibling so dist stays self-contained.

import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const webDir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(webDir, "src");
const distDir = join(webDir, "dist");

const ENTRIES = ["explore-product", "get-product-by-id"];

mkdirSync(distDir, { recursive: true });

for (const name of ENTRIES) {
  const outfile = join(distDir, `${name}.js`);
  const cssSibling = join(distDir, `${name}.css`);

  await esbuild.build({
    entryPoints: [join(srcDir, `${name}.tsx`)],
    outfile,
    bundle: true,
    format: "esm",
    minify: true,
    jsx: "automatic",
    platform: "browser",
    target: "es2020",
    // Let esbuild resolve and bundle CSS imports (Astryx reset/astryx/theme).
    // Font files referenced by the theme CSS are inlined as data URIs so the
    // bundle needs no external asset fetches inside the host iframe.
    loader: {
      ".woff": "dataurl",
      ".woff2": "dataurl",
      ".ttf": "dataurl",
      ".eot": "dataurl",
      ".svg": "dataurl",
    },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "info",
  });

  // Inline the esbuild-emitted CSS into the JS bundle via a style injector.
  let compiledCss = "";
  if (existsSync(cssSibling)) {
    compiledCss = readFileSync(cssSibling, "utf8");
  }

  const styleInjector =
    `(()=>{const c=${JSON.stringify(compiledCss)};` +
    `const s=document.createElement("style");` +
    `s.setAttribute("data-payally-widget","");` +
    `s.textContent=c;document.head.appendChild(s);})();\n`;

  const bundled = readFileSync(outfile, "utf8");
  writeFileSync(outfile, styleInjector + bundled);

  // Drop the sibling CSS — it is now inlined into the JS bundle.
  rmSync(cssSibling, { force: true });

  console.log(`Built ${name} -> ${outfile}`);
}

console.log("UI build complete.");
