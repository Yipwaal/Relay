import type { RouteDecision } from '../../router/types';
import type { RelayConfig } from '../config';
import { toModelHistory } from '../conversations/history';
import { resolveOptions, type ConversationStore, type NewMessage, type TurnRef } from '../conversations/store';
import type { DocumentStore } from '../documents/store';
import type { MemoryStore } from '../memory/store';
import type { CatalogSnapshot } from '../model-catalog';
import { createOllamaEmbedder } from '../ollama-embed';
import { isModelLoaded, unloadLoadedModels } from '../ollama-lifecycle';
import { buildToolRegistry } from '../tools';
import type { ChatMessage } from '../../shared/ipc-types';
import { runAgentTurn, type AppendedEntry } from './agent-loop';
import { resolveToolMode } from './capabilities';
import { buildSystemPrompt, MAX_MEMORY_CHARS } from './system-prompt';

const LOADED_CHECK_TIMEOUT_MS = 500;
const UNLOAD_TIMEOUT_MS = 3000;

export interface AttemptStores {
  conversationStore: ConversationStore;
  memoryStore: MemoryStore;
  documentStore: DocumentStore;
}

export interface AttemptInput {
  conversationId: number;
  ref: TurnRef;
  decision: RouteDecision;
  /** Zie AgentContext.maxToolFailures; undefined als er geen hoger model is. */
  maxToolFailures?: number;
  signal: AbortSignal;
  /** Main→renderer-events (chunk, tool-call, …); requestId voegt de aanroeper toe. */
  emit(channel: string, payload: Record<string, unknown>): void;
  /** Modellen met een lopend antwoord elders: die mogen niet ge-unload worden. */
  modelsInUse(): string[];
}

export interface AttemptResult {
  escalate: boolean;
  loadMs: number;
  /** Laatste assistant-tekst van deze poging, voor de automatische titel. */
  lastAnswer: string;
}

export function noticeRow(text: string): NewMessage {
  return { role: 'assistant', kind: 'notice', content: text, toolCalls: null, toolName: null, display: null, model: null, status: 'error', route: null };
}

function toStoredRow(entry: AppendedEntry, decision: RouteDecision): NewMessage | null {
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
      route: null,
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
    model: decision.model,
    status: entry.interrupted ? 'interrupted' : 'complete',
    route: decision.reason,
  };
}

/**
 * Eén poging van een beurt met één vast model (door de router gekozen).
 * Bouwt de geschiedenis uit de database — zonder eerdere pogingen van deze
 * beurt — en slaat elke iteratie als één batch op. Bij de eerste batch van
 * een tweede of latere poging worden de eerdere pogingen in dezelfde
 * transactie als vervangen gemarkeerd.
 */
export async function runAttempt(input: AttemptInput, stores: AttemptStores, snapshot: CatalogSnapshot, config: RelayConfig): Promise<AttemptResult> {
  const { conversationStore, memoryStore, documentStore } = stores;
  const { conversationId, ref, decision } = input;
  const conversation = conversationStore.get(conversationId);
  if (!conversation) throw new Error('Gesprek bestaat niet (meer).');

  const model = decision.model;
  const options = resolveOptions(conversation, config.options);
  const embedModel = snapshot.roles.embedding.model ?? '';
  const tools = buildToolRegistry({
    ollamaApiKey: config.ollamaApiKey,
    memoryStore,
    documentStore,
    embedder: createOllamaEmbedder(config.ollamaUrl, embedModel),
    embedModel,
    conversationId,
  });
  const toolMode = await resolveToolMode(config.ollamaUrl, model, config.toolMode);

  // Feiten aan het begin van de beurt lezen, niet per agent-loop-iteratie:
  // roept het model binnen deze beurt zelf remember aan, dan verandert de
  // system prompt van turnMessages[0] niet meer terwijl de loop bezig is.
  const facts = memoryStore.selectFactsForPrompt(MAX_MEMORY_CHARS);
  const systemPrompt = buildSystemPrompt({
    base: config.systemPrompt,
    facts,
    toolMode,
    tools: [...tools.values()].map((t) => ({ name: t.name, description: t.description })),
  });
  const history = toModelHistory(conversationStore.listMessages(conversationId), toolMode, ref);
  const turnMessages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...history];

  console.log(
    `[relay] chat request conversation=${conversationId} turn=${ref.turn} attempt=${ref.attempt} model=${model} ` +
      `route=${decision.source}:${decision.reason} toolMode=${toolMode} tools=${tools.size} facts=${facts.facts.length} messages=${turnMessages.length}`,
  );

  // Cold start: een groot model laden kan tientallen seconden duren — laat de
  // UI dat zien. Staat er nog een ánder chatmodel in het geheugen, haal dat
  // eerst weg; het background- en embedding-model blijven (classificeren en
  // documenten zoeken moeten snel blijven), net als modellen met een lopend antwoord.
  if ((await isModelLoaded(config.ollamaUrl, model, LOADED_CHECK_TIMEOUT_MS)) === false) {
    input.emit('relay:chat:status', { status: 'loading-model' });
    const keep = [model, snapshot.roles.background.model, snapshot.roles.embedding.model, ...input.modelsInUse()];
    await unloadLoadedModels(config.ollamaUrl, UNLOAD_TIMEOUT_MS, keep.filter((m): m is string => Boolean(m)));
  }

  let lastAnswer = '';
  // Bewust pas na de eerste batch mét rijen: een poging die niets oplevert
  // (bv. gestopt vóór de eerste token) laat het vorige antwoord staan.
  let firstBatch = true;
  const result = await runAgentTurn(
    { ollamaUrl: config.ollamaUrl, model, toolMode, tools, options, signal: input.signal, maxToolFailures: input.maxToolFailures },
    turnMessages,
    {
      onToken: (token) => input.emit('relay:chat:chunk', { token }),
      onToolCall: (info) => input.emit('relay:chat:tool-call', { ...info }),
      onToolResult: (info) => input.emit('relay:chat:tool-result', { ...info }),
      onAppend: (entries) => {
        const rows = entries.map((entry) => toStoredRow(entry, decision)).filter((row): row is NewMessage => row !== null);
        if (rows.length === 0) return;
        conversationStore.appendMessages(conversationId, ref, rows, { supersedeOlderAttempts: firstBatch && ref.attempt > 1 });
        firstBatch = false;
        for (const row of rows) if (row.kind === 'assistant' && row.content.trim()) lastAnswer = row.content;
      },
    },
  );

  return { escalate: result.escalate, loadMs: result.loadMs, lastAnswer };
}
