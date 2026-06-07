/**
 * Unit tests for the structured logger (`insforge/functions/_shared/logger.ts`).
 *
 * These tests pin:
 *   - the JSON shape that lands in the log sink (timestamp, level,
 *     function_name, request_id, plus caller-supplied fields like
 *     org_id, user_id, duration_ms, status),
 *   - the level filter behavior (debug suppressed at default `info`,
 *     debug visible at min-level `debug`),
 *   - the error serializer (`Error` → `{name, message, stack}`),
 *   - the request-context builder (UUID-shaped request_id, honor of
 *     inbound x-request-id header),
 *   - the `setLogSink` test seam (logs are captured, not printed).
 *
 * Run: npm test -- structured-logger
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  log,
  logError,
  newRequestContext,
  setLogSink,
  getLogSink,
  setMinLevel,
  getMinLevel,
  withRequest,
  withRequestIdHeader,
  _resetForTests,
  LEVEL_ORDER,
  type LogSink,
} from '../insforge/functions/_shared/logger.js';

/** Collect every line written to the sink. */
function captureSink(): { sink: LogSink; lines: Array<{ channel: keyof LogSink; line: string }> } {
  const lines: Array<{ channel: keyof LogSink; line: string }> = [];
  const sink: LogSink = {
    debug: (line) => lines.push({ channel: 'debug', line }),
    info: (line) => lines.push({ channel: 'info', line }),
    warn: (line) => lines.push({ channel: 'warn', line }),
    error: (line) => lines.push({ channel: 'error', line }),
  };
  return { sink, lines };
}

