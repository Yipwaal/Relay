import { ipcMain } from 'electron';
import { loadConfig } from '../config';
import type { ModelCatalog } from '../model-catalog';
import { chatModelsOnly } from '../models';
import { pingOllama } from '../ollama-lifecycle';
import type { LocalModel, OllamaStatus } from '../../shared/ipc-types';

const PING_TIMEOUT_MS = 1500;

/** Status van de lokale Ollama-server (indicator in de sidebar) en de lokaal beschikbare chatmodellen (dropdown). */
export function registerOllamaHandlers(catalog: ModelCatalog): void {
  ipcMain.handle('relay:ollama:status', async (): Promise<OllamaStatus> => {
    const running = await pingOllama(loadConfig().ollamaUrl, PING_TIMEOUT_MS);
    return { running };
  });

  // Ververst de catalogus: de dropdown wordt geopend na een eventuele `ollama pull`.
  ipcMain.handle('relay:models:list', async (): Promise<LocalModel[]> => chatModelsOnly((await catalog.refresh()).models));
}
