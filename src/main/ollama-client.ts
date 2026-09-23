import type { ChatMessage, ChatOptions } from '../shared/ipc-types';
import { fetchOllama } from './ollama-errors';

export type { ChatMessage };

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface NativeToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaChatChunk {
  message?: { role: string; content: string; tool_calls?: NativeToolCall[] };
  done: boolean;
  error?: string;
}

/**
 * Ollama streamt newline-delimited JSON. Eén read() van de response body kan
 * een halve regel bevatten, dus we bewaren het restant tot de volgende chunk.
 */
export function splitNdjsonLines(buffer: string): { lines: string[]; remainder: string } {
  const parts = buffer.split('\n');
  const remainder = parts.pop() ?? '';
  const lines = parts.filter((line) => line.trim().length > 0);
  return { lines, remainder };
}

export function parseOllamaChunk(line: string): OllamaChatChunk {
  return JSON.parse(line) as OllamaChatChunk;
}

/**
 * Vertaalt onze interne ChatMessage naar het wire-formaat dat Ollama
 * verwacht: role 'tool' wordt tool_name, en een assistant-bericht met
 * toolCalls (native tool-aanroep uit een vorige iteratie) krijgt zijn
 * tool_calls-veld terug zodat Ollama de conversatie correct kan volgen.
 */
function toOllamaMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: m.role, content: m.content, tool_name: m.toolName };
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: m.role,
        content: m.content,
        tool_calls: m.toolCalls.map((tc) => ({ function: { name: tc.name, arguments: tc.args } })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export interface StreamChatOptions {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  signal?: AbortSignal;
  /** num_ctx / num_predict / temperature — per gesprek instelbaar. */
  options?: ChatOptions;
}

export interface StreamChatHandlers {
  onToken: (token: string) => void;
  onToolCalls?: (calls: NativeToolCall[]) => void;
}

/**
 * Streamt een chatbeurt van Ollama. Bij een bewuste abort (bv. Fase 2's
 * prompt-tool-call-detectie die de stream vroegtijdig afbreekt zodra een
 * compleet tool-aanroep-blok gezien is) wordt dit als normale afronding
 * behandeld, niet als fout.
 */
export async function streamChat(options: StreamChatOptions, handlers: StreamChatHandlers): Promise<void> {
  const { baseUrl, model, messages, tools, signal } = options;
  const body: Record<string, unknown> = { model, messages: toOllamaMessages(messages), stream: true };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }
  if (options.options) {
    body.options = {
      num_ctx: options.options.numCtx,
      num_predict: options.options.numPredict,
      temperature: options.options.temperature,
    };
  }

  let response: Response;
  try {
    response = await fetchOllama(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) return;
    throw error;
  }

  if (!response.ok || !response.body) {
    throw new Error(`Ollama request mislukt: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const { lines, remainder } = splitNdjsonLines(buffer);
      buffer = remainder;

      for (const line of lines) {
        applyChunk(parseOllamaChunk(line), handlers);
      }
    }
  } catch (error) {
    if (isAbortError(error)) return;
    throw error;
  }

  if (buffer.trim().length > 0) {
    applyChunk(parseOllamaChunk(buffer), handlers);
  }
}

function applyChunk(chunk: OllamaChatChunk, handlers: StreamChatHandlers): void {
  if (chunk.error) {
    throw new Error(chunk.error);
  }
  if (chunk.message?.content) {
    handlers.onToken(chunk.message.content);
  }
  if (chunk.message?.tool_calls && chunk.message.tool_calls.length > 0) {
    handlers.onToolCalls?.(chunk.message.tool_calls);
  }
}
