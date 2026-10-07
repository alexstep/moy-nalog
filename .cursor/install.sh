#!/usr/bin/env bash
set -euo pipefail

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun
fi

bun install --frozen-lockfile
