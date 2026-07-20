import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  DEPLOYMENT_PREFLIGHT_NOTICE,
  FUNCTION_DEPLOYMENTS,
  deployInsforgeFunctions,
} from '../../scripts/deploy-insforge-functions.mjs';

const projectRoot = resolve(import.meta.dirname, '../..');

describe('InsForge function deployment manifest', () => {
  it('deploys every source entrypoint and never deploys checked-in bundles', () => {
    const functionsRoot = resolve(projectRoot, 'insforge/functions');
    const sourceSlugs = readdirSync(functionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((slug) => existsSync(resolve(functionsRoot, slug, 'index.ts')))
      .sort();

    expect(FUNCTION_DEPLOYMENTS.map(({ slug }) => slug).sort()).toEqual(
      sourceSlugs,
    );
    expect(FUNCTION_DEPLOYMENTS).toHaveLength(9);

    for (const deployment of FUNCTION_DEPLOYMENTS) {
      expect(deployment.source).toBe(
        `insforge/functions/${deployment.slug}/index.ts`,
      );
      expect(deployment.source).not.toContain('_bundled');
      expect(existsSync(resolve(projectRoot, deployment.source))).toBe(true);
    }
  });

  it('bundles every source before deploying its fresh disposable artifact', () => {
    const events = [];
    const writeLine = vi.fn((line) => events.push(`write:${line}`));
    const runCommand = vi.fn((command) => {
      events.push(command);
      return { status: 0 };
    });
    const bundleDirectory = resolve(projectRoot, '.test-function-bundles');
    const removeBundleDirectory = vi.fn();

    deployInsforgeFunctions({
      projectRoot,
      runCommand,
      writeLine,
      createBundleDirectory: () => bundleDirectory,
      removeBundleDirectory,
    });

    expect(events[0]).toBe(`write:${DEPLOYMENT_PREFLIGHT_NOTICE}`);
    expect(writeLine).toHaveBeenNthCalledWith(1, DEPLOYMENT_PREFLIGHT_NOTICE);
    expect(events[1]).toBe(
      'write:Bundling email-inbound from insforge/functions/email-inbound/index.ts',
    );
    expect(runCommand).toHaveBeenCalledTimes(FUNCTION_DEPLOYMENTS.length * 2);
    expect(
      runCommand.mock.calls
        .slice(0, FUNCTION_DEPLOYMENTS.length)
        .every(([command]) => command === 'deno'),
    ).toBe(true);
    expect(
      runCommand.mock.calls
        .slice(FUNCTION_DEPLOYMENTS.length)
        .every(([command]) => command === 'npx'),
    ).toBe(true);
    FUNCTION_DEPLOYMENTS.forEach((deployment, index) => {
      const sourcePath = resolve(projectRoot, deployment.source);
      const bundlePath = resolve(bundleDirectory, `${deployment.slug}.ts`);
      expect(runCommand).toHaveBeenNthCalledWith(
        index + 1,
        'deno',
        ['bundle', '--output', bundlePath, sourcePath],
        expect.objectContaining({ cwd: projectRoot, stdio: 'inherit', shell: false }),
      );
      expect(runCommand).toHaveBeenNthCalledWith(
        FUNCTION_DEPLOYMENTS.length + index + 1,
        'npx',
        [
          '@insforge/cli',
          'functions',
          'deploy',
          deployment.slug,
          '--file',
          bundlePath,
        ],
        expect.objectContaining({ cwd: projectRoot, stdio: 'inherit', shell: false }),
      );
    });
    expect(removeBundleDirectory).toHaveBeenCalledOnce();
    expect(removeBundleDirectory).toHaveBeenCalledWith(bundleDirectory);
  });

  it('stops immediately when a deployment fails and removes the temporary bundles', () => {
    let deployCalls = 0;
    const runCommand = vi.fn((command) => {
      if (command === 'deno') return { status: 0 };
      deployCalls += 1;
      return { status: deployCalls === 2 ? 1 : 0 };
    });
    const removeBundleDirectory = vi.fn();

    expect(() =>
      deployInsforgeFunctions({
        projectRoot,
        runCommand,
        createBundleDirectory: () => '/tmp/inboxpilot-test-bundles',
        removeBundleDirectory,
      }),
    ).toThrow(/email-status/);
    expect(runCommand).toHaveBeenCalledTimes(FUNCTION_DEPLOYMENTS.length + 2);
    expect(removeBundleDirectory).toHaveBeenCalledWith('/tmp/inboxpilot-test-bundles');
  });

  it('deploys nothing when any bundle preflight fails and still cleans up', () => {
    let bundleCalls = 0;
    const runCommand = vi.fn((command) => {
      if (command === 'npx') throw new Error('deployment must not start');
      bundleCalls += 1;
      return { status: bundleCalls === 3 ? 1 : 0 };
    });
    const removeBundleDirectory = vi.fn();

    expect(() =>
      deployInsforgeFunctions({
        projectRoot,
        runCommand,
        createBundleDirectory: () => '/tmp/inboxpilot-test-bundles',
        removeBundleDirectory,
      }),
    ).toThrow(/Failed to bundle process-jobs/);
    expect(runCommand).toHaveBeenCalledTimes(3);
    expect(runCommand.mock.calls.every(([command]) => command === 'deno')).toBe(true);
    expect(removeBundleDirectory).toHaveBeenCalledWith('/tmp/inboxpilot-test-bundles');
  });
});
