const MAX_TOOL_RESULT_CHARS = 8000;

/**
 * Sentinel die het prompt-tool-call-protocol gebruikt (zie chat/tool-protocol.ts)
 * en de wrapper-tag rond tool-resultaten. Opgehaalde webinhoud kan deze per
 * ongeluk of moedwillig bevatten (prompt injection) — we strippen ze altijd
 * uit externe content vóórdat die een bericht in gaat.
 */
const SENTINEL_PATTERN = /```relay_tool_call[\s\S]*?```/gi;
const WRAPPER_TAG_PATTERN = /<\/?relay-tool-result[^>]*>/gi;

/**
 * Laatste verdedigingslinie voor alle tool-resultaten (web_search + web_fetch)
 * vóórdat ze in een bericht naar het model gaan: verwijdert nagebootste
 * protocol-markers uit opgehaalde inhoud, en begrenst de lengte zodat één
 * tool-resultaat niet de hele context-window opsoupeert.
 */
export function sanitizeExternalContent(text: string): string {
  const stripped = text
    .replace(SENTINEL_PATTERN, '[verwijderd: leek op een tool-aanroep in opgehaalde inhoud]')
    .replace(WRAPPER_TAG_PATTERN, '[verwijderd: leek op een tool-resultaat-marker in opgehaalde inhoud]');

  return stripped.length > MAX_TOOL_RESULT_CHARS
    ? `${stripped.slice(0, MAX_TOOL_RESULT_CHARS)}\n[...ingekort...]`
    : stripped;
}

interface SanitizableMessage {
  role: string;
  content: string;
}

/**
 * Saneert elk 'tool'-bericht in een lijst (bv. geschiedenis die de renderer
 * bij een chat:send meestuurt). Zonder deze stap zou een gecompromitteerde
 * renderer een nagemaakt tool-bericht met een vervalste protocol-marker
 * kunnen laten passeren zonder ooit via een echte tool-uitvoering (en dus
 * zonder via sanitizeExternalContent) te gaan.
 */
export function sanitizeIncomingToolMessages<T extends SanitizableMessage>(messages: T[]): T[] {
  return messages.map((m) => (m.role === 'tool' ? { ...m, content: sanitizeExternalContent(m.content) } : m));
}
