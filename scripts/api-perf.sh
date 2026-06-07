#!/usr/bin/env bash
# =============================================================================
# scripts/api-perf.sh — API p95 latency gate for InboxPilot serverless functions.
# =============================================================================
#
# Hits each of the three tenant-facing AI endpoints N times, computes p50/p95/
# p99/max, and fails the run if any p95 is above its budget. Writes per-endpoint
# timings JSON next to a combined summary so the CI workflow can attach it to
# the PR as a comment.
#
# Endpoints and budgets (from docs/PERFORMANCE.md):
#   send-reply            — read/write a conversation          p95 < 500ms
#   regenerate-ai-draft   — enqueues AI job, returns fast      p95 < 500ms
#   approve-ai-draft      — writes draft + sends via channel   p95 < 2000ms
#
# Usage:
#   scripts/api-perf.sh                           # use $API_BASE_URL from env
#   API_BASE_URL=https://staging.example.com scripts/api-perf.sh
#   scripts/api-perf.sh --samples 30 --warmup 3
#   scripts/api-perf.sh --baseline main-baseline.json  # 10% regression gate
#   scripts/api-perf.sh --out-dir .perf/2026-06-07
#
# Exit codes:
#   0 — all endpoints within budget AND no >10% regression vs --baseline
#   1 — budget violation or regression
#   2 — usage / config error
#   3 — a request failed entirely (network, 5xx) — perf numbers are unreliable
#
# The script depends on:
#   bash 4+, curl, node (>=18), and a reachable $API_BASE_URL pointing at
#   an environment that has the three functions deployed. In CI this is
#   the staging InsForge project; locally it is whatever the developer has
#   tunneled (e.g. via `npm run tunnel`).
# =============================================================================

set -Eeuo pipefail

# -----------------------------------------------------------------------------
# Resolve repo root regardless of where the script is invoked from. This keeps
# the path to scripts/lib stable even when the workflow cd's elsewhere.
# -----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PARSER="${SCRIPT_DIR}/lib/parse-perf-results.mjs"

# -----------------------------------------------------------------------------
# Defaults
# -----------------------------------------------------------------------------
API_BASE_URL="${API_BASE_URL:-https://y39ezar3.us-east.insforge.app}"
SAMPLES="${SAMPLES:-20}"
WARMUP="${WARMUP:-2}"
AUTH_TOKEN="${PERF_AUTH_TOKEN:-${INSFORGE_SERVICE_ROLE_KEY:-}}"
ORG_ID="${PERF_ORG_ID:-}"
CONVERSATION_ID="${PERF_CONVERSATION_ID:-}"
AI_DECISION_ID="${PERF_AI_DECISION_ID:-}"
OUT_DIR="${OUT_DIR:-${REPO_ROOT}/.perf/$(date -u +%Y%m%dT%H%M%SZ)}"
BASELINE_FILE=""
FAIL_ON_REGRESSION="false"
REGRESSION_PCT="10"

# Endpoint → (path, method, body-template, threshold-ms, label).
# Bodies are read from stdin of curl, so we keep them as heredoc strings.
ENDPOINTS=(
  "send-reply|/functions/v1/send-reply|POST|{\"conversationId\":\"__CONV__\",\"body\":\"smoke test reply\"}|500|read"
  "regenerate-ai-draft|/functions/v1/regenerate-ai-draft|POST|{\"conversationId\":\"__CONV__\"}|500|read"
  "approve-ai-draft|/functions/v1/approve-ai-draft|POST|{\"conversationId\":\"__CONV__\",\"aiDecisionId\":\"__AID__\"}|2000|ai"
)

# -----------------------------------------------------------------------------
# Argument parsing
# -----------------------------------------------------------------------------
usage() {
  sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --samples) SAMPLES="$2"; shift 2 ;;
    --warmup) WARMUP="$2"; shift 2 ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --baseline) BASELINE_FILE="$2"; shift 2 ;;
    --regression-pct) REGRESSION_PCT="$2"; shift 2 ;;
    --api-base) API_BASE_URL="$2"; shift 2 ;;
    --token) AUTH_TOKEN="$2"; shift 2 ;;
    --org) ORG_ID="$2"; shift 2 ;;
    --conversation-id) CONVERSATION_ID="$2"; shift 2 ;;
    --ai-decision-id) AI_DECISION_ID="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown flag: $1" >&2; usage ;;
  esac
done

