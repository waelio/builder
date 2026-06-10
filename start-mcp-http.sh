#!/usr/bin/env bash
# Permanent MCP HTTP daemon startup
# Managed by: ~/Library/LaunchAgents/com.waelio.builder-mcp.plist

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

cd "$(dirname "$0")"

# Rebuild if dist is missing or source is newer
if [ ! -f "dist/src/mcp-server-http.js" ] || [ "src/mcp-server-http.ts" -nt "dist/src/mcp-server-http.js" ]; then
  npm run build 2>/dev/null || true
fi

exec node dist/src/mcp-server-http.js
