import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppDefaults,
  ChatStatusPayload,
  ChunkPayload,
  ConversationMessage,
  ConversationSummary,
  ConversationUpdatedPayload,
  DocumentInfo,
  DocumentProgressPayload,
  DonePayload,
  ErrorPayload,
  MemoryFact,
  OllamaStatus,
  ToolCallPayload,
  ToolResultPayload,
} from '../shared/ipc-types';

function on<T>(channel: string, callback: (payload: T) => void): void {
  ipcRenderer.on(channel, (_event, payload: T) => callback(payload));
}

contextBridge.exposeInMainWorld('relay', {
  defaults(): Promise<AppDefaults> {
    return ipcRenderer.invoke('relay:app:defaults');
  },
  /** Alleen de nieuwe tekst: de geschiedenis leest main zelf uit de database. */
  sendMessage(conversationId: number, text: string): string {
    const requestId = crypto.randomUUID();
    ipcRenderer.send('relay:chat:send', { requestId, conversationId, text });
    return requestId;
  },
  stopMessage(requestId: string): void {
    ipcRenderer.send('relay:chat:stop', requestId);
  },
  ollamaStatus(): Promise<OllamaStatus> {
    return ipcRenderer.invoke('relay:ollama:status');
  },
  onStatus: (callback: (payload: ChatStatusPayload) => void) => on('relay:chat:status', callback),
  onChunk: (callback: (payload: ChunkPayload) => void) => on('relay:chat:chunk', callback),
  onToolCall: (callback: (payload: ToolCallPayload) => void) => on('relay:chat:tool-call', callback),
  onToolResult: (callback: (payload: ToolResultPayload) => void) => on('relay:chat:tool-result', callback),
  onDone: (callback: (payload: DonePayload) => void) => on('relay:chat:done', callback),
  onError: (callback: (payload: ErrorPayload) => void) => on('relay:chat:error', callback),
  conversations: {
    list(): Promise<ConversationSummary[]> {
      return ipcRenderer.invoke('relay:conversations:list');
    },
    create(): Promise<ConversationSummary> {
      return ipcRenderer.invoke('relay:conversations:create');
    },
    rename(id: number, title: string): Promise<ConversationSummary> {
      return ipcRenderer.invoke('relay:conversations:rename', id, title);
    },
    remove(id: number): Promise<void> {
      return ipcRenderer.invoke('relay:conversations:delete', id);
    },
    messages(id: number): Promise<ConversationMessage[]> {
      return ipcRenderer.invoke('relay:conversations:messages', id);
    },
    onUpdated: (callback: (payload: ConversationUpdatedPayload) => void) => on('relay:conversations:updated', callback),
  },
  memory: {
    list(): Promise<MemoryFact[]> {
      return ipcRenderer.invoke('relay:memory:list');
    },
    add(text: string): Promise<MemoryFact> {
      return ipcRenderer.invoke('relay:memory:add', text);
    },
    update(id: number, text: string): Promise<MemoryFact> {
      return ipcRenderer.invoke('relay:memory:update', id, text);
    },
    remove(id: number): Promise<void> {
      return ipcRenderer.invoke('relay:memory:delete', id);
    },
  },
  documents: {
    list(conversationId: number): Promise<DocumentInfo[]> {
      return ipcRenderer.invoke('relay:documents:list', conversationId);
    },
    add(conversationId: number): Promise<DocumentInfo | null> {
      return ipcRenderer.invoke('relay:documents:add', conversationId);
    },
    addDropped(conversationId: number, name: string, data: Uint8Array): Promise<DocumentInfo> {
      return ipcRenderer.invoke('relay:documents:add-dropped', conversationId, name, data);
    },
    remove(id: number): Promise<void> {
      return ipcRenderer.invoke('relay:documents:delete', id);
    },
    onProgress: (callback: (payload: DocumentProgressPayload) => void) => on('relay:documents:progress', callback),
  },
});
