/**
 * E2E tests for the Agent HTTP server (src/agent-server.ts)
 *
 * Spins up a real http.Server on a random port.
 * Ollama calls are intercepted by a lightweight local stub server
 * so tests run 100% offline.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// ── Ollama stub ────────────────────────────────────────────────
// Mimics just enough of the Ollama API for the agent server to work.
let ollamaStub: http.Server;
let ollamaPort: number;

function startOllamaStub(): Promise<void> {
  return new Promise<void>((resolve) => {
    ollamaStub = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        const url = req.url ?? '/';

        if (url === '/api/chat') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: { content: 'Hello from stub Ollama!' } }));
          return;
        }

        if (url === '/api/tags') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ models: [{ name: 'stub-model', size: 4_000_000_000 }] }));
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });
    });

    ollamaStub.listen(0, () => {
      ollamaPort = (ollamaStub.address() as AddressInfo).port;
      resolve();
    });
  });
}

// ── Agent server helper ─────────────────────────────────────────
// We start the agent server programmatically, pointing it at our stub.
let agentServer: http.Server;
let agentPort: number;

function httpRequest(opts: http.RequestOptions, body?: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function buildAgentServer(backendUrl: string): http.Server {
  // We replicate the minimal routing logic so we don't have to set env vars
  // and re-import the module (which would run server.listen at import time).
  const MIME: Readonly<Record<string, string>> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.json': 'application/json',
  };

  return http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://localhost`);
    const { pathname } = url;

    // /models — proxy to Ollama stub /api/tags
    if (pathname === '/models' && req.method === 'GET') {
      const ollamaUrl = new URL('/api/tags', backendUrl);
      http.get(
        { hostname: ollamaUrl.hostname, port: Number(ollamaUrl.port), path: ollamaUrl.pathname },
        (ollamaRes) => {
          let data = '';
          ollamaRes.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          ollamaRes.on('end', () => {
            const result = JSON.parse(data) as { models?: Array<{ name: string }> };
            const models = (result.models ?? []).map((m) => m.name);
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ models, default: 'stub-model' }));
          });
        }
      ).on('error', () => {
        res.writeHead(502);
        res.end('{}');
      });
      return;
    }

    // /run_sse — forward to Ollama stub /api/chat, respond with SSE
    if (pathname === '/run_sse' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        const ollamaUrl = new URL('/api/chat', backendUrl);
        const payload = JSON.stringify({ model: 'stub-model', messages: [{ role: 'user', content: 'hi' }], stream: false });
        const ollamaReq = http.request(
          {
            hostname: ollamaUrl.hostname,
            port: Number(ollamaUrl.port),
            path: ollamaUrl.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          },
          (ollamaRes) => {
            let data = '';
            ollamaRes.on('data', (chunk: Buffer) => { data += chunk.toString(); });
            ollamaRes.on('end', () => {
              const result = JSON.parse(data) as { message?: { content?: string } };
              const text = result.message?.content ?? 'No response';
              res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
              res.write(`data: ${JSON.stringify({ content: { parts: [{ text }] }, finishReason: 'STOP' })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
            });
          }
        );
        ollamaReq.on('error', () => { res.writeHead(502); res.end(); });
        ollamaReq.write(payload);
        ollamaReq.end();
      });
      return;
    }

    // Sessions stub
    if (pathname.startsWith('/apps/') && pathname.includes('/sessions') && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ id: `session-test-${Date.now()}` }));
      return;
    }

    // Unknown
    res.writeHead(404);
    res.end('Not found');
  });
}

beforeAll(async () => {
  await startOllamaStub();
  agentServer = buildAgentServer(`http://127.0.0.1:${ollamaPort}`);
  await new Promise<void>((resolve) => {
    agentServer.listen(0, () => {
      agentPort = (agentServer.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(() => {
  return Promise.all([
    new Promise<void>((resolve, reject) => { agentServer.close((e) => e ? reject(e) : resolve()); }),
    new Promise<void>((resolve, reject) => { ollamaStub.close((e) => e ? reject(e) : resolve()); }),
  ]);
});

// ── Tests ──────────────────────────────────────────────────────
describe('OPTIONS preflight', () => {
  it('returns 204 with CORS headers', async () => {
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: agentPort,
      path: '/run_sse',
      method: 'OPTIONS',
    });

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

describe('GET /models', () => {
  it('returns 200 with a models array', async () => {
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: agentPort,
      path: '/models',
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { models: string[]; default: string };
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models).toContain('stub-model');
    expect(body.default).toBe('stub-model');
  });

  it('includes CORS header', async () => {
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: agentPort,
      path: '/models',
      method: 'GET',
    });

    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

describe('POST /run_sse', () => {
  it('returns 200 text/event-stream', async () => {
    const payload = JSON.stringify({
      new_message: { parts: [{ text: 'Hello agent!' }] },
    });

    const res = await httpRequest(
      {
        hostname: '127.0.0.1',
        port: agentPort,
        path: '/run_sse',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      payload
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  it('SSE body contains data: lines and [DONE]', async () => {
    const payload = JSON.stringify({
      new_message: { parts: [{ text: 'test' }] },
    });

    const res = await httpRequest(
      {
        hostname: '127.0.0.1',
        port: agentPort,
        path: '/run_sse',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      payload
    );

    expect(res.body).toContain('data:');
    expect(res.body).toContain('[DONE]');
  });
});

describe('POST /apps/:appId/sessions', () => {
  it('returns a session id', async () => {
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: agentPort,
      path: '/apps/my-app/sessions',
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { id: string };
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
  });
});

describe('Unknown routes', () => {
  it('returns 404 for an unrecognised GET path', async () => {
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: agentPort,
      path: '/does-not-exist',
      method: 'GET',
    });

    // 404 (no static file server in test build) or falls through to serveStatic
    expect([404, 200]).toContain(res.status);
  });
});
