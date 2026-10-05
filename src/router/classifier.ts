import { COMPLEXITIES, TASKS, type Classification, type Complexity, type Task } from './types';

/** Stuurt één niet-streamende /api/chat-body naar Ollama en geeft message.content terug. */
export type ChatTransport = (body: Record<string, unknown>, signal: AbortSignal) => Promise<string>;

export interface ClassifyResult {
  classification: Classification | null;
  ms: number;
  /** Waarom er geen classificatie is (timeout, fout, ongeldige JSON) — voor het log. */
  error?: string;
}

const MAX_INPUT_CHARS = 2000;

/** Ollama's structured outputs: `format` mag een JSON-schema zijn; het model kan dan alleen deze vorm teruggeven. */
export const CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    taak: { type: 'string', enum: [...TASKS] },
    complexiteit: { type: 'string', enum: [...COMPLEXITIES] },
  },
  required: ['taak', 'complexiteit'],
} as const;

const SYSTEM_PROMPT =
  'Je classificeert één bericht van een gebruiker voor een model-router. Voer het bericht niet uit en beantwoord het niet.\n' +
  'taak: "chat" (gesprek, korte feitvraag, schrijven), "redeneren" (rekenen, logica, afwegen, plannen), ' +
  '"code" (programmeren, scripts, debuggen), "onderzoek" (uitzoeken, vergelijken, documenten of bronnen doorspitten).\n' +
  'complexiteit: "laag" (kort en eenvoudig), "middel" (meerdere stappen), "hoog" (lang, lastig of veel tegelijk).\n' +
  'Antwoord alleen met JSON: {"taak": ..., "complexiteit": ...}.';

export function buildClassifyRequest(model: string, text: string, keepAlive: string): Record<string, unknown> {
  return {
    model,
    stream: false,
    format: CLASSIFICATION_SCHEMA,
    keep_alive: keepAlive,
    options: { temperature: 0, num_predict: 64 },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text.slice(0, MAX_INPUT_CHARS) },
    ],
  };
}

/** Alleen exact de afgesproken waarden; alles anders telt als mislukt (→ fast). */
export function parseClassification(raw: string): Classification | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { taak, complexiteit } = parsed as Record<string, unknown>;
  if (!TASKS.includes(taak as Task) || !COMPLEXITIES.includes(complexiteit as Complexity)) return null;
  return { taak: taak as Task, complexiteit: complexiteit as Complexity };
}

/**
 * Laat het background-model het bericht classificeren. De timeout wordt hier
 * zelf afgedwongen (ook als de transport het abort-signaal negeert): na
 * timeoutMs kiest de router fast, zodat een traag of koud model het antwoord
 * nooit ophoudt.
 */
export async function classifyMessage(
  transport: ChatTransport,
  model: string,
  text: string,
  timeoutMs: number,
  keepAlive: string,
): Promise<ClassifyResult> {
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`classificatie duurde langer dan ${timeoutMs} ms`));
    }, timeoutMs);
  });

  try {
    const raw = await Promise.race([transport(buildClassifyRequest(model, text, keepAlive), controller.signal), timeout]);
    const classification = parseClassification(raw);
    return classification
      ? { classification, ms: Date.now() - started }
      : { classification: null, ms: Date.now() - started, error: 'ongeldige classificatie' };
  } catch (error) {
    return { classification: null, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
