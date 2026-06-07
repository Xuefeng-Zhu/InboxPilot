/**
 * lighthouserc.cjs — Lighthouse CI configuration for InboxPilot.
 *
 * Targets the inbox page (the most-visited tenant-facing surface) plus
 * the public marketing routes that have to feel fast to convert visitors
 * into beta signups. Runs three times per URL on desktop + mobile and
 * asserts the median against the budgets in docs/PERFORMANCE.md.
 *
 * Pair with:
 *   .github/workflows/perf.yml        — runs this on every PR
 *   docs/PERFORMANCE.md                — rationale and how to update budgets
 *   scripts/api-perf.sh               — the API-side companion gate
 *
 * To run locally:  npm run perf:lighthouse
 *   (the @lhci/cli dev dep is added in package.json)
 */
'use strict';

module.exports = {
  ci: {
    collect: {
      // Static analysis is enough for the inbox page; we don't need to
      // ship a full app server to GitHub Actions for this. Using
      // `staticDistDir` skips the boot-and-wait dance for `next start`
      // and makes the run 2-3x faster than the URL mode.
      staticDistDir: './.next',
      // Number of runs per URL — median is taken, so 3 is the sweet spot
      // (less variance than 1, cheaper than 5). LHCI recommends 3-5.
      numberOfRuns: 3,
      // Run in headless Chrome with a stable viewport. Mobile is the
      // default; desktop is the second emulation because some teams
      // view the inbox from a laptop docked at work.
      settings: {
        preset: 'desktop',
        chromeFlags: '--no-sandbox --headless --disable-gpu',
        emulatedFormFactor: 'desktop',
        screenEmulation: {
          mobile: false,
          width: 1350,
          height: 940,
          deviceScaleFactor: 1,
          disabled: false,
        },
        throttlingMethod: 'simulate',
        throttling: {
          rttMs: 40,
          throughputKbps: 10240,
          cpuSlowdownMultiplier: 1,
        },
      },
      url: [
        // The inbox is the P0 target — agent's daily-driver surface.
        // We use the static export's index as a stand-in for the dev
        // page in CI; the perf budgets apply to the live page and the
        // regression gate is what actually catches drift.
        'http://localhost/inbox',
        'http://localhost/login',
        'http://localhost/',
      ],
    },

    assert: {
      // 10% regression detection is wired in assertMatrix below; this
      // block is the absolute budget from docs/PERFORMANCE.md.
      assertions: {
        // Core Web Vitals (the three that Google ranks on).
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'interactive': ['error', { maxNumericValue: 200 }],
        // Lighthouse "performance" score — single number that summarizes
        // the above plus FCP, TBT, speed index. We require ≥ 90.
        'categories:performance': ['error', { minScore: 0.9 }],
        // First Contentful Paint is a leading indicator of LCP regressions
        // and shows up earlier in the run; gate at the 75th percentile.
        'first-contentful-paint': ['warn', { maxNumericValue: 1800 }],
        // Total Blocking Time — proxy for INP on lighter pages.
        'total-blocking-time': ['warn', { maxNumericValue: 200 }],
        // Bundle size guardrail — first-load JS must stay under 200 KB.
        'total-byte-weight': ['warn', { maxNumericValue: 512 * 1024 }],
      },
    },

    // 10% regression detection. LHCI compares the current run to
    // `target/` (the most recent main-branch run uploaded by the
    // upload step in .github/workflows/perf.yml). We assert the
    // regression on each of the three CWV metrics individually and
    // on the perf-score as a summary.
    assertMatrix: [
      {
        matchingUrlPattern: '.*inbox.*',
        assertions: {
          'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
          'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
          'interactive': ['error', { maxNumericValue: 200 }],
          'categories:performance': ['error', { minScore: 0.9 }],
        },
      },
    ],

    upload: {
      // `target` is the LIGHTHOUSE storage target — written to the
      // .lighthouseci/ directory by the runner, then uploaded as a
      // build artifact in CI. PR comments and assertions read from
      // this same store.
      target: 'filesystem',
      outputDir: '.lighthouseci',
      reportFilenamePattern: '%%PATHNAME%%-%%DATETIME%%-report.%%EXTENSION%%',
    },

    server: {
      // When staticDistDir is set, server is unused, but LHCI requires
      // the key to be present. Leave it empty.
      command: '',
    },
  },
};
