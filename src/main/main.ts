import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';
import { registerChatHandler } from './ipc/chat-handler';
import { registerMemoryHandlers } from './ipc/memory-handler';
import { openMemoryDb } from './memory/db';
import { createMemoryStore } from './memory/store';

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
  console.log(`[relay] memory-database: ${dbPath}`);
  const db = openMemoryDb(dbPath);
  const memoryStore = createMemoryStore(db);

  registerChatHandler(memoryStore);
  registerMemoryHandlers(memoryStore);
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
