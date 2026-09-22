import type { ChatMessage, ChunkPayload, DonePayload, ErrorPayload } from '../shared/ipc-types';

declare global {
  type RelayChatMessage = ChatMessage;

  interface RelayAPI {
    sendMessage(messages: RelayChatMessage[]): string;
    onChunk(callback: (payload: ChunkPayload) => void): void;
    onDone(callback: (payload: DonePayload) => void): void;
    onError(callback: (payload: ErrorPayload) => void): void;
  }

  interface Window {
    relay: RelayAPI;
  }
}
