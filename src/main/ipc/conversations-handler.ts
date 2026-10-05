import { ipcMain } from 'electron';
import { isValidNumCtx, isValidNumPredict, isValidTemperature, loadConfig } from '../config';
import { toConversationMessages } from '../conversations/history';
import { MAX_TITLE_CHARS, resolveOptions, type ConversationRecord, type ConversationStore } from '../conversations/store';
import type { ModelCatalog } from '../model-catalog';
import { chatModelsOnly } from '../models';
import { unloadLoadedModels } from '../ollama-lifecycle';
import type { ChatOptions, ConversationMessage, ConversationSummary } from '../../shared/ipc-types';
import { abortConversationRequests, modelsInUse } from './chat-handler';

const UNLOAD_TIMEOUT_MS = 3000;

function isValidId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function toSummary(record: ConversationRecord, defaults: ChatOptions): ConversationSummary {
  return {
    id: record.id,
    title: record.title,
    modelMode: record.modelMode,
    model: record.model,
    routedModel: record.routedModel,
    options: resolveOptions(record, defaults),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    documentCount: record.documentCount,
  };
}

function parseOptions(value: unknown): ChatOptions {
  if (typeof value !== 'object' || value === null) throw new Error('Ongeldige instellingen.');
  const v = value as Record<string, unknown>;
  if (!isValidNumCtx(v.numCtx) || !isValidNumPredict(v.numPredict) || !isValidTemperature(v.temperature)) {
    throw new Error('Ongeldige instellingen.');
  }
  return { numCtx: v.numCtx, numPredict: v.numPredict, temperature: Math.round(v.temperature * 100) / 100 };
}

/** CRUD voor de gesprekkenlijst in de sidebar, plus modelkeuze (Automatisch/vast) en instellingen per gesprek. */
export function registerConversationsHandlers(store: ConversationStore, catalog: ModelCatalog): void {
  function requireConversation(id: unknown): ConversationRecord {
    const conversation = isValidId(id) ? store.get(id) : undefined;
    if (!conversation) throw new Error('Gesprek bestaat niet (meer).');
    return conversation;
  }

  ipcMain.handle('relay:conversations:list', (): ConversationSummary[] => {
    const defaults = loadConfig().options;
    return store.list().map((c) => toSummary(c, defaults));
  });

  /**
   * Een nieuw gesprek staat op Automatisch, tenzij het huidige gesprek een
   * vast model heeft: dan neemt het dat over (geen herlaadpauze). De
   * renderer geeft alleen een gespreks-id, nooit een modelnaam.
   */
  ipcMain.handle('relay:conversations:create', (_event, fromConversationId: unknown): ConversationSummary => {
    const config = loadConfig();
    const from = isValidId(fromConversationId) ? store.get(fromConversationId) : undefined;
    const fixed = from?.modelMode === 'fixed' && from.model;
    return toSummary(
      store.create({ modelMode: fixed ? 'fixed' : 'auto', model: fixed ? from.model : '', options: config.options }),
      config.options,
    );
  });

  ipcMain.handle('relay:conversations:rename', (_event, id: unknown, title: unknown): ConversationSummary => {
    const conversation = requireConversation(id);
    if (typeof title !== 'string' || title.length > MAX_TITLE_CHARS * 4) throw new Error('Ongeldige titel.');
    return toSummary(store.rename(conversation.id, title), loadConfig().options);
  });

  /**
   * null → Automatisch. Een vast model moet echt in Ollama staan (geen vrije
   * tekst uit de renderer); andere chatmodellen gaan dan direct uit het
   * geheugen, behalve het background- en embedding-model en modellen met een
   * lopend antwoord.
   */
  ipcMain.handle('relay:conversations:set-model', async (_event, id: unknown, model: unknown): Promise<ConversationSummary> => {
    const conversation = requireConversation(id);
    const config = loadConfig();
    if (model === null) return toSummary(store.setModelMode(conversation.id, 'auto'), config.options);

    const snapshot = await catalog.refresh();
    if (typeof model !== 'string' || !chatModelsOnly(snapshot.models).some((m) => m.name === model)) {
      throw new Error('Dit model staat niet (meer) in Ollama.');
    }
    const updated = store.setModelMode(conversation.id, 'fixed', model);
    const keep = [model, snapshot.roles.background.model, snapshot.roles.embedding.model, ...modelsInUse()];
    void unloadLoadedModels(config.ollamaUrl, UNLOAD_TIMEOUT_MS, keep.filter((m): m is string => Boolean(m)));
    return toSummary(updated, config.options);
  });

  ipcMain.handle('relay:conversations:set-options', (_event, id: unknown, options: unknown): ConversationSummary => {
    const conversation = requireConversation(id);
    return toSummary(store.setOptions(conversation.id, parseOptions(options)), loadConfig().options);
  });

  ipcMain.handle('relay:conversations:delete', (_event, id: unknown) => {
    const conversation = requireConversation(id);
    abortConversationRequests(conversation.id);
    store.delete(conversation.id);
  });

  ipcMain.handle('relay:conversations:messages', (_event, id: unknown): ConversationMessage[] => {
    const conversation = requireConversation(id);
    return toConversationMessages(store.listMessages(conversation.id));
  });
}
