import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

function waitForLine(stream: NodeJS.ReadableStream, match: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for: ${match}`));
    }, timeoutMs);

    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      if (buffer.includes(match)) {
        cleanup();
        resolve();
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timer);
      stream.off('data', onData);
      stream.off('error', onError);
    };

    stream.on('data', onData);
    stream.on('error', onError);
  });
}

test('e2e webhook scaffolds blueprint project', { timeout: 15000 }, async () => {
  const port = 3100 + Math.floor(Math.random() * 500);
  const projectSlug = `e2e-site-${Date.now()}`;
  const repoRoot = process.cwd();
  const projectDir = path.join(repoRoot, 'projects', projectSlug);
  const serverPath = path.resolve(__dirname, '..', 'src', 'index.js');

  const serverProcess = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForLine(serverProcess.stdout, `Builder webhook listening on port ${port}`, 6000);

    const response = await fetch(`http://127.0.0.1:${port}/webhooks/blueprints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projects: [{ name: projectSlug }] })
    });

    assert.equal(response.status, 202);

    const payload = (await response.json()) as { projects: string[] };
    assert.equal(Array.isArray(payload.projects), true);

    assert.equal(fs.existsSync(projectDir), true);
    const expectedFiles = [
      'gent.md',
      'ABOUT',
      'CONTACT',
      'about',
      'CASL.AUTH',
      'MONGODB',
      'ORM',
      'SEO',
      'nativescript.config.ts'
    ];
    for (const fileName of expectedFiles) {
      assert.equal(fs.existsSync(path.join(projectDir, fileName)), true);
    }
  } finally {
    if (serverProcess.pid && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
