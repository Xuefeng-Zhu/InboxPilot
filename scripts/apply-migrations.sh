#!/usr/bin/env bash
# =============================================================================
# scripts/apply-migrations.sh — InboxPilot forward migration runner.
# =============================================================================
#
# Applies every .sql file in insforge/migrations/ in lexicographic (filename)
# order, tracking each applied migration in a `schema_migrations` table. The
# runner is idempotent: re-running it on an already-migrated database is a
# no-op for every file whose (version, sha256) pair is already recorded. This
# is what unblocks CI: every integration-test job runs this script first and
# gets the same final state regardless of how many times the job has run.
#
# Apply path:
#   npx @insforge/cli db import <file>    (same path scripts/rollback.sh uses;
#                                         see insforge-cli skill, "Multi-statement
#                                         DDL doesn't persist via db query")
#
# The schema_migrations table is created in the `public` schema on first run.
# We use the InsForge anon-key connection implicitly via the CLI (which sits
# on a service-role context), so the CREATE TABLE does not need privileged
# credentials.
#
# Usage:
#   scripts/apply-migrations.sh                 # apply any pending migrations
#   scripts/apply-migrations.sh --force         # re-apply every migration
#                                               # (use after a migration file's
#                                               #  contents changed)
#   scripts/apply-migrations.sh --dry-run       # show plan, do not execute
#   scripts/apply-migrations.sh --dir <path>    # override migrations dir
#                                               # (default: insforge/migrations)
#   scripts/apply-migrations.sh --target <file> # apply up to and including <file>
#   scripts/apply-migrations.sh --no-color      # disable colored output
#
# Exit codes:
#   0 — every targeted migration was applied (or already applied; no-op)
#   2 — usage / config error (no migrations dir, bad flag, no files)
#   3 — a migration failed to apply; see the log for the failing step
#
# This script depends on: bash 4+, npx (Node.js 18+), and a logged-in InsForge
# CLI session (`npx @insforge/cli current` must show a linked project). Pass
# --no-cli-check to skip the linked-project check (for offline unit tests
# that exercise only the planning / hashing logic).
# =============================================================================

set -Eeuo pipefail

# -----------------------------------------------------------------------------
# Resolve paths. We anchor on the script's own location so this works whether
# the operator runs it from the repo root, from scripts/, or via `npm run`.
# -----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# -----------------------------------------------------------------------------
# Defaults + argument parsing. We keep the surface small on purpose: every
# flag is a real lever, not sugar.
# -----------------------------------------------------------------------------
MIGRATIONS_DIR="$REPO_ROOT/insforge/migrations"
TARGET_FILE=""
FORCE=0
DRY_RUN=0
NO_COLOR=0
SKIP_CLI_CHECK=0
INSFORGE_CLI_CMD="${INSFORGE_CLI_CMD:-npx @insforge/cli}"

usage() {
  sed -n '3,42p' "$0" | sed -e 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)         FORCE=1; shift ;;
    --dry-run)       DRY_RUN=1; shift ;;
    --dir)           MIGRATIONS_DIR="${2:-}"; shift 2 ;;
    --target)        TARGET_FILE="${2:-}"; shift 2 ;;
    --no-color)      NO_COLOR=1; shift ;;
    --no-cli-check)  SKIP_CLI_CHECK=1; shift ;;
    -h|--help)       usage; exit 0 ;;
    *)               echo "ERROR: unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

