import { ipcMain, type IpcMainEvent, type WebContents } from 'electron';
import { loadConfig } from '../config';
import { buildToolRegistry } from '../tools';
import { resolveToolMode } from '../chat/capabilities';
import { buildSystemPrompt, MAX_MEMORY_CHARS } from '../chat/system-prompt';
import { runAgentTurn, type AppendedEntry } from '../chat/agent-loop';
import { createOllamaEmbedder } from '../ollama-embed';
import { isModelLoaded } from '../ollama-lifecycle';
import { toModelHistory } from '../conversations/history';
import { generateTitle, provisionalTitle } from '../conversations/title';
import type { ConversationStore, NewMessage } from '../conversations/store';
import type { MemoryStore } from '../memory/store';
import type { DocumentStore } from '../documents/store';
import type { AppDefaults, ChatMessage, ConversationUpdatedPayload } from '../../shared/ipc-types';

const LOADED_CHECK_TIMEOUT_MS = 500;
const MAX_MESSAGE_CHARS = 100_000;

interface ChatSendPayload {
  requestId: string;
  conversationId: number;
  text: string;
}

export interface ChatDeps {
  conversationStore: ConversationStore;
  memoryStore: MemoryStore;
  documentStore: DocumentStore;
}

/**
 * Alleen nieuwe gebruikerstekst komt uit de renderer; de geschiedenis leest
 * main zelf uit de database. Daarmee kan een gecompromitteerde renderer geen
 * nagemaakte tool-resultaten of assistant-berichten meer in het gesprek smokkelen.
 */
function isChatSendPayload(value: unknown): value is ChatSendPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.requestId === 'string' &&
    v.requestId.length > 0 &&
    v.requestId.length <= 100 &&
    typeof v.conversationId === 'number' &&
    Number.isInteger(v.conversationId) &&
    typeof v.text === 'string' &&
    v.text.trim().length > 0 &&
    v.text.length <= MAX_MESSAGE_CHARS
  );
}

/** Lopende verzoeken, zodat relay:chat:stop de juiste kan afbreken — alleen vanuit het venster dat ze startte. */
const activeRequests = new Map<string, { controller: AbortController; senderId: number; conversationId: number }>();

/** Voor afsluiten: breek alles af vóórdat de database sluit. */
export function abortAllChatRequests(): void {
  for (const { controller } of activeRequests.values()) controller.abort();
}

/** Voor het verwijderen van een gesprek: stop eerst wat daar nog loopt. */
export function abortConversationRequests(conversationId: number): void {
  for (const active of activeRequests.values()) {
    if (active.conversationId === conversationId) active.controller.abort();
  }
}

function isConversationBusy(conversationId: number): boolean {
  return [...activeRequests.values()].some((active) => active.conversationId === conversationId);
}

function safeSend(sender: WebContents, channel: string, payload: unknown): void {
  if (sender.isDestroyed()) return;
  sender.send(channel, payload);
}

function sendConversationUpdated(sender: WebContents, store: ConversationStore, conversationId: number): void {
  const conversation = store.get(conversationId);
  if (!conversation) return;
  const payload: ConversationUpdatedPayload = { id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt };
  safeSend(sender, 'relay:conversations:updated', payload);
}

function userRow(text: string): NewMessage {
  return { role: 'user', kind: 'user', content: text, toolCalls: null, toolName: null, display: null, model: null, status: 'complete' };
}

function noticeRow(text: string): NewMessage {
  return { role: 'assistant', kind: 'notice', content: text, toolCalls: null, toolName: null, display: null, model: null, status: 'error' };
}

function toStoredRow(entry: AppendedEntry, model: string): NewMessage | null {
  const m: ChatMessage = entry.message;
  if (entry.tool) {
    return {
      role: m.role === 'tool' ? 'tool' : 'user',
      kind: 'tool_result',
      content: m.content,
      toolCalls: null,
      toolName: m.role === 'tool' ? m.toolName : entry.tool.tool,
      display: entry.tool,
      model: null,
      status: 'complete',
    };
  }
  if (m.role !== 'assistant') return null;
  const toolCalls = m.toolCalls && m.toolCalls.length > 0 ? m.toolCalls : null;
  // Een lege beurt zonder tool-aanroep (bv. stop vóór de eerste token) voegt niets toe.
  if (m.content.trim().length === 0 && !toolCalls) return null;
  return {
    role: 'assistant',
    kind: 'assistant',
    content: m.content,
    toolCalls,
    toolName: null,
    display: null,
    model,
    status: entry.interrupted ? 'interrupted' : 'complete',
  };
}

