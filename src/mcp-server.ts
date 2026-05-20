#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import path from 'node:path';
import { scaffoldFromBlueprint } from './project-scaffold';
import * as ai from './ai';

const server = new Server(
  {
    name: 'waelio-builder-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define the tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'scaffold_project',
        description: 'Scaffolds new projects from a blueprint name in the builder projects directory.',
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
        description: 'Generate code using the local Ollama AI model based on a description.',
        inputSchema: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: 'Detailed description of the code to generate',
            },
            language: {
              type: 'string',
              description: 'Programming language (e.g., typescript, python)',
            },
            model: {
              type: 'string',
              description: 'Optional Ollama model name (defaults to qwen3:8b)',
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
          },
          required: ['code'],
        },
      },
      {
        name: 'plan_project',
        description: 'Generate a project plan from a high-level description using the local Ollama AI model.',
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
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'scaffold_project') {
      const { projectNames } = args as { projectNames: string[] };
      const repoRoot = process.env.WAELIO_BUILDER_ROOT || path.resolve(__dirname, '../../');
      const projectsDir = path.join(repoRoot, 'projects');
      const created = scaffoldFromBlueprint(projectsDir, projectNames);
      return {
        content: [
          {
            type: 'text',
            text: `Successfully scaffolded projects: ${created.join(', ')}`,
          },
        ],
      };
    }

    if (name === 'generate_code') {
      const { description, language, model } = args as { description: string; language?: string; model?: string };
      const code = await ai.generateCode(description, language, model);
      return {
        content: [
          {
            type: 'text',
            text: code,
          },
        ],
      };
    }

    if (name === 'review_code') {
      const { code, language, model } = args as { code: string; language?: string; model?: string };
      const review = await ai.reviewCode(code, language, model);
      return {
        content: [
          {
            type: 'text',
            text: review,
          },
        ],
      };
    }

    if (name === 'plan_project') {
      const { description, model } = args as { description: string; model?: string };
      const plan = await ai.planProject(description, model);
      return {
        content: [
          {
            type: 'text',
            text: plan,
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error executing tool ${name}: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Run the server
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Waelio Builder MCP Server running on stdio');
}

run().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
