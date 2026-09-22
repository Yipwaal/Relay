import { ipcMain } from 'electron';
import type { MemoryStore } from '../memory/store';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Request/response-IPC voor het instellingenscherm (CRUD op feiten), naast de
 * fire-and-forget chat-kanalen in chat-handler.ts. ipcMain.handle werkt
 * gewoon onder sandbox: true. Elke payload wordt hier net zo streng
 * gevalideerd als chat-handler.ts dat doet — zelfde dreigingsmodel
 * (gecompromitteerde renderer), zelfde striktheid.
 */
export function registerMemoryHandlers(store: MemoryStore): void {
  ipcMain.handle('relay:memory:list', () => store.listFacts());

  ipcMain.handle('relay:memory:add', (_event, text: unknown) => {
    if (!isNonEmptyString(text)) {
      throw new Error('Feit mag niet leeg zijn.');
    }
    return store.addFact(text, 'user');
  });

  ipcMain.handle('relay:memory:update', (_event, id: unknown, text: unknown) => {
    if (!isValidId(id)) {
      throw new Error('Ongeldig id.');
    }
    if (!isNonEmptyString(text)) {
      throw new Error('Feit mag niet leeg zijn.');
    }
    return store.updateFact(id, text);
  });

  ipcMain.handle('relay:memory:delete', (_event, id: unknown) => {
    if (!isValidId(id)) {
      throw new Error('Ongeldig id.');
    }
    store.deleteFact(id);
  });
}
