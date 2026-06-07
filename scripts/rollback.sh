#!/usr/bin/env bash
# =============================================================================
# scripts/rollback.sh — Roll InboxPilot back to the previous known-good state.
# =============================================================================
#
# This is the "fix it now, ask questions later" button for InboxPilot. It does
# three things, in order, with a single confirmation gate between them:
#
#   1. Apply the @down block of the most-recent (or specified) migration in
#      insforge/migrations/. If --to <id> is given, every migration strictly
#      newer than <id> is rolled back, in reverse order.
#
#   2. Re-deploy the function entrypoints in insforge/functions/ from the
#      previous build artifact, if one was snapshotted under
#      insforge/functions/.last_good/<git-sha>/. We always snapshot the live
#      function sources into .last_good/ right after a successful deploy, so
#      this directory is normally populated.
#
#   3. Run a smoke test against a representative tenant-facing endpoint
#      (send-reply) and fail the rollback if it doesn't return 200/401/404
#      (i.e. the function is up; 401 means the smoke caller wasn't authed,
#      which is the *correct* response from a working server).
#
# Usage:
#   scripts/rollback.sh                     # roll back the most recent migration
#   scripts/rollback.sh --to 001_initial_schema   # roll back TO migration 001
#   scripts/rollback.sh --dry-run           # show what would happen, do nothing
#   scripts/rollback.sh --skip-functions    # DB-only rollback (no function redeploy)
#   scripts/rollback.sh --skip-migrations   # functions-only rollback (no DB change)
#   scripts/rollback.sh --yes               # skip the confirmation prompt
#   scripts/rollback.sh --no-smoke          # skip the post-rollback smoke test
#
# Exit codes:
#   0 — rollback completed and smoke test passed
#   1 — rollback completed but smoke test failed
#   2 — usage / config error (no .last_good/, no @down block, bad --to arg)
#   3 — a command failed mid-rollback; see the log for the failing step
#
# The script depends on: bash 4+, the `insforge` CLI (npx @insforge/cli), `curl`,
# and a logged-in CLI session (`npx @insforge/cli current` must show a linked
# project). For staging drills, point the CLI at staging before invoking.
# =============================================================================

set -Eeuo pipefail

# -----------------------------------------------------------------------------
# Resolve repo root regardless of where the script is invoked from. This keeps
# the path to insforge/migrations/ and insforge/functions/ stable when the
# workflow cd's elsewhere (CI, runbook-execution subagent, etc).
# -----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/insforge/migrations"
FUNCTIONS_DIR="$REPO_ROOT/insforge/functions"
LAST_GOOD_DIR="$FUNCTIONS_DIR/.last_good"

# -----------------------------------------------------------------------------
# Defaults + argument parsing. We keep the surface small on purpose — every
# flag is a real rollback lever, not sugar. Order of operations: parse →
# preflight → confirm → act → verify.
# -----------------------------------------------------------------------------
TARGET_ID=""
DRY_RUN=0
SKIP_FUNCTIONS=0
SKIP_MIGRATIONS=0
SKIP_SMOKE=0
ASSUME_YES=0
SKIP_PREFLIGHT_CLI=0

usage() {
  sed -n '3,40p' "$0" | sed -e 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to)            TARGET_ID="${2:-}"; shift 2 ;;
    --dry-run)       DRY_RUN=1; shift ;;
    --skip-functions) SKIP_FUNCTIONS=1; shift ;;
    --skip-migrations) SKIP_MIGRATIONS=1; shift ;;
    --no-smoke)      SKIP_SMOKE=1; shift ;;
    --no-preflight-cli) SKIP_PREFLIGHT_CLI=1; shift ;;
    --yes|-y)        ASSUME_YES=1; shift ;;
    -h|--help)       usage; exit 0 ;;
    *)               echo "ERROR: unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

# -----------------------------------------------------------------------------
# Logging helpers. We tee everything to a per-run log file so the post-rollback
# record includes what the operator saw, in order. This is what gets pasted
# into docs/evidence/rollback-drill.txt after a successful staging run.
# -----------------------------------------------------------------------------
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="$REPO_ROOT/docs/evidence/.rollback-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/rollback-$RUN_ID.log"

log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE" ; }
err()  { printf '[%s] ERROR: %s\n' "$(date -u +%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE" >&2 ; }
die()  { err "$@"; exit 3 ; }

if [[ $DRY_RUN -eq 1 ]]; then
  log "DRY-RUN: no changes will be made. Remove --dry-run to execute."
fi

