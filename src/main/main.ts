import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';
import { registerChatHandler } from './ipc/chat-handler';
import { registerMemoryHandlers } from './ipc/memory-handler';
import { registerDocumentsHandlers } from './ipc/documents-handler';
import { registerOllamaHandlers } from './ipc/ollama-handler';
import { openRelayDb } from './db';
import { loadConfig } from './config';
import { createBeforeQuitHandler } from './quit';
import { createMemoryStore } from './memory/store';
import { createDocumentStore } from './documents/store';

function createWindow(): void {
  const window = new BrowserWindow({
    show: false,
    minWidth: 1080,
    minHeight: 640,
    backgroundColor: '#0d1613',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => {
    window.maximize();
    window.show();
  });

  // Een bestand op het venster slepen laat Chromium er standaard naartoe
  // navigeren (en daarmee de app vervangen); nieuwe vensters zijn nooit nodig.
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'relay.db');
  console.log(`[relay] database: ${dbPath}`);
  const db = openRelayDb(dbPath);
  const memoryStore = createMemoryStore(db);
  const documentStore = createDocumentStore(db);

  registerChatHandler(memoryStore, documentStore);
  registerMemoryHandlers(memoryStore);
  registerDocumentsHandlers(documentStore);
  registerOllamaHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on(
    'before-quit',
    createBeforeQuitHandler({
      ollamaUrl: () => loadConfig().ollamaUrl,
      closeDb: () => db.close(),
      exit: () => app.exit(0),
    }),
  );
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
