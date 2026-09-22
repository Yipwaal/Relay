import type { ToolSchema } from '../ollama-client';
import { createOllamaSearchProvider } from './web-search';
import { fetchWebPage } from './web-fetch';

export interface ToolDefinition {
  name: 'web_search' | 'web_fetch';
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

function requireStringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Tool-argument "${key}" ontbreekt of is geen niet-lege string`);
  }
  return value;
}

let loggedMissingKey = false;

/**
 * Bouwt de tool-registry. Zonder OLLAMA_API_KEY zijn er geen tools
 * beschikbaar — Relay gedraagt zich dan als in Fase 1 (gewone chat, geen
 * tools-veld meegestuurd), met één keer een duidelijke console-melding.
 */
export function buildToolRegistry(apiKey: string | null): Map<string, ToolDefinition> {
  const registry = new Map<string, ToolDefinition>();

  if (!apiKey) {
    if (!loggedMissingKey) {
      console.log('[relay] OLLAMA_API_KEY ontbreekt — web_search/web_fetch tools zijn uitgeschakeld (zie .env.example)');
      loggedMissingKey = true;
    }
    return registry;
  }

  const searchProvider = createOllamaSearchProvider(apiKey);

  registry.set('web_search', {
    name: 'web_search',
    description: 'Zoek op het web naar actuele informatie.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'De zoekopdracht.' },
      },
      required: ['query'],
    },
    async execute(args) {
      const query = requireStringArg(args, 'query');
      const results = await searchProvider.search(query);
      return { results };
    },
  });

  registry.set('web_fetch', {
    name: 'web_fetch',
    description: "Haal de volledige inhoud van één specifieke URL op.",
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'De volledige URL om op te halen.' },
      },
      required: ['url'],
    },
    async execute(args) {
      const url = requireStringArg(args, 'url');
      const page = await fetchWebPage(apiKey, url);
      return page;
    },
  });

  return registry;
}

export function toToolSchemas(registry: Map<string, ToolDefinition>): ToolSchema[] {
  return [...registry.values()].map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
