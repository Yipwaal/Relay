type ToolStatus = 'running' | 'done' | 'error';

/** Een afbeelding in een gebruikersbericht: nog niet opgeslagen (blob-URL) of uit de database (id). */
interface DisplayImage {
  name: string;
  url?: string;
  id?: number;
}

/** Een afbeelding bij de vraag die nog getypt wordt. */
interface DraftImage {
  name: string;
  data: Uint8Array;
  url: string;
}

type DisplayMessage =
  | { kind: 'user'; text: string; images: DisplayImage[] }
  | {
      kind: 'assistant';
      text: string;
      model: string;
      streaming: boolean;
      failed: boolean;
      loadingModel: boolean;
      /** Waarom de router dit model koos ('code', 'probeer slimmer', …); null bij oude berichten en meldingen. */
      route: string | null;
      /** Welke poging van de beurt (1, 2, … na escalatie of "Probeer slimmer"). */
      attempt: number;
      /** Vervangen door een latere poging: gedimd, gaat niet meer naar het model. */
      superseded: boolean;
      /** Afgeleid door refreshAnswerFooters: label "model · reden" onder dit antwoord, en de knop "Probeer slimmer". */
      showRoute: boolean;
      canRetry: boolean;
    }
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
      superseded: boolean;
    };

type AssistantMessage = Extract<DisplayMessage, { kind: 'assistant' }>;

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
  segment: AssistantMessage | null;
  /** Wat de router voor de lopende poging koos (relay:chat:route); '' / null tot dat bekend is. */
  model: string;
  route: string | null;
  attempt: number;
  /** De vorige poging(en) van deze beurt: worden gedimd zodra de nieuwe poging iets oplevert. */
  replacing: DisplayMessage[];
  stopping: boolean;
}

function newPending(requestId: string, conversationId: number): PendingRequest {
  return { requestId, conversationId, segment: null, model: '', route: null, attempt: 1, replacing: [], stopping: false };
}

function newAssistant(fields: Pick<AssistantMessage, 'text' | 'model'> & Partial<AssistantMessage>): AssistantMessage {
  return {
    kind: 'assistant',
    streaming: false,
    failed: false,
    loadingModel: false,
    route: null,
    attempt: 1,
    superseded: false,
    showRoute: false,
    canRetry: false,
    ...fields,
  };
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
  defaults: { options: { numCtx: 0, numPredict: -1, temperature: 0.7 } } as RelayAppDefaults,
  /** Lokaal geïnstalleerde chatmodellen (dropdown); leeg tot de eerste keer opgehaald. */
  models: [] as RelayLocalModel[],
  /** Documenten die in het actieve gesprek doorzoekbaar zijn (eigen + globale). */
  documents: [] as RelayDocumentInfo[],
  indexing: null as IndexingState | null,
  draftImages: [] as DraftImage[],
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

/** Het model dat dit gesprek nu gebruikt: het vaste model, of in Automatisch het laatst gerouteerde ('' als nog onbekend). */
function currentModelName(c: RelayConversationSummary): string {
  return c.modelMode === 'fixed' ? c.model : (c.routedModel ?? '');
}

/** Korte tekst voor de modelkeuze: "Automatisch" of de naam van het vaste model. */
function modelModeLabel(c: RelayConversationSummary): string {
  return c.modelMode === 'fixed' ? c.model : 'Automatisch';
}

function toConversationView(summary: RelayConversationSummary): ConversationView {
  return { ...summary, display: [], loaded: false };
}

function toDisplayMessage(m: RelayConversationMessage): DisplayMessage {
  if (m.kind === 'user') return { kind: 'user', text: m.text, images: m.images.map((image) => ({ name: image.name, id: image.id })) };
  if (m.kind === 'notice') return newAssistant({ text: m.text, model: '', failed: true, superseded: m.superseded });
  if (m.kind === 'assistant') {
    return newAssistant({ text: m.interrupted ? `${m.text} …` : m.text, model: m.model, route: m.route, attempt: m.attempt, superseded: m.superseded });
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
    superseded: m.superseded,
  };
}
