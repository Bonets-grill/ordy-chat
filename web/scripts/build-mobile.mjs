#!/usr/bin/env node
// web/scripts/build-mobile.mjs — Sprint 4 F4.4 build pipeline mobile.
//
// Uso:
//   node scripts/build-mobile.mjs ios      # sync + abre Xcode
//   node scripts/build-mobile.mjs android  # sync + abre Android Studio
//   node scripts/build-mobile.mjs          # solo sync (default)
//
// NOTA: la app NO se buildea estáticamente. Capacitor usa live URL
// (https://ordychat.ordysuite.com). Este script solo sincroniza config
// y assets nativos + abre el IDE correspondiente.

import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(__dirname, "..");
const target = (process.argv[2] ?? "").toLowerCase();

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: WEB_ROOT, stdio: "inherit" });
}

function ensureNative(platform) {
  const dir = join(WEB_ROOT, platform);
  if (existsSync(dir)) return true;
  console.log(`\nCarpeta ${platform}/ no existe.`);
  if (platform === "ios") {
    console.log("Requiere: brew install cocoapods && sudo xcode-select --switch /Applications/Xcode.app");
  } else {
    console.log("Requiere: Android Studio instalado + ANDROID_HOME exportado.");
  }
  console.log(`Corre: npx cap add ${platform}`);
  return false;
}

// Sync es siempre seguro: copia config + web assets + plugins.
run("npx cap sync");

if (target === "ios") {
  if (!ensureNative("ios")) process.exit(1);
  run("npx cap open ios");
} else if (target === "android") {
  if (!ensureNative("android")) process.exit(1);
  run("npx cap open android");
} else if (target && target !== "sync") {
  console.error(`Target desconocido: ${target}. Usa ios | android | sync.`);
  process.exit(2);
}

console.log("\n✓ Listo.");
