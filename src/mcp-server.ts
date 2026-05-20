#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import path from 'node:path';
import fs from 'node:fs';
import { scaffoldFromBlueprint } from './project-scaffold';
import * as ai from './ai';
import { getErrorMessage } from './utils';
import type { ProjectFile } from './types';

// ── Constants ─────────────────────────────────────────────────

const INCLUDE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts', '.js', '.json', '.md', '.html', '.css', '.vue',
  '.yaml', '.yml', '.toml', '.sh',
]);

const EXCLUDE_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', 'dist', '.nuxt', '.next', '.output',
  'coverage', '.cache', 'projects', 'readysites', 'templates',
]);

const MAX_FILE_SIZE = 50_000; // bytes
const MAX_CONTEXT_CHARS = 80_000; // chars total for project context

// ── Helpers ───────────────────────────────────────────────────

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
      const ext = path.extname(entry.name);
      if (!INCLUDE_EXTENSIONS.has(ext)) continue;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size <= MAX_FILE_SIZE) {
          files.push({ path: relPath, content: fs.readFileSync(fullPath, 'utf8') });
        }
      } catch { /* skip unreadable */ }
    }
  }
  return files;
}

function buildContext(files: ProjectFile[]): string {
  let context = '';
  for (const file of files) {
    const block = `--- ${file.path} ---\n${file.content}\n\n`;
    if ((context + block).length > MAX_CONTEXT_CHARS) break;
    context += block;
  }
  return context;
}

// Language-only fence labels that are NOT file paths
const LANGUAGE_LABELS: ReadonlySet<string> = new Set([
  'typescript', 'javascript', 'json', 'html', 'css', 'bash', 'sh',
  'yaml', 'yml', 'markdown', 'md', 'text', 'txt', 'diff', 'sql',
  'python', 'py', 'vue', 'tsx', 'jsx',
]);

function parseFileBlocks(response: string): Array<{ path: string; content: string }> {
  const blocks: Array<{ path: string; content: string }> = [];
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

// ── MCP Server ────────────────────────────────────────────────

const server = new Server(
  {
    name: 'waelio-builder-mcp',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ── Tool Definitions ──────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // ── Existing (enhanced) ────────────────────────────────
      {
        name: 'scaffold_project',
        description: 'Scaffolds new projects from a blueprint template in the builder projects directory. Returns the list of created project paths.',
        inputSchema: {
          type: 'object',
          properties: {
            projectNames: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of project names to scaffold',
            },
          },
          required: ['projectNames'],
        },
      },
      {
        name: 'generate_code',
        description: 'Generate clean, production-ready code using the local Ollama AI model based on a description.',
        inputSchema: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: 'Detailed description of the code to generate',
            },
            language: {
              type: 'string',
              description: 'Programming language (e.g., typescript, python). Defaults to typescript.',
            },
            model: {
              type: 'string',
              description: 'Optional Ollama model name (defaults to qwen3:8b)',
            },
            context: {
              type: 'string',
              description: 'Optional surrounding code to inject as context for better generation',
            },
          },
          required: ['description'],
        },
      },
      {
        name: 'review_code',
        description: 'Review code and suggest improvements using the local Ollama AI model.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'The code to review',
            },
            language: {
              type: 'string',
              description: 'Programming language of the code',
            },
            model: {
              type: 'string',
              description: 'Optional Ollama model name (defaults to qwen3:8b)',
            },
            focus: {
              type: 'string',
              enum: ['security', 'performance', 'readability', 'all'],
              description: 'Review focus area. Defaults to "all".',
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'plan_project',
        description: 'Generate a structured project plan (file structure, dependencies, steps) from a high-level description using the local Ollama AI model.',
        inputSchema: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: 'High-level description of the project',
            },
            model: {
              type: 'string',
              description: 'Optional Ollama model name (defaults to qwen3:8b)',
            },
          },
          required: ['description'],
        },
      },

      // ── New tools ──────────────────────────────────────────
      {
        name: 'ask_ai',
        description: 'Ask a general question to the local Ollama AI model with an optional system context/persona.',
        inputSchema: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'The question or prompt to send to the AI',
            },
            context: {
              type: 'string',
              description: 'Optional system context or persona to inject (e.g. "You are a DevOps expert...")',
            },
            model: {
              type: 'string',
              description: 'Optional Ollama model name (defaults to qwen3:8b)',
            },
          },
          required: ['question'],
        },
      },
      {
        name: 'list_models',
        description: 'List all Ollama models currently available on this machine.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'run_task',
        description: 'Run the autonomous coding agent on a project directory. Scans existing files for context, asks Ollama to complete the task, and either returns a dry-run plan or applies changes directly.',
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The coding task to perform (e.g. "Add a /health endpoint to src/index.ts")',
            },
            projectDir: {
              type: 'string',
              description: 'Absolute path to the project directory to work in',
            },
            model: {
              type: 'string',
              description: 'Optional Ollama model name (defaults to qwen3:8b)',
            },
            dryRun: {
              type: 'boolean',
              description: 'When true (default), return the AI plan + proposed file changes without writing to disk. When false, auto-apply the changes.',
            },
          },
          required: ['task', 'projectDir'],
        },
      },
      {
        name: 'read_project',
        description: 'Scan a project directory and return its file tree with content summary. Useful for understanding an existing project before making changes.',
        inputSchema: {
          type: 'object',
          properties: {
            projectDir: {
              type: 'string',
              description: 'Absolute path to the project directory to scan',
            },
            includeContent: {
              type: 'boolean',
              description: 'When true, include file contents in the response (up to 80k chars total). Defaults to false (file list only).',
            },
          },
          required: ['projectDir'],
        },
      },
      {
        name: 'refactor_code',
        description: 'Refactor code toward specific goals (e.g. "extract reusable function", "apply DRY principle", "rename for clarity") using the local Ollama AI model.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'The code to refactor',
            },
            goals: {
              type: 'string',
              description: 'Refactoring goals (e.g. "extract the validation logic into a pure function", "apply DRY")',
            },
            language: {
              type: 'string',
              description: 'Programming language of the code. Defaults to typescript.',
            },
            model: {
              type: 'string',
              description: 'Optional Ollama model name (defaults to qwen3:8b)',
            },
          },
          required: ['code', 'goals'],
        },
      },
      {
        name: 'explain_code',
        description: 'Explain what a block of code does in plain English, covering how it works, edge cases, and notable patterns.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'The code to explain',
            },
            language: {
              type: 'string',
              description: 'Programming language of the code. Defaults to typescript.',
            },
            model: {
              type: 'string',
              description: 'Optional Ollama model name (defaults to qwen3:8b)',
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'write_tests',
        description: 'Generate comprehensive unit tests (happy path, edge cases, error conditions) for a given code snippet using the local Ollama AI model.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'The code to write tests for',
            },
            language: {
              type: 'string',
              description: 'Programming language of the code. Defaults to typescript.',
            },
            framework: {
              type: 'string',
              description: 'Test framework to use (e.g. vitest, jest, mocha). Defaults to vitest.',
            },
            model: {
              type: 'string',
              description: 'Optional Ollama model name (defaults to qwen3:8b)',
            },
          },
          required: ['code'],
        },
      },
    ],
  };
});

