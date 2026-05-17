# @waelio/builder

Utilising all the tools to build websites, according to blueprints.

## Architecture

The builder repo contains:

- **Builder Server** — Express webhook server + UI that scaffolds projects from blueprint payloads
- **Readysites** — Five framework-specific starter templates (Nest, Next, Nitro, Nuxt, PHP/Laravel)
- **Agent Server** — MCP-compatible agent launcher using `@waelio/agent` backed by Ollama

## Quick Start

```bash
# Install root dependencies
pnpm install

# Start the builder server (port 3000)
pnpm run dev
```

## Available Scripts

| Script       | Description                              |
| ------------ | ---------------------------------------- |
| `pnpm dev`   | Start dev server with hot-reload (tsx)   |
| `pnpm build` | Compile TypeScript to `dist/`            |
| `pnpm start` | Run compiled production build            |
| `pnpm clean` | Remove `dist/` directory                 |

## Readysites

Each readysite is an independent project under `readysites/`. They have their own `package.json` and dependencies.

### Starting All Readysites

```bash
# Install each project's dependencies first (one-time)
cd readysites/nest  && pnpm install --ignore-workspace && pnpm approve-builds @nestjs/core unrs-resolver
cd readysites/next  && pnpm install --ignore-workspace && pnpm approve-builds sharp unrs-resolver
cd readysites/nuxt  && pnpm install  # uses its own pnpm-workspace.yaml with catalogs
cd readysites/nitro && pnpm install --ignore-workspace

# Start all on separate ports
PORT=3000 pnpm run dev                                              # Builder
cd readysites/nest  && PORT=3001 pnpm run start:dev                 # Nest
cd readysites/next  && npx next dev -p 3002                         # Next
cd readysites/nuxt  && npx nuxt dev --port 3003                     # Nuxt
cd readysites/nitro && npx nitro dev --port 3004                    # Nitro
```

### Port Map

| Service  | Port | URL                      | Framework          |
| -------- | ---- | ------------------------ | ------------------ |
| Builder  | 3000 | http://localhost:3000     | Express + tsx      |
| Nest     | 3001 | http://localhost:3001     | NestJS 11          |
| Next     | 3002 | http://localhost:3002     | Next.js 16 (Turbo) |
| Nuxt     | 3003 | http://localhost:3003     | Nuxt 4 + Vite 8    |
| Nitro    | 3004 | http://localhost:3004     | Nitro 2            |
| Agent    | 3005 | http://localhost:3005     | @waelio/agent PWA  |
| PHP      | 8000 | http://localhost:8000     | Laravel (Docker)   |

### PHP / Laravel (Docker)

The PHP readysite runs via Docker Compose:

```bash
cd readysites/php/agent-app
docker compose up -d    # Starts PHP-FPM + Nginx on port 8000
```

## Blueprint Webhook API

### `POST /webhooks/blueprints`

Scaffolds one or more projects from a blueprint payload.

**Request:**
```json
{
  "projects": [
    { "name": "my-app" },
    { "name": "dashboard" }
  ]
}
```

**Response (202):**
```json
{
  "message": "Blueprint accepted",
  "projects": [
    "/path/to/projects/my-app",
    "/path/to/projects/dashboard"
  ]
}
```

Each scaffolded project gets:
- Template files from `templates/project-template/`
- `gent.md` — agent scaffold descriptor
- `waelio.tools.json` — CLI tools configuration
- Required files: `ABOUT`, `CONTACT`, `CASL.AUTH`, `MONGODB`, `ORM`, `SEO`

## Agent Server (MCP)

The `waelio-agent-server.js` serves the `@waelio/agent` PWA and acts as a backend adapter between the agent's API and your local Ollama instance.

**What it does:**
- Serves the `@waelio/agent` PWA (chat UI) as static files
- Translates `/run_sse` requests into Ollama `/api/chat` calls
- Lists available Ollama models via `/models` → Ollama `/api/tags`
- Provides session management via `/apps/.../sessions`

```bash
# Start standalone
AGENT_PORT=3005 node waelio-agent-server.js

# Or via MCP config
```

Configure in `mcp_config.json`:

```json
{
  "mcpServers": {
    "waelioAgent": {
      "command": "node",
      "args": ["./waelio-agent-server.js"],
      "env": {
        "AGENT_PORT": "3005",
        "OLLAMA_URL": "http://127.0.0.1:11434",
        "OLLAMA_MODEL": "llama3:70b"
      }
    }
  }
}
```

## Project Structure

```
builder/
├── src/
│   ├── index.ts              # Express server + webhook endpoint
│   └── project-scaffold.ts   # Project scaffolding logic
├── dist/                     # Compiled JS output (gitignored)
├── public/
│   └── index.html            # Builder UI
├── templates/
│   └── project-template/     # Base template for scaffolded projects
├── readysites/
│   ├── nest/                 # NestJS starter
│   ├── next/                 # Next.js starter
│   ├── nitro/                # Nitro starter
│   ├── nuxt/                 # Nuxt 4 starter
│   └── php/                  # Laravel + Docker starter
├── waelio-agent-server.js    # MCP agent launcher (Ollama)
├── package.json
└── tsconfig.json
```

## Environment Variables

| Variable               | Default                    | Description                          |
| ---------------------- | -------------------------- | ------------------------------------ |
| `PORT`                 | `3000`                     | Builder server port                  |
| `WAELIO_BUILDER_ROOT`  | `process.cwd()`            | Override repo root path              |
| `WAELIO_MODEL`         | `ollama`                   | Agent model backend                  |
| `OLLAMA_URL`           | `http://127.0.0.1:11434`   | Ollama API endpoint                  |
| `OLLAMA_MODEL`         | `llama3:70b`               | Model to use with Ollama             |

## License

GPL-3.0-or-later
