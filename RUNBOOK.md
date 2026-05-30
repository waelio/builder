# @waelio/builder — Continuity & Operations Runbook

> If Wael is unavailable, this document tells anyone (or any AI agent) how to
> keep the system running, recover from failures, and continue development.

## 1. System Overview

The builder is a **self-hosted development platform** with 6 services:

| Service | Port | What It Does |
|---------|------|--------------|
| Builder | 3000 | Project scaffold engine + ready-site host + AI API |
| Nest    | 3001 | NestJS readysite |
| Next    | 3002 | Next.js readysite |
| Nuxt    | 3003 | Nuxt readysite |
| Nitro   | 3004 | Nitro readysite |
| Agent   | 3005 | @waelio/agent PWA (chat UI → Ollama) |
| PHP     | 8000 | Laravel (Docker) |

All Node services run locally. AI is powered by **Ollama** on `localhost:11434`.

## 2. How to Start Everything

```bash
cd /Users/waelio/Code/GitHub/waelio/builder

# 1. Builder (must be first — other services don't depend on it but it's the hub)
OLLAMA_MODEL=qwen3:8b PORT=3000 pnpm run dev

# 2. Readysites (each in a separate terminal)
cd readysites/nest  && PORT=3001 pnpm run start:dev
cd readysites/next  && npx next dev -p 3002
cd readysites/nuxt  && npx nuxt dev --port 3003
cd readysites/nitro && npx nitro dev --port 3004

# 3. Agent PWA
AGENT_PORT=3005 node waelio-agent-server.js

# 4. PHP (Docker, optional)
cd readysites/php/agent-app && docker compose up -d
```

## 3. How to Stop Everything

```bash
# Kill all Node dev servers
pkill -f "tsx watch"
pkill -f "nest start"
pkill -f "next dev"
pkill -f "nuxt dev"
pkill -f "nitro dev"
pkill -f "waelio-agent-server"

# Stop Docker
cd readysites/php/agent-app && docker compose down
```

## 4. AI API (No Code Knowledge Needed)

Anyone can use the AI through simple HTTP calls:

```bash
# Ask a question
curl -X POST http://localhost:3000/ai/ask \
  -H 'Content-Type: application/json' \
  -d '{"question": "How do I deploy a Nuxt app?", "model": "qwen3:8b"}'

# Generate code
curl -X POST http://localhost:3000/ai/generate \
  -H 'Content-Type: application/json' \
  -d '{"description": "A REST API endpoint for user registration", "language": "typescript"}'

# Review code
curl -X POST http://localhost:3000/ai/review \
  -H 'Content-Type: application/json' \
  -d '{"code": "function add(a,b){return a+b}", "language": "javascript"}'

# Plan a project
curl -X POST http://localhost:3000/ai/plan \
  -H 'Content-Type: application/json' \
  -d '{"description": "E-commerce site with user auth and payment processing"}'

# List available models
curl http://localhost:3000/ai/models
```

Or open http://localhost:3005 in a browser to chat with the AI directly.

## 5. Scaffold a New Project

```bash
curl -X POST http://localhost:3000/webhooks/blueprints \
  -H 'Content-Type: application/json' \
  -d '{"projects": [{"name": "my-new-app"}]}'
```

Projects are created under `projects/` with all required files. Hosted Siforge ready-sites are built under `readysites/ready-sites/` and served from `http://localhost:3000/ready-sites/<project-name>/`.

## 6. Troubleshooting

| Problem | Solution |
|---------|----------|
| `pnpm run dev` fails with "IGNORED_BUILDS" | Run `pnpm approve-builds` in that directory |
| Ollama unreachable | Check `ollama serve` is running: `curl http://localhost:11434` |
| Port already in use | `lsof -i :PORT_NUMBER` to find the process, then `kill PID` |
| Nest/Next won't start | `cd readysites/nest && pnpm install --ignore-workspace && pnpm approve-builds @nestjs/core unrs-resolver` |
| Nuxt won't install | Do NOT use `--ignore-workspace` — it needs its own `pnpm-workspace.yaml` |
| AI responses are slow | Ollama is loading the model — first call takes 1-5 min on CPU |

## 7. Key Credentials & Accounts

| Service | Location |
|---------|----------|
| GitHub token | `~/.gemini/antigravity/mcp_config.json` |
| Ollama | Local only, no auth needed |
| npm (@waelio scope) | `npm whoami` to check, `npm login` to refresh |

## 8. GitHub Repository

- **Repo:** https://github.com/waelio/builder
- **Owner:** waelio (Wael Wahbeh)
- **License:** GPL-3.0-or-later
- **Published packages:** `@waelio/agent` on npm

## 9. Contact

- **Wael Wahbeh** — wahbehw@gmail.com / wahbehw@me.com
- **Website:** https://waelio.com
