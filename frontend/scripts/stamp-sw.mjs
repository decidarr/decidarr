// Postbuild: stamp a unique-per-release token into dist/sw.js.
//
// vite copies public/sw.js verbatim, so without this every deploy would
// ship byte-identical bytes and the browser would never run its SW update
// algorithm (→ updatefound → registration.waiting → the reload toast).
// We rewrite the __BUILD_HASH__ placeholder with a short hash derived from
// the content-hashed asset filenames vite emitted in dist/assets — those
// names change iff app content changes, so sw.js's bytes change iff the app
// changes (and stay stable across rebuilds of identical content). Falls
// back to a timestamp if for some reason no assets directory exists.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");
const SW_PATH = path.join(DIST, "sw.js");

if (!existsSync(SW_PATH)) {
  console.error(`stamp-sw: ${SW_PATH} not found — did vite build run?`);
  process.exit(1);
}

const assetsDir = path.join(DIST, "assets");
let token;
if (existsSync(assetsDir)) {
  // Hash the sorted list of emitted asset filenames (already content-hashed
  // by vite). Deterministic for identical content, different when it changes.
  const names = readdirSync(assetsDir).sort().join("\n");
  token = createHash("sha256").update(names).digest("hex").slice(0, 12);
} else {
  token = `ts${Date.now()}`;
}

const src = readFileSync(SW_PATH, "utf8");
if (!src.includes("__BUILD_HASH__")) {
  console.error("stamp-sw: __BUILD_HASH__ placeholder not found in dist/sw.js");
  process.exit(1);
}
const out = src.replaceAll("__BUILD_HASH__", token);
writeFileSync(SW_PATH, out);
console.log(`stamp-sw: SHELL = decidarr-shell-${token}`);
