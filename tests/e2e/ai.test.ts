/**
 * E2E tests for src/ai.ts
 *
 * All Ollama network calls are intercepted by a local stub server.
 * Module is dynamically imported AFTER env var is set so the constant
 * OLLAMA_URL picks up the stub address.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type * as AiModule from '../../src/ai';

// ── Ollama stub responses ──────────────────────────────────────
interface OllamaTagsModel {
  name: string;
  size: number;
}

interface OllamaTagsBody {
  models: OllamaTagsModel[];
}

interface OllamaChatBody {
  message: { content: string };
}

interface OllamaErrorBody {
  error: string;
}

// ── Ollama stub ────────────────────────────────────────────────
let stub: http.Server;
let stubPort: number;

// Controls what the /api/chat stub returns
let chatResponseBody: OllamaChatBody | OllamaErrorBody = {
  message: { content: 'stub response text' },
};

function startStub(): Promise<void> {
  return new Promise<void>((resolve) => {
    stub = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        if (req.url === '/api/chat') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(chatResponseBody));
          return;
        }
        if (req.url === '/api/tags') {
          const tagsBody: OllamaTagsBody = {
            models: [
              { name: 'qwen3:8b', size: 5_000_000_000 },
              { name: 'llama3:70b', size: 40_000_000_000 },
            ],
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(tagsBody));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });

    stub.listen(0, () => {
      stubPort = (stub.address() as AddressInfo).port;
      resolve();
    });
  });
}

// ── Module under test (dynamically imported after env stub) ────
let ai: typeof AiModule;

beforeAll(async () => {
  await startStub();
  vi.stubEnv('OLLAMA_URL', `http://127.0.0.1:${stubPort}`);
  vi.stubEnv('OLLAMA_MODEL', 'qwen3:8b');
  vi.resetModules();
  ai = await import('../../src/ai');
});

afterAll(() => {
  vi.unstubAllEnvs();
  return new Promise<void>((resolve, reject) => {
    stub.close((e) => (e ? reject(e) : resolve()));
  });
});

// ── listModels ─────────────────────────────────────────────────
describe('listModels()', () => {
  it('returns an array of model name strings', async () => {
    const models = await ai.listModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models).toContain('qwen3:8b');
    expect(models).toContain('llama3:70b');
  });

  it('falls back gracefully when Ollama is unreachable', async () => {
    // Point to a port nothing is listening on
    vi.stubEnv('OLLAMA_URL', 'http://127.0.0.1:1');
    vi.resetModules();
    const isolated = await import('../../src/ai');
    const models = await isolated.listModels();
    // Should return a non-empty fallback array, not throw
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    // Restore
    vi.stubEnv('OLLAMA_URL', `http://127.0.0.1:${stubPort}`);
    vi.resetModules();
    ai = await import('../../src/ai');
  });
});

// ── chat ───────────────────────────────────────────────────────
describe('chat()', () => {
  it('returns the content string from the Ollama response', async () => {
    chatResponseBody = { message: { content: 'hello world' } };
    const result = await ai.chat([{ role: 'user', content: 'hi' }]);
    expect(result).toBe('hello world');
  });

  it('uses the provided model override', async () => {
    chatResponseBody = { message: { content: 'ok' } };
    const result = await ai.chat([{ role: 'user', content: 'test' }], 'llama3:70b');
    expect(typeof result).toBe('string');
  });

  it('rejects when Ollama returns an error field', async () => {
    chatResponseBody = { error: 'model not found' } as OllamaErrorBody;
    await expect(ai.chat([{ role: 'user', content: 'test' }])).rejects.toThrow('model not found');
    // Restore good response
    chatResponseBody = { message: { content: 'stub response text' } };
  });

  it('returns empty string when content is missing', async () => {
    chatResponseBody = { message: { content: '' } };
    const result = await ai.chat([{ role: 'user', content: 'empty?' }]);
    expect(result).toBe('');
    chatResponseBody = { message: { content: 'stub response text' } };
  });
});

// ── generateCode ───────────────────────────────────────────────
describe('generateCode()', () => {
  it('returns a string', async () => {
    chatResponseBody = { message: { content: 'const x = 1;' } };
    const code = await ai.generateCode('create a variable x');
    expect(typeof code).toBe('string');
    expect(code).toBe('const x = 1;');
  });

  it('accepts an optional language parameter', async () => {
    chatResponseBody = { message: { content: 'x = 1' } };
    const code = await ai.generateCode('create a variable', 'python');
    expect(typeof code).toBe('string');
  });

  it('accepts an optional model parameter', async () => {
    chatResponseBody = { message: { content: 'result' } };
    const code = await ai.generateCode('create something', 'typescript', 'llama3:70b');
    expect(typeof code).toBe('string');
  });
});

// ── reviewCode ─────────────────────────────────────────────────
describe('reviewCode()', () => {
  it('returns a review string', async () => {
    chatResponseBody = { message: { content: 'Looks good, no issues.' } };
    const review = await ai.reviewCode('const x = 1;');
    expect(review).toBe('Looks good, no issues.');
  });

  it('accepts language and model overrides', async () => {
    chatResponseBody = { message: { content: 'Python review' } };
    const review = await ai.reviewCode('x = 1', 'python', 'llama3:70b');
    expect(typeof review).toBe('string');
  });
});

// ── planProject ────────────────────────────────────────────────
describe('planProject()', () => {
  it('returns a plan string', async () => {
    chatResponseBody = { message: { content: '1. Create files\n2. Write code' } };
    const plan = await ai.planProject('Build a todo app');
    expect(plan).toContain('1. Create files');
  });

  it('accepts a model override', async () => {
    chatResponseBody = { message: { content: 'plan with llama' } };
    const plan = await ai.planProject('Build an API', 'llama3:70b');
    expect(typeof plan).toBe('string');
  });
});

// ── ask ────────────────────────────────────────────────────────
describe('ask()', () => {
  it('returns an answer string', async () => {
    chatResponseBody = { message: { content: 'TypeScript is a superset of JavaScript.' } };
    const answer = await ai.ask('What is TypeScript?');
    expect(answer).toContain('TypeScript');
  });

  it('accepts optional context that becomes a system message', async () => {
    chatResponseBody = { message: { content: 'With context.' } };
    const answer = await ai.ask('What is this?', 'You are a helpful assistant.');
    expect(typeof answer).toBe('string');
  });

  it('accepts an optional model override', async () => {
    chatResponseBody = { message: { content: 'ok' } };
    const answer = await ai.ask('test', undefined, 'llama3:70b');
    expect(typeof answer).toBe('string');
  });
});
