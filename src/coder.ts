#!/usr/bin/env node
// coder.ts — Autonomous local coding agent powered by Ollama
//
// When cloud AI credits run out, use this to keep coding.
//
// Usage:
//   npx tsx src/coder.ts "Add a health check endpoint to src/index.ts"
//   npx tsx src/coder.ts --task tasks/my-task.md
//   npx tsx src/coder.ts --interactive

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type {
  OllamaChatMessage,
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaTagsResponse,
  OllamaModel,
  ProjectFile,
  FileBlock,
  TaskResult,
  AnsiColors,
} from './types';
import { getErrorMessage } from './utils';

// ── Configuration ──────────────────────────────────────────────
const OLLAMA_URL: string = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const OLLAMA_MODEL: string = process.env.OLLAMA_MODEL ?? 'qwen3:8b';
const PROJECT_ROOT: string = process.env.PROJECT_ROOT ?? process.cwd();

const INCLUDE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts', '.js', '.json', '.md', '.html', '.css', '.vue',
  '.yaml', '.yml', '.toml', '.sh',
]);

const EXCLUDE_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', 'dist', '.nuxt', '.next', '.output',
  'coverage', '.cache', 'projects', 'readysites', 'templates',
]);

const SKIP_FILENAMES: ReadonlySet<string> = new Set(['pnpm-lock.yaml']);

const MAX_FILE_SIZE = 50_000; // bytes

// Language-only fence labels that are NOT file paths
const LANGUAGE_LABELS: ReadonlySet<string> = new Set([
  'typescript', 'javascript', 'json', 'html', 'css', 'bash', 'sh',
  'yaml', 'yml', 'markdown', 'md', 'text', 'txt', 'diff', 'sql',
  'python', 'py', 'vue', 'tsx', 'jsx',
]);

// ── ANSI Colors ────────────────────────────────────────────────
const c: AnsiColors = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  red:     '\x1b[31m',
};

function log(color: string, label: string, msg: string): void {
  console.log(`${color}${c.bold}[${label}]${c.reset} ${msg}`);
}

// ── Ollama API ─────────────────────────────────────────────────
function callOllama(messages: OllamaChatMessage[], model?: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const request: OllamaChatRequest = {
      model: model ?? OLLAMA_MODEL,
      messages,
      stream: false,
      options: { num_ctx: 8192 },
    };
    const payload = JSON.stringify(request);

    const url = new URL('/api/chat', OLLAMA_URL);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 600_000, // 10 min for slow CPUs
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try {
            const result = JSON.parse(data) as OllamaChatResponse;
            if (result.error) {
              reject(new Error(`Ollama: ${result.error}`));
              return;
            }
            resolve(result.message?.content ?? '');
          } catch (e) {
            reject(new Error(`Bad Ollama response: ${data.slice(0, 300)}`));
          }
        });
      }
    );

    req.on('error', (err: NodeJS.ErrnoException) =>
      reject(new Error(`Ollama unreachable: ${err.message}`))
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Ollama request timed out (10 min)'));
    });

    req.write(payload);
    req.end();
  });
}

// ── File System Helpers ────────────────────────────────────────
function scanProject(dir: string, baseDir: string = dir): ProjectFile[] {
  const files: ProjectFile[] = [];
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry.name)) {
        files.push(...scanProject(fullPath, baseDir));
      }
    } else if (entry.isFile()) {
      if (SKIP_FILENAMES.has(entry.name)) continue;
      const ext = path.extname(entry.name);
      if (!INCLUDE_EXTENSIONS.has(ext)) continue;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size <= MAX_FILE_SIZE) {
          files.push({ path: relPath, content: fs.readFileSync(fullPath, 'utf8') });
        }
      } catch { /* skip unreadable files */ }
    }
  }

  return files;
}

function buildProjectContext(dir: string): string {
  const files = scanProject(dir);
  if (files.length === 0) return 'No project files found.';

  let context = `Project root: ${dir}\nFiles (${files.length}):\n\n`;
  for (const file of files) {
    context += `--- ${file.path} ---\n${file.content}\n\n`;
  }
  return context;
}

