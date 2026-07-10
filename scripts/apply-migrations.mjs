#!/usr/bin/env node
// scripts/apply-migrations.mjs — Apply a single SQL migration file to the
// InsForge Postgres database using the direct connection (not the PostgREST
// REST API, which doesn't support raw multi-statement SQL reliably).
//
// Usage: node scripts/apply-migrations.mjs <migration-file> [...]
//        node scripts/apply-migrations.mjs --reload-schema (just reload PostgREST cache)
//
// After applying, automatically runs `NOTIFY pgrst, 'reload schema'` so the
// PostgREST schema cache picks up new functions/tables. This is required
// after any CREATE OR REPLACE FUNCTION/RPC because the cache latches onto
// the first signature it sees for a function name.
//
// Drop-in replacement for `npx @insforge/cli db query <file.sql>` which
// (a) is broken for `--` comments (CLI misinterprets them as flags),
// (b) doesn't reload the PostgREST schema cache, and
// (c) splits multi-statement SQL on `;` which can fail inside PL/pgSQL bodies
//     with `RAISE EXCEPTION '...';` statements (each RAISE is its own statement).
//
// SECURITY: The Postgres connection URL is read from `DATABASE_URL` env var.
// Never hardcode credentials here. CI/dev should export `DATABASE_URL` from
// a secrets store. The `npx @insforge/cli db connection-string` command
// prints the URL once you are authenticated.
//
// Stopgap note: once the InsForge CLI's `db migrations up` command correctly
// reloads the PostgREST cache and handles multi-statement PL/pgSQL bodies,
// this script can be retired.

import { Client } from 'pg';
import { readFileSync } from 'fs';
import { basename } from 'path';

function resolveConnectionString() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  throw new Error(
    'No Postgres connection string available.\n' +
      'Set DATABASE_URL=<postgres-url> in your environment, e.g.:\n' +
      '  export DATABASE_URL="postgresql://postgres:...@<host>:5432/insforge?sslmode=require"\n' +
      'The `npx @insforge/cli db connection-string` command prints the URL\n' +
      'once you are authenticated (`npx @insforge/cli login`).'
  );
}

const PG_URL = resolveConnectionString();

const rawArgs = process.argv.slice(2);

const flags = new Set();
const files = [];

for (const arg of rawArgs) {
  if (arg.startsWith('--')) {
    flags.add(arg);
  } else {
    files.push(arg);
  }
}

const client = new Client({ connectionString: PG_URL });

async function applyFile(file) {
  let sql = readFileSync(file, 'utf8');

  // Migration 008's CREATE OR REPLACE renames the parameter (max_count →
  // claim_limit), which Postgres disallows. Drop the old function first.
  if (basename(file) === '008_claim_failed_jobs.sql') {
    try {
      await client.query('DROP FUNCTION IF EXISTS public.claim_support_jobs(integer)');
      console.log(`[apply-migrations] Pre-drop: claim_support_jobs(integer)`);
    } catch (e) {
      console.warn(`[apply-migrations] Pre-drop failed (non-fatal): ${e.message}`);
    }
  }

  await client.query(sql);
  console.log(`[apply-migrations] OK: ${basename(file)}`);
}

async function reloadSchema() {
  await client.query("NOTIFY pgrst, 'reload schema'");
  console.log('[apply-migrations] PostgREST schema cache reloaded');
}

(async () => {
  try {
    await client.connect();

    if (flags.has('--reload-schema') && files.length === 0) {
      await reloadSchema();
    } else if (files.length === 0) {
      console.error('Usage: node scripts/apply-migrations.mjs <migration-file> [...]');
      console.error('       node scripts/apply-migrations.mjs --reload-schema');
      process.exit(2);
    } else {
      for (const file of files) {
        await applyFile(file);
      }
      // Always reload the PostgREST schema cache after migrations so the
      // REST layer sees the new function signatures.
      await reloadSchema();
    }
  } catch (err) {
    console.error(`[apply-migrations] FAILED: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
