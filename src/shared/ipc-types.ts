export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Verplicht wanneer role === 'tool': welke tool dit resultaat opleverde. */
  toolName?: string;
}

export interface ChunkPayload {
  requestId: string;
  token: string;
}

export interface ToolCallPayload {
  requestId: string;
  /** Kant-en-klare, mensleesbare tekst, bv. 'Zoekt naar: "..."'. */
  label: string;
}

export interface ToolResultPayload {
  requestId: string;
  /** Kant-en-klare, mensleesbare tekst, bv. '3 resultaten gevonden'. */
  summary: string;
  ok: boolean;
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
