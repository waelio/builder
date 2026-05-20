/**
 * E2E tests for src/index.ts — the full Express API
 *
 * Covers all /ai/* endpoints and /webhooks/blueprints end-to-end.
 * Ollama calls are intercepted by a local stub server.
 * The Express app is dynamically imported after env vars are set.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type express from 'express';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// ── Ollama stub ────────────────────────────────────────────────
interface OllamaStubConfig {
  chatContent: string;
  chatError?: string;
  reachable: boolean;
}

const stubConfig: OllamaStubConfig = {
  chatContent: 'generated response from stub',
  reachable: true,
};

let ollamaStub: http.Server;
let ollamaPort: number;

function startOllamaStub(): Promise<void> {
  return new Promise<void>((resolve) => {
    ollamaStub = http.createServer((req, res) => {
      if (!stubConfig.reachable) {
        req.socket.destroy();
        return;
      }

      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        if (req.url === '/api/chat') {
          if (stubConfig.chatError) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: stubConfig.chatError }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: { content: stubConfig.chatContent } }));
          return;
        }

        if (req.url === '/api/tags') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'llama3:70b' }] }));
          return;
        }

        res.writeHead(404);
        res.end();
      });
    });

    ollamaStub.listen(0, () => {
      ollamaPort = (ollamaStub.address() as AddressInfo).port;
      resolve();
    });
  });
}

// ── Express app (dynamically imported) ────────────────────────
let app: express.Express;
let tmpProjectsDir: string;

beforeAll(async () => {
  await startOllamaStub();

  tmpProjectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waelio-api-e2e-'));

  vi.stubEnv('OLLAMA_URL', `http://127.0.0.1:${ollamaPort}`);
  vi.stubEnv('OLLAMA_MODEL', 'qwen3:8b');
  vi.stubEnv('WAELIO_BUILDER_ROOT', path.resolve(process.cwd()));
  vi.resetModules();

  const mod = await import('../../src/index') as { server: express.Express };
  app = mod.server;
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpProjectsDir, { recursive: true, force: true });
  return new Promise<void>((resolve, reject) => {
    ollamaStub.close((e) => (e ? reject(e) : resolve()));
  });
});

// ── GET /ai/models ─────────────────────────────────────────────
describe('GET /ai/models', () => {
  it('returns 200 with a models array', async () => {
    const res = await request(app).get('/ai/models').expect(200);
    expect(Array.isArray(res.body.models)).toBe(true);
    expect(res.body.models).toContain('qwen3:8b');
  });

  it('includes a default model field', async () => {
    const res = await request(app).get('/ai/models').expect(200);
    expect(typeof res.body.default).toBe('string');
    expect(res.body.default.length).toBeGreaterThan(0);
  });
});

// ── POST /ai/generate ──────────────────────────────────────────
describe('POST /ai/generate', () => {
  it('returns 400 when description is missing', async () => {
    const res = await request(app)
      .post('/ai/generate')
      .send({})
      .expect(400);

    expect(res.body).toHaveProperty('error');
  });

  it('returns 200 with generated code', async () => {
    stubConfig.chatContent = 'const hello = "world";';
    const res = await request(app)
      .post('/ai/generate')
      .send({ description: 'create a hello variable' })
      .expect(200);

    expect(typeof res.body.code).toBe('string');
    expect(res.body.code).toBe('const hello = "world";');
  });

  it('accepts an optional language parameter', async () => {
    stubConfig.chatContent = 'hello = "world"';
    const res = await request(app)
      .post('/ai/generate')
      .send({ description: 'create a hello variable', language: 'python' })
      .expect(200);

    expect(typeof res.body.code).toBe('string');
  });

  it('accepts an optional model parameter', async () => {
    stubConfig.chatContent = 'result';
    const res = await request(app)
      .post('/ai/generate')
      .send({ description: 'test', model: 'llama3:70b' })
      .expect(200);

    expect(res.body.model).toBe('llama3:70b');
  });

  it('returns 502 when Ollama returns an error', async () => {
    stubConfig.chatError = 'model not found';
    const res = await request(app)
      .post('/ai/generate')
      .send({ description: 'test' })
      .expect(502);

    expect(res.body).toHaveProperty('error');
    stubConfig.chatError = undefined;
  });
});

// ── POST /ai/review ────────────────────────────────────────────
describe('POST /ai/review', () => {
  it('returns 400 when code is missing', async () => {
    const res = await request(app)
      .post('/ai/review')
      .send({})
      .expect(400);

    expect(res.body).toHaveProperty('error');
  });

  it('returns 200 with a review string', async () => {
    stubConfig.chatContent = 'No issues found.';
    const res = await request(app)
      .post('/ai/review')
      .send({ code: 'const x = 1;' })
      .expect(200);

    expect(typeof res.body.review).toBe('string');
    expect(res.body.review).toBe('No issues found.');
  });

  it('accepts language and model overrides', async () => {
    stubConfig.chatContent = 'Python review.';
    const res = await request(app)
      .post('/ai/review')
      .send({ code: 'x = 1', language: 'python', model: 'llama3:70b' })
      .expect(200);

    expect(res.body.model).toBe('llama3:70b');
  });

  it('returns 502 when Ollama returns an error', async () => {
    stubConfig.chatError = 'timeout';
    const res = await request(app)
      .post('/ai/review')
      .send({ code: 'const x = 1;' })
      .expect(502);

    expect(res.body).toHaveProperty('error');
    stubConfig.chatError = undefined;
  });
});

// ── POST /ai/plan ──────────────────────────────────────────────
describe('POST /ai/plan', () => {
  it('returns 400 when description is missing', async () => {
    const res = await request(app)
      .post('/ai/plan')
      .send({})
      .expect(400);

    expect(res.body).toHaveProperty('error');
  });

  it('returns 200 with a plan string', async () => {
    stubConfig.chatContent = '1. Setup\n2. Build\n3. Deploy';
    const res = await request(app)
      .post('/ai/plan')
      .send({ description: 'Build a SaaS app' })
      .expect(200);

    expect(typeof res.body.plan).toBe('string');
    expect(res.body.plan).toContain('1. Setup');
  });

  it('returns 502 when Ollama returns an error', async () => {
    stubConfig.chatError = 'oom';
    const res = await request(app)
      .post('/ai/plan')
      .send({ description: 'test' })
      .expect(502);

    expect(res.body).toHaveProperty('error');
    stubConfig.chatError = undefined;
  });
});

// ── POST /ai/ask ───────────────────────────────────────────────
describe('POST /ai/ask', () => {
  it('returns 400 when question is missing', async () => {
    const res = await request(app)
      .post('/ai/ask')
      .send({})
      .expect(400);

    expect(res.body).toHaveProperty('error');
  });

  it('returns 200 with an answer string', async () => {
    stubConfig.chatContent = 'TypeScript is great.';
    const res = await request(app)
      .post('/ai/ask')
      .send({ question: 'What is TypeScript?' })
      .expect(200);

    expect(typeof res.body.answer).toBe('string');
    expect(res.body.answer).toBe('TypeScript is great.');
  });

  it('accepts an optional context field', async () => {
    stubConfig.chatContent = 'With context answer.';
    const res = await request(app)
      .post('/ai/ask')
      .send({ question: 'What?', context: 'You are an expert.' })
      .expect(200);

    expect(typeof res.body.answer).toBe('string');
  });

  it('accepts a model override', async () => {
    stubConfig.chatContent = 'ok';
    const res = await request(app)
      .post('/ai/ask')
      .send({ question: 'test', model: 'llama3:70b' })
      .expect(200);

    expect(res.body.model).toBe('llama3:70b');
  });

  it('returns 502 when Ollama returns an error', async () => {
    stubConfig.chatError = 'service unavailable';
    const res = await request(app)
      .post('/ai/ask')
      .send({ question: 'test' })
      .expect(502);

    expect(res.body).toHaveProperty('error');
    stubConfig.chatError = undefined;
  });
});

// ── CORS ───────────────────────────────────────────────────────
describe('CORS headers', () => {
  it('all responses include Access-Control-Allow-Origin: *', async () => {
    stubConfig.chatContent = 'ok';
    const res = await request(app).get('/ai/models');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
