#!/usr/bin/env bash
# Sync the dev-facing Mark AI repos to the latest dev branch:
#   git fetch origin  →  git checkout dev  →  fast-forward to origin/dev
#
# Repos: CMS frontend, CMS backend (signage API), and the player APK.
#
# Usage:  ./sync-dev.sh
#
# Safety: a repo with uncommitted changes is NOT switched or pulled — it is
# fetched and reported, so nothing you were working on gets clobbered.
# Merges are --ff-only, so a diverged local dev is reported, never rewritten.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BRANCH=dev

REPOS=(
  markai-Web-cms
  markai-signage-api
  markai-player-apk
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

  if ! git -C "$path" rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" >/dev/null; then
    echo "${YELLOW}    no origin/$BRANCH — skipping${RESET}"
    skipped+=("$name (no origin/$BRANCH)")
    continue
  fi

  if [ -n "$(git -C "$path" status --porcelain --untracked-files=no)" ]; then
    current="$(git -C "$path" rev-parse --abbrev-ref HEAD)"
    echo "${YELLOW}    uncommitted changes on '$current' — fetched only, not switching${RESET}"
    skipped+=("$name (dirty on $current)")
    continue
  fi

  # Check out dev, creating it from origin/dev on first run.
  if git -C "$path" rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
    checkout=(checkout "$BRANCH")
  else
    checkout=(checkout -b "$BRANCH" --track "origin/$BRANCH")
  fi

  if ! git -C "$path" "${checkout[@]}"; then
    echo "${RED}    checkout $BRANCH failed${RESET}"
    failed+=("$name (checkout)")
    continue
  fi

  if ! git -C "$path" merge --ff-only "origin/$BRANCH"; then
    echo "${RED}    fast-forward to origin/$BRANCH failed (local $BRANCH has diverged)${RESET}"
    failed+=("$name (merge)")
    continue
  fi

  echo "${GREEN}    up to date on $BRANCH${RESET}"
  ok+=("$name")
done

echo
echo "${BOLD}────────── summary ──────────${RESET}"
for r in "${ok[@]:-}";      do [ -n "$r" ] && echo "${GREEN}  ✓ $r${RESET}"; done
for r in "${skipped[@]:-}"; do [ -n "$r" ] && echo "${YELLOW}  ! $r${RESET}"; done
for r in "${failed[@]:-}";  do [ -n "$r" ] && echo "${RED}  ✗ $r${RESET}"; done
echo

[ ${#failed[@]} -eq 0 ]
