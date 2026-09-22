import type {
  ChatMessage,
  ChunkPayload,
  DocumentInfo,
  DocumentProgressPayload,
  DonePayload,
  ErrorPayload,
  MemoryFact,
  ToolCallPayload,
  ToolResultPayload,
} from '../shared/ipc-types';

declare global {
  type RelayChatMessage = ChatMessage;
  type RelayMemoryFact = MemoryFact;
  type RelayDocumentInfo = DocumentInfo;

  interface RelayMemoryAPI {
    list(): Promise<RelayMemoryFact[]>;
    add(text: string): Promise<RelayMemoryFact>;
    update(id: number, text: string): Promise<RelayMemoryFact>;
    remove(id: number): Promise<void>;
  }

  interface RelayDocumentsAPI {
    list(): Promise<RelayDocumentInfo[]>;
    /** Opent een native bestandskiezer (main); geeft null terug als de gebruiker annuleert. */
    add(): Promise<RelayDocumentInfo | null>;
    remove(id: number): Promise<void>;
    onProgress(callback: (payload: DocumentProgressPayload) => void): void;
  }

  interface RelayAPI {
    sendMessage(messages: RelayChatMessage[]): string;
    onChunk(callback: (payload: ChunkPayload) => void): void;
    onToolCall(callback: (payload: ToolCallPayload) => void): void;
    onToolResult(callback: (payload: ToolResultPayload) => void): void;
    onDone(callback: (payload: DonePayload) => void): void;
    onError(callback: (payload: ErrorPayload) => void): void;
    memory: RelayMemoryAPI;
    documents: RelayDocumentsAPI;
  }

  interface Window {
    relay: RelayAPI;
  }
}
