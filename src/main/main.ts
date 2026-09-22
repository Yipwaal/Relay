import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';
import { registerChatHandler } from './ipc/chat-handler';
import { registerMemoryHandlers } from './ipc/memory-handler';
import { registerDocumentsHandlers } from './ipc/documents-handler';
import { openRelayDb } from './db';
import { createMemoryStore } from './memory/store';
import { createDocumentStore } from './documents/store';

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

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'relay.db');
  console.log(`[relay] database: ${dbPath}`);
  const db = openRelayDb(dbPath);
  const memoryStore = createMemoryStore(db);
  const documentStore = createDocumentStore(db);

  registerChatHandler(memoryStore, documentStore);
  registerMemoryHandlers(memoryStore);
  registerDocumentsHandlers(documentStore);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('before-quit', () => db.close());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
