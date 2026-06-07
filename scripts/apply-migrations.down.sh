#!/usr/bin/env bash
# =============================================================================
# scripts/apply-migrations.down.sh — InboxPilot migration rollback runner.
# =============================================================================
#
# Rolls back migrations in reverse order using the `-- @down` / `-- @end`
# blocks embedded in each .sql file. The companion forward runner is
# scripts/apply-migrations.sh.
#
# What "applied" means:
#   We only roll back migrations that the forward runner recorded in
#   public.schema_migrations. This means running this script on a fresh DB
#   (where nothing was applied via the forward runner) is a no-op — the
#   opposite of the legacy scripts/rollback.sh, which extracted @down blocks
#   straight from the filesystem and would happily drop tables that never
#   existed in the current schema.
#
# Conventions:
#   - Every migration file uses `-- @down` / `-- @end` to delimit its
#     rollback block. (See docs/LAUNCH_CHECKLIST.md §8.2.)
#   - The `db import` CLI path is the supported way to apply multi-statement
#     DDL — `db query` with semicolon-joined statements silently drops DDL
#     (see insforge-cli skill, "Multi-statement DDL doesn't persist").
#   - After a successful rollback we DELETE the row from schema_migrations,
#     so the forward runner will re-apply it on the next pass.
#
# Usage:
#   scripts/apply-migrations.down.sh --last 1          # roll back most recent
#   scripts/apply-migrations.down.sh --last 3          # roll back last 3
#   scripts/apply-migrations.down.sh --to 001_initial_schema  # roll back to (and including) 001
#   scripts/apply-migrations.down.sh --to 002_rpc_functions  # roll back 002 + 003
#   scripts/apply-migrations.down.sh --dry-run --last 1
#   scripts/apply-migrations.down.sh --no-color
#   scripts/apply-migrations.down.sh --no-cli-check    # for offline unit tests
#
# Exit codes:
#   0 — every targeted migration was rolled back
#   2 — usage / config error (no migrations dir, bad flag, no @down block)
#   3 — a migration failed to roll back; schema_migrations is in an
#       intermediate state (forward runner can re-apply to recover)
#
# Depends on: bash 4+, npx, the InsForge CLI linked to the target project.
# =============================================================================

set -Eeuo pipefail

# -----------------------------------------------------------------------------
# Resolve paths + shared helpers.
# -----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

MIGRATIONS_DIR="$REPO_ROOT/insforge/migrations"
LAST_N=""
TARGET_VERSION=""
DRY_RUN=0
NO_COLOR=0
SKIP_CLI_CHECK=0
INSFORGE_CLI_CMD="${INSFORGE_CLI_CMD:-npx @insforge/cli}"

usage() {
  sed -n '3,45p' "$0" | sed -e 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --last)          LAST_N="${2:-}"; shift 2 ;;
    --to)            TARGET_VERSION="${2:-}"; shift 2 ;;
    --dry-run)       DRY_RUN=1; shift ;;
    --no-color)      NO_COLOR=1; shift ;;
    --no-cli-check)  SKIP_CLI_CHECK=1; shift ;;
    -h|--help)       usage; exit 0 ;;
    *)               echo "ERROR: unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$LAST_N" && -z "$TARGET_VERSION" ]]; then
  echo "ERROR: must pass --last <N> or --to <version>" >&2
  usage
  exit 2
fi
if [[ -n "$LAST_N" && ! "$LAST_N" =~ ^[0-9]+$ ]] || [[ -n "$LAST_N" && "$LAST_N" -le 0 ]]; then
  echo "ERROR: --last must be a positive integer (got: '$LAST_N')" >&2
  exit 2
fi

