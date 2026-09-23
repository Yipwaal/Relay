import { fetchOllama } from '../ollama-errors';

const PROVISIONAL_TITLE_CHARS = 40;
const GENERATED_TITLE_MAX_CHARS = 60;
const TITLE_TIMEOUT_MS = 20_000;

/** Eerste regel van het eerste bericht, afgekapt op een woordgrens rond 40 tekens. */
export function provisionalTitle(text: string): string {
  const firstLine = text.trim().split('\n')[0]?.replace(/\s+/g, ' ').trim() ?? '';
  if (firstLine.length === 0) return 'Nieuw gesprek';
  if (firstLine.length <= PROVISIONAL_TITLE_CHARS) return firstLine;
  const cut = firstLine.slice(0, PROVISIONAL_TITLE_CHARS - 2);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Modeluitvoer opschonen tot één korte regel; null als er niets bruikbaars overblijft. */
export function cleanGeneratedTitle(raw: string): string | null {
  const firstLine =
    raw
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
  const cleaned = firstLine
    .replace(/^(titel|title)\s*:\s*/i, '')
    .replace(/[*_#`]/g, '')
    .replace(/^["'“‘«]+|["'”’»]+$/g, '')
    .replace(/[.!?:;,]+$/, '')
    .trim();
  if (cleaned.length === 0) return null;
  return cleaned.length > GENERATED_TITLE_MAX_CHARS ? `${cleaned.slice(0, GENERATED_TITLE_MAX_CHARS - 1).trimEnd()}…` : cleaned;
}

/**
 * Eén korte, niet-streamende aanroep naar hetzelfde lokale model (dat na de
 * eerste beurt toch al geladen is). De titel is alleen weergavetekst — hij
 * wordt nooit als instructie gebruikt en gaat via textContent de UI in.
 */
export async function generateTitle(baseUrl: string, model: string, userText: string, answer: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS);
  try {
    const response = await fetchOllama(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        options: { num_predict: 24, temperature: 0.2 },
        messages: [
          {
            role: 'system',
            content:
              'Vat het onderwerp van dit gesprek samen in 3 tot 5 woorden, in de taal van de vraag. ' +
              'Antwoord met alleen die woorden: geen aanhalingstekens, geen punt, geen uitleg.',
          },
          { role: 'user', content: `Vraag: ${userText.slice(0, 1000)}\n\nAntwoord: ${answer.slice(0, 1000)}` },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { message?: { content?: unknown } };
    return typeof data.message?.content === 'string' ? cleanGeneratedTitle(data.message.content) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
