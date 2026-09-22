export interface Embedder {
  /** Eén Ollama-aanroep voor alle meegegeven teksten — batching (voor voortgangsrapportage) is aan de aanroeper. */
  embed(texts: string[]): Promise<Float32Array[]>;
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
  error?: string;
}

/**
 * Embeddings via Ollama's /api/embed, dezelfde lokale ollamaUrl als de chat-
 * client (assertLocalOllamaUrl in config.ts dwingt dat al af). Vereist een
 * apart gepulled embedding-model (bv. embeddinggemma) — ontbreekt dat, dan
 * geeft dit een duidelijke foutmelding i.p.v. een cryptische HTTP-fout.
 */
export function createOllamaEmbedder(baseUrl: string, model: string): Embedder {
  return {
    async embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];

      const response = await fetch(`${baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: texts }),
      });

      if (!response.ok) {
        let message = `${response.status} ${response.statusText}`;
        try {
          const errorBody = (await response.json()) as OllamaEmbedResponse;
          if (typeof errorBody.error === 'string') message = errorBody.error;
        } catch {
          // Geen JSON-body; val terug op de statuscode hierboven.
        }

        if (response.status === 404 || /not found/i.test(message)) {
          throw new Error(`Embedding-model "${model}" niet gevonden. Voer \`ollama pull ${model}\` uit.`);
        }
        throw new Error(`Embedding-aanroep mislukt: ${message}`);
      }

      const data = (await response.json()) as OllamaEmbedResponse;
      if (!Array.isArray(data.embeddings)) {
        throw new Error('Embedding-aanroep gaf een onverwacht antwoordformaat terug.');
      }

      return data.embeddings.map((values) => new Float32Array(values));
    },
  };
}
