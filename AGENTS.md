# AGENTS.md

## Cursor Cloud specific instructions

### Overview

This is a pnpm monorepo (`@waelio/builder`) with a core Express server, an MCP server, an agent PWA server, and five readysite starter templates. Node.js >= 20 is required.

### Key commands

All documented in `package.json` scripts and `README.md`:

- **Install:** `pnpm install`
- **Dev server (hot-reload):** `pnpm dev` — starts on port 3000
- **Typecheck:** `pnpm typecheck`
- **Tests:** `pnpm test` (vitest, 88 tests with stub Ollama — no external services needed)
- **Build:** `pnpm build`

### Notes for cloud agents

- **Ollama is not available** in cloud agent VMs. All AI endpoints (`/ai/*`) gracefully degrade when Ollama is unreachable — `listModels` returns the default model name, and generation/review/plan/ask endpoints return 502 with an error message. Tests use a local HTTP stub so they pass without Ollama.
- The `pnpm-workspace.yaml` only contains an `allowBuilds` directive for esbuild — readysites are **not** workspace members. They have independent `pnpm-lock.yaml` files and must be installed separately with `--ignore-workspace` if needed.
- Scaffolded projects land in `/workspace/projects/`. This directory is gitignored.
- The dev server (`pnpm dev`) uses `tsx watch` for hot-reload. Changes to `src/**/*.ts` are picked up automatically without restart.
