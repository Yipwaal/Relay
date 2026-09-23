import { ipcMain } from 'electron';
import { loadConfig } from '../config';
import { pingOllama } from '../ollama-lifecycle';
import { listChatModels } from '../models';
import type { LocalModel, OllamaStatus } from '../../shared/ipc-types';

const PING_TIMEOUT_MS = 1500;

/** Status van de lokale Ollama-server (indicator in de sidebar) en de lokaal beschikbare modellen (dropdown). */
export function registerOllamaHandlers(): void {
  ipcMain.handle('relay:ollama:status', async (): Promise<OllamaStatus> => {
    const running = await pingOllama(loadConfig().ollamaUrl, PING_TIMEOUT_MS);
    return { running };
  });

  ipcMain.handle('relay:models:list', (): Promise<LocalModel[]> => listChatModels(loadConfig().ollamaUrl));
}
