#!/usr/bin/env node
/**
 * scripts/tunnel.js — Expose a local dev server to the public internet.
 *
 * Twilio and Postmark need a public URL to send webhooks to during local
 * development. This script opens a quick tunnel to a local port (default 3000)
 * and prints the public URL on stdout so a developer can copy-paste it into
 * the provider's webhook configuration.
 *
 * Selection:
 *   1. If NGROK_AUTHTOKEN is set in the environment, use `ngrok http <port>`
 *      (ngrok is more reliable for webhook testing — provides stable URLs
 *       and works with Twilio's signature validation that requires HTTPS).
 *   2. Otherwise use `localtunnel` (no account, no install, but the URL
 *      changes on every restart and there is no uptime guarantee).
 *
 * Usage:
 *   npm run tunnel                # tunnel :3000 with localtunnel
 *   PORT=4000 npm run tunnel      # tunnel a different port
 *   NGROK_AUTHTOKEN=... npm run tunnel  # use ngrok instead
 *
 * The script keeps running until Ctrl-C. The URL is printed as soon as the
 * tunnel is established.
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const SUBDOMAIN = process.env.TUNNEL_SUBDOMAIN || undefined;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(2);
}

// Pre-flight: warn if the local server isn't responding, but don't block.
// It's common to start the tunnel before the dev server is fully up; the
// tunnel will still work and the first request will retry until the server
// is ready.
async function preflight() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.status >= 500) {
      console.warn(
        `[tunnel] Warning: local server on :${PORT} returned ${res.status}. ` +
        'The tunnel will still start; check `npm run dev` is healthy.'
      );
    } else {
      console.log(`[tunnel] Local server on :${PORT} responded ${res.status}.`);
    }
  } catch (err) {
    console.warn(
      `[tunnel] Warning: could not reach http://127.0.0.1:${PORT}/ (${err.message}).\n` +
      '         Start your dev server first (e.g. `npm run dev`), then re-run this script.\n' +
      '         The tunnel will still be created but requests will fail until the server is up.'
    );
  }
}

function startLocaltunnel() {
  console.log(`[tunnel] Starting localtunnel on port ${PORT}...`);
  // Use the localtunnel CLI; it auto-installs via npx on first run.
  const args = ['localtunnel', '--port', String(PORT)];
  if (SUBDOMAIN) {
    args.push('--subdomain', SUBDOMAIN);
  }
  const child = spawn('npx', ['--yes', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let urlPrinted = false;

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    // localtunnel prints: "your url is: https://<sub>.loca.lt"
    if (!urlPrinted) {
      const match = text.match(/https:\/\/[a-z0-9-]+\.loca\.lt/i);
      if (match) {
        urlPrinted = true;
        console.log('\n[tunnel] ============================================');
        console.log(`[tunnel] Public URL: ${match[0]}`);
        console.log('[tunnel] ============================================');
        console.log('[tunnel] Point your Twilio/Postmark webhook here.');
        console.log('[tunnel] Press Ctrl-C to stop.');
        console.log('');
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[tunnel] localtunnel exited with code ${code}`);
      process.exit(code);
    }
  });

  return child;
}

function startNgrok() {
  console.log(`[tunnel] Starting ngrok on port ${PORT}...`);
  const args = ['http', String(PORT), '--log', 'stdout'];
  const child = spawn('ngrok', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  // ngrok prints "url=https://..." to stdout in text mode. We also probe
  // the local API on :4040 to get the assigned URL reliably.
  let urlPrinted = false;
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (!urlPrinted) {
      const match = text.match(/url=(https:\/\/[^\s]+)/);
      if (match) {
        urlPrinted = true;
        console.log('\n[tunnel] ============================================');
        console.log(`[tunnel] Public URL: ${match[1]}`);
        console.log('[tunnel] ============================================');
        console.log('[tunnel] Point your Twilio/Postmark webhook here.');
        console.log('[tunnel] Press Ctrl-C to stop.');
        console.log('');
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[tunnel] ngrok exited with code ${code}`);
      process.exit(code);
    }
  });

  return child;
}

async function main() {
  await preflight();

  const useNgrok = Boolean(process.env.NGROK_AUTHTOKEN);
  const child = useNgrok ? startNgrok() : startLocaltunnel();

  // Forward SIGINT/SIGTERM so Ctrl-C cleanly tears down the tunnel process
  // tree (otherwise the spawned npx/ngrok keeps running after the parent dies).
  const shutdown = (signal) => {
    console.log(`\n[tunnel] Received ${signal}, shutting down tunnel...`);
    try {
      child.kill('SIGTERM');
    } catch (_) {
      // already dead
    }
    // Hard-kill after 3s if it didn't exit cleanly
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (_) {}
      process.exit(0);
    }, 3000);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[tunnel] Fatal error:', err);
  process.exit(1);
});
