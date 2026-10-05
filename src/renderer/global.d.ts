import type {
  AppDefaults,
  ChatOptions,
  ChatRoutePayload,
  ChatStatusPayload,
  ChunkPayload,
  ConversationMessage,
  ConversationSummary,
  ConversationUpdatedPayload,
  DocumentInfo,
  DocumentProgressPayload,
  DonePayload,
  ErrorPayload,
  LocalModel,
  MemoryFact,
  OllamaStatus,
  OutgoingImage,
  ImageData,
  RouterSettingsInfo,
  ToolCallPayload,
  ToolPreviewItem,
  ToolResultPayload,
} from '../shared/ipc-types';

declare global {
  type RelayMemoryFact = MemoryFact;
  type RelayDocumentInfo = DocumentInfo;
  type RelayToolPreviewItem = ToolPreviewItem;
  type RelayAppDefaults = AppDefaults;
  type RelayConversationSummary = ConversationSummary;
  type RelayConversationMessage = ConversationMessage;
  type RelayLocalModel = LocalModel;
  type RelayChatOptions = ChatOptions;
  type RelayRouterSettings = RouterSettingsInfo;
  type RelayRoutePayload = ChatRoutePayload;

  interface RelayConversationsAPI {
    list(): Promise<RelayConversationSummary[]>;
    /** Staat op Automatisch, tenzij fromConversationId een vast model heeft (dat wordt overgenomen); instellingen komen uit config.json. */
    create(fromConversationId?: number): Promise<RelayConversationSummary>;
    rename(id: number, title: string): Promise<RelayConversationSummary>;
    remove(id: number): Promise<void>;
    /** null = Automatisch (de router kiest per bericht). */
    setModel(id: number, model: string | null): Promise<RelayConversationSummary>;
    setOptions(id: number, options: RelayChatOptions): Promise<RelayConversationSummary>;
    messages(id: number): Promise<RelayConversationMessage[]>;
    /** Bytes + type van een afbeelding bij een bericht, voor de miniatuur. */
    image(id: number): Promise<ImageData>;
    onUpdated(callback: (payload: ConversationUpdatedPayload) => void): void;
  }

  interface RelayRouterAPI {
    settings(): Promise<RelayRouterSettings>;
    setAllowMax(value: boolean): Promise<RelayRouterSettings>;
  }

  interface RelayMemoryAPI {
    list(): Promise<RelayMemoryFact[]>;
    add(text: string): Promise<RelayMemoryFact>;
    update(id: number, text: string): Promise<RelayMemoryFact>;
    remove(id: number): Promise<void>;
  }

  interface RelayDocumentsAPI {
    list(conversationId: number): Promise<RelayDocumentInfo[]>;
    /** Opent een native bestandskiezer (main); geeft null terug als de gebruiker annuleert. */
    add(conversationId: number): Promise<RelayDocumentInfo | null>;
    /** Voor slepen: alleen naam + inhoud van het gesleepte bestand, nooit een pad. */
    addDropped(conversationId: number, name: string, data: Uint8Array): Promise<RelayDocumentInfo>;
    remove(id: number): Promise<void>;
    onProgress(callback: (payload: DocumentProgressPayload) => void): void;
  }

  interface RelayAPI {
    defaults(): Promise<RelayAppDefaults>;
    sendMessage(conversationId: number, text: string, images?: OutgoingImage[]): string;
    retryMessage(conversationId: number): string;
    stopMessage(requestId: string): void;
    ollamaStatus(): Promise<OllamaStatus>;
    listModels(): Promise<RelayLocalModel[]>;
    onRoute(callback: (payload: RelayRoutePayload) => void): void;
    onStatus(callback: (payload: ChatStatusPayload) => void): void;
    onChunk(callback: (payload: ChunkPayload) => void): void;
    onToolCall(callback: (payload: ToolCallPayload) => void): void;
    onToolResult(callback: (payload: ToolResultPayload) => void): void;
    onDone(callback: (payload: DonePayload) => void): void;
    onError(callback: (payload: ErrorPayload) => void): void;
    conversations: RelayConversationsAPI;
    router: RelayRouterAPI;
    memory: RelayMemoryAPI;
    documents: RelayDocumentsAPI;
  }

  interface Window {
    relay: RelayAPI;
  }
}
