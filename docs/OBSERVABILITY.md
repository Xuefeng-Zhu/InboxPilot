# Observability

How `insforge/functions/*` entrypoints emit logs, what the shape is, and how
operators (and support) query them when triaging a customer report.

## TL;DR

- **Every function entrypoint** wraps its body in `withRequest(ctx, ...)` and
  emits one JSON object per line on stdout.
- **The log destination is stdout.** The InsForge platform captures stdout
  and exposes it through the `function.logs` endpoint. No extra HTTP sink,
  no extra cost, no extra failure mode.
- **The shape is flat** — every event is a top-level object with
  `timestamp`, `level`, `function_name`, `request_id`, and (when known)
  `org_id`, `user_id`, `duration_ms`, `status`, plus any caller-supplied
  fields. Flat means `.org_id == "..."` JSON filters work without
  `data->>org_id` ceremony.
- **Two acceptance queries are first-class:** filter by `org_id` to see one
  tenant's events; filter by `request_id` to see one request's full
  lifecycle (start → middle events → end/error).

## The logger

`insforge/functions/_shared/logger.ts` is the only thing function entrypoints
should call. It exports:

| Symbol | Purpose |
|---|---|
| `log(event: LogEvent)` | Emit one structured JSON line. Always sync, allocation-light. |
| `logError(ctx, err, extra)` | Convenience: emit a `level: 'error'` event with the canonical error shape. |
| `newRequestContext(functionName, req?)` | Build a `RequestContext` with a fresh `request_id` (UUID) or one inherited from the inbound `x-request-id` header. |
| `withRequest(ctx, body)` | Wrap a function body so `start`, `end`, and `function error` events are emitted automatically, with `duration_ms` and a final `status`. |
| `withRequestIdHeader(ctx, response)` | Stamp the `x-request-id` response header so a customer can paste it into a support ticket. |
| `LEVEL_ORDER` | Numeric priority of each level, for tests and filters. |
| `setMinLevel(level)` | Override the level filter (test seam). |
| `setLogSink(sink)` | Swap the output sink (test seam; production writes to `console.*`). |

### LogEvent shape

```ts
type LogEvent = {
  level?: 'debug' | 'info' | 'warn' | 'error';  // default: 'info'
  msg?: string;                                  // human-readable summary
  function_name: string;                         // e.g. 'send-reply'
  request_id: string;                            // UUID-shaped, propagated
  org_id?: string;                               // when known
  user_id?: string;                              // when known
  duration_ms?: number;                          // end events only
  status?: 'running' | 'ok' | 'error' | string;  // outcome
  [extra: string]: unknown;                      // caller-supplied fields
};
```

Every line written by `log()` is `JSON.stringify({ timestamp, level, ...rest })`
where `timestamp` is an ISO-8601 string. There is never string concatenation
— every line is exactly one JSON object.

### Level filter

Set `LOG_LEVEL=debug` in the function env to lower the threshold; the default
is `info`. The filter is process-global and read once per call (so changing it
in the env of a running function takes effect on the next event).

```bash
# Suppress info and below; keep warn/error.
LOG_LEVEL=warn npx @insforge/cli deploy ...
```

## Log destination: why stdout

Two reasonable options were considered:

- **(a) InsForge's own `function.logs` endpoint** (chosen) — Stdout is
  captured by the platform and exposed via the `function.logs` API. No
  extra HTTP, no extra cost, no extra failure mode. Verified via
  `npx @insforge/cli logs function.logs`.
- **(b) A separate log sink (Axiom / Logtail / CloudWatch)** via `fetch` —
  more power (long retention, advanced query), but adds a synchronous
  outbound HTTP call to every request hot path, a new failure mode (the
  sink going down = silent lost logs or a 5xx on the user request),
  and a per-GB cost line.

We chose (a) for v1. The structured JSON shape is sink-agnostic, so a
follow-up task can add an async-forwarder (fire-and-forget) without
changing call sites. If the team later needs >7 day retention or
cross-function SQL joins over logs, the migration path is:

