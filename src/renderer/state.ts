type ToolStatus = 'running' | 'done' | 'error';

type DisplayMessage =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; model: string; streaming: boolean; failed: boolean }
  | {
      kind: 'tool';
      tool: string;
      query: string;
      label: string;
      status: ToolStatus;
      summary: string;
      items: RelayToolPreviewItem[];
      /** De exacte (gesaneerde) tekst die het model kreeg. */
      preview: string;
      durationMs: number;
      open: boolean;
    };

interface ConversationView {
  id: number;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  /** Wat naar main gaat bij de volgende beurt (incl. tool-berichten voor het model). */
  history: RelayChatMessage[];
  /** Wat de gebruiker ziet: bubbels en tool-kaarten. */
  display: DisplayMessage[];
}

interface PendingRequest {
  requestId: string;
  conversationId: number;
  /** Assistant-bubbel die nu tokens ontvangt; null tussen twee segmenten (bv. rond een tool-aanroep). */
  segment: Extract<DisplayMessage, { kind: 'assistant' }> | null;
}

interface IndexingState {
  title: string;
  done: number;
  total: number;
}

const appState = {
  conversations: [] as ConversationView[],
  activeId: 0,
  defaults: { model: '', numCtx: 0 } as RelayAppDefaults,
  documents: [] as RelayDocumentInfo[],
  indexing: null as IndexingState | null,
  pending: null as PendingRequest | null,
  factsCount: 0,
  renamingId: null as number | null,
  deleteId: null as number | null,
};

function activeConversation(): ConversationView | undefined {
  return appState.conversations.find((c) => c.id === appState.activeId);
}

function conversationById(id: number): ConversationView | undefined {
  return appState.conversations.find((c) => c.id === id);
}

// Gesprekken leven voorlopig alleen in het geheugen van de renderer; de
// async-vorm is alvast gelijk aan wat de database-variant straks nodig heeft.
let nextConversationId = 1;

interface ConversationStore {
  create(model: string): Promise<ConversationView>;
  rename(id: number, title: string): Promise<void>;
  remove(id: number): Promise<void>;
}

const conversationStore: ConversationStore = {
  async create(model) {
    const now = Date.now();
    return { id: nextConversationId++, title: 'Nieuw gesprek', createdAt: now, updatedAt: now, model, history: [], display: [] };
  },
  async rename() {},
  async remove() {},
};
