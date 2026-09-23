type ToolStatus = 'running' | 'done' | 'error';

type DisplayMessage =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; model: string; streaming: boolean; failed: boolean; loadingModel: boolean }
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

/** De modelgeschiedenis zelf blijft in main (database); de renderer houdt alleen bij wat hij toont. */
interface ConversationView extends RelayConversationSummary {
  display: DisplayMessage[];
  /** false tot de berichten van dit gesprek één keer uit de database zijn geladen. */
  loaded: boolean;
}

interface PendingRequest {
  requestId: string;
  conversationId: number;
  /** Assistant-bubbel die nu tokens ontvangt; null tussen twee segmenten (bv. rond een tool-aanroep). */
  segment: Extract<DisplayMessage, { kind: 'assistant' }> | null;
  stopping: boolean;
}

interface IndexingState {
  conversationId: number;
  title: string;
  done: number;
  total: number;
}

const appState = {
  conversations: [] as ConversationView[],
  activeId: 0,
  defaults: { model: '', numCtx: 0 } as RelayAppDefaults,
  /** Documenten die in het actieve gesprek doorzoekbaar zijn (eigen + globale). */
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

function toConversationView(summary: RelayConversationSummary): ConversationView {
  return { ...summary, display: [], loaded: false };
}

function toDisplayMessage(m: RelayConversationMessage): DisplayMessage {
  if (m.kind === 'user') return { kind: 'user', text: m.text };
  if (m.kind === 'notice') return { kind: 'assistant', text: m.text, model: '', streaming: false, failed: true, loadingModel: false };
  if (m.kind === 'assistant') {
    return { kind: 'assistant', text: m.interrupted ? `${m.text} …` : m.text, model: m.model, streaming: false, failed: false, loadingModel: false };
  }
  const d = m.display;
  return {
    kind: 'tool',
    tool: d.tool,
    query: d.query,
    label: d.label,
    status: d.ok ? 'done' : 'error',
    summary: d.summary,
    items: d.items,
    preview: d.preview,
    durationMs: d.durationMs,
    // Eerder bekeken resultaten ingeklapt; nieuwe (live) kaarten met externe inhoud staan open.
    open: false,
  };
}
