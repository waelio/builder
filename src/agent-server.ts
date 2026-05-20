#!/usr/bin/env node
// agent-server.ts
// Serves the @waelio/agent PWA and proxies API calls to a FastAPI/Ollama backend.
//
// The @waelio/agent package is a Vite PWA — it ships source (index.html + src/).
// This server:
//   1. Serves the built PWA as static files
//   2. Proxies /run_sse, /models, /apps/* to the configured backend (FastAPI or Ollama)

import http from 'node:http';
import { URL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import type {
  AgentRunPayload,
  AgentSseEvent,
  ModelsResponse,
  SessionResponse,
  OllamaTagsResponse,
} from './types';
import { getErrorMessage } from './utils';

const AGENT_PORT = Number(process.env.AGENT_PORT ?? 3005);
const BACKEND_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3:70b';

// Resolve the @waelio/agent package directory (CJS context — require is available)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const agentDir: string = path.dirname(require.resolve('@waelio/agent/package.json'));

// ── Mime types for static serving ──────────────────────────────
const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ts': 'text/plain',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
} as const;

const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, ngrok-skip-browser-warning',
} as const;

// ── Simple proxy helper ────────────────────────────────────────
function proxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  targetBase: string
): void {
  const targetUrl = new URL(req.url ?? '/', targetBase);

  const proxyOpts: http.RequestOptions = {
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: { ...req.headers, host: targetUrl.host },
  };

  const proxyReq = http.request(proxyOpts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, {
      ...proxyRes.headers,
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, ngrok-skip-browser-warning',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`Proxy error: ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Backend unreachable: ${err.message}` }));
  });

  req.pipe(proxyReq);
}

// ── Ollama-to-Agent SSE adapter ────────────────────────────────
function handleRunSse(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = '';
  req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
  req.on('end', () => {
    let payload: AgentRunPayload;
    try {
      payload = JSON.parse(body) as AgentRunPayload;
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Bad request: ${getErrorMessage(err)}` }));
      return;
    }

    const userText = payload.new_message?.parts?.[0]?.text ?? '';
    const model = payload.model ?? OLLAMA_MODEL;

    const ollamaPayload = JSON.stringify({
      model,
      messages: [{ role: 'user', content: userText }],
      stream: false,
    });

    const ollamaUrl = new URL('/api/chat', BACKEND_URL);
    const ollamaReq = http.request(
      {
        hostname: ollamaUrl.hostname,
        port: ollamaUrl.port,
        path: ollamaUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(ollamaPayload),
        },
      },
      (ollamaRes) => {
        let data = '';
        ollamaRes.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        ollamaRes.on('end', () => {
          try {
            const result = JSON.parse(data) as { message?: { content?: string } };
            const replyText = result.message?.content ?? 'No response from model.';

            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*',
            });

            const event: AgentSseEvent = {
              content: { parts: [{ text: replyText }] },
              finishReason: 'STOP',
            };
            res.write(`data: ${JSON.stringify(event)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Ollama parse error: ${getErrorMessage(err)}` }));
          }
        });
      }
    );

    ollamaReq.on('error', (err: NodeJS.ErrnoException) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Ollama unreachable: ${err.message}` }));
    });

    ollamaReq.write(ollamaPayload);
    ollamaReq.end();
  });
}

// ── Models endpoint ────────────────────────────────────────────
function handleModels(_req: http.IncomingMessage, res: http.ServerResponse): void {
  const ollamaUrl = new URL('/api/tags', BACKEND_URL);

  const sendFallback = (): void => {
    const body: ModelsResponse = { models: [OLLAMA_MODEL], default: OLLAMA_MODEL };
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify(body));
  };

  http
    .get(
      { hostname: ollamaUrl.hostname, port: ollamaUrl.port, path: ollamaUrl.pathname },
      (ollamaRes) => {
        let data = '';
        ollamaRes.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        ollamaRes.on('end', () => {
          try {
            const result = JSON.parse(data) as OllamaTagsResponse;
            const models = (result.models ?? []).map((m) => m.name ?? m.model ?? 'unknown');
            const body: ModelsResponse = { models, default: OLLAMA_MODEL };
            res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
            res.end(JSON.stringify(body));
          } catch {
            sendFallback();
          }
        });
      }
    )
    .on('error', sendFallback);
}

// ── Sessions endpoint (stub) ──────────────────────────────────
function handleCreateSession(_req: http.IncomingMessage, res: http.ServerResponse): void {
  const body: SessionResponse = {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(body));
}

// ── Static file server for @waelio/agent ──────────────────────
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  let filePath = (req.url ?? '/').split('?')[0];
  if (filePath === '/' || filePath === '/social') filePath = '/index.html';

  const absPath = path.join(agentDir, filePath);

  // Security: prevent directory traversal
  if (!absPath.startsWith(agentDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(absPath)) {
    const indexPath = path.join(agentDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(absPath);
  const contentType = MIME[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(absPath).pipe(res);
}

// ── HTTP server ────────────────────────────────────────────────
export const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${AGENT_PORT}`);
  const { pathname } = url;

  if (pathname === '/run_sse' && req.method === 'POST') {
    handleRunSse(req, res);
    return;
  }

  if (pathname === '/models' && req.method === 'GET') {
    handleModels(req, res);
    return;
  }

  if (pathname.startsWith('/apps/') && pathname.includes('/sessions') && req.method === 'POST') {
    handleCreateSession(req, res);
    return;
  }

  serveStatic(req, res);
});

server.listen(AGENT_PORT, () => {
  console.log(`@waelio/agent PWA serving at http://localhost:${AGENT_PORT}`);
  console.log(`Proxying AI requests to Ollama at ${BACKEND_URL}`);
  console.log(`Default model: ${OLLAMA_MODEL}`);
});
