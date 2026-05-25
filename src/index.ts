#!/usr/bin/env node
import express, { Request, Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import {
  buildBlueprintReadySites,
  extractProjectNames,
  type BlueprintPayload,
} from './project-scaffold';
import * as ai from './ai';
import { getErrorMessage } from './utils';

function findRepoRoot() {
  if (process.env.WAELIO_BUILDER_ROOT) return process.env.WAELIO_BUILDER_ROOT;
  const distPath = path.resolve(__dirname, '../../public');
  if (fs.existsSync(distPath)) return path.resolve(__dirname, '../../');
  return path.resolve(__dirname, '../');
}

const repoRoot = findRepoRoot();
const projectsDir = path.join(repoRoot, 'projects');
const readySitesDir = path.join(repoRoot, 'readysites', 'ready-sites');

const app = express();
export const server: express.Express = app;

const port = Number(process.env.PORT || 3000);

// Serve static files for the UI
app.use(express.static(path.join(repoRoot, 'public')));
app.use('/ready-sites', express.static(readySitesDir));

// Middleware to parse JSON payloads
app.use(express.json({ limit: '1mb' }));

// CORS for readysites on other ports
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ── Blueprint webhook ─────────────────────────────────────────
app.post('/webhooks/blueprints', (req: Request, res: Response): void => {
  try {
    const payload = req.body as BlueprintPayload;
    const projectNames = extractProjectNames(payload);

    if (projectNames.length === 0) {
      res.status(400).json({ error: 'No projects provided' });
      return;
    }

    const baseUrl = `${req.protocol}://${req.get('host') ?? `localhost:${port}`}`;
    const result = buildBlueprintReadySites({
      projectsDir,
      readySitesDir,
      baseUrl,
    }, projectNames);
    res
      .status(202)
      .json({
        message: 'Blueprint accepted',
        projects: result.projects,
        sites: result.sites,
      });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process blueprint' });
  }
});

// ── AI endpoints (powered by local Ollama) ────────────────────

/** List available Ollama models */
app.get('/ai/models', async (_req: Request, res: Response) => {
  try {
    const models = await ai.listModels();
    res.json({ models, default: process.env.OLLAMA_MODEL || 'qwen3:8b' });
  } catch (err: unknown) {
    const message = getErrorMessage(err);
    res.status(502).json({ error: message });
  }
});

/** Generate code from a description */
app.post('/ai/generate', async (req: Request, res: Response) => {
  const { description, language, model } = req.body;
  if (!description) {
    res.status(400).json({ error: 'description is required' });
    return;
  }
  try {
    const code = await ai.generateCode(description, language, model);
    res.json({ code, model: model || process.env.OLLAMA_MODEL || 'qwen3:8b' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});

/** Review code */
app.post('/ai/review', async (req: Request, res: Response) => {
  const { code, language, model } = req.body;
  if (!code) {
    res.status(400).json({ error: 'code is required' });
    return;
  }
  try {
    const review = await ai.reviewCode(code, language, model);
    res.json({ review, model: model || process.env.OLLAMA_MODEL || 'qwen3:8b' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});

/** Plan a project */
app.post('/ai/plan', async (req: Request, res: Response) => {
  const { description, model } = req.body;
  if (!description) {
    res.status(400).json({ error: 'description is required' });
    return;
  }
  try {
    const plan = await ai.planProject(description, model);
    res.json({ plan, model: model || process.env.OLLAMA_MODEL || 'qwen3:8b' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});

/** Ask a general question */
app.post('/ai/ask', async (req: Request, res: Response) => {
  const { question, context, model } = req.body;
  if (!question) {
    res.status(400).json({ error: 'question is required' });
    return;
  }
  try {
    const answer = await ai.ask(question, context, model);
    res.json({ answer, model: model || process.env.OLLAMA_MODEL || 'qwen3:8b' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});

let serverInstance: http.Server | undefined;
if (require.main === module) {
  serverInstance = app.listen(port, () => {
    console.log(
      `Builder listening on http://localhost:${port}`
    );
    console.log(
      `  AI endpoints: /ai/models, /ai/generate, /ai/review, /ai/plan, /ai/ask`
    );
    console.log(
      `  Ollama: ${process.env.OLLAMA_URL || 'http://127.0.0.1:11434'} (model: ${process.env.OLLAMA_MODEL || 'qwen3:8b'})`
    );
  });
}