1. Add a `forwardsTo?: 'axiom' | 'logtail'` env var.
2. Install a sidecar / forwarder in the function container.
3. The logger's sink interface already supports it; the default sink
   just becomes a tee.

## Querying

The two acceptance criteria are both single-field filters on the
captured stdout:

### Per-tenant query

> "Show me everything for `org_42` this morning."

```
filter: org_id = "org_42"
```

The function entrypoint writes `org_id` as a top-level field on every
event where the tenant is known (after JWT verify and `requireOrgMembership`,
or after the `sms_phone_numbers` lookup for inbound webhooks). Auth-fail
events and pre-tenant events have no `org_id` and are filtered out by
the query — which is what you want when triaging "tenant X reports a
problem".

### Per-request lifecycle

> "Customer pasted `req_abc123` from a support ticket. What happened?"

```
filter: request_id = "req_abc123"
```

Every event in the request lifecycle — `start`, intermediate domain
events, `end` / `function error` — carries the same `request_id`, so
one filter returns the full sequence. The id is also returned to the
caller in the `x-request-id` response header (via `withRequestIdHeader`)
so a customer doesn't have to dig through devtools to find it.

## Migrating a new function entrypoint

Two steps, plus a 30-second convention:

1. **Wrap the body in `withRequest`.** Replace the outermost `try { ... }
   catch (err) { return 500; }` with:

   ```ts
   const ctx = newRequestContext('function-name', req);
   return withRequest(ctx, async () => {
     // ... existing body
   });
   ```

2. **Replace `console.error(...)` with `logError(ctx, err, { ... })`.**
   The wrapper re-throws so the existing `catch` (now inside the body)
   can still shape the HTTP response, but the structured error event
   is already in the log stream by then.

3. **Set `ctx.org_id` / `ctx.user_id` as soon as they're known.** The
   `withRequest` wrapper spreads the final `ctx` onto the `end` event,
   so a late-learned `org_id` will still appear on `end`. The `start`
   event is emitted before the body runs and won't have it; that's
   expected and matches the "we don't know the tenant yet" reality.

Example migration: see `insforge/functions/send-reply/index.ts`.

## Testing

`__tests__/structured-logger.test.ts` (21 cases) pins:

- the JSON shape (timestamp, level, function_name, request_id, all
  caller fields, ISO-8601 timestamp),
- the per-level sink routing,
- the level filter (default `info` suppresses `debug`; `LOG_LEVEL`
  override; per-test seam),
- the error serializer (`Error` → `{name, message, stack}`; non-Error
  → `NonError` + `JSON.stringify`),
- the `newRequestContext` helper (UUID shape, inbound header, length
  cap, uniqueness),
- the per-tenant and per-request query shapes (top-level fields),
- the `withRequest` lifecycle (start/end, duration, re-throw on error,
  `ctx` mutation is preserved),
- the `withRequestIdHeader` response stamping.

Run:

```bash
npm test -- structured-logger
```

## Operator runbook

When triaging from a customer report:

1. Ask for the `x-request-id` value from the response headers (or
   `curl -i` to capture it). The format is `req_<ts>_<rand>` or a UUID.
2. `npx @insforge/cli logs function.logs --filter "request_id=<id>"`
   returns the full lifecycle in order.
3. If no request id, fall back to `org_id`:
   `--filter "org_id=<tenant> AND timestamp > now-1h"`.
4. If neither, escalate via the support playbook in
   `docs/SUPPORT_PLAYBOOK.md` — the operator can query the raw stdout
   for the timestamp window.

## Future work (not in v1)

- **Async forwarder** to Axiom / Logtail (sink interface already
  supports it; only the default sink changes).
- **Per-tenant rate limit / quota events** (`level: 'warn'`,
  `status: 'rate_limited'`) — easy to add at the call site.
- **Sampling** at `debug` level for high-volume endpoints (the filter
  hook is already there; just needs a `sample_rate` config).
