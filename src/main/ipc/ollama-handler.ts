import { ipcMain } from 'electron';
import { loadConfig } from '../config';
import { pingOllama } from '../ollama-lifecycle';
import type { OllamaStatus } from '../../shared/ipc-types';

const PING_TIMEOUT_MS = 1500;

/** Status van de lokale Ollama-server, voor de indicator in de sidebar. */
export function registerOllamaHandlers(): void {
  ipcMain.handle('relay:ollama:status', async (): Promise<OllamaStatus> => {
    const running = await pingOllama(loadConfig().ollamaUrl, PING_TIMEOUT_MS);
    return { running };
  });
}