// ── Response Parser ────────────────────────────────────────────
function parseFileBlocks(response: string): FileBlock[] {
  const blocks: FileBlock[] = [];
  const regex = /```(\S+)?\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(response)) !== null) {
    let filePath = (match[1] ?? '').trim();
    const content = match[2] ?? '';

    if (LANGUAGE_LABELS.has(filePath)) {
      const before = response.slice(0, match.index);
      const pathMatch = before.match(
        /(?:create|write|update|modify|edit|file)[:\s]+[`"]?([^\s`"]+\.\w+)[`"]?\s*$/i
      );
      if (pathMatch?.[1]) {
        filePath = pathMatch[1];
      } else {
        continue;
      }
    }

    if (filePath && !filePath.startsWith('//') && filePath.includes('.')) {
      blocks.push({
        path: filePath.replace(/^\/+/, ''),
        content: content.trimEnd() + '\n',
      });
    }
  }

  return blocks;
}

// ── Core Agent ─────────────────────────────────────────────────
async function runTask(task: string, projectDir: string, model?: string): Promise<TaskResult> {
  log(c.cyan, 'TASK', task);
  log(c.blue, 'MODEL', model ?? OLLAMA_MODEL);
  log(c.blue, 'PROJECT', projectDir);

  log(c.dim, 'SCAN', 'Reading project files...');
  const context = buildProjectContext(projectDir);
  const fileCount = (context.match(/^--- /gm) ?? []).length;
  log(c.dim, 'SCAN', `Found ${fileCount} files`);

  const systemPrompt = `You are an expert software engineer working on a TypeScript project. You have access to all the project files below.

RULES:
1. When you need to create or modify files, output the COMPLETE file contents in a fenced code block with the file path as the language tag.
   Example: \`\`\`src/utils.ts
   // file contents here
   \`\`\`
2. Always output the FULL file — never use "..." or "// rest of file" shortcuts.
3. If you modify an existing file, include ALL its content (changed and unchanged lines).
4. Explain what you're doing briefly before each file block.
5. If the task is a question, just answer it — no file changes needed.

PROJECT FILES:
${context}`;

  const messages: OllamaChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task },
  ];

  log(c.yellow, 'AI', 'Thinking (this may take a few minutes on CPU)...');
  const startTime = Date.now();

  let response: string;
  try {
    response = await callOllama(messages, model);
  } catch (err) {
    log(c.red, 'ERROR', getErrorMessage(err));
    return { success: false, error: getErrorMessage(err) };
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(c.green, 'AI', `Response received in ${elapsed}s`);

  console.log(`\n${c.magenta}${c.bold}── AI Response ──${c.reset}\n`);
  console.log(response);
  console.log(`\n${c.magenta}${c.bold}── End Response ──${c.reset}\n`);

  const fileBlocks = parseFileBlocks(response);

  if (fileBlocks.length === 0) {
    log(c.dim, 'FILES', 'No file changes detected in response.');
    return { success: true, filesWritten: 0, response };
  }

  log(c.yellow, 'FILES', `${fileBlocks.length} file(s) to write:`);
  for (const block of fileBlocks) {
    console.log(`  ${c.cyan}→${c.reset} ${block.path}`);
  }

  const confirmed = await askUser('\nApply these changes? (y/n) ');
  if (confirmed.toLowerCase() !== 'y' && confirmed.toLowerCase() !== 'yes') {
    log(c.yellow, 'SKIP', 'Changes not applied.');
    return { success: true, filesWritten: 0, response };
  }

  let written = 0;
  for (const block of fileBlocks) {
    const fullPath = path.join(projectDir, block.path);
    try {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, block.content, 'utf8');
      log(c.green, 'WRITE', block.path);
      written++;
    } catch (err) {
      log(c.red, 'ERROR', `Failed to write ${block.path}: ${getErrorMessage(err)}`);
    }
  }

  log(c.green, 'DONE', `${written} file(s) written.`);
  return { success: true, filesWritten: written, response };
}