# -----------------------------------------------------------------------------
# Color helpers. Auto-disabled when stdout is not a TTY unless the operator
# explicitly opts in. --no-color forces plain output.
# -----------------------------------------------------------------------------
if [[ $NO_COLOR -eq 1 ]] || [[ ! -t 1 ]]; then
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_RESET=""
else
  C_RED=$'\033[0;31m'; C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[0;33m'
  C_BLUE=$'\033[0;34m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
fi

log()  { printf '%b[apply-migrations]%b %s\n' "$C_BLUE" "$C_RESET" "$*" ; }
warn() { printf '%b[apply-migrations]%b %bWARN%b: %s\n' "$C_BLUE" "$C_RESET" "$C_YELLOW" "$C_RESET" "$*" ; }
err()  { printf '%b[apply-migrations]%b %bERROR%b: %s\n' "$C_BLUE" "$C_RESET" "$C_RED" "$C_RESET" "$*" >&2 ; }
die()  { err "$@"; exit 3 ; }

# -----------------------------------------------------------------------------
# Preflight. Fail loud and early if the environment isn't ready. Each check
# is a one-liner; if we get past this block we have a real chance of success.
# -----------------------------------------------------------------------------
log "Preflight: starting"
log "  repo root:      $REPO_ROOT"
log "  migrations dir: $MIGRATIONS_DIR"

if ! command -v npx >/dev/null 2>&1; then
  err "npx not found on PATH. Install Node.js 18+ before running the migration runner."
  exit 2
fi

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  err "Migrations dir not found: $MIGRATIONS_DIR (use --dir to override)"
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
# Discover migration files. Lexicographic order on the NNN_ prefix is the
# same order the apply phase will use, so we can compare lists directly.
# -----------------------------------------------------------------------------
mapfile -t ALL_MIGRATION_FILES < <(
  find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '[0-9][0-9][0-9]*.sql' \
    | sort | sed "s|^$MIGRATIONS_DIR/||"
)

if [[ ${#ALL_MIGRATION_FILES[@]} -eq 0 ]]; then
  die "No migration files found in $MIGRATIONS_DIR (expected NNN_*.sql)."
fi

# -----------------------------------------------------------------------------
# Apply --target filtering (up to and including the named file). This is a
# CI escape hatch: a downstream job that needs migrations 001+002 only can
# ask for --target 002_rpc_functions.sql and stop short of 003.
# -----------------------------------------------------------------------------
MIGRATION_FILES=()
if [[ -n "$TARGET_FILE" ]]; then
  found=0
  for f in "${ALL_MIGRATION_FILES[@]}"; do
    MIGRATION_FILES+=("$f")
    if [[ "$f" == "$TARGET_FILE" ]]; then
      found=1
      break
    fi
  done
  if [[ $found -eq 0 ]]; then
    die "--target $TARGET_FILE not found in $MIGRATIONS_DIR. Available: ${ALL_MIGRATION_FILES[*]}"
  fi
else
  MIGRATION_FILES=("${ALL_MIGRATION_FILES[@]}")
fi

log "Discovered ${#MIGRATION_FILES[@]} migration(s):"
for f in "${MIGRATION_FILES[@]}"; do
  log "  - $f"
done

# -----------------------------------------------------------------------------
# Hash helper. sha256 of the file as it sits on disk. We store this in
# schema_migrations so a future --force re-run can detect content drift and
# refuse to silently skip a migration that was edited in place.
# -----------------------------------------------------------------------------
file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "Neither sha256sum nor shasum found on PATH. Install coreutils."
  fi
}

# -----------------------------------------------------------------------------
# SQL helpers — every CLI call uses `db query` with a single statement to
# dodge the multi-statement-DDL pitfall. CREATE TABLE / CREATE INDEX / CREATE
# POLICY etc. each go in their own call. INSERTs to schema_migrations are
# also one statement per call.
# -----------------------------------------------------------------------------
sql_query() {
  $INSFORGE_CLI_CMD db query "$1" >/dev/null
}

# -----------------------------------------------------------------------------
# Bootstrap the schema_migrations table. Idempotent: CREATE TABLE IF NOT
# EXISTS. We use text columns (not enum / numeric) so adding a future column
# is a no-op ALTER. No-op when --no-cli-check is set (offline mode).
# -----------------------------------------------------------------------------
bootstrap_schema_table() {
  if [[ $SKIP_CLI_CHECK -eq 1 ]]; then
    log "Ensuring schema_migrations table exists (skipped, --no-cli-check)"
    return 0
  fi
  log "Ensuring schema_migrations table exists"
  sql_query "
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version     text        PRIMARY KEY,
      filename    text        NOT NULL,
      sha256      text        NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
  "
}

# -----------------------------------------------------------------------------
# Read the applied-state from the DB. Returns TSV lines:
#   <version>\t<sha256>
# We parse with awk below. Use a single SELECT (one statement) per call.
# -----------------------------------------------------------------------------
fetch_applied() {
  if [[ $SKIP_CLI_CHECK -eq 1 ]]; then
    # Offline mode: treat the DB as fresh. The caller will see all
    # migrations as pending, which is what an empty `schema_migrations`
    # table would report.
    return 0
  fi
  $INSFORGE_CLI_CMD db query \
    "SELECT version || E'\t' || sha256 FROM public.schema_migrations ORDER BY version ASC;" \
    2>/dev/null \
    | awk -F'\t' '/^[0-9]{3}_/ {print $1 "\t" $2}'
}

# -----------------------------------------------------------------------------
# Compute the apply plan. We have three buckets:
#   - already_applied:  present in DB with matching sha256 → skip (or re-run
#                       if --force)
#   - drifted:          present in DB but sha256 differs → MUST re-run; treat
#                       like pending (refuse --dry-run to be quiet about it)
#   - pending:          not in DB → apply
#
# Output is a plan printed to stdout. The "drifted" case is the most
# failure-prone in practice (someone edits a migration in place); we surface
# it loudly so the operator decides whether --force is the right move.
# -----------------------------------------------------------------------------
declare -a PLAN_SKIP=()
declare -a PLAN_APPLY=()
declare -a PLAN_DRIFT=()

compute_plan() {
  local applied_tsv="$1"
  declare -A applied_hash  # version -> sha256 (from DB)
  while IFS=$'\t' read -r v h; do
    [[ -n "$v" ]] && applied_hash["$v"]="$h"
  done <<< "$applied_tsv"

  for f in "${MIGRATION_FILES[@]}"; do
    # version key is the filename without the .sql extension
    local version="${f%.sql}"
    local current_hash
    current_hash="$(file_sha256 "$MIGRATIONS_DIR/$f")"

    if [[ -n "${applied_hash[$version]:-}" ]]; then
      if [[ "${applied_hash[$version]}" == "$current_hash" ]]; then
        PLAN_SKIP+=("$version")
      else
        PLAN_DRIFT+=("$version")
        PLAN_APPLY+=("$version")
      fi
    else
      PLAN_APPLY+=("$version")
    fi
  done
}

# -----------------------------------------------------------------------------
# Print the plan. Two flavors: the human-readable summary (always) and a
# machine-parseable list (when --dry-run is set, for CI plumbing).
# -----------------------------------------------------------------------------
print_plan_summary() {
  if [[ ${#PLAN_SKIP[@]} -gt 0 ]]; then
    log "Already applied (skipping):"
    for v in "${PLAN_SKIP[@]}"; do log "  ✓ $v"; done
  fi
  if [[ ${#PLAN_DRIFT[@]} -gt 0 ]]; then
    warn "Drift detected — file content changed since first apply:"
    for v in "${PLAN_DRIFT[@]}"; do warn "  ⚠ $v"; done
    if [[ $FORCE -eq 0 ]]; then
      warn "Re-run with --force to re-apply drifted migrations."
    else
      log "  --force set: re-applying drifted migrations"
    fi
  fi
  if [[ ${#PLAN_APPLY[@]} -gt 0 ]]; then
    log "Will apply (${#PLAN_APPLY[@]}):"
    for v in "${PLAN_APPLY[@]}"; do log "  → $v"; done
  else
    log "${C_GREEN}Database is up-to-date.${C_RESET} No migrations to apply."
  fi
}

# -----------------------------------------------------------------------------
# Apply phase. For each migration in PLAN_APPLY we:
#   1. import the .sql via `db import` (multi-statement safe)
#   2. UPSERT the schema_migrations row with the new sha256
#
# If --force was set, we ALSO re-import every PLAN_SKIP migration. The
# rationale: --force is "apply every migration as if the DB were fresh".
# Note: re-running CREATE TABLE / CREATE EXTENSION / CREATE POLICY etc.
# against an already-populated schema is safe because every file in this
# repo uses IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS. Don't
# introduce a file that breaks that invariant.
# -----------------------------------------------------------------------------
apply_one() {
  local version="$1"
  local file="$MIGRATIONS_DIR/$version.sql"
  local sha
  sha="$(file_sha256 "$file")"

  log "  → applying $version"
  if [[ $DRY_RUN -eq 1 ]]; then
    log "    DRY-RUN: would '$INSFORGE_CLI_CMD db import $file' and record sha=$sha"
    return 0
  fi

  if ! $INSFORGE_CLI_CMD db import "$file" 2>/dev/null; then
    die "db import failed for $version. Inspect '$file' and the live DB state."
  fi

  # UPSERT: update sha256 if the row exists, insert otherwise. Single
  # statement per call (see sql_query note above).
  sql_query "
    INSERT INTO public.schema_migrations (version, filename, sha256, applied_at)
    VALUES ('$version', '$(basename "$file")', '$sha', now())
    ON CONFLICT (version) DO UPDATE
      SET sha256 = EXCLUDED.sha256,
          applied_at = now();
  "
  log "    ${C_GREEN}✓${C_RESET} applied $version (sha=$sha)"
}

run_apply_phase() {
  if [[ ${#PLAN_APPLY[@]} -gt 0 ]]; then
    log "Applying ${#PLAN_APPLY[@]} migration(s)"
    for v in "${PLAN_APPLY[@]}"; do
      apply_one "$v"
    done
  fi

  if [[ $FORCE -eq 1 ]]; then
    if [[ ${#PLAN_SKIP[@]} -gt 0 ]]; then
      log "--force: re-applying ${#PLAN_SKIP[@]} already-applied migration(s)"
      for v in "${PLAN_SKIP[@]}"; do
        apply_one "$v"
      done
    fi
  fi
}

# -----------------------------------------------------------------------------
# Final summary. Helpful for CI logs.
# -----------------------------------------------------------------------------
print_final_summary() {
  log "${C_BOLD}Summary${C_RESET}"
  log "  Applied:  ${#PLAN_APPLY[@]}"
  log "  Skipped:  ${#PLAN_SKIP[@]}"
  log "  Drifted:  ${#PLAN_DRIFT[@]} (re-applied if --force)"
  if [[ $DRY_RUN -eq 1 ]]; then
    log "  Mode:     ${C_YELLOW}DRY-RUN${C_RESET} (no changes made)"
  elif [[ $FORCE -eq 1 ]]; then
    log "  Mode:     ${C_YELLOW}FORCE${C_RESET}"
  else
    log "  Mode:     normal"
  fi
}

# =============================================================================
# Main
# =============================================================================
bootstrap_schema_table
applied_tsv="$(fetch_applied || true)"
compute_plan "$applied_tsv"
print_plan_summary

# Refuse to silently skip drifted migrations — the operator must opt in.
if [[ ${#PLAN_DRIFT[@]} -gt 0 && $FORCE -eq 0 && $DRY_RUN -eq 0 ]]; then
  die "Drift detected and --force not set. Either pass --force or restore the file's original sha256."
fi

run_apply_phase
print_final_summary

log "${C_GREEN}Done.${C_RESET}"
