# @waelio/builder

Utilising all the tools to build websites, according to blueprints.

## Architecture

The builder repo contains:

- **Builder Server** — Express webhook server + UI that scaffolds projects from blueprint payloads and hosts generated Siforge ready-sites
- **Readysites** — Five framework-specific starter templates (Nest, Next, Nitro, Nuxt, PHP/Laravel)
- **Agent Server** — MCP-compatible agent launcher using `@waelio/agent` backed by Ollama

## Quick Start

### Install dependencies

```bash
pnpm install
```

### Run the builder server

```bash
pnpm dev
```

### Build for production

```bash
pnpm build
pnpm start
```

### Start the MCP server

```bash
pnpm mcp
```

### Start the local agent UI

```bash
pnpm agent
```

### Useful development commands

```bash
pnpm mcp:dev
pnpm agent:dev
pnpm coder:dev
pnpm typecheck
pnpm test
```

### Start Ollama with GPU

For optimal performance, start Ollama with GPU acceleration enabled:

```bash
# Use GPU (macOS Metal, NVIDIA CUDA, AMD ROCm)
OLLAMA_NUM_GPU=1 ollama serve

# Or use all GPUs if you have multiple
OLLAMA_NUM_GPU=-1 ollama serve
```

## Available Scripts

| Script           | Description                                         |
| ---------------- | --------------------------------------------------- |
| `pnpm dev`       | Start dev server with hot-reload (tsx)              |
| `pnpm build`     | Compile TypeScript to `dist/`                       |
| `pnpm start`     | Run compiled production build                       |
| `pnpm clean`     | Remove `dist/` directory                            |
| `pnpm mcp`       | Run the compiled MCP server                         |
| `pnpm mcp:dev`   | Run the MCP server from source with watch           |
| `pnpm agent`     | Run the compiled agent backend server               |
| `pnpm agent:dev` | Run the agent backend server from source with watch |
| `pnpm coder:dev` | Run the local coder from source with watch          |

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

| Service | Port | URL                   | Framework          |
| ------- | ---- | --------------------- | ------------------ |
| Builder | 3000 | http://localhost:3000 | Express + tsx      |
| Nest    | 3001 | http://localhost:3001 | NestJS 11          |
| Next    | 3002 | http://localhost:3002 | Next.js 16 (Turbo) |
| Nuxt    | 3003 | http://localhost:3003 | Nuxt 4 + Vite 8    |
| Nitro   | 3004 | http://localhost:3004 | Nitro 2            |
| Agent   | 3005 | http://localhost:3005 | @waelio/agent PWA  |
| PHP     | 8000 | http://localhost:8000 | Laravel (Docker)   |

### PHP / Laravel (Docker)

The PHP readysite runs via Docker Compose:

```bash
cd readysites/php/agent-app
docker compose up -d    # Starts PHP-FPM + Nginx on port 8000
```

## Blueprint Webhook API

### `POST /webhooks/blueprints`

Scaffolds one or more projects from a blueprint payload and builds hosted ready-site artifacts under `readysites/ready-sites/`.

**Request:**

```json
{
  "projects": [{ "name": "my-app" }, { "name": "dashboard" }]
}
```

**Response (202):**

```json
{
  "message": "Blueprint accepted",
  "projects": ["/path/to/projects/my-app", "/path/to/projects/dashboard"],
  "sites": [
    {
      "name": "my-app",
      "projectPath": "/path/to/projects/my-app",
      "readySitePath": "/path/to/readysites/ready-sites/my-app",
      "url": "http://localhost:3000/ready-sites/my-app/"
    }
  ]
}
```

The webhook also accepts Siteforge-style single-site payloads when `projects`
is omitted. The first non-empty value from `project.name`, `project.title`,
`site.name`, `site.site_name`, `site.domain`, `site_name`, or `siteName` is
used as the project name.

Each scaffolded project gets:

- Template files from `templates/project-template/`
- `gent.md` — agent scaffold descriptor
- `waelio.tools.json` — CLI tools configuration
- Required files: `ABOUT`, `CONTACT`, `CASL.AUTH`, `MONGODB`, `ORM`, `SEO`
- A hosted Siforge ready-site at `/ready-sites/<project-name>/`

## Agent PWA Server (HTTP)

The `waelio-agent-server.js` serves the `@waelio/agent` PWA and acts as a backend adapter between the agent's web-based chat UI and your local Ollama instance.

- **Serves the `@waelio/agent` PWA** as static files on port `3005`.
- **Translates `/run_sse` requests** into Ollama `/api/chat` calls.
- **Lists available Ollama models** via `/models` → Ollama `/api/tags`.

To start the PWA backend standalone:

```bash
AGENT_PORT=3005 node waelio-agent-server.js
```

Then open `http://localhost:3005` in your browser to chat with the agent UI.

---

## Model Context Protocol (MCP) Server

The actual Model Context Protocol (MCP) server runs on stdio transport and exposes project scaffolding and Ollama generation tools directly to AI clients like Cursor or Claude Desktop.

### Configuration for AI Clients (Claude Desktop / Cursor)

To register this MCP server, add the following to your `mcp_config.json` (or `claude_desktop_config.json`):

#### 1. Local Development (Absolute Path)

```json
{
  "mcpServers": {
    "waelio-builder": {
      "command": "node",
      "args": [
        "/Users/waelio/Code/GitHub/waelio/builder/dist/src/mcp-server.js"
      ],
      "env": {
        "OLLAMA_URL": "http://127.0.0.1:11434",
        "OLLAMA_MODEL": "qwen3:8b"
      }
    }
  }
}
```

#### 2. Via NPM (Global Command)

Once published or globally linked, you can run the binary directly:

```json
{
  "mcpServers": {
    "waelio-builder": {
      "command": "npx",
      "args": ["-y", "@waelio/builder", "waelio-builder-mcp"],
      "env": {
        "OLLAMA_URL": "http://127.0.0.1:11434",
        "OLLAMA_MODEL": "qwen3:8b"
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

| Variable              | Default                  | Description              |
| --------------------- | ------------------------ | ------------------------ |
| `PORT`                | `3000`                   | Builder server port      |
| `WAELIO_BUILDER_ROOT` | `process.cwd()`          | Override repo root path  |
| `WAELIO_BUILDER_URL`  | `http://localhost:3000`  | Public builder URL for MCP ready-site links |
| `WAELIO_MODEL`        | `ollama`                 | Agent model backend      |
| `OLLAMA_URL`          | `http://127.0.0.1:11434` | Ollama API endpoint      |
| `OLLAMA_MODEL`        | `llama3:70b`             | Model to use with Ollama |

## License

GPL-3.0-or-later