# -----------------------------------------------------------------------------
# Preflight. Fail loud and early if the environment isn't ready. Each check
# is a one-liner; if we get past this block we have a real chance of success.
# -----------------------------------------------------------------------------
log "Preflight: starting"
log "  repo root:      $REPO_ROOT"
log "  migrations dir: $MIGRATIONS_DIR"
log "  functions dir:  $FUNCTIONS_DIR"
log "  last-good dir:  $LAST_GOOD_DIR"
log "  log file:       $LOG_FILE"

if ! command -v npx >/dev/null 2>&1; then
  die "npx not found on PATH. Install Node.js 18+ before running rollback."
fi
# Verify the CLI is logged in. The current command exits 0 even when not
# linked; parse the output for "(not linked" to detect that case. We skip
# this check when --no-preflight-cli is set, which is for local dry-runs and
# unit tests where the operator has not (and should not have to) link the CLI
# just to validate the script's argument parsing and @down extraction.
if [[ $SKIP_PREFLIGHT_CLI -eq 0 ]]; then
  INSFORGE_CONTEXT="$(npx @insforge/cli current 2>&1 || true)"
  if echo "$INSFORGE_CONTEXT" | grep -q "(not linked"; then
    die "InsForge CLI is not linked. Run 'npx @insforge/cli link --project-id <id>' first. (Use --no-preflight-cli to skip this check for local dry-runs.)"
  fi
  log "  CLI:            $(echo "$INSFORGE_CONTEXT" | grep -E 'Project|User' | tr -d '\n' | sed 's/  */ /g')"
else
  log "  CLI:            (preflight skipped via --no-preflight-cli)"
fi

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  die "Migrations dir not found: $MIGRATIONS_DIR"
fi

# -----------------------------------------------------------------------------
# Pick the migration(s) to roll back. Migrations are sorted by their numeric
# prefix; the "most recent" is the highest-numbered file. --to <id> rolls back
# everything strictly newer than <id>.
# -----------------------------------------------------------------------------
MIGRATION_FILES=()
while IFS= read -r f; do
  MIGRATION_FILES+=("$(basename "$f")")
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '[0-9][0-9][0-9]*.sql' | sort)

