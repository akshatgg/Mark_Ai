#!/usr/bin/env bash
# Sync every Mark AI repo to the latest main:
#   git fetch origin  →  git checkout main  →  git pull
#
# Usage:  ./sync.sh
#
# Safety: a repo with uncommitted changes is NOT switched or pulled — it is
# fetched and reported, so nothing you were working on gets clobbered.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REPOS=(
  markai-signage-api
  markai-Web-cms
  markai-player-apk
  markai-frontend-new
  markai-backend-new
)

BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'

ok=(); skipped=(); failed=()

for name in "${REPOS[@]}"; do
  path="$ROOT/$name"
  echo
  echo "${BOLD}==> $name${RESET}"

  if [ ! -d "$path/.git" ]; then
    echo "${YELLOW}    not a git repo — skipping${RESET}"
    skipped+=("$name (not a git repo)")
    continue
  fi

  if ! git -C "$path" fetch origin --prune; then
    echo "${RED}    fetch failed${RESET}"
    failed+=("$name (fetch)")
    continue
  fi

  if [ -n "$(git -C "$path" status --porcelain --untracked-files=no)" ]; then
    branch="$(git -C "$path" rev-parse --abbrev-ref HEAD)"
    echo "${YELLOW}    uncommitted changes on '$branch' — fetched only, not switching${RESET}"
    skipped+=("$name (dirty on $branch)")
    continue
  fi

  if ! git -C "$path" checkout main; then
    echo "${RED}    checkout main failed${RESET}"
    failed+=("$name (checkout)")
    continue
  fi

  if ! git -C "$path" pull --ff-only; then
    echo "${RED}    pull failed${RESET}"
    failed+=("$name (pull)")
    continue
  fi

  echo "${GREEN}    up to date on main${RESET}"
  ok+=("$name")
done

echo
echo "${BOLD}────────── summary ──────────${RESET}"
for r in "${ok[@]:-}";      do [ -n "$r" ] && echo "${GREEN}  ✓ $r${RESET}"; done
for r in "${skipped[@]:-}"; do [ -n "$r" ] && echo "${YELLOW}  ! $r${RESET}"; done
for r in "${failed[@]:-}";  do [ -n "$r" ] && echo "${RED}  ✗ $r${RESET}"; done
echo

[ ${#failed[@]} -eq 0 ]
