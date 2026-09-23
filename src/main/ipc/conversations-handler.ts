import { ipcMain } from 'electron';
import { loadConfig } from '../config';
import { toConversationMessages } from '../conversations/history';
import { MAX_TITLE_CHARS, type ConversationRecord, type ConversationStore } from '../conversations/store';
import type { ConversationMessage, ConversationSummary } from '../../shared/ipc-types';
import { abortConversationRequests } from './chat-handler';

function isValidId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function toSummary(record: ConversationRecord): ConversationSummary {
  return {
    id: record.id,
    title: record.title,
    model: record.model,
    numCtx: record.numCtx,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    documentCount: record.documentCount,
  };
}

/** CRUD voor de gesprekkenlijst in de sidebar. Zelfde strikte validatie als de andere handlers. */
export function registerConversationsHandlers(store: ConversationStore): void {
  function requireConversation(id: unknown): ConversationRecord {
    const conversation = isValidId(id) ? store.get(id) : undefined;
    if (!conversation) throw new Error('Gesprek bestaat niet (meer).');
    return conversation;
  }

  ipcMain.handle('relay:conversations:list', (): ConversationSummary[] => store.list().map(toSummary));

  ipcMain.handle('relay:conversations:create', (): ConversationSummary => {
    const config = loadConfig();
    return toSummary(store.create({ model: config.model, numCtx: config.numCtx }));
  });

  ipcMain.handle('relay:conversations:rename', (_event, id: unknown, title: unknown): ConversationSummary => {
    const conversation = requireConversation(id);
    if (typeof title !== 'string' || title.length > MAX_TITLE_CHARS * 4) throw new Error('Ongeldige titel.');
    return toSummary(store.rename(conversation.id, title));
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
