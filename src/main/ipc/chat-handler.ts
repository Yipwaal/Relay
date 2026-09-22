import { ipcMain, type IpcMainEvent, type WebContents } from 'electron';
import { loadConfig } from '../config';
import { buildToolRegistry } from '../tools';
import { resolveToolMode } from '../chat/capabilities';
import { buildToolSystemAppendix } from '../chat/tool-protocol';
import { runAgentTurn } from '../chat/agent-loop';
import type { ChatMessage } from '../../shared/ipc-types';

interface IncomingMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
}

interface ChatSendPayload {
  requestId: string;
  messages: IncomingMessage[];
}

function isIncomingMessage(value: unknown): value is IncomingMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.role !== 'user' && v.role !== 'assistant' && v.role !== 'tool') return false;
  if (typeof v.content !== 'string') return false;
  // Een tool-bericht is alleen geldig mét toolName; renderer kan geen 'system'-rol injecteren.
  if (v.role === 'tool' && typeof v.toolName !== 'string') return false;
  return true;
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

async function handleChatRequest(sender: WebContents, requestId: string, incoming: IncomingMessage[]): Promise<void> {
  try {
    const config = loadConfig();
    const tools = buildToolRegistry(config.ollamaApiKey);
    const toolMode = await resolveToolMode(config.ollamaUrl, config.model, config.toolMode);
    const systemAppendix = buildToolSystemAppendix(
      toolMode,
      [...tools.values()].map((t) => ({ name: t.name, description: t.description })),
    );
    const systemPrompt = systemAppendix ? `${config.systemPrompt}\n\n${systemAppendix}` : config.systemPrompt;

    const turnMessages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...incoming];

    console.log(
      `[relay] chat request model=${config.model} toolMode=${toolMode} tools=${tools.size} messages=${turnMessages.length}`,
    );

    const appended = await runAgentTurn(
      { ollamaUrl: config.ollamaUrl, model: config.model, toolMode, tools },
      turnMessages,
      {
        onToken: (token) => safeSend(sender, 'relay:chat:chunk', { requestId, token }),
        onToolCall: (label) => safeSend(sender, 'relay:chat:tool-call', { requestId, label }),
        onToolResult: (summary, ok) => safeSend(sender, 'relay:chat:tool-result', { requestId, summary, ok }),
      },
    );

    safeSend(sender, 'relay:chat:done', { requestId, appended });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout bij Ollama-aanroep';
    console.error(`[relay] chat request mislukt: ${message}`);
    safeSend(sender, 'relay:chat:error', { requestId, message });
  }
}

export function registerChatHandler(): void {
  ipcMain.on('relay:chat:send', (event: IpcMainEvent, payload: unknown) => {
    if (!isChatSendPayload(payload)) {
      console.error('[relay] ongeldig chat:send-bericht genegeerd');
      return;
    }
    void handleChatRequest(event.sender, payload.requestId, payload.messages);
  });
}
