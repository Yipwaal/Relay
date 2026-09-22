import { ipcMain, dialog, BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadConfig } from '../config';
import { createOllamaEmbedder } from '../ollama-embed';
import { ingestDocument } from '../documents/ingest';
import { SUPPORTED_EXTENSIONS } from '../documents/extract';
import type { DocumentStore, DocumentRecord } from '../documents/store';
import type { DocumentInfo } from '../../shared/ipc-types';

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

function safeSend(sender: WebContents, channel: string, payload: unknown): void {
  if (sender.isDestroyed()) return;
  sender.send(channel, payload);
}

function toDocumentInfo(record: DocumentRecord, currentEmbedModel: string): DocumentInfo {
  return { ...record, outdated: record.embedModel !== currentEmbedModel };
}

function isValidId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Documentbeheer voor het instellingenscherm: bestandsselectie gebeurt
 * volledig in main via dialog.showOpenDialog, nooit via een pad dat de
 * renderer aanlevert (een gecompromitteerde renderer zou anders elk pad
 * kunnen opgeven, bv. ~/.ssh/id_rsa, dat main dan zou inlezen en
 * doorzoekbaar maken — zie architect-advies Fase 4).
 */
export function registerDocumentsHandlers(documentStore: DocumentStore): void {
  let ingestInProgress = false;

  ipcMain.handle('relay:documents:list', () => {
    const config = loadConfig();
    return documentStore.listDocuments().map((doc) => toDocumentInfo(doc, config.embedModel));
  });

  ipcMain.handle('relay:documents:add', async (event: IpcMainInvokeEvent): Promise<DocumentInfo | null> => {
    if (ingestInProgress) {
      throw new Error('Er wordt al een document toegevoegd — wacht tot dat klaar is.');
    }
    ingestInProgress = true;

    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      const openDialogOptions: Electron.OpenDialogOptions = {
        properties: ['openFile'],
        filters: [{ name: 'Documenten', extensions: SUPPORTED_EXTENSIONS.map((ext) => ext.slice(1)) }],
      };
      const dialogResult = window
        ? await dialog.showOpenDialog(window, openDialogOptions)
        : await dialog.showOpenDialog(openDialogOptions);

      if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
        return null;
      }

      const filePath = dialogResult.filePaths[0] as string;
      const stat = await fs.stat(filePath);
      if (stat.size > MAX_FILE_SIZE_BYTES) {
        throw new Error(`Bestand is te groot (max ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))} MB).`);
      }

      const buffer = await fs.readFile(filePath);
      const title = path.basename(filePath);
      const config = loadConfig();
      const embedder = createOllamaEmbedder(config.ollamaUrl, config.embedModel);

      console.log(`[relay] document toevoegen: ${title} (${stat.size} bytes)`);

      const record = await ingestDocument(documentStore, embedder, config.embedModel, { filePath, buffer, title }, (progress) => {
        safeSend(event.sender, 'relay:documents:progress', { title, done: progress.done, total: progress.total });
      });

      return toDocumentInfo(record, config.embedModel);
    } finally {
      ingestInProgress = false;
    }
  });

  ipcMain.handle('relay:documents:delete', (_event, id: unknown) => {
    if (!isValidId(id)) {
      throw new Error('Ongeldig id.');
    }
    documentStore.deleteDocument(id);
  });
}
