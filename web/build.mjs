// Builds the two read-only widgets into self-contained ESM bundles.
//
// Each web/dist/<name>.js carries BOTH the minified React widget code AND the
// compiled Tailwind + apps-sdk-ui CSS (injected as a <style> at runtime), so
// the server only needs to wrap the single file in a <script type="module">.

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const webDir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(webDir, "src");
const distDir = join(webDir, "dist");
const tmpCss = join(distDir, "styles.css");

const ENTRIES = ["explore-product", "get-product-by-id"];

mkdirSync(distDir, { recursive: true });

// 1) Compile the global stylesheet (Tailwind 4 + apps-sdk-ui) to a single CSS
//    string via @tailwindcss/cli.
console.log("Compiling CSS with @tailwindcss/cli…");
const cli = spawnSync(
  process.execPath,
  [
    join(webDir, "..", "node_modules", "@tailwindcss", "cli", "dist", "index.mjs"),
    "-i",
    join(srcDir, "styles.css"),
    "-o",
    tmpCss,
    "--minify",
  ],
  { stdio: "inherit", cwd: join(webDir, "..") },
);

if (cli.status !== 0) {
  console.error("Tailwind CSS build failed.");
  process.exit(cli.status ?? 1);
}

const compiledCss = readFileSync(tmpCss, "utf8");

// A tiny self-executing snippet that injects the compiled CSS into <head>.
// JSON.stringify keeps the CSS string safe to embed inside JS.
const styleInjector =
  `(()=>{const c=${JSON.stringify(compiledCss)};` +
  `const s=document.createElement("style");` +
  `s.setAttribute("data-payally-widget","");` +
  `s.textContent=c;document.head.appendChild(s);})();\n`;

// 2) Bundle each widget, then 3) prepend the style injector.
for (const name of ENTRIES) {
  const outfile = join(distDir, `${name}.js`);

  await esbuild.build({
    entryPoints: [join(srcDir, `${name}.tsx`)],
    outfile,
    bundle: true,
    format: "esm",
    minify: true,
    jsx: "automatic",
    platform: "browser",
    target: "es2020",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "info",
  });

  const bundled = readFileSync(outfile, "utf8");
  writeFileSync(outfile, styleInjector + bundled);

  // esbuild may emit a sibling <name>.css when bundled dependencies import CSS.
  // That CSS is redundant (the full Tailwind + apps-sdk-ui CSS is already
  // inlined via the style injector), so drop it to keep dist self-contained.
  rmSync(join(distDir, `${name}.css`), { force: true });

  console.log(`Built ${name} -> ${outfile}`);
}

// Remove the intermediate CSS file; it is now inlined into both bundles.
rmSync(tmpCss, { force: true });

console.log("UI build complete.");
