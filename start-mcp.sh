#!/usr/bin/env bash
# Permanent MCP startup — works regardless of node/nvm version changes

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

cd "$(dirname "$0")"

# Rebuild if dist is missing or source is newer
if [ ! -f "dist/src/mcp-server.js" ] || [ "src/mcp-server.ts" -nt "dist/src/mcp-server.js" ]; then
  npm run build 2>/dev/null || true
fi

exec node dist/src/mcp-server.js