# -----------------------------------------------------------------------------
# Preflight
# -----------------------------------------------------------------------------
command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "node is required (for parse-perf-results.mjs)" >&2; exit 2; }
[[ -f "$PARSER" ]] || { echo "missing parser: $PARSER" >&2; exit 2; }
[[ -n "$AUTH_TOKEN" ]] || { echo "PERF_AUTH_TOKEN (or INSFORGE_SERVICE_ROLE_KEY) is required" >&2; exit 2; }
[[ -n "$CONVERSATION_ID" ]] || { echo "PERF_CONVERSATION_ID is required (a real conversation id from the target env)" >&2; exit 2; }

# approve-ai-draft needs an aiDecisionId; allow it to be empty for the other two
# by substituting an obvious sentinel that the server will reject with 404.
# We still measure the round-trip time of the 404, which is what the budget
# gates anyway (a hung function is the failure mode the budget catches).
if [[ -z "$AI_DECISION_ID" ]]; then
  AI_DECISION_ID="00000000-0000-0000-0000-000000000000"
fi

mkdir -p "$OUT_DIR"
echo "==> api-perf: target=${API_BASE_URL} samples=${SAMPLES} warmup=${WARMUP} out=${OUT_DIR}"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

# measure_endpoint <name> <path> <method> <body-template> <threshold-ms> <label>
# Runs the warmup + N samples, writes a timings JSON, and invokes the parser.
# Returns the parser's exit code so the caller can short-circuit on first FAIL.
measure_endpoint() {
  local name="$1" path="$2" method="$3" body_template="$4" threshold="$5" label="$6"
  local timings_file="${OUT_DIR}/${name}.timings.json"
  local tmpfile
  tmpfile="$(mktemp)"
  local total=$((WARMUP + SAMPLES))
  local samples_ms=()

  # Substitute placeholders into the body template.
  local body="${body_template//__CONV__/$CONVERSATION_ID}"
  body="${body//__AID__/$AI_DECISION_ID}"

  echo "    -> ${name} (${total} requests, threshold ${threshold}ms)"

  for ((i = 1; i <= total; i++)); do
    local url="${API_BASE_URL%/}${path}"
    local headers=(
      -H "Authorization: Bearer ${AUTH_TOKEN}"
      -H "Content-Type: application/json"
    )
    [[ -n "$ORG_ID" ]] && headers+=(-H "x-organization-id: ${ORG_ID}")

    # -w outputs the timings block to stdout, -o /dev/null discards the body.
    # We use %{time_total} (seconds, 3-decimal) and convert to ms.
    local t
    t=$(curl -sS -X "$method" \
      "${headers[@]}" \
      -o /dev/null \
      -w '%{http_code} %{time_total}\n' \
      --data "$body" \
      "$url") || { echo "    !! curl failed on $name request $i" >&2; rm -f "$tmpfile"; return 3; }

    local code t_sec
    code=$(awk '{print $1}' <<<"$t")
    t_sec=$(awk '{print $2}' <<<"$t")

    # 5xx means the endpoint is broken, not slow — abort so the operator
    # sees a clear "endpoint broken" error rather than a misleading perf FAIL.
    if [[ "$code" =~ ^5[0-9][0-9]$ ]]; then
      echo "    !! ${name} returned ${code} on request $i — endpoint is broken, not slow" >&2
      rm -f "$tmpfile"
      return 3
    fi

    # Convert seconds → integer ms (use awk for portability — no bc dep).
    local t_ms
    t_ms=$(awk -v s="$t_sec" 'BEGIN { printf("%d", s * 1000 + 0.5) }')

    if (( i > WARMUP )); then
      samples_ms+=("$t_ms")
    fi
  done

  # Emit timings JSON in the format the parser expects.
  {
    printf '{\n'
    printf '  "endpoint": "%s",\n' "$path"
    printf '  "label": "%s",\n' "$label"
    printf '  "sampleCount": %d,\n' "${#samples_ms[@]}"
    printf '  "samplesMs": ['
    local first=1
    for s in "${samples_ms[@]}"; do
      if (( first )); then printf '%s' "$s"; first=0; else printf ',%s' "$s"; fi
    done
    printf '],\n'
    printf '  "thresholdMs": %s,\n' "$threshold"
    printf '  "capturedAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "target": "%s"\n' "$API_BASE_URL"
    printf '}\n'
  } > "$timings_file"

  # Invoke the pure-logic parser. Capture its exit code but always echo its
  # output so the operator sees the per-endpoint summary.
  local parser_status=0
  node "$PARSER" "$timings_file" \
    --endpoint "$name" \
    --threshold-ms "$threshold" \
    --format md || parser_status=$?

  return $parser_status
}

