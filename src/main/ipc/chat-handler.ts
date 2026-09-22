import { ipcMain, type IpcMainEvent, type WebContents } from 'electron';
import { loadConfig } from '../config';
import { buildToolRegistry } from '../tools';
import { sanitizeIncomingToolMessages } from '../tools/sanitize';
import { resolveToolMode } from '../chat/capabilities';
import { buildSystemPrompt, MAX_MEMORY_CHARS } from '../chat/system-prompt';
import { runAgentTurn } from '../chat/agent-loop';
import { createOllamaEmbedder } from '../ollama-embed';
import type { MemoryStore } from '../memory/store';
import type { DocumentStore } from '../documents/store';
import type { ChatMessage, ChatToolCall } from '../../shared/ipc-types';

type IncomingMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ChatToolCall[] }
  | { role: 'tool'; content: string; toolName: string };

interface ChatSendPayload {
  requestId: string;
  messages: IncomingMessage[];
}

function isChatToolCall(value: unknown): value is ChatToolCall {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === 'string' && typeof v.args === 'object' && v.args !== null;
}

function isIncomingMessage(value: unknown): value is IncomingMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.content !== 'string') return false;

  // Renderer kan geen 'system'-rol injecteren (die voegt alleen main zelf toe).
  if (v.role === 'user') return true;
  if (v.role === 'tool') return typeof v.toolName === 'string';
  if (v.role === 'assistant') {
    if (v.toolCalls === undefined) return true;
    return Array.isArray(v.toolCalls) && v.toolCalls.every(isChatToolCall);
  }
  return false;
}

function isChatSendPayload(value: unknown): value is ChatSendPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.requestId === 'string' && Array.isArray(v.messages) && v.messages.every(isIncomingMessage);
}

function safeSend(sender: WebContents, channel: string, payload: unknown): void {
  if (sender.isDestroyed()) return;
  sender.send(channel, payload);
}

async function handleChatRequest(
  sender: WebContents,
  requestId: string,
  incoming: IncomingMessage[],
  memoryStore: MemoryStore,
  documentStore: DocumentStore,
): Promise<void> {
  try {
    const config = loadConfig();
    const embedder = createOllamaEmbedder(config.ollamaUrl, config.embedModel);
    const tools = buildToolRegistry({
      ollamaApiKey: config.ollamaApiKey,
      memoryStore,
      documentStore,
      embedder,
      embedModel: config.embedModel,
    });
    const toolMode = await resolveToolMode(config.ollamaUrl, config.model, config.toolMode);

    // Feiten aan het begin van de beurt lezen, niet per agent-loop-iteratie:
    // roept het model binnen deze beurt zelf remember aan, dan verandert de
    // system prompt van turnMessages[0] niet meer terwijl de loop bezig is —
    // dat nieuwe feit staat pas vanaf de volgende beurt in de system prompt.
    const facts = memoryStore.selectFactsForPrompt(MAX_MEMORY_CHARS);
    const systemPrompt = buildSystemPrompt({
      base: config.systemPrompt,
      facts,
      toolMode,
      tools: [...tools.values()].map((t) => ({ name: t.name, description: t.description })),
    });

    const turnMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...sanitizeIncomingToolMessages(incoming),
    ];

    console.log(
      `[relay] chat request model=${config.model} toolMode=${toolMode} tools=${tools.size} ` +
        `facts=${facts.facts.length} messages=${turnMessages.length}`,
    );

    const appended = await runAgentTurn(
      { ollamaUrl: config.ollamaUrl, model: config.model, toolMode, tools, numCtx: config.numCtx },
      turnMessages,
      {
        onToken: (token) => safeSend(sender, 'relay:chat:chunk', { requestId, token }),
        onToolCall: (label) => safeSend(sender, 'relay:chat:tool-call', { requestId, label }),
        onToolResult: (summary, ok, preview) => safeSend(sender, 'relay:chat:tool-result', { requestId, summary, ok, preview }),
      },
    );

    safeSend(sender, 'relay:chat:done', { requestId, appended });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout bij Ollama-aanroep';
    console.error(`[relay] chat request mislukt: ${message}`);
    safeSend(sender, 'relay:chat:error', { requestId, message });
  }
}

export function registerChatHandler(memoryStore: MemoryStore, documentStore: DocumentStore): void {
  ipcMain.on('relay:chat:send', (event: IpcMainEvent, payload: unknown) => {
    if (!isChatSendPayload(payload)) {
      console.error('[relay] ongeldig chat:send-bericht genegeerd');
      return;
    }
    void handleChatRequest(event.sender, payload.requestId, payload.messages, memoryStore, documentStore);
  });
}