// ── Tool Handlers ─────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // ── scaffold_project ───────────────────────────────────
    if (name === 'scaffold_project') {
      const { projectNames } = args as { projectNames: string[] };
      const repoRoot = process.env.WAELIO_BUILDER_ROOT || path.resolve(__dirname, '../../');
      const projectsDir = path.join(repoRoot, 'projects');
      const created = scaffoldFromBlueprint(projectsDir, projectNames);

      // List files created in each project
      const details = created.map((projectPath) => {
        let fileList: string[] = [];
        try {
          fileList = fs.readdirSync(projectPath);
        } catch { /* ignore */ }
        return `${projectPath}\n  Files: ${fileList.join(', ')}`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `Successfully scaffolded ${created.length} project(s):\n\n${details.join('\n\n')}`,
          },
        ],
      };
    }

    // ── generate_code ──────────────────────────────────────
    if (name === 'generate_code') {
      const { description, language, model, context } = args as {
        description: string;
        language?: string;
        model?: string;
        context?: string;
      };
      const code = await ai.generateCode(description, language, model, context);
      return { content: [{ type: 'text', text: code }] };
    }

    // ── review_code ────────────────────────────────────────
    if (name === 'review_code') {
      const { code, language, model, focus } = args as {
        code: string;
        language?: string;
        model?: string;
        focus?: 'security' | 'performance' | 'readability' | 'all';
      };
      const review = await ai.reviewCode(code, language, model, focus);
      return { content: [{ type: 'text', text: review }] };
    }

    // ── plan_project ───────────────────────────────────────
    if (name === 'plan_project') {
      const { description, model } = args as { description: string; model?: string };
      const plan = await ai.planProject(description, model);
      return { content: [{ type: 'text', text: plan }] };
    }

    // ── ask_ai ─────────────────────────────────────────────
    if (name === 'ask_ai') {
      const { question, context, model } = args as {
        question: string;
        context?: string;
        model?: string;
      };
      const answer = await ai.ask(question, context, model);
      return { content: [{ type: 'text', text: answer }] };
    }

    // ── list_models ────────────────────────────────────────
    if (name === 'list_models') {
      const models = await ai.listModels();
      const defaultModel = process.env.OLLAMA_MODEL ?? 'qwen3:8b';
      const lines = models.map((m) => (m === defaultModel ? `${m} (default)` : m));
      return {
        content: [
          {
            type: 'text',
            text: `Available Ollama models (${models.length}):\n${lines.map((l) => `  • ${l}`).join('\n')}`,
          },
        ],
      };
    }

    // ── run_task ───────────────────────────────────────────
    if (name === 'run_task') {
      const { task, projectDir, model, dryRun = true } = args as {
        task: string;
        projectDir: string;
        model?: string;
        dryRun?: boolean;
      };

      if (!fs.existsSync(projectDir)) {
        throw new Error(`Project directory does not exist: ${projectDir}`);
      }

      // Scan project files for context
      const files = scanProject(projectDir);
      const context = buildContext(files);

      const systemPrompt = `You are an expert software engineer working on a TypeScript project. You have access to all the project files below.

RULES:
1. When you need to create or modify files, output the COMPLETE file contents in a fenced code block with the file path as the language tag.
   Example: \`\`\`src/utils.ts
   // file contents here
   \`\`\`
2. Always output the FULL file — never use "..." or "// rest of file" shortcuts.
3. If you modify an existing file, include ALL its content (changed and unchanged lines).
4. Briefly explain what you are doing before each file block.
5. If the task is a question, just answer it — no file changes needed.

PROJECT FILES (${files.length} files scanned):
${context}`;

      const response = await ai.ask(task, systemPrompt, model);
      const fileBlocks = parseFileBlocks(response);

      if (dryRun) {
        const preview = fileBlocks.length > 0
          ? `\n\nProposed changes (${fileBlocks.length} file(s)) — DRY RUN, nothing written:\n${fileBlocks.map((b) => `  → ${b.path}`).join('\n')}`
          : '\n\nNo file changes detected.';
        return {
          content: [{ type: 'text', text: response + preview }],
        };
      }

      // Auto-apply mode
      let written = 0;
      const writtenPaths: string[] = [];
      const errors: string[] = [];

      for (const block of fileBlocks) {
        const fullPath = path.join(projectDir, block.path);
        try {
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, block.content, 'utf8');
          writtenPaths.push(block.path);
          written++;
        } catch (err) {
          errors.push(`${block.path}: ${getErrorMessage(err)}`);
        }
      }

      const summary = [
        response,
        `\n\n── Applied Changes ──`,
        `Files written (${written}): ${writtenPaths.map((p) => `\n  ✓ ${p}`).join('')}`,
        errors.length > 0 ? `Errors:\n${errors.map((e) => `  ✗ ${e}`).join('\n')}` : '',
      ].filter(Boolean).join('\n');

      return { content: [{ type: 'text', text: summary }] };
    }

    // ── read_project ───────────────────────────────────────
    if (name === 'read_project') {
      const { projectDir, includeContent = false } = args as {
        projectDir: string;
        includeContent?: boolean;
      };

      if (!fs.existsSync(projectDir)) {
        throw new Error(`Project directory does not exist: ${projectDir}`);
      }

      const files = scanProject(projectDir);
      const fileList = files.map((f) => {
        const sizeBytes = Buffer.byteLength(f.content, 'utf8');
        return `  ${f.path} (${(sizeBytes / 1024).toFixed(1)}KB)`;
      });

      let output = `Project: ${projectDir}\nFiles scanned: ${files.length}\n\n${fileList.join('\n')}`;

      if (includeContent) {
        const context = buildContext(files);
        output += `\n\n── File Contents ──\n\n${context}`;
      }

      return { content: [{ type: 'text', text: output }] };
    }

    // ── refactor_code ──────────────────────────────────────
    if (name === 'refactor_code') {
      const { code, goals, language, model } = args as {
        code: string;
        goals: string;
        language?: string;
        model?: string;
      };
      const refactored = await ai.refactorCode(code, goals, language, model);
      return { content: [{ type: 'text', text: refactored }] };
    }

    // ── explain_code ───────────────────────────────────────
    if (name === 'explain_code') {
      const { code, language, model } = args as {
        code: string;
        language?: string;
        model?: string;
      };
      const explanation = await ai.explainCode(code, language, model);
      return { content: [{ type: 'text', text: explanation }] };
    }

    // ── write_tests ────────────────────────────────────────
    if (name === 'write_tests') {
      const { code, language, framework, model } = args as {
        code: string;
        language?: string;
        framework?: string;
        model?: string;
      };
      const tests = await ai.writeTests(code, language, framework, model);
      return { content: [{ type: 'text', text: tests }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error executing tool "${name}": ${getErrorMessage(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// ── Start Server ──────────────────────────────────────────────

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Waelio Builder MCP Server v2.0.0 running on stdio');
  console.error('Tools: scaffold_project, generate_code, review_code, plan_project,');
  console.error('       ask_ai, list_models, run_task, read_project,');
  console.error('       refactor_code, explain_code, write_tests');
}

run().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
