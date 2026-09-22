const WEB_SEARCH_URL = 'https://ollama.com/api/web_search';
const MAX_RESULTS = 5;
const MAX_SNIPPET_CHARS = 500;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  search(query: string): Promise<SearchResult[]>;
}

interface RawSearchResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
}

function toSearchResult(raw: RawSearchResult): SearchResult | null {
  if (typeof raw.url !== 'string') return null;
  return {
    title: typeof raw.title === 'string' ? raw.title : raw.url,
    url: raw.url,
    snippet: typeof raw.content === 'string' ? raw.content.slice(0, MAX_SNIPPET_CHARS) : '',
  };
}

/**
 * Zoekprovider op basis van Ollama's gehoste web search API
 * (https://ollama.com/api/web_search). Vereist een account + API-key via
 * ollama.com/settings/keys — zie README.md voor de afweging tegen SearXNG.
 */
export function createOllamaSearchProvider(apiKey: string): SearchProvider {
  return {
    async search(query: string): Promise<SearchResult[]> {
      const response = await fetch(WEB_SEARCH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        throw new Error(`web_search mislukt: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { results?: RawSearchResult[] };
      if (!Array.isArray(data.results)) {
        throw new Error('web_search gaf een onverwacht antwoordformaat terug');
      }

      return data.results
        .map(toSearchResult)
        .filter((r): r is SearchResult => r !== null)
        .slice(0, MAX_RESULTS);
    },
  };
}
