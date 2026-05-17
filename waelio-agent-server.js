// waelio-agent-server.js
// Serves the @waelio/agent PWA and proxies API calls to a FastAPI/Ollama backend.
//
// The @waelio/agent package is a Vite PWA — it ships source (index.html + src/).
// This server:
//   1. Builds the PWA with Vite on startup (or serves the source in dev mode)
//   2. Proxies /run_sse, /models, /apps/* to the configured backend (FastAPI or Ollama)

const http = require('node:http');
const { URL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

const AGENT_PORT = Number(process.env.AGENT_PORT || 3005);
const BACKEND_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3:70b';

// Resolve the @waelio/agent package directory
const agentDir = path.dirname(require.resolve('@waelio/agent/package.json'));

// ── Mime types for static serving ──────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ts': 'text/plain',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// ── Simple proxy helper ────────────────────────────────────────
function proxyRequest(req, res, targetBase) {
  const targetUrl = new URL(req.url, targetBase);

  const proxyOpts = {
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetUrl.host,
    },
  };

  const proxyReq = http.request(proxyOpts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, ngrok-skip-browser-warning',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`Proxy error: ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Backend unreachable: ${err.message}` }));
  });

  req.pipe(proxyReq);
}

// ── Ollama-to-Agent adapter ────────────────────────────────────
// Converts Ollama /api/chat response into the SSE format @waelio/agent expects
function handleRunSse(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body);
      const userText = payload.new_message?.parts?.[0]?.text || '';
      const model = payload.model || OLLAMA_MODEL;

      // Call Ollama /api/chat
      const ollamaPayload = JSON.stringify({
        model,
        messages: [{ role: 'user', content: userText }],
        stream: false,
      });

      const ollamaUrl = new URL('/api/chat', BACKEND_URL);
      const ollamaReq = http.request({
        hostname: ollamaUrl.hostname,
        port: ollamaUrl.port,
        path: ollamaUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(ollamaPayload),
        },
      }, (ollamaRes) => {
        let data = '';
        ollamaRes.on('data', (chunk) => { data += chunk; });
        ollamaRes.on('end', () => {
          try {
            const result = JSON.parse(data);
            const replyText = result.message?.content || 'No response from model.';

            // Format as SSE that @waelio/agent expects
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*',
            });
            const event = {
              content: { parts: [{ text: replyText }] },
              finishReason: 'STOP',
            };
            res.write(`data: ${JSON.stringify(event)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Ollama parse error: ${err.message}` }));
          }
        });
      });

      ollamaReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Ollama unreachable: ${err.message}` }));
      });

      ollamaReq.write(ollamaPayload);
      ollamaReq.end();
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Bad request: ${err.message}` }));
    }
  });
}

// ── Models endpoint ────────────────────────────────────────────
function handleModels(req, res) {
  const ollamaUrl = new URL('/api/tags', BACKEND_URL);
  http.get({
    hostname: ollamaUrl.hostname,
    port: ollamaUrl.port,
    path: ollamaUrl.pathname,
  }, (ollamaRes) => {
    let data = '';
    ollamaRes.on('data', (chunk) => { data += chunk; });
    ollamaRes.on('end', () => {
      try {
        const result = JSON.parse(data);
        const models = (result.models || []).map((m) => m.name || m.model);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ models, default: OLLAMA_MODEL }));
      } catch {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ models: [OLLAMA_MODEL], default: OLLAMA_MODEL }));
      }
    });
  }).on('error', () => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ models: [OLLAMA_MODEL], default: OLLAMA_MODEL }));
  });
}

// ── Sessions endpoint (stub) ──────────────────────────────────
function handleCreateSession(req, res) {
  const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({ id }));
}

// ── Static file server for @waelio/agent ──────────────────────
function serveStatic(req, res) {
  let filePath = req.url.split('?')[0];
  if (filePath === '/' || filePath === '/social') filePath = '/index.html';

  const absPath = path.join(agentDir, filePath);

  // Security: prevent directory traversal
  if (!absPath.startsWith(agentDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(absPath)) {
    // SPA fallback
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
  const contentType = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(absPath).pipe(res);
}

// ── HTTP server ────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, ngrok-skip-browser-warning',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${AGENT_PORT}`);
  const pathname = url.pathname;

  // API routes (what @waelio/agent calls)
  if (pathname === '/run_sse' && req.method === 'POST') {
    return handleRunSse(req, res);
  }

  if (pathname === '/models' && req.method === 'GET') {
    return handleModels(req, res);
  }

  if (pathname.startsWith('/apps/') && pathname.includes('/sessions') && req.method === 'POST') {
    return handleCreateSession(req, res);
  }

  // Everything else: serve the @waelio/agent PWA files
  serveStatic(req, res);
});

server.listen(AGENT_PORT, () => {
  console.log(`@waelio/agent PWA serving at http://localhost:${AGENT_PORT}`);
  console.log(`Proxying AI requests to Ollama at ${BACKEND_URL}`);
  console.log(`Default model: ${OLLAMA_MODEL}`);
});
