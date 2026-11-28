#!/usr/bin/env node
/**
 * Sets Sonora's version in every file that carries it, so they cannot drift:
 *
 *   pnpm version:bump 0.8.19
 *
 * tests/app-version.test.ts fails if they ever disagree.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Each file and the one version string in it, captured around the number. */
export const TARGETS = [
  ["package.json", /("version":\s*")[^"]+(")/],
  ["src-tauri/tauri.conf.json", /("version":\s*")[^"]+(")/],
  ["src-tauri/Cargo.toml", /^(version\s*=\s*")[^"]+(")/m],
  ["src-tauri/Cargo.lock", /(\[\[package\]\]\r?\nname = "sonora"\r?\nversion = ")[^"]+(")/],
  ["src/lib/app-info.ts", /(FALLBACK_APP_INFO: AppInfo = \{\s*name: "Sonora",\s*version: ")[^"]+(")/],
];

export function isValidVersion(version) {
  return typeof version === "string" && SEMVER.test(version);
}

/** Replaces the version in one file's text, leaving everything else untouched. */
export function setVersion(text, pattern, version) {
  if (!pattern.test(text)) throw new Error(`no version found for ${pattern}`);
  return text.replace(pattern, `$1${version}$2`);
}

function main(version) {
  if (!isValidVersion(version)) {
    console.error("Usage: pnpm version:bump <major.minor.patch>");
    process.exit(1);
  }
  // Work out every change before writing any, so a mismatch leaves nothing half-done.
  const updates = TARGETS.map(([file, pattern]) => {
    const full = path.join(ROOT, file);
    return [file, full, setVersion(readFileSync(full, "utf8"), pattern, version)];
  });
  for (const [file, full, text] of updates) {
    writeFileSync(full, text);
    console.log(`${file} -> ${version}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]);
}
