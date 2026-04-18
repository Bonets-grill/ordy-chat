#!/usr/bin/env node
// web/scripts/check-use-server.mjs
//
// Guard contra el bug que petó producción el 2026-04-19:
// un archivo con "use server" al top que también exporta tipos, clases, interfaces
// o cualquier cosa no-function. Turbopack rechaza esos exports en server files
// y el build Vercel se rompe (typecheck local pasa sin problema).
//
// Reglas:
//  - Archivo con `"use server"` (o `'use server'`) como primera línea de código
//    (ignorando comentarios y vacías) → TODOS los exports deben ser `async function`
//    o re-exports. No se permiten: class, interface, type, const que no sea
//    función async, export default que no sea async function.
//
// Este check es heurístico (no es un AST parser) pero cubre el caso real que rompió.
// Si introduces un export legítimo que este check rechaza, mueve el helper a otro
// archivo sin "use server" (patrón correcto: helper puro en `lib/*`, server action
// en `app/**/actions.ts`).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");

// Directorios a escanear (relativos a web/)
const SCAN_DIRS = ["app", "lib", "components"];
const IGNORE = new Set(["node_modules", ".next", "dist", ".turbo"]);

/** @type {string[]} */
const tsFiles = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORE.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      tsFiles.push(full);
    }
  }
}

for (const dir of SCAN_DIRS) {
  walk(join(ROOT, dir));
}

/** @type {{file:string, reason:string, line:number}[]} */
const violations = [];

for (const file of tsFiles) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");

  // Busca primera línea significativa (no comentario, no vacía).
  let firstCodeLineIdx = -1;
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw === "") continue;
    if (inBlockComment) {
      if (raw.includes("*/")) inBlockComment = false;
      continue;
    }
    if (raw.startsWith("/*")) {
      if (!raw.includes("*/")) inBlockComment = true;
      continue;
    }
    if (raw.startsWith("//")) continue;
    firstCodeLineIdx = i;
    break;
  }
  if (firstCodeLineIdx < 0) continue;

  const firstLine = lines[firstCodeLineIdx].trim();
  const isUseServer =
    /^["']use server["'];?$/.test(firstLine);
  if (!isUseServer) continue;

  // Archivo marcado "use server". Revisa exports.
  // Patrones permitidos (async function + re-exports):
  //   export async function xxx(
  //   export { xxx } from "..."
  //   export * from "..."
  //   export type { xxx } from "..."  (pure type re-export is fine — erased at runtime)
  //   export default async function
  // Patrones prohibidos (rompen Turbopack "use server"):
  //   export const xxx = ...  (aunque sea async arrow, Turbopack se pone raro;
  //                            mejor usar `export async function`)
  //   export class xxx
  //   export interface xxx
  //   export type xxx =
  //   export enum xxx
  //   export default (algo no-async-function)

  const exportRe = /^\s*export\s+(async\s+function|function|const|let|var|class|interface|type|enum|default|\*|\{)/;
  const allowedPrefixes = [
    /^\s*export\s+async\s+function\s+\w+/,
    /^\s*export\s+default\s+async\s+function/,
    /^\s*export\s*\*\s*from/,
    /^\s*export\s+type\s*\{[^}]*\}\s*from/, // re-export puro de tipos
    /^\s*export\s*\{[^}]*\}\s*from/,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!exportRe.test(line)) continue;
    if (allowedPrefixes.some((re) => re.test(line))) continue;
    // Export prohibido en archivo "use server".
    const trimmed = line.trim().slice(0, 80);
    violations.push({
      file,
      line: i + 1,
      reason: `"use server" file cannot export non-async-function. Found: ${trimmed}`,
    });
  }
}

if (violations.length > 0) {
  console.error(`\n❌ "use server" misuse detected (${violations.length} violations):\n`);
  for (const v of violations) {
    const rel = v.file.replace(ROOT + "/", "");
    console.error(`  ${rel}:${v.line}`);
    console.error(`    ${v.reason}`);
  }
  console.error(
    `\nFix: mover el archivo a un helper puro (sin "use server") y crear un\n` +
      `wrapper con "use server" en app/**/actions.ts que solo exporte async\n` +
      `functions. Ver web/lib/reseller/create.ts vs web/app/admin/resellers/new/actions.ts\n` +
      `como referencia correcta.\n`,
  );
  process.exit(1);
}

console.log(`✅ check-use-server: ${tsFiles.length} archivos escaneados, 0 violaciones.`);
