import type {
  ChatMessage,
  ChunkPayload,
  DonePayload,
  ErrorPayload,
  MemoryFact,
  ToolCallPayload,
  ToolResultPayload,
} from '../shared/ipc-types';

declare global {
  type RelayChatMessage = ChatMessage;
  type RelayMemoryFact = MemoryFact;

  interface RelayMemoryAPI {
    list(): Promise<RelayMemoryFact[]>;
    add(text: string): Promise<RelayMemoryFact>;
    update(id: number, text: string): Promise<RelayMemoryFact>;
    remove(id: number): Promise<void>;
  }

  interface RelayAPI {
    sendMessage(messages: RelayChatMessage[]): string;
    onChunk(callback: (payload: ChunkPayload) => void): void;
    onToolCall(callback: (payload: ToolCallPayload) => void): void;
    onToolResult(callback: (payload: ToolResultPayload) => void): void;
    onDone(callback: (payload: DonePayload) => void): void;
    onError(callback: (payload: ErrorPayload) => void): void;
    memory: RelayMemoryAPI;
  }

  interface Window {
    relay: RelayAPI;
  }
}