# -----------------------------------------------------------------------------
# Color helpers. Mirrors apply-migrations.sh.
# -----------------------------------------------------------------------------
if [[ $NO_COLOR -eq 1 ]] || [[ ! -t 1 ]]; then
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_RESET=""
else
  C_RED=$'\033[0;31m'; C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[0;33m'
  C_BLUE=$'\033[0;34m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
fi

log()  { printf '%b[apply-migrations.down]%b %s\n' "$C_BLUE" "$C_RESET" "$*" ; }
warn() { printf '%b[apply-migrations.down]%b %bWARN%b: %s\n' "$C_BLUE" "$C_RESET" "$C_YELLOW" "$C_RESET" "$*" ; }
err()  { printf '%b[apply-migrations.down]%b %bERROR%b: %s\n' "$C_BLUE" "$C_RESET" "$C_RED" "$C_RESET" "$*" >&2 ; }
die()  { err "$@"; exit 3 ; }

# -----------------------------------------------------------------------------
# Preflight.
# -----------------------------------------------------------------------------
log "Preflight: starting"
log "  repo root:      $REPO_ROOT"
log "  migrations dir: $MIGRATIONS_DIR"

if ! command -v npx >/dev/null 2>&1; then
  err "npx not found on PATH. Install Node.js 18+ before running the rollback runner."
  exit 2
fi
if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  err "Migrations dir not found: $MIGRATIONS_DIR"
  exit 2
fi
if [[ $SKIP_CLI_CHECK -eq 0 ]]; then
  INSFORGE_CONTEXT="$($INSFORGE_CLI_CMD current 2>&1 || true)"
  if echo "$INSFORGE_CONTEXT" | grep -q "(not linked"; then
    die "InsForge CLI is not linked. Run 'npx @insforge/cli link --project-id <id>' first. (Use --no-cli-check to skip this check for offline unit tests.)"
  fi
  log "  CLI:            $(echo "$INSFORGE_CONTEXT" | grep -E 'Project|User' | tr -d '\n' | sed 's/  */ /g')"
else
  log "  CLI:            (preflight skipped via --no-cli-check)"
fi

# -----------------------------------------------------------------------------
# Read the list of applied migrations from the DB. We only roll back what
# was actually applied via apply-migrations.sh — the legacy
# scripts/rollback.sh could drop tables that never existed; this one can't.
# -----------------------------------------------------------------------------
mapfile -t APPLIED_VERSIONS < <(
  if [[ $SKIP_CLI_CHECK -eq 1 ]]; then
    # Offline mode: no schema_migrations to read. The forward runner
    # would never have recorded anything, so there's nothing to roll back.
    exit 0
  fi
  $INSFORGE_CLI_CMD db query \
    "SELECT version FROM public.schema_migrations ORDER BY version DESC;" \
    2>/dev/null \
    | awk '/^[0-9]{3}_/ {print}'
)

if [[ ${#APPLIED_VERSIONS[@]} -eq 0 ]]; then
  log "${C_GREEN}No migrations recorded in schema_migrations. Nothing to roll back.${C_RESET}"
  exit 0
fi

log "Found ${#APPLIED_VERSIONS[@]} applied migration(s) in schema_migrations"

# -----------------------------------------------------------------------------
# Compute the rollback target list.
#   --last N:  the N most-recent versions, in reverse order (so 003 before 002)
#   --to V:    every version >= V, in reverse order (target version itself
#              is included — its @down block must run to actually undo it)
# -----------------------------------------------------------------------------
ROLLBACK_VERSIONS=()
if [[ -n "$LAST_N" ]]; then
  if [[ "$LAST_N" -gt ${#APPLIED_VERSIONS[@]} ]]; then
    warn "--last $LAST_N exceeds ${#APPLIED_VERSIONS[@]} applied migration(s); rolling back all of them"
    LAST_N="${#APPLIED_VERSIONS[@]}"
  fi
  for ((i = 0; i < LAST_N; i++)); do
    ROLLBACK_VERSIONS+=("${APPLIED_VERSIONS[$i]}")
  done
else
  # --to: keep versions lexicographically >= TARGET_VERSION
  for v in "${APPLIED_VERSIONS[@]}"; do
    if [[ "$v" > "$TARGET_VERSION" ]] || [[ "$v" == "$TARGET_VERSION" ]]; then
      ROLLBACK_VERSIONS+=("$v")
    fi
  done
  if [[ ${#ROLLBACK_VERSIONS[@]} -eq 0 ]]; then
    die "--to $TARGET_VERSION: no applied migrations are at or after this version. Nothing to roll back."
  fi
fi

log "Will roll back (newest first):"
for v in "${ROLLBACK_VERSIONS[@]}"; do
  log "  ← $v"
done

# -----------------------------------------------------------------------------
# Extract the @down block from a migration file. The convention is the same
# as scripts/rollback.sh: lines between "-- @down" and "-- @end".
# -----------------------------------------------------------------------------
extract_down_block() {
  local file="$1"
  awk '
    /^-- @down/   { capturing = 1; next }
    /^-- @end/    { capturing = 0 }
    capturing     { print }
  ' "$file"
}

# -----------------------------------------------------------------------------
# Roll back one migration: extract its @down block, write it to a temp file,
# `db import` it, then DELETE the schema_migrations row so the forward
# runner will re-apply it next time.
# -----------------------------------------------------------------------------
rollback_one() {
  local version="$1"
  local file="$MIGRATIONS_DIR/$version.sql"
  local down
  down="$(extract_down_block "$file")"
  if [[ -z "$down" ]]; then
    die "Migration $version has no -- @down block. See docs/LAUNCH_CHECKLIST.md §8.2."
  fi

  log "  ← rolling back $version"
  if [[ $DRY_RUN -eq 1 ]]; then
    log "    DRY-RUN: would 'db import' the @down block of $version and DELETE its schema_migrations row"
    log "    ----- @down (first 8 lines) -----"
    printf '%s\n' "$down" | head -8 | sed 's/^/    | /'
    log "    ----------------------------------"
    return 0
  fi

  # Write the @down block to a temp file. We wrap it in a BEGIN/COMMIT for
  # transactional DDL on databases that support it. InsForge's Postgres
  # supports transactional DDL, so a failure mid-@down will roll back the
  # partial changes — but we still delete the schema_migrations row LAST so
  # a failed rollback leaves the system in a recoverable state.
  local tmp
  tmp="$(mktemp -t "migdown-${version}-XXXXXX.sql")"
  trap 'rm -f "$tmp"' EXIT
  {
    echo "-- Generated by scripts/apply-migrations.down.sh"
    echo "-- Source: $file (-- @down block)"
    echo
    echo "BEGIN;"
    printf '%s\n' "$down"
    echo "COMMIT;"
  } > "$tmp"

  if ! $INSFORGE_CLI_CMD db import "$tmp" 2>/dev/null; then
    rm -f "$tmp"
    die "@down import failed for $version. The schema_migrations row was NOT deleted — forward runner will be a no-op until you fix the @down block and retry."
  fi
  rm -f "$tmp"

  # DELETE only after the @down import succeeded. Single statement per
  # call (multi-statement pitfall).
  $INSFORGE_CLI_CMD db query \
    "DELETE FROM public.schema_migrations WHERE version = '$version';" \
    >/dev/null
  log "    ${C_GREEN}✓${C_RESET} rolled back $version"
}

# =============================================================================
# Main
# =============================================================================
log "Rolling back ${#ROLLBACK_VERSIONS[@]} migration(s)"
for v in "${ROLLBACK_VERSIONS[@]}"; do
  rollback_one "$v"
done

log "${C_GREEN}Done.${C_RESET} Forward runner can now re-apply these migrations cleanly."
