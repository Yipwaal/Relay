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
  /** De exacte (gesaneerde) inhoud die het model te zien krijgt — zichtbaar vóór gebruik, zie CLAUDE.md. */
  preview: string;
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
