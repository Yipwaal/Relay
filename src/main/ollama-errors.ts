export const OLLAMA_UNREACHABLE_MESSAGE = 'Ollama lijkt niet te draaien — start Ollama en probeer opnieuw.';

const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENOTFOUND', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

/**
 * Node's fetch gooit bij een weigerende/afwezige server een TypeError
 * "fetch failed" met de echte oorzaak (bv. ECONNREFUSED) in error.cause.
 * Alleen dát geval vertalen we naar een vriendelijke melding; HTTP-fouten
 * van een wél draaiende Ollama (404 model niet gevonden, 500) blijven zoals
 * ze zijn, want die hebben een andere oplossing.
 */
export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = (error as Error & { cause?: unknown }).cause;
  const code = cause && typeof cause === 'object' ? (cause as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) return true;
  return error instanceof TypeError && error.message === 'fetch failed';
}

/** Voert een fetch naar Ollama uit en vertaalt verbindingsfouten naar OLLAMA_UNREACHABLE_MESSAGE. */
export async function fetchOllama(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (isConnectionError(error)) throw new Error(OLLAMA_UNREACHABLE_MESSAGE, { cause: error });
    throw error;
  }
}
