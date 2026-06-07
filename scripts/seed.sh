#!/usr/bin/env bash
# =============================================================================
# scripts/seed.sh — InboxPilot idempotent seed runner.
# =============================================================================
#
# Runs insforge/seed.sql against the linked InsForge project. The seed file
# is idempotent by design: every INSERT uses fixed UUIDs + ON CONFLICT DO
# NOTHING, so running this script any number of times produces the same
# end state. (See the header comment in insforge/seed.sql.)
#
# Pre-flight checks:
#   1. seed.sql exists at the conventional path (or --file override)
#   2. The schema_migrations table is reachable — we depend on its existence
#      to gate the seed on having applied migrations first. (The seed file
#      inserts rows with foreign keys into every tenant-scoped table, so
#      running it against an empty schema is a guaranteed FK violation.)
#   3. The CLI is linked (skip with --no-cli-check for offline tests)
#
# Usage:
#   scripts/seed.sh                   # apply seed.sql
#   scripts/seed.sh --file <path>     # custom seed file
#   scripts/seed.sh --dry-run         # show what would run
#   scripts/seed.sh --reset           # DROP + re-create everything (DANGER)
#   scripts/seed.sh --no-color
#   scripts/seed.sh --no-cli-check    # offline unit tests
#
# Exit codes:
#   0 — seed applied successfully (or dry-run plan shown)
#   2 — usage / config error
#   3 — seed import failed; see CLI output
# =============================================================================

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SEED_FILE="$REPO_ROOT/insforge/seed.sql"
DRY_RUN=0
NO_COLOR=0
SKIP_CLI_CHECK=0
RESET=0
INSFORGE_CLI_CMD="${INSFORGE_CLI_CMD:-npx @insforge/cli}"

usage() {
  sed -n '3,32p' "$0" | sed -e 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)          SEED_FILE="${2:-}"; shift 2 ;;
    --dry-run)       DRY_RUN=1; shift ;;
    --reset)         RESET=1; shift ;;
    --no-color)      NO_COLOR=1; shift ;;
    --no-cli-check)  SKIP_CLI_CHECK=1; shift ;;
    -h|--help)       usage; exit 0 ;;
    *)               echo "ERROR: unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ $NO_COLOR -eq 1 ]] || [[ ! -t 1 ]]; then
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_RESET=""
else
  C_RED=$'\033[0;31m'; C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[0;33m'
  C_BLUE=$'\033[0;34m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
fi

log()  { printf '%b[seed]%b %s\n' "$C_BLUE" "$C_RESET" "$*" ; }
warn() { printf '%b[seed]%b %bWARN%b: %s\n' "$C_BLUE" "$C_RESET" "$C_YELLOW" "$C_RESET" "$*" ; }
err()  { printf '%b[seed]%b %bERROR%b: %s\n' "$C_BLUE" "$C_RESET" "$C_RED" "$C_RESET" "$*" >&2 ; }
die()  { err "$@"; exit 3 ; }

log "Preflight: starting"
log "  repo root:  $REPO_ROOT"
log "  seed file:  $SEED_FILE"

if ! command -v npx >/dev/null 2>&1; then
  err "npx not found on PATH. Install Node.js 18+ before running the seed script."
  exit 2
fi
if [[ ! -f "$SEED_FILE" ]]; then
  err "Seed file not found: $SEED_FILE"
  exit 2
fi
if [[ $SKIP_CLI_CHECK -eq 0 ]]; then
  INSFORGE_CONTEXT="$($INSFORGE_CLI_CMD current 2>&1 || true)"
  if echo "$INSFORGE_CONTEXT" | grep -q "(not linked"; then
    die "InsForge CLI is not linked. Run 'npx @insforge/cli link --project-id <id>' first. (Use --no-cli-check to skip this check for offline unit tests.)"
  fi
  log "  CLI:        $(echo "$INSFORGE_CONTEXT" | grep -E 'Project|User' | tr -d '\n' | sed 's/  */ /g')"
else
  log "  CLI:        (preflight skipped via --no-cli-check)"
fi

# -----------------------------------------------------------------------------
# Sanity-check the schema. We can detect this without a separate roundtrip
# by counting rows in schema_migrations — zero rows = the operator forgot
# to run apply-migrations.sh, and the seed's FK inserts will fail anyway.
# In --no-cli-check mode we treat the schema as already-applied so the dry
# run can complete (the unit tests don't need to hit the DB).
# -----------------------------------------------------------------------------
applied_count=0
if [[ $SKIP_CLI_CHECK -eq 0 ]]; then
  applied_count="$(
    $INSFORGE_CLI_CMD db query \
      "SELECT count(*) FROM public.schema_migrations;" \
      2>/dev/null | awk '/^[0-9]+$/ {print; exit}'
  )"
fi
applied_count="${applied_count:-0}"

if [[ "$applied_count" -eq 0 && $SKIP_CLI_CHECK -eq 0 ]]; then
  err "No migrations recorded in schema_migrations. Run scripts/apply-migrations.sh first."
  exit 2
fi
log "  applied migrations: $applied_count"

# -----------------------------------------------------------------------------
# Optional reset. Drops every row from the seeded tables in FK-safe order,
# then re-runs the seed. The down blocks in the migration files use
# CASCADE drops, but we want to keep the schema and just clear the data.
# -----------------------------------------------------------------------------
reset_seed_tables() {
  log "${C_YELLOW}--reset: clearing seeded data (schema preserved)${C_RESET}"
  # Order matters: child rows before parent rows. We use DELETE rather than
  # TRUNCATE so foreign keys fire predictably.
  local -a tables=(
    audit_logs
    support_jobs
    ai_decisions
    ai_settings
    knowledge_chunks
    knowledge_documents
    email_delivery_events
    email_addresses
    email_provider_accounts
    sms_delivery_events
    sms_phone_numbers
    sms_provider_accounts
    messages
    conversations
    contacts
    organization_members
    organizations
  )
  for t in "${tables[@]}"; do
    $INSFORGE_CLI_CMD db query "DELETE FROM public.$t;" >/dev/null || \
      die "--reset: DELETE failed on $t"
  done
}

# =============================================================================
# Main
# =============================================================================
if [[ $RESET -eq 1 ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    log "DRY-RUN: would reset 17 seeded tables then run $SEED_FILE"
    log "  ${C_YELLOW}(no changes made)${C_RESET}"
    exit 0
  fi
  reset_seed_tables
fi

log "Applying $SEED_FILE"
if [[ $DRY_RUN -eq 1 ]]; then
  log "  DRY-RUN: would '$INSFORGE_CLI_CMD db import $SEED_FILE'"
  log "  ${C_YELLOW}(no changes made)${C_RESET}"
  exit 0
fi

if ! $INSFORGE_CLI_CMD db import "$SEED_FILE" 2>/dev/null; then
  die "Seed import failed. The seed is designed to be idempotent; a failure here usually means a missing table (run apply-migrations.sh first) or a renamed column."
fi

log "${C_GREEN}Seed applied.${C_RESET}"
