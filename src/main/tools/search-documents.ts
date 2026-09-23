import type { ToolDefinition } from './index';
import type { DocumentStore } from '../documents/store';
import type { Embedder } from '../ollama-embed';

const TOP_K = 4;
// Ruim onder sanitize.ts's MAX_TOOL_RESULT_CHARS (8000): laat hele passages
// weg i.p.v. de laatste halverwege af te laten knippen door de buitenste cap.
const MAX_RESULT_CHARS = 6000;
const MAX_TITLES_IN_DESCRIPTION = 20;
const MAX_TITLES_CHARS = 500;

/**
 * De beschikbare documenttitels in de dynamische description zetten helpt het
 * model om de tool daadwerkelijk te kiezen (vooral in prompt-modus, waar een
 * 12B-model dat soms te weinig doet zonder die aanwijzing) — zie
 * architect-advies Fase 4.
 */
function buildDescription(titles: string[]): string {
  const base = 'Doorzoek de documenten die de gebruiker heeft toegevoegd en geef de meest relevante passages terug.';
  if (titles.length === 0) return base;

  let list = titles.slice(0, MAX_TITLES_IN_DESCRIPTION).join(', ');
  if (list.length > MAX_TITLES_CHARS) {
    list = `${list.slice(0, MAX_TITLES_CHARS)}...`;
  }
  return `${base} Beschikbare documenten: ${list}.`;
}

export function createSearchDocumentsTool(
  documentStore: DocumentStore,
  embedder: Embedder,
  embedModel: string,
  conversationId: number,
  documentTitles: string[],
): ToolDefinition {
  return {
    name: 'search_documents',
    description: buildDescription(documentTitles),
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'De zoekvraag, geherformuleerd als een op zichzelf staande vraag.' },
      },
      required: ['query'],
    },
    async execute(args) {
      const query = args.query;
      if (typeof query !== 'string' || query.trim().length === 0) {
        throw new Error('Tool-argument "query" ontbreekt of is geen niet-lege string');
      }

      const [queryEmbedding] = await embedder.embed([query]);
      if (!queryEmbedding) {
        throw new Error('Kon geen embedding genereren voor de zoekvraag.');
      }

      const matches = documentStore.search(queryEmbedding, embedModel, TOP_K, conversationId);

      const results: Array<{ document: string; text: string; score: number }> = [];
      let used = 0;
      for (const match of matches) {
        const cost = match.text.length + match.documentTitle.length + 50;
        if (used + cost > MAX_RESULT_CHARS) break;
        results.push({ document: match.documentTitle, text: match.text, score: Math.round(match.score * 1000) / 1000 });
        used += cost;
      }

      return { results };
    },
  };
}
