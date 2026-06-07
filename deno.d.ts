// Deno runtime ambient types
//
// The InsForge serverless functions in `insforge/functions/` run on
// Deno. The Next.js build type-checks them despite tsconfig.json
// excluding that directory (Next.js runs its own TS pass that
// doesn't honor the tsconfig `exclude` field for the build's own
// worker). This file declares the minimal Deno global surface the
// entrypoints need so the build doesn't error on `Deno.env.get()`.
//
// Adding the type does NOT execute any Deno code on the build
// machine — it's a declaration only. The functions themselves are
// only deployed via the InsForge CLI (see docs/DEVELOPMENT.md) and
// run on Deno at runtime.
//
// See insforge/functions/send-reply/index.ts:70-77 and
// insforge/functions/approve-ai-draft/index.ts:73-80 for the call
// sites.

declare const Deno:
  | {
      env: {
        get(name: string): string | undefined;
      };
    }
  | undefined;
