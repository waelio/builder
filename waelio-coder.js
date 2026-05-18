#!/usr/bin/env node
// ============================================================================
// waelio-coder.js — Autonomous local coding agent powered by Ollama
//
// When cloud AI credits run out, use this to keep coding.
//
// Usage:
//   node waelio-coder.js "Add a health check endpoint to src/index.ts"
//   node waelio-coder.js --task tasks/my-task.md
//   node waelio-coder.js --interactive
//
// It reads your code, sends it to Ollama, and writes the changes to disk.
// ============================================================================

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

// ── Configuration ──────────────────────────────────────────────
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';
const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();

// File patterns to include when reading the project
const INCLUDE_EXTENSIONS = [
  '.ts', '.js', '.json', '.md', '.html', '.css', '.vue',
  '.yaml', '.yml', '.toml', '.env.example', '.sh'
];
const EXCLUDE_DIRS = [
  'node_modules', '.git', 'dist', '.nuxt', '.next', '.output',
  'coverage', '.cache', 'pnpm-lock.yaml', 'projects', 'readysites', 'templates'
];
const MAX_FILE_SIZE = 50000; // bytes

// ── Colors ─────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(color, label, msg) {
  console.log(`${color}${c.bold}[${label}]${c.reset} ${msg}`);
}

// ── Ollama API ─────────────────────────────────────────────────
function callOllama(messages, model) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: model || OLLAMA_MODEL,
      messages,
      stream: false,
      options: { num_ctx: 8192 },
    });

    const url = new URL('/api/chat', OLLAMA_URL);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 600000, // 10 min for slow CPUs
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.error) {
            reject(new Error(`Ollama: ${result.error}`));
            return;
          }
          resolve(result.message?.content || '');
        } catch (e) {
          reject(new Error(`Bad Ollama response: ${data.slice(0, 300)}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Ollama unreachable: ${err.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Ollama request timed out (10 min)'));
    });

    req.write(payload);
    req.end();
  });
}

// ── File System Helpers ────────────────────────────────────────
function scanProject(dir, baseDir = dir) {
  const files = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return files; }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(entry.name)) {
        files.push(...scanProject(fullPath, baseDir));
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (INCLUDE_EXTENSIONS.includes(ext)) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size <= MAX_FILE_SIZE) {
            files.push({ path: relPath, content: fs.readFileSync(fullPath, 'utf8') });
          }
        } catch { /* skip */ }
      }
    }
  }
  return files;
}

function buildProjectContext(dir) {
  const files = scanProject(dir);
  if (files.length === 0) return 'No project files found.';

  let context = `Project root: ${dir}\nFiles (${files.length}):\n\n`;
  for (const file of files) {
    context += `--- ${file.path} ---\n${file.content}\n\n`;
  }
  return context;
}

// ── Response Parser ────────────────────────────────────────────
// Parses Ollama's response to extract file writes
function parseFileBlocks(response) {
  const blocks = [];
  // Match ```filepath or ``` filepath patterns
  const regex = /```(\S+)?\s*\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(response)) !== null) {
    let filePath = (match[1] || '').trim();
    const content = match[2];

    // Skip language-only labels like ```typescript without a path
    if (['typescript', 'javascript', 'json', 'html', 'css', 'bash', 'sh',
         'yaml', 'yml', 'markdown', 'md', 'text', 'txt', 'diff', 'sql',
         'python', 'py', 'vue', 'tsx', 'jsx'].includes(filePath)) {
      // Try to find the file path in the text before this block
      const before = response.slice(0, match.index);
      const pathMatch = before.match(/(?:create|write|update|modify|edit|file)[:\s]+[`"]?([^\s`"]+\.\w+)[`"]?\s*$/i);
      if (pathMatch) {
        filePath = pathMatch[1];
      } else {
        continue; // Can't determine file path, skip
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
async function runTask(task, projectDir, model) {
  log(c.cyan, 'TASK', task);
  log(c.blue, 'MODEL', model || OLLAMA_MODEL);
  log(c.blue, 'PROJECT', projectDir);

  // 1. Read project files
  log(c.dim, 'SCAN', 'Reading project files...');
  const context = buildProjectContext(projectDir);
  const fileCount = (context.match(/^--- /gm) || []).length;
  log(c.dim, 'SCAN', `Found ${fileCount} files`);

  // 2. Build the prompt
  const systemPrompt = `You are an expert software engineer working on a project. You have access to all the project files below.

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

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task },
  ];

  // 3. Call Ollama
  log(c.yellow, 'AI', `Thinking (this may take a few minutes on CPU)...`);
  const startTime = Date.now();

  let response;
  try {
    response = await callOllama(messages, model);
  } catch (err) {
    log(c.red, 'ERROR', err.message);
    return { success: false, error: err.message };
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(c.green, 'AI', `Response received in ${elapsed}s`);

  // 4. Print the response
  console.log(`\n${c.magenta}${c.bold}── AI Response ──${c.reset}\n`);
  console.log(response);
  console.log(`\n${c.magenta}${c.bold}── End Response ──${c.reset}\n`);

  // 5. Parse file blocks
  const fileBlocks = parseFileBlocks(response);

  if (fileBlocks.length === 0) {
    log(c.dim, 'FILES', 'No file changes detected in response.');
    return { success: true, filesWritten: 0, response };
  }

  // 6. Confirm before writing
  log(c.yellow, 'FILES', `${fileBlocks.length} file(s) to write:`);
  for (const block of fileBlocks) {
    console.log(`  ${c.cyan}→${c.reset} ${block.path}`);
  }

  const confirmed = await askUser('\nApply these changes? (y/n) ');

  if (confirmed.toLowerCase() !== 'y' && confirmed.toLowerCase() !== 'yes') {
    log(c.yellow, 'SKIP', 'Changes not applied.');
    return { success: true, filesWritten: 0, response };
  }

  // 7. Write files
  let written = 0;
  for (const block of fileBlocks) {
    const fullPath = path.join(projectDir, block.path);
    try {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, block.content, 'utf8');
      log(c.green, 'WRITE', block.path);
      written++;
    } catch (err) {
      log(c.red, 'ERROR', `Failed to write ${block.path}: ${err.message}`);
    }
  }

  log(c.green, 'DONE', `${written} file(s) written.`);
  return { success: true, filesWritten: written, response };
}

// ── Interactive Mode ───────────────────────────────────────────
function askUser(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function interactiveMode(projectDir, model) {
  console.log(`
${c.cyan}${c.bold}╔══════════════════════════════════════════════╗
║         @waelio/coder — Local AI Agent       ║
║  Type a task, get code. No cloud needed.     ║
╚══════════════════════════════════════════════╝${c.reset}

${c.dim}Model: ${model || OLLAMA_MODEL}
Project: ${projectDir}
Type "quit" to exit, "model <name>" to switch models.${c.reset}
`);

  let currentModel = model;

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
        const res = await new Promise((resolve, reject) => {
          http.get({ hostname: url.hostname, port: url.port, path: url.pathname }, (r) => {
            let d = ''; r.on('data', (c) => d += c); r.on('end', () => resolve(d));
          }).on('error', reject);
        });
        const tags = JSON.parse(res);
        console.log(`\nAvailable models:`);
        for (const m of tags.models || []) {
          const active = m.name === (currentModel || OLLAMA_MODEL) ? ' ← active' : '';
          console.log(`  ${c.cyan}•${c.reset} ${m.name} (${(m.size / 1e9).toFixed(1)}GB)${c.green}${active}${c.reset}`);
        }
        console.log();
      } catch (err) {
        log(c.red, 'ERROR', `Can't list models: ${err.message}`);
      }
      continue;
    }

    await runTask(task, projectDir, currentModel);
    console.log();
  }

  console.log(`${c.dim}Goodbye.${c.reset}`);
}

// ── CLI Entry Point ────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${c.bold}@waelio/coder${c.reset} — Autonomous local coding agent

${c.bold}Usage:${c.reset}
  node waelio-coder.js "your task here"           Run a single task
  node waelio-coder.js --task path/to/task.md      Read task from file
  node waelio-coder.js --interactive               Interactive mode
  node waelio-coder.js --interactive --model qwen3:8b

${c.bold}Environment:${c.reset}
  OLLAMA_URL     Ollama endpoint (default: http://127.0.0.1:11434)
  OLLAMA_MODEL   Default model (default: qwen3:8b)
  PROJECT_ROOT   Project directory (default: current dir)

${c.bold}In interactive mode:${c.reset}
  models         List available Ollama models
  model <name>   Switch to a different model
  quit           Exit
`);
    return;
  }

  const modelFlag = args.indexOf('--model');
  const model = modelFlag !== -1 ? args[modelFlag + 1] : undefined;
  const projectDir = PROJECT_ROOT;

  if (args.includes('--interactive') || args.includes('-i')) {
    await interactiveMode(projectDir, model);
    return;
  }

  const taskFlagIdx = args.indexOf('--task');
  let task;

  if (taskFlagIdx !== -1 && args[taskFlagIdx + 1]) {
    const taskFile = args[taskFlagIdx + 1];
    try {
      task = fs.readFileSync(taskFile, 'utf8').trim();
    } catch (err) {
      log(c.red, 'ERROR', `Can't read task file: ${err.message}`);
      process.exit(1);
    }
  } else {
    // Remaining args (not flags) are the task
    task = args
      .filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1]?.startsWith('--')))
      .join(' ')
      .trim();
  }

  if (!task) {
    console.log(`No task provided. Use --help for usage, or --interactive for chat mode.`);
    process.exit(1);
  }

  const result = await runTask(task, projectDir, model);
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  log(c.red, 'FATAL', err.message);
  process.exit(1);
});
