import { contextBridge, ipcRenderer } from 'electron';
import type {
  ChatMessage,
  ChunkPayload,
  DonePayload,
  ErrorPayload,
  ToolCallPayload,
  ToolResultPayload,
} from '../shared/ipc-types';

contextBridge.exposeInMainWorld('relay', {
  sendMessage(messages: ChatMessage[]): string {
    const requestId = crypto.randomUUID();
    ipcRenderer.send('relay:chat:send', { requestId, messages });
    return requestId;
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
});
