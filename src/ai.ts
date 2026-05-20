import http from 'node:http';
import type {
  OllamaChatMessage,
  OllamaChatResponse,
  OllamaTagsResponse,
} from './types';

/**
 * Ollama AI client — lets the builder use local models for code generation,
 * project scaffolding, code review, refactoring, explanation, and test writing.
 */

const OLLAMA_URL: string = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const OLLAMA_MODEL: string = process.env.OLLAMA_MODEL ?? 'qwen3:8b';

/**
 * Send a chat request to Ollama and get a response.
 */
export function chat(
  messages: OllamaChatMessage[],
  model?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: model || OLLAMA_MODEL,
      messages,
      stream: false,
    });

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
        res.on('data', (chunk: Buffer) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const result: OllamaChatResponse = JSON.parse(data);
            if (result.error) {
              reject(new Error(`Ollama error: ${result.error}`));
              return;
            }
            resolve(result.message?.content || '');
          } catch (err) {
            reject(new Error(`Failed to parse Ollama response: ${data.slice(0, 200)}`));
          }
        });
      }
    );

    req.on('error', (err) => {
      reject(new Error(`Ollama unreachable at ${OLLAMA_URL}: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Ollama request timed out (10 min)'));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * List available Ollama models.
 */
export function listModels(): Promise<string[]> {
  return new Promise((resolve) => {
    const url = new URL('/api/tags', OLLAMA_URL);

    http
      .get(
        { hostname: url.hostname, port: url.port, path: url.pathname },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const result: OllamaTagsResponse = JSON.parse(data);
              resolve(
                (result.models || []).map((m) => m.name || m.model || 'unknown')
              );
            } catch {
              resolve([OLLAMA_MODEL]);
            }
          });
        }
      )
      .on('error', () => {
        resolve([OLLAMA_MODEL]);
      });
  });
}

/**
 * Generate code for a project based on a description.
 * @param description - What the code should do
 * @param language - Target language (default: typescript)
 * @param model - Ollama model override
 * @param context - Optional surrounding code to inject for better generation
 */
export async function generateCode(
  description: string,
  language: string = 'typescript',
  model?: string,
  context?: string
): Promise<string> {
  const systemContent = [
    `You are a senior software engineer. Generate clean, production-ready ${language} code.`,
    'Return ONLY code — no explanations, no markdown fences. Follow best practices.',
    context ? `\nExisting code context for reference:\n${context}` : '',
  ].join('\n').trim();

  return chat(
    [
      { role: 'system', content: systemContent },
      { role: 'user', content: description },
    ],
    model
  );
}

/**
 * Review code and suggest improvements.
 * @param code - The code to review
 * @param language - Language of the code (default: typescript)
 * @param model - Ollama model override
 * @param focus - Review focus area: 'security' | 'performance' | 'readability' | 'all'
 */
export async function reviewCode(
  code: string,
  language: string = 'typescript',
  model?: string,
  focus: 'security' | 'performance' | 'readability' | 'all' = 'all'
): Promise<string> {
  const focusInstruction =
    focus === 'all'
      ? 'Analyze for bugs, security issues, performance, and readability improvements.'
      : focus === 'security'
      ? 'Focus ONLY on security vulnerabilities, injection risks, authentication issues, and data exposure.'
      : focus === 'performance'
      ? 'Focus ONLY on performance bottlenecks, inefficient loops, memory leaks, and optimization opportunities.'
      : 'Focus ONLY on readability: naming, structure, comments, complexity, and maintainability.';

  return chat(
    [
      {
        role: 'system',
        content: `You are a code reviewer. ${focusInstruction} Be concise and actionable. Use numbered bullet points. Language: ${language}.`,
      },
      { role: 'user', content: code },
    ],
    model
  );
}

/**
 * Generate a project plan from a high-level description.
 */
export async function planProject(
  description: string,
  model?: string
): Promise<string> {
  return chat(
    [
      {
        role: 'system',
        content:
          'You are a technical architect. Given a project description, output a structured plan with: 1) File structure, 2) Key dependencies, 3) Implementation steps. Be practical and specific.',
      },
      { role: 'user', content: description },
    ],
    model
  );
}

/**
 * Ask a general question to the AI.
 * @param question - The question to ask
 * @param context - Optional system context / persona to inject
 * @param model - Ollama model override
 */
export async function ask(
  question: string,
  context?: string,
  model?: string
): Promise<string> {
  const messages: OllamaChatMessage[] = [];

  if (context) {
    messages.push({
      role: 'system',
      content: context,
    });
  }

  messages.push({ role: 'user', content: question });

  return chat(messages, model);
}

/**
 * Refactor code toward specific goals.
 * @param code - The code to refactor
 * @param goals - What to achieve, e.g. 'extract reusable function', 'apply DRY', 'rename for clarity'
 * @param language - Language of the code (default: typescript)
 * @param model - Ollama model override
 */
export async function refactorCode(
  code: string,
  goals: string,
  language: string = 'typescript',
  model?: string
): Promise<string> {
  return chat(
    [
      {
        role: 'system',
        content: [
          `You are an expert ${language} engineer specializing in clean code and refactoring.`,
          'Refactor the provided code according to the given goals.',
          'Return ONLY the refactored code — no explanations, no markdown fences.',
          'Preserve all existing functionality unless the goal explicitly changes it.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `Refactoring goals: ${goals}\n\nCode to refactor:\n${code}`,
      },
    ],
    model
  );
}

/**
 * Explain what a block of code does in plain English.
 * @param code - The code to explain
 * @param language - Language of the code (default: typescript)
 * @param model - Ollama model override
 */
export async function explainCode(
  code: string,
  language: string = 'typescript',
  model?: string
): Promise<string> {
  return chat(
    [
      {
        role: 'system',
        content: [
          `You are a senior ${language} engineer and technical writer.`,
          'Explain the provided code clearly and concisely for a developer audience.',
          'Cover: what it does, how it works, any edge cases or gotchas, and notable patterns used.',
          'Use plain English with short paragraphs. No code blocks unless illustrating a point.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `Explain this ${language} code:\n\n${code}`,
      },
    ],
    model
  );
}

/**
 * Generate unit tests for a given code snippet.
 * @param code - The code to write tests for
 * @param language - Language of the code (default: typescript)
 * @param framework - Test framework to use (default: vitest)
 * @param model - Ollama model override
 */
export async function writeTests(
  code: string,
  language: string = 'typescript',
  framework: string = 'vitest',
  model?: string
): Promise<string> {
  return chat(
    [
      {
        role: 'system',
        content: [
          `You are a senior ${language} engineer who writes thorough unit tests using ${framework}.`,
          'Generate comprehensive tests for the provided code.',
          'Cover: happy path, edge cases, error conditions, and boundary values.',
          `Return ONLY the test file content in ${language} — no explanations, no markdown fences.`,
          'Import the code under test using relative paths (e.g. ../src/module).',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `Write ${framework} unit tests for this ${language} code:\n\n${code}`,
      },
    ],
    model
  );
}
