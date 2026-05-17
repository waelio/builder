// waelio-agent-server.js
// Simple launcher for @waelio/agent using Ollama as backend
const { startAgent } = require('@waelio/agent');

// Environment variables can be set via mcp_config.json
const model = process.env.WAELIO_MODEL || 'ollama';
const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const ollamaModel = process.env.OLLAMA_MODEL || 'llama3:70b';

// Start the agent with the desired configuration
startAgent({
  model,
  ollamaUrl,
  ollamaModel,
  // you can extend this config with additional options if needed
});
