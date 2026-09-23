export interface ChatToolCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Discriminated union i.p.v. losse optionele velden: dwingt af dat
 * toolName verplicht is bij role 'tool', en dat toolCalls alleen op een
 * assistant-bericht kan staan (native tool_calls die naar Ollama teruggaan).
 */
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ChatToolCall[] }
  | { role: 'tool'; content: string; toolName: string };

export interface ChunkPayload {
  requestId: string;
  token: string;
}

/** Eén gevonden fragment voor de tool-kaart in de UI: bron (document, domein, URL) + tekst. */
export interface ToolPreviewItem {
  src: string;
  text: string;
}

export interface ToolCallInfo {
  /** Toolnaam, bv. 'search_documents' — de renderer kiest hier het kaartlabel op. */
  tool: string;
  /** Het belangrijkste argument (zoekvraag, URL of feit), voor de kaarttitel. */
  query: string;
  /** Kant-en-klare, mensleesbare tekst, bv. 'Zoekt naar: "..."'. */
  label: string;
}

export interface ToolResultInfo {
  /** Kant-en-klare, mensleesbare tekst, bv. '3 resultaten gevonden'. */
  summary: string;
  ok: boolean;
  /** De exacte (gesaneerde) inhoud die het model te zien krijgt — zichtbaar vóór gebruik, zie CLAUDE.md. */
  preview: string;
  /** Dezelfde resultaten per fragment, elk apart gesaneerd, voor de inklapbare kaart. */
  items: ToolPreviewItem[];
  durationMs: number;
}

export type ToolCallPayload = ToolCallInfo & { requestId: string };
export type ToolResultPayload = ToolResultInfo & { requestId: string };

export interface AppDefaults {
  model: string;
  numCtx: number;
}

export interface DonePayload {
  requestId: string;
  /** Alle berichten die deze beurt aan de geschiedenis zijn toegevoegd (assistant + eventuele tool-berichten), in volgorde. */
  appended: ChatMessage[];
}

export interface ErrorPayload {
  requestId: string;
  message: string;
}

export interface MemoryFact {
  id: number;
  text: string;
  /** 'user': handmatig toegevoegd via het instellingenscherm. 'model': via de remember-tool. */
  source: 'user' | 'model';
  createdAt: number;
  updatedAt: number;
}

export interface DocumentInfo {
  id: number;
  title: string;
  contentHash: string;
  charCount: number;
  chunkCount: number;
  embedModel: string;
  embedDims: number;
  createdAt: number;
  /** true als embedModel niet meer overeenkomt met de huidig geconfigureerde embedModel — niet meer doorzoekbaar tot het opnieuw wordt toegevoegd. */
  outdated: boolean;
}

/** Geen requestId: main staat maar één document-toevoeging tegelijk toe, dus correlatie is niet nodig. */
export interface DocumentProgressPayload {
  title: string;
  done: number;
  total: number;
}
