#!/usr/bin/env bash
# Push Project Cost Tracker to https://github.com/thelubemaster/Receipt-tracker
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPO_URL="https://github.com/thelubemaster/Receipt-tracker.git"
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"
git branch -M main

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Create a token: https://github.com/settings/tokens (scopes: repo, workflow)"
  echo -n "Paste Personal Access Token: "
  read -r GITHUB_TOKEN
fi
if [[ -z "${GITHUB_TOKEN}" ]]; then
  echo "No token — aborting." >&2
  exit 1
fi

echo "Pushing main → origin…"
git push -u "https://x-access-token:${GITHUB_TOKEN}@github.com/thelubemaster/Receipt-tracker.git" main:main
echo ""
echo "✓ Pushed. Next:"
echo "  1) Repo Settings → Pages → Source: GitHub Actions"
echo "  2) Wait for workflow: Release app"
echo "  3) Download: ${REPO_URL%/}.git → Releases → project-cost-tracker.apk"
echo "     https://github.com/thelubemaster/Receipt-tracker/releases/latest/download/project-cost-tracker.apk"
echo "     Install page: https://thelubemaster.github.io/Receipt-tracker/?install=1"