async function handleChatRequest(
  sender: WebContents,
  requestId: string,
  conversationId: number,
  text: string,
  deps: ChatDeps,
  controller: AbortController,
): Promise<void> {
  const { conversationStore, memoryStore, documentStore } = deps;
  try {
    const conversation = conversationStore.get(conversationId);
    if (!conversation) throw new Error('Gesprek bestaat niet (meer).');
    const config = loadConfig();
    const { model, numCtx } = conversation;

    const isFirstTurn = conversationStore.listMessages(conversationId).length === 0;
    conversationStore.appendMessages(conversationId, [userRow(text)]);
    if (isFirstTurn) conversationStore.setAutoTitle(conversationId, provisionalTitle(text));
    sendConversationUpdated(sender, conversationStore, conversationId);

    const embedder = createOllamaEmbedder(config.ollamaUrl, config.embedModel);
    const tools = buildToolRegistry({
      ollamaApiKey: config.ollamaApiKey,
      memoryStore,
      documentStore,
      embedder,
      embedModel: config.embedModel,
      conversationId,
    });
    const toolMode = await resolveToolMode(config.ollamaUrl, model, config.toolMode);

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
    const history = toModelHistory(conversationStore.listMessages(conversationId), toolMode);
    const turnMessages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...history];

    console.log(
      `[relay] chat request conversation=${conversationId} model=${model} toolMode=${toolMode} tools=${tools.size} ` +
        `facts=${facts.facts.length} messages=${turnMessages.length}`,
    );

    // Cold start: een 12B-model laden kan tientallen seconden duren. Laat de
    // UI dat zien i.p.v. dat het lijkt alsof er niets gebeurt.
    if ((await isModelLoaded(config.ollamaUrl, model, LOADED_CHECK_TIMEOUT_MS)) === false) {
      safeSend(sender, 'relay:chat:status', { requestId, status: 'loading-model' });
    }

    let lastAnswer = '';
    await runAgentTurn({ ollamaUrl: config.ollamaUrl, model, toolMode, tools, numCtx, signal: controller.signal }, turnMessages, {
      onToken: (token) => safeSend(sender, 'relay:chat:chunk', { requestId, token }),
      onToolCall: (info) => safeSend(sender, 'relay:chat:tool-call', { requestId, ...info }),
      onToolResult: (info) => safeSend(sender, 'relay:chat:tool-result', { requestId, ...info }),
      onAppend: (entries) => {
        const rows = entries.map((entry) => toStoredRow(entry, model)).filter((row): row is NewMessage => row !== null);
        conversationStore.appendMessages(conversationId, rows);
        for (const row of rows) if (row.kind === 'assistant' && row.content.trim()) lastAnswer = row.content;
      },
    });

    const stopped = controller.signal.aborted;
    safeSend(sender, 'relay:chat:done', { requestId, stopped });
    sendConversationUpdated(sender, conversationStore, conversationId);

    if (isFirstTurn && !stopped && !conversation.titleIsCustom && lastAnswer) {
      void generateTitle(config.ollamaUrl, model, text, lastAnswer).then((title) => {
        if (title && conversationStore.get(conversationId) && conversationStore.setAutoTitle(conversationId, title)) {
          sendConversationUpdated(sender, conversationStore, conversationId);
        }
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout bij Ollama-aanroep';
    console.error(`[relay] chat request mislukt: ${message}`);
    try {
      if (conversationStore.get(conversationId)) conversationStore.appendMessages(conversationId, [noticeRow(message)]);
    } catch (persistError) {
      console.error(`[relay] foutmelding niet opgeslagen: ${persistError instanceof Error ? persistError.message : String(persistError)}`);
    }
    safeSend(sender, 'relay:chat:error', { requestId, message });
  } finally {
    activeRequests.delete(requestId);
  }
}

export function registerChatHandler(deps: ChatDeps): void {
  ipcMain.handle('relay:app:defaults', (): AppDefaults => {
    const config = loadConfig();
    return { model: config.model, numCtx: config.numCtx };
  });

  ipcMain.on('relay:chat:send', (event: IpcMainEvent, payload: unknown) => {
    if (!isChatSendPayload(payload)) {
      console.error('[relay] ongeldig chat:send-bericht genegeerd');
      return;
    }
    const { requestId, conversationId, text } = payload;
    if (activeRequests.has(requestId)) {
      console.error('[relay] dubbel requestId genegeerd');
      return;
    }
    if (isConversationBusy(conversationId)) {
      safeSend(event.sender, 'relay:chat:error', { requestId, message: 'Er loopt al een antwoord in dit gesprek.' });
      return;
    }
    const controller = new AbortController();
    activeRequests.set(requestId, { controller, senderId: event.sender.id, conversationId });
    void handleChatRequest(event.sender, requestId, conversationId, text.trim(), deps, controller);
  });

  ipcMain.on('relay:chat:stop', (event: IpcMainEvent, requestId: unknown) => {
    if (typeof requestId !== 'string') return;
    const active = activeRequests.get(requestId);
    // Een stop die ná done/error binnenkomt vindt niets meer — dat is prima.
    if (active && active.senderId === event.sender.id) active.controller.abort();
  });
}
