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
  /** Alleen in de laatste chunk: hoe lang het laden van het model duurde, in nanoseconden. */
  load_duration?: number;
}

export interface StreamChatResult {
  /** Laadtijd van het model voor dit verzoek (0 als het al in het geheugen stond of onbekend is). */
  loadMs: number;
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
    if (m.role === 'user' && m.images && m.images.length > 0) {
      return { role: m.role, content: m.content, images: m.images };
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
export async function streamChat(options: StreamChatOptions, handlers: StreamChatHandlers): Promise<StreamChatResult> {
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
    if (isAbortError(error)) return { loadMs: 0 };
    throw error;
  }

  if (!response.ok || !response.body) {
    throw new Error(`Ollama request mislukt: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const result: StreamChatResult = { loadMs: 0 };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const { lines, remainder } = splitNdjsonLines(buffer);
      buffer = remainder;

      for (const line of lines) {
        applyChunk(parseOllamaChunk(line), handlers, result);
      }
    }
  } catch (error) {
    if (isAbortError(error)) return result;
    throw error;
  }

  if (buffer.trim().length > 0) {
    applyChunk(parseOllamaChunk(buffer), handlers, result);
  }
  return result;
}

function applyChunk(chunk: OllamaChatChunk, handlers: StreamChatHandlers, result: StreamChatResult): void {
  if (typeof chunk.load_duration === 'number') result.loadMs = chunk.load_duration / 1e6;
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