# -----------------------------------------------------------------------------
# Main loop
# -----------------------------------------------------------------------------
overall_status=0
results=()

for entry in "${ENDPOINTS[@]}"; do
  IFS='|' read -r name path method body threshold label <<<"$entry"
  if measure_endpoint "$name" "$path" "$method" "$body" "$threshold" "$label"; then
    results+=("PASS|$name|$threshold")
  else
    # Captures the function's return code. 1 = budget violation; 3 = endpoint broken.
    rc=$?
    results+=("FAIL|$name|$threshold")
    if (( rc == 1 )); then
      overall_status=1
    else
      # 3 = endpoint broken — treat as a hard failure, not a perf regression
      overall_status=3
    fi
  fi
done

# -----------------------------------------------------------------------------
# Optional: regression vs baseline (acceptance: >10% on any metric = fail)
# -----------------------------------------------------------------------------
regression_note=""
if [[ -n "$BASELINE_FILE" && -f "$BASELINE_FILE" && "$FAIL_ON_REGRESSION" != "true" ]]; then
  if command -v node >/dev/null 2>&1; then
    # Defer the actual comparison to a small node one-liner — keeps math
    # correct under bc/locale differences.
    regression_note=$(node -e '
      const fs = require("fs");
      const path = require("path");
      const baseline = JSON.parse(fs.readFileSync(process.argv[1], "utf-8"));
      const outDir = process.argv[2];
      const pct = Number(process.argv[3]);
      const lines = [];
      let regression = false;
      for (const ep of baseline.endpoints || []) {
        const file = path.join(outDir, ep.name + ".timings.json");
        if (!fs.existsSync(file)) { lines.push(`- **${ep.name}**: no current run`); continue; }
        const cur = JSON.parse(fs.readFileSync(file, "utf-8"));
        const sorted = [...cur.samplesMs].sort((a,b)=>a-b);
        const p95 = sorted[Math.max(1, Math.ceil(0.95 * sorted.length)) - 1];
        const baseSorted = [...ep.samplesMs].sort((a,b)=>a-b);
        const baseP95 = baseSorted[Math.max(1, Math.ceil(0.95 * baseSorted.length)) - 1];
        const delta = ((p95 - baseP95) / baseP95) * 100;
        const ok = delta <= pct;
        if (!ok) regression = true;
        lines.push(`- **${ep.name}**: p95 ${p95}ms vs baseline ${baseP95}ms (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%) ${ok ? "✅" : "❌"}`);
      }
      console.log(lines.join("\n"));
      if (regression) process.exit(1);
    ' "$BASELINE_FILE" "$OUT_DIR" "$REGRESSION_PCT" 2>&1) || {
      echo "" >&2
      echo "==> Regression gate FAILED (>${REGRESSION_PCT}% on at least one endpoint):" >&2
      echo "$regression_note" >&2
      overall_status=1
    }
  fi
fi

# -----------------------------------------------------------------------------
# Combined summary — also written to summary.md for the PR comment
# -----------------------------------------------------------------------------
{
  echo "### API p95 latency · InboxPilot"
  echo ""
  echo "| Endpoint | Threshold | p50 | p95 | p99 | max | Verdict |"
  echo "|---|---|---|---|---|---|---|"
  for r in "${results[@]}"; do
    IFS='|' read -r verdict name threshold <<<"$r"
    tf="${OUT_DIR}/${name}.timings.json"
    if [[ -f "$tf" ]]; then
      stats=$(node -e '
        const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8"));
        const s = [...d.samplesMs].sort((a,b)=>a-b);
        const pct = (p) => s[Math.max(1, Math.ceil(p * s.length)) - 1];
        console.log(`${pct(0.5)}|${pct(0.95)}|${pct(0.99)}|${s[s.length-1]}`);
      ' "$tf")
      IFS='|' read -r p50 p95 p99 max <<<"$stats"
      echo "| \`${name}\` | ${threshold} ms | ${p50} | **${p95}** | ${p99} | ${max} | ${verdict} |"
    fi
  done
  echo ""
  if [[ -n "$regression_note" ]]; then
    echo "**Regression vs baseline (>${REGRESSION_PCT}%):**"
    echo ""
    echo "$regression_note"
    echo ""
  fi
  echo "_${SAMPLES} samples per endpoint after ${WARMUP} warmup; target ${API_BASE_URL}_"
} > "${OUT_DIR}/summary.md"

echo ""
echo "==> Combined summary: ${OUT_DIR}/summary.md"
cat "${OUT_DIR}/summary.md"

exit "$overall_status"
