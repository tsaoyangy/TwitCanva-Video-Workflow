#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Make Trae-managed Node.js available when this script is run from a plain shell.
TRAE_NODE_PATHS=(
  "$HOME/.trae-cn/sdks/workspaces/da7366c8/versions/node/current"
  "$HOME/.trae-cn/sdks/versions/node/current"
)

for node_path in "${TRAE_NODE_PATHS[@]}"; do
  if [ -d "$node_path" ]; then
    export PATH="$node_path:$PATH"
  fi
done

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Please install Node.js or open this project in an environment with Node.js available." >&2
  exit 1
fi

npm run dev
