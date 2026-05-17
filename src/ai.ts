import http from 'node:http';

/**
 * Ollama AI client — lets the builder use local models for code generation,
 * project scaffolding, and code review.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaChatResponse {
  message?: { content: string };
  error?: string;
}

interface OllamaModel {
  name: string;
  model?: string;
}

interface OllamaTagsResponse {
  models?: OllamaModel[];
}

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
 */
export async function generateCode(
  description: string,
  language: string = 'typescript',
  model?: string
): Promise<string> {
  return chat(
    [
      {
        role: 'system',
        content: `You are a senior software engineer. Generate clean, production-ready ${language} code. Return ONLY code — no explanations, no markdown fences. Follow best practices.`,
      },
      {
        role: 'user',
        content: description,
      },
    ],
    model
  );
}

/**
 * Review code and suggest improvements.
 */
export async function reviewCode(
  code: string,
  language: string = 'typescript',
  model?: string
): Promise<string> {
  return chat(
    [
      {
        role: 'system',
        content: `You are a code reviewer. Analyze the following ${language} code for bugs, security issues, and improvements. Be concise and actionable.`,
      },
      {
        role: 'user',
        content: code,
      },
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
      {
        role: 'user',
        content: description,
      },
    ],
    model
  );
}

/**
 * Ask a general question to the AI.
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
