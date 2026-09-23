import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppDefaults,
  ChatMessage,
  ChatStatusPayload,
  ChunkPayload,
  DocumentInfo,
  DocumentProgressPayload,
  DonePayload,
  ErrorPayload,
  MemoryFact,
  OllamaStatus,
  ToolCallPayload,
  ToolResultPayload,
} from '../shared/ipc-types';

contextBridge.exposeInMainWorld('relay', {
  defaults(): Promise<AppDefaults> {
    return ipcRenderer.invoke('relay:app:defaults');
  },
  sendMessage(messages: ChatMessage[]): string {
    const requestId = crypto.randomUUID();
    ipcRenderer.send('relay:chat:send', { requestId, messages });
    return requestId;
  },
  stopMessage(requestId: string): void {
    ipcRenderer.send('relay:chat:stop', requestId);
  },
  onStatus(callback: (payload: ChatStatusPayload) => void): void {
    ipcRenderer.on('relay:chat:status', (_event, payload: ChatStatusPayload) => callback(payload));
  },
  ollamaStatus(): Promise<OllamaStatus> {
    return ipcRenderer.invoke('relay:ollama:status');
  },
  onChunk(callback: (payload: ChunkPayload) => void): void {
    ipcRenderer.on('relay:chat:chunk', (_event, payload: ChunkPayload) => callback(payload));
  },
  onToolCall(callback: (payload: ToolCallPayload) => void): void {
    ipcRenderer.on('relay:chat:tool-call', (_event, payload: ToolCallPayload) => callback(payload));
  },
  onToolResult(callback: (payload: ToolResultPayload) => void): void {
    ipcRenderer.on('relay:chat:tool-result', (_event, payload: ToolResultPayload) => callback(payload));
  },
  onDone(callback: (payload: DonePayload) => void): void {
    ipcRenderer.on('relay:chat:done', (_event, payload: DonePayload) => callback(payload));
  },
  onError(callback: (payload: ErrorPayload) => void): void {
    ipcRenderer.on('relay:chat:error', (_event, payload: ErrorPayload) => callback(payload));
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
    list(): Promise<DocumentInfo[]> {
      return ipcRenderer.invoke('relay:documents:list');
    },
    add(): Promise<DocumentInfo | null> {
      return ipcRenderer.invoke('relay:documents:add');
    },
    remove(id: number): Promise<void> {
      return ipcRenderer.invoke('relay:documents:delete', id);
    },
    onProgress(callback: (payload: DocumentProgressPayload) => void): void {
      ipcRenderer.on('relay:documents:progress', (_event, payload: DocumentProgressPayload) => callback(payload));
    },
  },
});
