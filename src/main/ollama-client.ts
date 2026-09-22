import type { ChatMessage } from '../shared/ipc-types';

export type { ChatMessage };

interface OllamaChatChunk {
  message?: { role: string; content: string };
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

export async function streamChat(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  onToken: (token: string) => void,
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Ollama request mislukt: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const { lines, remainder } = splitNdjsonLines(buffer);
    buffer = remainder;

    for (const line of lines) {
      applyChunk(parseOllamaChunk(line), onToken);
    }
  }

  if (buffer.trim().length > 0) {
    applyChunk(parseOllamaChunk(buffer), onToken);
  }
}

function applyChunk(chunk: OllamaChatChunk, onToken: (token: string) => void): void {
  if (chunk.error) {
    throw new Error(chunk.error);
  }
  if (chunk.message?.content) {
    onToken(chunk.message.content);
  }
}