// ── User Prompt ────────────────────────────────────────────────
function askUser(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(prompt, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Interactive Mode ───────────────────────────────────────────
async function interactiveMode(projectDir: string, model?: string): Promise<void> {
  console.log(`
${c.cyan}${c.bold}╔══════════════════════════════════════════════╗
║         @waelio/coder — Local AI Agent       ║
║  Type a task, get code. No cloud needed.     ║
╚══════════════════════════════════════════════╝${c.reset}

${c.dim}Model: ${model ?? OLLAMA_MODEL}
Project: ${projectDir}
Type "quit" to exit, "model <name>" to switch models.${c.reset}
`);

  let currentModel: string | undefined = model;

  while (true) {
    const task = await askUser(`${c.cyan}task>${c.reset} `);

    if (!task) continue;
    if (task === 'quit' || task === 'exit') break;

    if (task.startsWith('model ')) {
      currentModel = task.slice(6).trim();
      log(c.blue, 'MODEL', `Switched to ${currentModel}`);
      continue;
    }

    if (task === 'models') {
      try {
        const url = new URL('/api/tags', OLLAMA_URL);
        const raw = await new Promise<string>((resolve, reject) => {
          http
            .get(
              { hostname: url.hostname, port: url.port, path: url.pathname },
              (r) => {
                let d = '';
                r.on('data', (chunk: Buffer) => { d += chunk.toString(); });
                r.on('end', () => { resolve(d); });
              }
            )
            .on('error', (err: NodeJS.ErrnoException) => { reject(err); });
        });

        const tags = JSON.parse(raw) as OllamaTagsResponse;
        console.log('\nAvailable models:');
        for (const m of (tags.models ?? [])) {
          const modelName: string = (m as OllamaModel).name;
          const active = modelName === (currentModel ?? OLLAMA_MODEL) ? ' ← active' : '';
          const sizeGb = m.size !== undefined ? ` (${(m.size / 1e9).toFixed(1)}GB)` : '';
          console.log(`  ${c.cyan}•${c.reset} ${modelName}${sizeGb}${c.green}${active}${c.reset}`);
        }
        console.log();
      } catch (err) {
        log(c.red, 'ERROR', `Can't list models: ${getErrorMessage(err)}`);
      }
      continue;
    }

    await runTask(task, projectDir, currentModel);
    console.log();
  }

  console.log(`${c.dim}Goodbye.${c.reset}`);
}

// ── CLI Entry Point ────────────────────────────────────────────
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${c.bold}@waelio/coder${c.reset} — Autonomous local coding agent

${c.bold}Usage:${c.reset}
  npx tsx src/coder.ts "your task here"             Run a single task
  npx tsx src/coder.ts --task path/to/task.md       Read task from file
  npx tsx src/coder.ts --interactive                Interactive mode
  npx tsx src/coder.ts --interactive --model qwen3:8b

${c.bold}Environment:${c.reset}
  OLLAMA_URL     Ollama endpoint (default: http://127.0.0.1:11434)
  OLLAMA_MODEL   Default model  (default: qwen3:8b)
  PROJECT_ROOT   Project directory (default: current dir)

${c.bold}In interactive mode:${c.reset}
  models         List available Ollama models
  model <name>   Switch to a different model
  quit           Exit
`);
    return;
  }

  const modelFlagIdx = args.indexOf('--model');
  const model: string | undefined = modelFlagIdx !== -1 ? args[modelFlagIdx + 1] : undefined;
  const projectDir: string = PROJECT_ROOT;

  if (args.includes('--interactive') || args.includes('-i')) {
    await interactiveMode(projectDir, model);
    return;
  }

  const taskFlagIdx = args.indexOf('--task');
  let task: string;

  if (taskFlagIdx !== -1 && args[taskFlagIdx + 1]) {
    const taskFile = args[taskFlagIdx + 1];
    try {
      task = fs.readFileSync(taskFile, 'utf8').trim();
    } catch (err) {
      log(c.red, 'ERROR', `Can't read task file: ${getErrorMessage(err)}`);
      process.exit(1);
    }
  } else {
    task = args
      .filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1]?.startsWith('--')))
      .join(' ')
      .trim();
  }

  if (!task) {
    console.log('No task provided. Use --help for usage, or --interactive for chat mode.');
    process.exit(1);
  }

  const result = await runTask(task, projectDir, model);
  process.exit(result.success ? 0 : 1);
}

main().catch((err: unknown) => {
  log(c.red, 'FATAL', getErrorMessage(err));
  process.exit(1);
});
