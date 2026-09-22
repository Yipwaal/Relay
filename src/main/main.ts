import { app, BrowserWindow, ipcMain, type IpcMainEvent, type WebContents } from 'electron';
import * as path from 'node:path';
import { loadConfig } from './config';
import { streamChat } from './ollama-client';
import type { ChatMessage } from '../shared/ipc-types';

function createWindow(): void {
  const window = new BrowserWindow({
    width: 900,
    height: 700,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

interface IncomingMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatSendPayload {
  requestId: string;
  messages: IncomingMessage[];
}

function isIncomingMessage(value: unknown): value is IncomingMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (v.role === 'user' || v.role === 'assistant') && typeof v.content === 'string';
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

function registerChatHandler(): void {
  ipcMain.on('relay:chat:send', (event: IpcMainEvent, payload: unknown) => {
    if (!isChatSendPayload(payload)) {
      console.error('[relay] ongeldig chat:send-bericht genegeerd');
      return;
    }

    const { requestId, messages } = payload;

    void (async () => {
      try {
        const config = loadConfig();
        const fullMessages: ChatMessage[] = [{ role: 'system', content: config.systemPrompt }, ...messages];

        console.log(`[relay] chat request model=${config.model} messages=${fullMessages.length}`);

        await streamChat(config.ollamaUrl, config.model, fullMessages, (token) => {
          safeSend(event.sender, 'relay:chat:chunk', { requestId, token });
        });

        safeSend(event.sender, 'relay:chat:done', { requestId });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Onbekende fout bij Ollama-aanroep';
        console.error(`[relay] chat request mislukt: ${message}`);
        safeSend(event.sender, 'relay:chat:error', { requestId, message });
      }
    })();
  });
}

app.whenReady().then(() => {
  registerChatHandler();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
