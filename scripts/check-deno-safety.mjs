#!/usr/bin/env node
/**
 * check-deno-safety.mjs — Deno-safety guard for insforge/functions/
 *
 * Scans `insforge/functions/` recursively for Node-only patterns that are NOT
 * safe in the Deno serverless runtime:
 *
 *   1. `from 'crypto'`            — bare Node `crypto` import
 *   2. `from 'node:`              — explicit `node:` prefix (fs, crypto, ...)
 *   3. `Buffer.`                  — member access on the Node `Buffer` global
 *
 * The Deno entrypoints ship to the InsForge Deno runtime. These patterns
 * either fail at bundle time or at runtime with no portable fallback, so
 * the lint check fails the build (exit 1) on any match.
 *
 * Scope:
 *   - INCLUDED:   `insforge/functions/` (all .ts files, recursively)
 *   - EXCLUDED:   `insforge/functions/_bundled/`  (deno bundle artifacts)
 *
 * Usage:
 *   node scripts/check-deno-safety.mjs
 *
 * Exit codes:
 *   0  — tree is clean (no forbidden patterns)
 *   1  — at least one forbidden pattern matched (printed to stderr)
 *
 * Dependencies: none. Uses only `node:fs/promises` and `node:path`.
 */

// ---------------------------------------------------------------------------
// Imports (node: built-ins only — no npm deps)
// ---------------------------------------------------------------------------

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Resolve project root from this script's location
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const SCAN_ROOT = join(projectRoot, 'insforge', 'functions');
const EXCLUDE_DIR = '_bundled'; // deno bundle artifacts — never lint

// ---------------------------------------------------------------------------
// Forbidden patterns
// ---------------------------------------------------------------------------

/**
 * Each entry: [name, regex].
 * - `bare-crypto-import`:  matches `from 'crypto'` and `from "crypto"` only.
 *   (Excludes `node:crypto` and `crypto.subtle` webcrypto which are fine.)
 * - `node-prefix-import`:  matches `from 'node:fs'`, `from "node:crypto"`, etc.
 * - `buffer-global-usage`: matches `Buffer.from(...)`, `Buffer.alloc(...)`, ...
 *   (Word boundary prevents matching `BufferLike` or `MyBuffer.x`.)
 */
const PATTERNS = [
  ['bare-crypto-import', /from\s+['"]crypto['"]/],
  ['node-prefix-import', /from\s+['"]node:/],
  ['buffer-global-usage', /\bBuffer\./],
];

// ---------------------------------------------------------------------------
// Recursive directory walk
// ---------------------------------------------------------------------------

/**
 * Async generator that yields absolute paths of every regular file under
 * `dir`, recursively. Excludes any directory named `EXCLUDE_DIR`. Defensive
 * against non-file / non-directory entries (symlinks, sockets, etc.).
 */
async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    // Directory gone between scan and walk — surface a warning, then stop.
    process.stderr.write(`check-deno-safety: cannot read ${dir}: ${err.message}\n`);
    return;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip the deno bundle artifacts directory.
      if (entry.name === EXCLUDE_DIR) continue;
      yield* walk(full);
      continue;
    }

    // Only inspect regular .ts source files.
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;

    yield full;
  }
}

// ---------------------------------------------------------------------------
// Scan a single file
// ---------------------------------------------------------------------------

/**
 * Reads `filePath` line by line and returns the matches as an array of
 * `{ lineNumber, patternName, content }` records. Returns an empty array if
 * the file cannot be read (caller logs a warning; we don't want one bad
 * file to mask a real hit on another).
 */
async function scanFile(filePath) {
  let text;
  try {
    text = await readFile(filePath, 'utf-8');
  } catch (err) {
    process.stderr.write(
      `check-deno-safety: cannot read ${filePath}: ${err.message}\n`,
    );
    return [];
  }

  const lines = text.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const content = lines[i];
    for (const [patternName, regex] of PATTERNS) {
      if (regex.test(content)) {
        hits.push({ lineNumber: i + 1, patternName, content });
        // Don't double-report: one line should not match two patterns.
        break;
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Verify the scan root exists. If it doesn't, warn and exit 0 — this keeps
  // the check safe to run in a partial checkout (e.g. fresh clone before
  // any functions have been added).
  let rootStat;
  try {
    rootStat = await stat(SCAN_ROOT);
  } catch (err) {
    process.stderr.write(
      `check-deno-safety: scan root not found: ${SCAN_ROOT} (${err.message})\n` +
        `check-deno-safety: nothing to check; exiting 0.\n`,
    );
    process.exit(0);
  }
  if (!rootStat.isDirectory()) {
    process.stderr.write(
      `check-deno-safety: scan root is not a directory: ${SCAN_ROOT}\n` +
        `check-deno-safety: nothing to check; exiting 0.\n`,
    );
    process.exit(0);
  }

  let totalHits = 0;
  let fileCount = 0;

  for await (const filePath of walk(SCAN_ROOT)) {
    fileCount += 1;
    const hits = await scanFile(filePath);
    for (const hit of hits) {
      totalHits += 1;
      // Report paths relative to the project root (matches the rest of
      // the project's diagnostics, e.g. ESLint / tsc output).
      const relPath = relative(projectRoot, filePath);
      process.stderr.write(
        `${relPath}:${hit.lineNumber}: ${hit.patternName}: ${hit.content.trim()}\n`,
      );
    }
  }

  if (totalHits === 0) {
    process.stderr.write(
      `check-deno-safety: OK — scanned ${fileCount} .ts file(s) under insforge/functions/ (excluding _bundled/); no forbidden patterns.\n`,
    );
    process.exit(0);
  }

  process.stderr.write(
    `check-deno-safety: FAIL — ${totalHits} forbidden pattern match(es) in ${fileCount} file(s). See lines above.\n`,
  );
  process.exit(1);
}

main().catch((err) => {
  // Last-ditch error sink — never let the script crash with a stack trace
  // dump that CI can't parse.
  process.stderr.write(`check-deno-safety: unexpected error: ${err.stack || err.message}\n`);
  process.exit(1);
});