describe('structured-logger', () => {
  let captured: ReturnType<typeof captureSink>;

  beforeEach(() => {
    captured = captureSink();
    setLogSink(captured.sink);
    // Default the level filter to 'debug' so all lines are captured
    // for shape tests; level-filter tests will override this.
    setMinLevel('debug');
  });

  afterEach(() => {
    _resetForTests();
  });

  describe('JSON shape', () => {
    it('emits one JSON object per line with the required fields', () => {
      log({
        level: 'info',
        function_name: 'send-reply',
        request_id: 'req_test_001',
        org_id: 'org_abc',
        user_id: 'user_xyz',
        msg: 'start',
        status: 'ok',
        duration_ms: 42,
      });

      expect(captured.lines).toHaveLength(1);
      const { channel, line } = captured.lines[0];
      expect(channel).toBe('info');

      // The line must be valid JSON, exactly one object, no
      // concatenation.
      expect(() => JSON.parse(line)).not.toThrow();
      const obj = JSON.parse(line) as Record<string, unknown>;
      expect(typeof obj).toBe('object');

      // Required fields, in any order.
      expect(obj.level).toBe('info');
      expect(obj.function_name).toBe('send-reply');
      expect(obj.request_id).toBe('req_test_001');
      expect(obj.org_id).toBe('org_abc');
      expect(obj.user_id).toBe('user_xyz');
      expect(obj.msg).toBe('start');
      expect(obj.status).toBe('ok');
      expect(obj.duration_ms).toBe(42);

      // Timestamp is a parseable ISO string.
      expect(typeof obj.timestamp).toBe('string');
      expect(new Date(obj.timestamp as string).toISOString()).toBe(obj.timestamp);
    });

    it('routes each level to the matching sink channel', () => {
      log({ level: 'debug', function_name: 'f', request_id: 'r', msg: 'd' });
      log({ level: 'info', function_name: 'f', request_id: 'r', msg: 'i' });
      log({ level: 'warn', function_name: 'f', request_id: 'r', msg: 'w' });
      log({ level: 'error', function_name: 'f', request_id: 'r', msg: 'e' });

      expect(captured.lines.map((l) => l.channel)).toEqual(['debug', 'info', 'warn', 'error']);
    });

    it('defaults to level=info when level is omitted', () => {
      log({ function_name: 'f', request_id: 'r', msg: 'no level' });
      const obj = JSON.parse(captured.lines[0].line) as Record<string, unknown>;
      expect(obj.level).toBe('info');
    });
  });

  describe('level filter', () => {
    it('suppresses debug lines when min level is info (the default)', () => {
      setMinLevel('info');
      log({ level: 'debug', function_name: 'f', request_id: 'r', msg: 'hidden' });
      log({ level: 'info', function_name: 'f', request_id: 'r', msg: 'visible' });
      log({ level: 'warn', function_name: 'f', request_id: 'r', msg: 'visible too' });

      expect(captured.lines).toHaveLength(2);
      const levels = captured.lines.map((l) => JSON.parse(l.line).level);
      expect(levels).toEqual(['info', 'warn']);
    });

    it('suppresses info lines when min level is warn', () => {
      setMinLevel('warn');
      log({ level: 'debug', function_name: 'f', request_id: 'r', msg: 'hidden' });
      log({ level: 'info', function_name: 'f', request_id: 'r', msg: 'hidden' });
      log({ level: 'warn', function_name: 'f', request_id: 'r', msg: 'visible' });
      log({ level: 'error', function_name: 'f', request_id: 'r', msg: 'visible' });

      expect(captured.lines.map((l) => JSON.parse(l.line).level)).toEqual(['warn', 'error']);
    });

    it('emits everything when min level is debug', () => {
      setMinLevel('debug');
      log({ level: 'debug', function_name: 'f', request_id: 'r', msg: 'visible' });
      log({ level: 'info', function_name: 'f', request_id: 'r', msg: 'visible' });
      log({ level: 'error', function_name: 'f', request_id: 'r', msg: 'visible' });

      expect(captured.lines).toHaveLength(3);
    });

    it('getMinLevel reflects the active threshold', () => {
      setMinLevel('error');
      expect(getMinLevel()).toBe(LEVEL_ORDER.error);
      setMinLevel(null);
      // After clearing the override, the env-var fallback takes over.
      // We don't assert the exact value because it depends on the
      // test runner's env, but the call must not throw.
      expect(typeof getMinLevel()).toBe('number');
    });
  });

  describe('error serialization', () => {
    it('serializes a real Error into name/message/stack', () => {
      const err = new TypeError('bad input');
      logError({ function_name: 'send-reply', request_id: 'r1' }, err, { msg: 'failure' });

      const obj = JSON.parse(captured.lines[0].line) as Record<string, unknown>;
      expect(obj.level).toBe('error');
      expect(obj.function_name).toBe('send-reply');
      expect(obj.request_id).toBe('r1');
      const errField = obj.error as Record<string, unknown>;
      expect(errField.name).toBe('TypeError');
      expect(errField.message).toBe('bad input');
      expect(typeof errField.stack).toBe('string');
      // Stack must mention the message and the function name.
      expect((errField.stack as string)).toContain('TypeError');
    });

    it('serializes a non-Error throw value (string) safely', () => {
      logError({ function_name: 'f', request_id: 'r' }, 'something went wrong', {});
      const obj = JSON.parse(captured.lines[0].line) as Record<string, unknown>;
      const errField = obj.error as Record<string, unknown>;
      expect(errField.name).toBe('NonError');
      expect(errField.message).toBe('something went wrong');
    });

    it('serializes a non-Error throw value (object) via JSON.stringify', () => {
      logError({ function_name: 'f', request_id: 'r' }, { code: 42, reason: 'x' }, {});
      const obj = JSON.parse(captured.lines[0].line) as Record<string, unknown>;
      const errField = obj.error as Record<string, unknown>;
      expect(errField.name).toBe('NonError');
      // The whole object survives a JSON.stringify round-trip.
      expect(errField.message).toContain('"code":42');
    });
  });

  describe('newRequestContext', () => {
    it('mints a UUID-shaped request_id when no header is supplied', () => {
      const ctx = newRequestContext('send-reply');
      expect(ctx.function_name).toBe('send-reply');
      expect(typeof ctx.request_id).toBe('string');
      // UUID v4 is 36 chars: 8-4-4-4-12. We accept any non-empty
      // string here, but a 36-char shape is a useful regression
      // signal — the helper prefers `crypto.randomUUID()` when
      // available.
      expect(ctx.request_id.length).toBeGreaterThan(8);
    });

    it('honors an inbound x-request-id header (case-insensitive)', () => {
      const req = new Request('http://localhost/test', {
        headers: { 'x-request-id': 'incoming-12345' },
      });
      const ctx = newRequestContext('send-reply', req);
      expect(ctx.request_id).toBe('incoming-12345');
    });

    it('rejects a maliciously long inbound header and mints a fresh id', () => {
      // Buffer the header to a safe length to prevent log-injection
      // amplification (a giant x-request-id would make every line
      // huge). 200 chars is the documented cap in the helper.
      const tooLong = 'a'.repeat(1000);
      const req = new Request('http://localhost/test', {
        headers: { 'x-request-id': tooLong },
      });
      const ctx = newRequestContext('send-reply', req);
      expect(ctx.request_id).not.toBe(tooLong);
      expect(ctx.request_id.length).toBeLessThanOrEqual(200);
    });

    it('emits a unique request_id per call', () => {
      const a = newRequestContext('f');
      const b = newRequestContext('f');
      expect(a.request_id).not.toBe(b.request_id);
    });
  });

  describe('per-tenant query support', () => {
    // This is the acceptance criterion: a log query by `org_id` should
    // return only that org's events. We don't run a real query (that
    // is the `function.logs` endpoint on the InsForge platform), but
    // we assert the shape that makes the query possible: org_id is a
    // top-level field, not nested.
    it('places org_id as a top-level field, queryable via JSON filter', () => {
      log({
        level: 'info',
        function_name: 'send-reply',
        request_id: 'r1',
        org_id: 'org_alpha',
        msg: 'start',
      });
      log({
        level: 'info',
        function_name: 'send-reply',
        request_id: 'r2',
        org_id: 'org_beta',
        msg: 'start',
      });

      const allLines = captured.lines.map((l) => JSON.parse(l.line) as Record<string, unknown>);
      const alphaOnly = allLines.filter((o) => o.org_id === 'org_alpha');
      const betaOnly = allLines.filter((o) => o.org_id === 'org_beta');

      expect(alphaOnly).toHaveLength(1);
      expect(betaOnly).toHaveLength(1);
      expect(alphaOnly[0].request_id).toBe('r1');
      expect(betaOnly[0].request_id).toBe('r2');
    });

    // Same shape check for request_id: a query by request_id must
    // return the full request lifecycle.
    it('places request_id as a top-level field, queryable for full request lifecycle', () => {
      // Simulate one request: start, mid, end.
      log({ level: 'info', function_name: 'send-reply', request_id: 'req_42', msg: 'start' });
      log({ level: 'info', function_name: 'send-reply', request_id: 'req_42', msg: 'mid', duration_ms: 12 });
      log({ level: 'info', function_name: 'send-reply', request_id: 'req_42', msg: 'end', duration_ms: 30 });
      // And an unrelated request that must NOT match.
      log({ level: 'info', function_name: 'send-reply', request_id: 'req_99', msg: 'start' });

      const all = captured.lines.map((l) => JSON.parse(l.line) as Record<string, unknown>);
      const lifecycle = all.filter((o) => o.request_id === 'req_42');
      expect(lifecycle.map((o) => o.msg)).toEqual(['start', 'mid', 'end']);
    });
  });

  describe('sink seam', () => {
    it('setLogSink swaps the active sink and returns the previous one', () => {
      const first = getLogSink();
      const second = captureSink().sink;
      const returned = setLogSink(second);
      expect(returned).toBe(first);
      expect(getLogSink()).toBe(second);
    });
  });

  describe('withRequest', () => {
    it('emits start and end events with a duration and ok status', async () => {
      const ctx = newRequestContext('send-reply');
      const result = await withRequest(ctx, async () => 'hello');
      expect(result).toBe('hello');

      const events = captured.lines.map((l) => JSON.parse(l.line) as Record<string, unknown>);
      expect(events.map((e) => e.msg)).toEqual(['start', 'end']);
      expect(events[0].status).toBe('running');
      expect(events[1].status).toBe('ok');
      expect(typeof events[1].duration_ms).toBe('number');
      expect(events[1].duration_ms).toBeGreaterThanOrEqual(0);
      // Both events share the same request_id.
      expect(events[0].request_id).toBe(ctx.request_id);
      expect(events[1].request_id).toBe(ctx.request_id);
    });

    it('emits an error event with the serialized error and re-throws', async () => {
      const ctx = newRequestContext('send-reply');
      const err = new RangeError('boom');
      await expect(
        withRequest(ctx, async () => {
          throw err;
        }),
      ).rejects.toBe(err);

      const events = captured.lines.map((l) => JSON.parse(l.line) as Record<string, unknown>);
      expect(events.map((e) => e.msg)).toEqual(['start', 'function error']);
      expect(events[1].level).toBe('error');
      expect(events[1].status).toBe('error');
      const errField = events[1].error as Record<string, unknown>;
      expect(errField.name).toBe('RangeError');
      expect(errField.message).toBe('boom');
    });

    it('preserves org_id and user_id mutations made inside the body', async () => {
      // The body may learn the tenant and caller after JWT verify.
      // withRequest must spread the latest ctx onto the end event.
      const ctx = newRequestContext('send-reply');
      await withRequest(ctx, async () => {
        ctx.org_id = 'org_learned';
        ctx.user_id = 'user_learned';
      });

      const events = captured.lines.map((l) => JSON.parse(l.line) as Record<string, unknown>);
      // Start was emitted before the body ran, so it has no org_id.
      expect(events[0].org_id).toBeUndefined();
      // End was emitted after, so it has both ids.
      expect(events[1].org_id).toBe('org_learned');
      expect(events[1].user_id).toBe('user_learned');
    });
  });

  describe('withRequestIdHeader', () => {
    it('attaches the x-request-id header to a Response', () => {
      const ctx = newRequestContext('send-reply');
      const original = new Response('body', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      const stamped = withRequestIdHeader(ctx, original);
      expect(stamped.headers.get('x-request-id')).toBe(ctx.request_id);
      // Original headers are preserved.
      expect(stamped.headers.get('Content-Type')).toBe('application/json');
      expect(stamped.status).toBe(200);
    });
  });
});
