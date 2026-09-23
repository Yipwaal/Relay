import { ipcMain, dialog, BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadConfig } from '../config';
import { createOllamaEmbedder } from '../ollama-embed';
import { ingestDocument } from '../documents/ingest';
import { isSupportedExtension, SUPPORTED_EXTENSIONS, type SupportedExtension } from '../documents/extract';
import type { DocumentStore, DocumentRecord } from '../documents/store';
import type { ConversationStore } from '../conversations/store';
import type { DocumentInfo, DocumentProgressPayload } from '../../shared/ipc-types';

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
// .pdf/.docx zijn gecomprimeerde formaten: hun uitgepakte tekst kan veel groter zijn
// dan het bestand op schijf (decompressie-bom-risico, zie README). Een lagere grens
// hier beperkt hoeveel data er überhaupt aan de (niet-gesandboxde) extractie wordt
// aangeboden; .txt/.md worden direct gelezen zonder decompressiestap.
const MAX_COMPRESSED_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const COMPRESSED_EXTENSIONS: ReadonlySet<SupportedExtension> = new Set(['.pdf', '.docx']);
const MAX_FILE_NAME_CHARS = 255;

function maxFileSizeFor(fileName: string): number {
  const ext = path.extname(fileName).toLowerCase();
  return COMPRESSED_EXTENSIONS.has(ext as SupportedExtension) ? MAX_COMPRESSED_FILE_SIZE_BYTES : MAX_FILE_SIZE_BYTES;
}

function assertSize(fileName: string, size: number): void {
  const maxSize = maxFileSizeFor(fileName);
  if (size > maxSize) throw new Error(`Bestand is te groot (max ${Math.round(maxSize / (1024 * 1024))} MB).`);
}

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
 * Documenten per gesprek, via de paperclip (native dialoog) of slepen.
 *
 * Paperclip: bestandsselectie gebeurt volledig in main via
 * dialog.showOpenDialog, nooit via een pad dat de renderer aanlevert (een
 * gecompromitteerde renderer zou anders elk pad kunnen opgeven, bv.
 * ~/.ssh/id_rsa, dat main dan zou inlezen en doorzoekbaar maken).
 *
 * Slepen: de renderer stuurt alleen de bestandsnaam en de bytes die de
 * gebruiker zelf op het venster liet vallen. Main leest hiervoor niets van
 * schijf, dus ook hier kan de renderer geen willekeurig pad laten inlezen;
 * de naam wordt tot een basename teruggebracht en alleen gebruikt als titel
 * en om het type te bepalen.
 */
export function registerDocumentsHandlers(documentStore: DocumentStore, conversationStore: ConversationStore): void {
  let ingestInProgress = false;

  function requireConversation(id: unknown): number {
    if (!isValidId(id) || !conversationStore.get(id)) throw new Error('Gesprek bestaat niet (meer).');
    return id;
  }

  async function ingest(sender: WebContents, conversationId: number, title: string, buffer: Buffer): Promise<DocumentInfo> {
    if (ingestInProgress) throw new Error('Er wordt al een document toegevoegd — wacht tot dat klaar is.');
    ingestInProgress = true;
    try {
      const config = loadConfig();
      const embedder = createOllamaEmbedder(config.ollamaUrl, config.embedModel);
      console.log(`[relay] document toevoegen aan gesprek ${conversationId}: ${title} (${buffer.length} bytes)`);
      const record = await ingestDocument(documentStore, embedder, config.embedModel, { conversationId, filePath: title, buffer, title }, (progress) => {
        const payload: DocumentProgressPayload = { conversationId, title, done: progress.done, total: progress.total };
        safeSend(sender, 'relay:documents:progress', payload);
      });
      return toDocumentInfo(record, config.embedModel);
    } finally {
      ingestInProgress = false;
    }
  }

  ipcMain.handle('relay:documents:list', (_event, conversationId: unknown) => {
    const config = loadConfig();
    return documentStore.listDocuments(requireConversation(conversationId)).map((doc) => toDocumentInfo(doc, config.embedModel));
  });

  ipcMain.handle('relay:documents:add', async (event: IpcMainInvokeEvent, conversationIdArg: unknown): Promise<DocumentInfo | null> => {
    const conversationId = requireConversation(conversationIdArg);
    if (ingestInProgress) throw new Error('Er wordt al een document toegevoegd — wacht tot dat klaar is.');

    const window = BrowserWindow.fromWebContents(event.sender);
    const openDialogOptions: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Documenten', extensions: SUPPORTED_EXTENSIONS.map((ext) => ext.slice(1)) }],
    };
    const dialogResult = window ? await dialog.showOpenDialog(window, openDialogOptions) : await dialog.showOpenDialog(openDialogOptions);
    if (dialogResult.canceled || dialogResult.filePaths.length === 0) return null;

    const filePath = dialogResult.filePaths[0] as string;
    const stat = await fs.stat(filePath);
    assertSize(filePath, stat.size);
    return ingest(event.sender, conversationId, path.basename(filePath), await fs.readFile(filePath));
  });

  ipcMain.handle('relay:documents:add-dropped', async (event: IpcMainInvokeEvent, conversationIdArg: unknown, name: unknown, data: unknown) => {
    const conversationId = requireConversation(conversationIdArg);
    if (typeof name !== 'string' || !(data instanceof Uint8Array)) throw new Error('Ongeldig bestand.');
    const title = path.basename(name.replace(/\\/g, '/')).slice(0, MAX_FILE_NAME_CHARS);
    if (!isSupportedExtension(path.extname(title))) {
      throw new Error(`"${title}" wordt niet ondersteund — alleen .txt, .md, .pdf en .docx.`);
    }
    assertSize(title, data.byteLength);
    return ingest(event.sender, conversationId, title, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  });

  ipcMain.handle('relay:documents:delete', (_event, id: unknown) => {
    if (!isValidId(id)) throw new Error('Ongeldig id.');
    documentStore.deleteDocument(id);
  });
}
