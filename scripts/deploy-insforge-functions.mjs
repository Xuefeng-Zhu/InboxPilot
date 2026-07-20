#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultProjectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEPLOYMENT_PREFLIGHT_NOTICE =
  'Preflight required before deployment: create the InsForge PROCESS_JOBS_SECRET for the Deno runtime, put the same value in the Next.js server environment, and update any existing process-jobs schedule to POST with X-Process-Jobs-Secret: ${{secrets.PROCESS_JOBS_SECRET}}. See docs/guides/deploying.md.';
export const WORKER_AUTH_CONFIRMATION_FLAG = '--confirm-worker-auth';

export const FUNCTION_DEPLOYMENTS = Object.freeze([
  { slug: 'email-inbound', source: 'insforge/functions/email-inbound/index.ts' },
  { slug: 'email-status', source: 'insforge/functions/email-status/index.ts' },
  { slug: 'process-jobs', source: 'insforge/functions/process-jobs/index.ts' },
  { slug: 'sms-inbound', source: 'insforge/functions/sms-inbound/index.ts' },
  { slug: 'sms-status', source: 'insforge/functions/sms-status/index.ts' },
  { slug: 'webchat-identify', source: 'insforge/functions/webchat-identify/index.ts' },
  { slug: 'webchat-inbound', source: 'insforge/functions/webchat-inbound/index.ts' },
  { slug: 'webchat-session-info', source: 'insforge/functions/webchat-session-info/index.ts' },
  { slug: 'webchat-thread-init', source: 'insforge/functions/webchat-thread-init/index.ts' },
]);

export function deployInsforgeFunctions({
  projectRoot = defaultProjectRoot,
  workerAuthConfirmed = false,
  runCommand = spawnSync,
  writeLine = (line) => process.stdout.write(`${line}\n`),
  createBundleDirectory = () =>
    mkdtempSync(resolve(tmpdir(), 'inboxpilot-insforge-functions-')),
  removeBundleDirectory = (directory) =>
    rmSync(directory, { recursive: true, force: true }),
} = {}) {
  writeLine(DEPLOYMENT_PREFLIGHT_NOTICE);
  if (!workerAuthConfirmed) {
    throw new Error(
      `Deployment blocked: verify the worker-auth preflight, then re-run with ${WORKER_AUTH_CONFIRMATION_FLAG}.`,
    );
  }

  const bundleDirectory = createBundleDirectory();
  try {
    const preparedDeployments = FUNCTION_DEPLOYMENTS.map((deployment) => ({
      ...deployment,
      sourcePath: resolve(projectRoot, deployment.source),
      bundlePath: resolve(bundleDirectory, `${deployment.slug}.ts`),
    }));

    // Finish the complete bundle preflight before mutating the remote project.
    // A broken import in any entrypoint must result in zero deployed functions,
    // rather than a partially updated release.
    for (const deployment of preparedDeployments) {
      writeLine(`Bundling ${deployment.slug} from ${deployment.source}`);

      const bundleResult = runCommand(
        'deno',
        ['bundle', '--output', deployment.bundlePath, deployment.sourcePath],
        {
          cwd: projectRoot,
          stdio: 'inherit',
          shell: false,
        },
      );

      if (bundleResult.error) {
        throw new Error(
          `Failed to bundle ${deployment.slug}: ${bundleResult.error.message}`,
        );
      }
      if (bundleResult.status !== 0) {
        throw new Error(
          `Failed to bundle ${deployment.slug}: Deno exited with status ${bundleResult.status ?? 'unknown'}`,
        );
      }
    }

    for (const deployment of preparedDeployments) {
      writeLine(`Deploying ${deployment.slug} from its fresh bundle`);

      const result = runCommand(
        'npx',
        [
          '@insforge/cli',
          'functions',
          'deploy',
          deployment.slug,
          '--file',
          deployment.bundlePath,
        ],
        {
          cwd: projectRoot,
          stdio: 'inherit',
          shell: false,
        },
      );

      if (result.error) {
        throw new Error(
          `Failed to deploy ${deployment.slug}: ${result.error.message}`,
        );
      }
      if (result.status !== 0) {
        throw new Error(
          `Failed to deploy ${deployment.slug}: CLI exited with status ${result.status ?? 'unknown'}`,
        );
      }
    }
  } finally {
    removeBundleDirectory(bundleDirectory);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    deployInsforgeFunctions({
      workerAuthConfirmed: process.argv.includes(WORKER_AUTH_CONFIRMATION_FLAG),
    });
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
