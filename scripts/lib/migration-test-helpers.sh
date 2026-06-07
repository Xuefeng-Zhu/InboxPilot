#!/usr/bin/env bash
# =============================================================================
# scripts/lib/migration-test-helpers.sh — pure helpers for unit testing.
# =============================================================================
#
# Sourced (not executed) by __tests__/apply-migrations.test.ts. Contains the
# pure logic extracted from apply-migrations.sh and apply-migrations.down.sh
# — file discovery, sha256 computation, plan computation, and the @down
# block extractor. No InsForge CLI calls; no network. Every function is
# deterministic given a known fixtures dir.
#
# Functions:
#   discover_migrations <dir>              → writes NUL-separated filenames to stdout
#   file_sha256 <file>                     → echoes the sha256 hex digest
#   extract_down_block <file>              → echoes the @down block (no trailing
#                                           newline; empty if no block)
#   compute_plan <applied_tsv>             → reads versions from a tsv stream
#                                           "<version>\t<sha256>" (one per line)
#                                           on stdin, plus its own positional
#                                           args, and writes a 3-line plan
#                                           summary (counts) to stdout.
#
# Plan output format (3 lines, parseable by the vitest harness):
#   <skip_count>\t<apply_count>\t<drift_count>
#   <space-separated SKIP versions>
#   <space-separated APPLY versions>
#   <space-separated DRIFT versions>
#
# Usage in tests:
#   source "$(dirname "$0")/../scripts/lib/migration-test-helpers.sh"
#   compute_plan < <(printf "001_initial_schema\tdeadbeef\n")
# =============================================================================

set -Eeuo pipefail

# -----------------------------------------------------------------------------
# discover_migrations <dir>
#   Lists NUL-separated relative filenames of NNN_*.sql in <dir>, sorted
#   lexicographically. Mirrors the find/sort filter in apply-migrations.sh.
# -----------------------------------------------------------------------------
discover_migrations() {
  local dir="$1"
  # We use a here-string + mapfile to avoid the while-read-inside-pipe pattern,
  # which interacts badly with `set -o pipefail` in the caller. The trailing
  # -printf 0 (instead of \n) lets callers consume NUL-separated names.
  local -a files=()
  while IFS= read -r -d '' f; do
    files+=("${f#$dir/}")
  done < <(find "$dir" -maxdepth 1 -type f -name '[0-9][0-9][0-9]*.sql' -print0 | sort -z)
  if [[ ${#files[@]} -gt 0 ]]; then
    printf '%s\0' "${files[@]}"
  fi
}

# -----------------------------------------------------------------------------
# file_sha256 <file>
#   Echoes the lowercase hex sha256 digest of <file>. Pure stdlib.
# -----------------------------------------------------------------------------
file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# -----------------------------------------------------------------------------
# extract_down_block <file>
#   Echoes everything between "-- @down" and "-- @end", exclusive. Empty
#   if no @down block is present.
# -----------------------------------------------------------------------------
extract_down_block() {
  awk '
    /^-- @down/   { capturing = 1; next }
    /^-- @end/    { capturing = 0 }
    capturing     { print }
  ' "$1"
}

# -----------------------------------------------------------------------------
# compute_plan <migrations_dir> <force_flag>
#   Reads "<version>\t<sha256>" pairs from stdin (one per line, tab-separated,
#   no header) and writes the plan summary to stdout. <force_flag> is 0 or 1
#   and is only echoed back as a convenience for the test harness.
#
# Output (4 lines):
#   <force_flag>\t<skip_count>\t<apply_count>\t<drift_count>
#   <space-separated SKIP versions>
#   <space-separated APPLY versions>
#   <space-separated DRIFT versions>
# -----------------------------------------------------------------------------
compute_plan() {
  local dir="$1"
  local force_flag="$2"
  declare -A applied_hash
  while IFS=$'\t' read -r v h || [[ -n "$v" ]]; do
    [[ -n "$v" ]] && applied_hash["$v"]="$h"
  done

  local skip_count=0 apply_count=0 drift_count=0
  local -a skips=() applies=() drifts=()

  while IFS= read -r -d '' f || [[ -n "$f" ]]; do
    local version="${f%.sql}"
    local current_hash
    current_hash="$(file_sha256 "$dir/$f")"
    if [[ -n "${applied_hash[$version]:-}" ]]; then
      if [[ "${applied_hash[$version]}" == "$current_hash" ]]; then
        skips+=("$version")
        skip_count=$((skip_count + 1))
      else
        drifts+=("$version")
        applies+=("$version")
        drift_count=$((drift_count + 1))
        apply_count=$((apply_count + 1))
      fi
    else
      applies+=("$version")
      apply_count=$((apply_count + 1))
    fi
  done < <(discover_migrations "$dir")

  # Output: exactly 4 lines, joined by a single \n with NO trailing \n.
  # The header is the count quadruple; the remaining 3 are space-joined
  # version lists (possibly empty). Empty lists become the empty string.
  #
  # The output contract is: 4 \n-separated fields, no terminator, so
  # `split('\n')` always yields exactly 4 elements. We avoid printing a
  # trailing \n because `trim().split('\n')` would then collapse trailing
  # empty fields and break the count.
  local skip_line="" apply_line="" drift_line=""
  [[ ${#skips[@]}   -gt 0 ]] && skip_line="${skips[*]}"
  [[ ${#applies[@]} -gt 0 ]] && apply_line="${applies[*]}"
  [[ ${#drifts[@]}  -gt 0 ]] && drift_line="${drifts[*]}"
  printf '%s\t%s\t%s\t%s\n%s\n%s\n%s' \
    "$force_flag" "$skip_count" "$apply_count" "$drift_count" \
    "$skip_line" "$apply_line" "$drift_line"
}