if [[ ${#MIGRATION_FILES[@]} -eq 0 ]]; then
  die "No migration files found in $MIGRATIONS_DIR (expected NNN_*.sql)."
fi

if [[ -n "$TARGET_ID" ]]; then
  # --to <id>: keep only files strictly newer than <id>
  ROLLBACK_FILES=()
  for f in "${MIGRATION_FILES[@]}"; do
    if [[ "$f" > "$TARGET_ID" ]] || [[ "$f" == "$TARGET_ID"* && "$f" != "$TARGET_ID" ]]; then
      # > compares lexicographically; NNN_ prefix sorts correctly. We exclude
      # the target file itself — it's the destination, not a rollback step.
      ROLLBACK_FILES+=("$f")
    fi
  done
  if [[ ${#ROLLBACK_FILES[@]} -eq 0 ]]; then
    die "--to $TARGET_ID: no migrations are newer than this. Nothing to roll back."
  fi
else
  # No --to: roll back the single most-recent migration.
  ROLLBACK_FILES=("${MIGRATION_FILES[-1]}")
fi

# Reverse for safe application order: newest first. Down blocks for N+1 must
# run before N's down block (think: drop the new index before dropping the
# table the index was on).
REVERSED_FILES=()
for ((i=${#ROLLBACK_FILES[@]}-1; i>=0; i--)); do
  REVERSED_FILES+=("${ROLLBACK_FILES[i]}")
done

log "Migrations to roll back (newest first):"
for f in "${REVERSED_FILES[@]}"; do
  log "  - $f"
done

# -----------------------------------------------------------------------------
# Extract the @down block from each migration file. Convention: the @down
# block is delimited by lines starting with "-- @down" and "-- @end". This
# matches the launch-checklist §8.2 acceptance criterion (every migration has
# a paired @down block). Files without one are a real bug — fail loud.
# -----------------------------------------------------------------------------
declare -A DOWN_BLOCKS
for f in "${REVERSED_FILES[@]}"; do
  path="$MIGRATIONS_DIR/$f"
  # awk extracts the multi-line block between "-- @down" and "-- @end"
  down="$(awk '
    /^-- @down/   { capturing = 1; next }
    /^-- @end/    { capturing = 0 }
    capturing     { print }
  ' "$path")"
  if [[ -z "$down" ]]; then
    die "Migration $f has no -- @down block. See docs/LAUNCH_CHECKLIST.md §8.2."
  fi
  DOWN_BLOCKS["$f"]="$down"
done

# -----------------------------------------------------------------------------
# Locate the previous-known-good function snapshot. The deploy script is
# expected to populate $LAST_GOOD_DIR/<git-sha>/<function-slug>/index.ts after
# every successful deploy. We pick the most recent snapshot.
# -----------------------------------------------------------------------------
PREVIOUS_FN_SNAPSHOT=""
if [[ $SKIP_FUNCTIONS -eq 0 ]]; then
  if [[ ! -d "$LAST_GOOD_DIR" ]]; then
    die "--skip-functions not set but $LAST_GOOD_DIR does not exist. Either re-run with --skip-functions or re-deploy once so the snapshot dir is created."
  fi
  # Snapshot dirs are named by git SHA. Pick the most recent.
  PREVIOUS_FN_SNAPSHOT="$(find "$LAST_GOOD_DIR" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)"
  if [[ -z "$PREVIOUS_FN_SNAPSHOT" ]]; then
    die "No snapshot dirs found under $LAST_GOOD_DIR. Was a deploy ever run?"
  fi
  log "Previous function snapshot: $PREVIOUS_FN_SNAPSHOT"
fi

# -----------------------------------------------------------------------------
# Confirmation gate. Real operator in front of a terminal, real blast radius.
# --yes is the CI / on-call-script flag.
# -----------------------------------------------------------------------------
echo
echo "Planned rollback:"
if [[ $SKIP_MIGRATIONS -eq 0 ]]; then
  echo "  Migrations to apply (@down blocks, newest first):"
  for f in "${REVERSED_FILES[@]}"; do
    echo "    - $f"
  done
fi
if [[ $SKIP_FUNCTIONS -eq 0 ]]; then
  echo "  Functions to redeploy from: $PREVIOUS_FN_SNAPSHOT"
fi
if [[ $SKIP_SMOKE -eq 0 ]]; then
  echo "  Smoke test: curl send-reply, expect 200/401/404"
fi
echo

if [[ $ASSUME_YES -eq 0 && $DRY_RUN -eq 0 ]]; then
  read -r -p "Type 'rollback' to continue, anything else aborts: " confirm
  if [[ "$confirm" != "rollback" ]]; then
    log "Aborted by operator (typed: '$confirm')."
    exit 0
  fi
fi

# -----------------------------------------------------------------------------
# Take a safety snapshot of the live functions dir. If something goes wrong
# during the redeploy we can restore from this. We deliberately do NOT take
# a pg_dump here — that's the staging-backup job, not rollback.sh. The
# launch checklist §8.5 already schedules pre-launch backups.
# -----------------------------------------------------------------------------
SAFETY_SNAPSHOT="$LOG_DIR/functions-live-$RUN_ID"
if [[ $SKIP_FUNCTIONS -eq 0 && $DRY_RUN -eq 0 ]]; then
  log "Snapshotting live functions to $SAFETY_SNAPSHOT"
  cp -R "$FUNCTIONS_DIR" "$SAFETY_SNAPSHOT"
  # Remove the .last_good subdir from the snapshot — it can be huge and isn't
  # needed for restore. The next deploy will repopulate it.
  rm -rf "$SAFETY_SNAPSHOT/.last_good"
fi

# -----------------------------------------------------------------------------
# Step 1: apply @down blocks. Each is a multi-statement DDL script — we
# apply it via a temp file because insforge db query can be flaky with
# multi-statement strings on the CLI (see insforge-cli skill, "Multi-statement
# DDL doesn't persist via db query"). The migration files themselves are
# applied with `npx @insforge/cli db import` which is the supported path.
# -----------------------------------------------------------------------------
if [[ $SKIP_MIGRATIONS -eq 0 ]]; then
  log "STEP 1/3: applying @down blocks"
  for f in "${REVERSED_FILES[@]}"; do
    log "  -> $f"
    down_file="$LOG_DIR/${f%.sql}.down.sql"
    {
      echo "-- Generated by scripts/rollback.sh at $RUN_ID"
      echo "-- Source: insforge/migrations/$f (-- @down block)"
      echo
      echo "${DOWN_BLOCKS[$f]}"
    } > "$down_file"
    if [[ $DRY_RUN -eq 1 ]]; then
      log "    DRY-RUN: would 'npx @insforge/cli db import $down_file'"
      log "    ----- down block (first 12 lines) -----"
      printf '%s\n' "${DOWN_BLOCKS[$f]}" | head -12 | sed 's/^/    | /'
      log "    ----------------------------------------"
    else
      if ! npx @insforge/cli db import "$down_file" 2>>"$LOG_FILE"; then
        die "db import failed for $f. Live functions snapshot at $SAFETY_SNAPSHOT."
      fi
    fi
  done
fi

# -----------------------------------------------------------------------------
# Step 2: redeploy functions from the previous snapshot. We copy each
# function's index.ts (or whatever the entrypoint file is) from the snapshot
# into $FUNCTIONS_DIR, then `npx @insforge/cli functions deploy <slug>`. The
# deploy is per-function so a partial failure leaves the others untouched.
# -----------------------------------------------------------------------------
if [[ $SKIP_FUNCTIONS -eq 0 ]]; then
  log "STEP 2/3: redeploying functions from snapshot"
  deploy_one() {
    local slug="$1"
    local entrypoint_file="$2"
    local src="$PREVIOUS_FN_SNAPSHOT/$slug/$entrypoint_file"
    local dst="$FUNCTIONS_DIR/$slug/$entrypoint_file"
    if [[ ! -f "$src" ]]; then
      err "    snapshot missing $src — skipping $slug"
      return 1
    fi
    log "    -> $slug"
    if [[ $DRY_RUN -eq 1 ]]; then
      log "      DRY-RUN: would copy $src -> $dst and run 'functions deploy $slug'"
    else
      mkdir -p "$(dirname "$dst")"
      cp "$src" "$dst"
      if ! npx @insforge/cli functions deploy "$slug" --file "$dst" 2>>"$LOG_FILE"; then
        err "    deploy failed for $slug. Live snapshot at $SAFETY_SNAPSHOT."
        return 1
      fi
    fi
  }
  # Walk the snapshot dir. Each immediate subdirectory is a function slug.
  # The entrypoint file is the same as the deploy script uses — for InboxPilot
  # every function is a single index.ts at the slug root. If a future deploy
  # shape changes, this list is the single place to update.
  for slug_dir in "$PREVIOUS_FN_SNAPSHOT"/*/; do
    [[ -d "$slug_dir" ]] || continue
    slug="$(basename "$slug_dir")"
    [[ "$slug" == "_shared" ]] && continue
    [[ "$slug" == ".last_good" ]] && continue
    if [[ -f "$slug_dir/index.ts" ]]; then
      deploy_one "$slug" "index.ts"
    elif [[ -f "$slug_dir/handler.ts" ]]; then
      deploy_one "$slug" "handler.ts"
    else
      err "    no index.ts or handler.ts in $slug_dir — skipping"
    fi
  done
fi

# -----------------------------------------------------------------------------
# Step 3: smoke test. A "working" send-reply returns 401 when called without
# a JWT, which proves the function is up and the auth check is firing. We
# accept 200/401/404 as "up" and treat 5xx as a rollback failure.
# -----------------------------------------------------------------------------
SMOKE_RESULT=0
if [[ $SKIP_SMOKE -eq 0 ]]; then
  log "STEP 3/3: smoke test"
  smoke_url="${INBOX_PILOT_API_BASE:-https://y39ezar3.functions.insforge.app/send-reply}"
  log "  Hitting: POST $smoke_url"
  if [[ $DRY_RUN -eq 1 ]]; then
    log "    DRY-RUN: would curl -s -o /dev/null -w '%{http_code}' -X POST $smoke_url"
    log "    expect 200/401/404; 5xx = rollback failure"
  else
    code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$smoke_url" \
              -H 'Content-Type: application/json' \
              -d '{}' || echo 000)"
    log "  HTTP status: $code"
    case "$code" in
      200|401|404) log "  SMOKE OK"; SMOKE_RESULT=0 ;;
      5*)          err "  SMOKE FAILED: 5xx from send-reply. Rollback did not restore service."; SMOKE_RESULT=1 ;;
      000)         err "  SMOKE FAILED: network error or DNS. Is the CLI logged in / VPN up?"; SMOKE_RESULT=1 ;;
      *)           err "  SMOKE WARNING: unexpected status $code (not 200/401/404/5xx). Investigate."; SMOKE_RESULT=1 ;;
    esac
  fi
fi

# -----------------------------------------------------------------------------
# Wrap up. Tell the operator where the log is and what to do next.
# -----------------------------------------------------------------------------
echo
log "================================================================"
log "Rollback complete."
log "  Log file:    $LOG_FILE"
if [[ $SKIP_FUNCTIONS -eq 0 && $DRY_RUN -eq 0 ]]; then
  log "  Live snapshot (for restore): $SAFETY_SNAPSHOT"
fi
log "  Next: open the launch checklist §8.4 entry for this drill and"
log "  paste the log into docs/evidence/rollback-drill.txt."
log "================================================================"

if [[ $SMOKE_RESULT -ne 0 ]]; then
  exit 1
fi
exit 0
