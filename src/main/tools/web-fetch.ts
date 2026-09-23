const WEB_FETCH_URL = 'https://ollama.com/api/web_fetch';

export interface FetchedPage {
  title: string;
  url: string;
  content: string;
}

function assertFetchableUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Ongeldige URL: "${url}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Alleen http/https-URL's kunnen opgehaald worden, niet "${parsed.protocol}"`);
  }
}

/**
 * Haalt een pagina op via Ollama's gehoste web fetch API
 * (https://ollama.com/api/web_fetch) — dezelfde provider als web_search, dus
 * geen aparte HTML-extractiepipeline nodig in dit project.
 */
export async function fetchWebPage(apiKey: string, url: string, signal?: AbortSignal): Promise<FetchedPage> {
  assertFetchableUrl(url);

  const response = await fetch(WEB_FETCH_URL, {
    signal,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    throw new Error(`web_fetch mislukt: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { title?: unknown; content?: unknown };
  if (typeof data.content !== 'string') {
    throw new Error('web_fetch gaf een onverwacht antwoordformaat terug');
  }

  return {
    title: typeof data.title === 'string' ? data.title : url,
    url,
    content: data.content,
  };
}
