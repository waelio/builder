import express, { Request, Response } from 'express';
import path from 'node:path';
import { scaffoldFromBlueprint } from './project-scaffold';
import * as ai from './ai';

const repoRoot =
  process.env.WAELIO_BUILDER_ROOT ?? process.cwd();
const projectsDir = path.join(repoRoot, 'projects');

const app = express();
export const server: express.Express = app;

const port = Number(process.env.PORT || 3000);

// Serve static files for the UI
app.use(express.static(path.join(repoRoot, 'public')));

// Middleware to parse JSON payloads
app.use(express.json({ limit: '1mb' }));

// CORS for readysites on other ports
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

interface BlueprintProject {
  name?: string;
}

interface BlueprintPayload {
  projects?: BlueprintProject[];
}

// ── Blueprint webhook ─────────────────────────────────────────
app.post('/webhooks/blueprints', (req: Request, res: Response): void => {
  try {
    const payload: BlueprintPayload = req.body;

    const projectNames = (payload.projects ?? [])
      .map((project) => project.name?.trim())
      .filter((name): name is string => Boolean(name));

    if (projectNames.length === 0) {
      res.status(400).json({ error: 'No projects provided' });
      return;
    }

    const created = scaffoldFromBlueprint(projectsDir, projectNames);
    res
      .status(202)
      .json({ message: 'Blueprint accepted', projects: created });
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
    const message = err instanceof Error ? err.message : 'Unknown error';
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

let serverInstance;
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
