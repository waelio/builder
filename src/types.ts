// ── Ollama API ────────────────────────────────────────────────

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatResponse {
  message?: { content: string };
  error?: string;
}

export interface OllamaModel {
  name: string;
  model?: string;
  size?: number;
}

export interface OllamaTagsResponse {
  models?: OllamaModel[];
}

// ── Agent Server ──────────────────────────────────────────────

export interface AgentMessagePart {
  text?: string;
}

export interface AgentNewMessage {
  parts?: AgentMessagePart[];
}

export interface AgentRunPayload {
  new_message?: AgentNewMessage;
  model?: string;
}

export interface AgentSseEvent {
  content: { parts: Array<{ text: string }> };
  finishReason: 'STOP' | 'ERROR';
}

export interface ModelsResponse {
  models: string[];
  default: string;
}

export interface SessionResponse {
  id: string;
}

// ── Coder ─────────────────────────────────────────────────────

export interface ProjectFile {
  path: string;
  content: string;
}

export interface FileBlock {
  path: string;
  content: string;
}

export interface TaskResult {
  success: boolean;
  filesWritten?: number;
  response?: string;
  error?: string;
}

export interface AnsiColors {
  reset: string;
  bold: string;
  dim: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  red: string;
}

export interface OllamaOptions {
  num_ctx?: number;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: boolean;
  options?: OllamaOptions;
}
