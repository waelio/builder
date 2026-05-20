/**
 * E2E tests for src/coder.ts — the autonomous CLI coding agent.
 *
 * Since coder.ts exports nothing (it's a CLI entry point), tests spawn it
 * as a child process using `tsx`. This validates real CLI behaviour.
 *
 * Tests that require Ollama use a local HTTP stub and pass it via
 * the OLLAMA_URL env var.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// ── Helpers ────────────────────────────────────────────────────
interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCoder(
  args: string[],
  opts: { input?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}
): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    const child: ChildProcess = spawn(
      'npx',
      ['tsx', path.resolve(process.cwd(), 'src/coder.ts'), ...args],
      {
        env: { ...process.env, ...opts.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, opts.timeoutMs ?? 10_000);

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    if (opts.input !== undefined) {
      child.stdin?.write(opts.input);
      child.stdin?.end();
    }
  });
}

// ── Ollama stub (for task tests) ───────────────────────────────
let ollamaStub: http.Server;
let ollamaPort: number;
let stubResponse = 'Here is the answer to your question. No files to write.';

function startOllamaStub(): Promise<void> {
  return new Promise<void>((resolve) => {
    ollamaStub = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        if (req.url === '/api/chat') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: { content: stubResponse } }));
          return;
        }
        if (req.url === '/api/tags') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ models: [{ name: 'qwen3:8b', size: 5_000_000_000 }] }));
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

let tmpProjectDir: string;

beforeAll(async () => {
  await startOllamaStub();
  tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waelio-coder-e2e-'));
  // Write a minimal TS file so scanProject finds something
  fs.writeFileSync(
    path.join(tmpProjectDir, 'hello.ts'),
    'export const greeting = "hello";\n',
    'utf8'
  );
});

afterAll(() => {
  fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  return new Promise<void>((resolve, reject) => {
    ollamaStub.close((e) => (e ? reject(e) : resolve()));
  });
});

// ── --help flag ────────────────────────────────────────────────
describe('--help flag', () => {
  it('exits with code 0', async () => {
    const result = await runCoder(['--help']);
    expect(result.exitCode).toBe(0);
  });

  it('prints usage information', async () => {
    const result = await runCoder(['--help']);
    expect(result.stdout).toContain('@waelio/coder');
    expect(result.stdout).toContain('Usage');
  });

  it('mentions --task, --interactive, and --model flags', async () => {
    const result = await runCoder(['--help']);
    expect(result.stdout).toContain('--task');
    expect(result.stdout).toContain('--interactive');
    expect(result.stdout).toContain('--model');
  });

  it('mentions OLLAMA_URL and OLLAMA_MODEL env vars', async () => {
    const result = await runCoder(['--help']);
    expect(result.stdout).toContain('OLLAMA_URL');
    expect(result.stdout).toContain('OLLAMA_MODEL');
  });

  it('-h is an alias for --help', async () => {
    const result = await runCoder(['-h']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('@waelio/coder');
  });
});

// ── No args ────────────────────────────────────────────────────
describe('no arguments', () => {
  it('exits with code 1 when no task is provided', async () => {
    const result = await runCoder([], {
      env: { OLLAMA_URL: `http://127.0.0.1:${ollamaPort}` },
    });
    expect(result.exitCode).toBe(1);
  });

  it('prints a hint to use --interactive or --help', async () => {
    const result = await runCoder([], {
      env: { OLLAMA_URL: `http://127.0.0.1:${ollamaPort}` },
    });
    expect(result.stdout).toMatch(/--help|--interactive/i);
  });
});

// ── --task flag with a missing file ───────────────────────────
describe('--task flag', () => {
  it('exits with code 1 when the task file does not exist', async () => {
    const result = await runCoder(['--task', '/non/existent/task.md'], {
      env: { OLLAMA_URL: `http://127.0.0.1:${ollamaPort}` },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/can't read|error/i);
  });

  it('reads and runs the task from a file', async () => {
    const taskFile = path.join(tmpProjectDir, 'task.md');
    fs.writeFileSync(taskFile, 'What is TypeScript?', 'utf8');
    stubResponse = 'TypeScript is a typed superset of JavaScript.';

    const result = await runCoder(['--task', taskFile], {
      env: {
        OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`,
        PROJECT_ROOT: tmpProjectDir,
      },
      // Decline file writes (no files to write so this resolves immediately)
      input: 'n\n',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('TypeScript is a typed superset');
  });
});

// ── inline task argument ───────────────────────────────────────
describe('inline task argument', () => {
  it('runs a task and exits 0 when Ollama responds with no file blocks', async () => {
    stubResponse = 'The answer is 42. No files to create.';

    const result = await runCoder(['What is the answer to life?'], {
      env: {
        OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`,
        PROJECT_ROOT: tmpProjectDir,
      },
      input: 'n\n',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('42');
  });

  it('prints AI Response and End Response markers', async () => {
    stubResponse = 'Some AI output here.';

    const result = await runCoder(['Explain this project'], {
      env: {
        OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`,
        PROJECT_ROOT: tmpProjectDir,
      },
      input: 'n\n',
    });

    expect(result.stdout).toContain('AI Response');
    expect(result.stdout).toContain('End Response');
  });

  it('detects file blocks in the response and lists them', async () => {
    stubResponse = [
      'I will create a new file:',
      '```src/output.ts',
      'export const x = 1;',
      '```',
    ].join('\n');

    const result = await runCoder(['Create a file'], {
      env: {
        OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`,
        PROJECT_ROOT: tmpProjectDir,
      },
      input: 'n\n', // Decline the write
    });

    expect(result.stdout).toContain('src/output.ts');
  });

  it('writes files when the user confirms with y', async () => {
    const outFile = 'src/confirmed.ts';
    stubResponse = [
      'Creating confirmed.ts:',
      '```src/confirmed.ts',
      'export const confirmed = true;',
      '```',
    ].join('\n');

    await runCoder(['Create confirmed.ts'], {
      env: {
        OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`,
        PROJECT_ROOT: tmpProjectDir,
      },
      input: 'y\n',
    });

    const written = path.join(tmpProjectDir, outFile);
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.readFileSync(written, 'utf8')).toContain('confirmed = true');
  });

  it('skips writing files when the user declines', async () => {
    const outFile = 'src/skipped.ts';
    stubResponse = [
      'Skipping this one:',
      '```src/skipped.ts',
      'export const skipped = true;',
      '```',
    ].join('\n');

    await runCoder(['Create skipped.ts'], {
      env: {
        OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`,
        PROJECT_ROOT: tmpProjectDir,
      },
      input: 'n\n',
    });

    expect(fs.existsSync(path.join(tmpProjectDir, outFile))).toBe(false);
  });
});

// ── --interactive mode ─────────────────────────────────────────
describe('--interactive mode', () => {
  it('starts and exits cleanly when user types quit', async () => {
    const result = await runCoder(['--interactive'], {
      env: {
        OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`,
        PROJECT_ROOT: tmpProjectDir,
      },
      input: 'quit\n',
      timeoutMs: 8_000,
    });

    expect(result.stdout).toContain('Local AI Agent');
    expect(result.stdout).toContain('Goodbye');
  });

  it('shows available models when user types "models"', async () => {
    const result = await runCoder(['--interactive'], {
      env: {
        OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`,
        PROJECT_ROOT: tmpProjectDir,
      },
      input: 'models\nquit\n',
      timeoutMs: 8_000,
    });

    expect(result.stdout).toContain('qwen3:8b');
  });

  it('switches model when user types "model <name>"', async () => {
    const result = await runCoder(['--interactive'], {
      env: {
        OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`,
        PROJECT_ROOT: tmpProjectDir,
      },
      input: 'model llama3:70b\nquit\n',
      timeoutMs: 8_000,
    });

    expect(result.stdout).toContain('llama3:70b');
  });
});
