import type { ChatTransport } from '../../router/classifier';
import { classifyMessage } from '../../router/classifier';
import type { RouterContext } from '../../router/router';
import type { RelayConfig } from '../config';
import type { CatalogSnapshot } from '../model-catalog';
import { fetchOllama } from '../ollama-errors';

/** Eén niet-streamende /api/chat-aanroep naar de lokale Ollama, voor de classificatie. */
export function createOllamaTransport(ollamaUrl: string): ChatTransport {
  return async (body, signal) => {
    const response = await fetchOllama(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`classificatie mislukt: ${response.status}`);
    const data = (await response.json()) as { message?: { content?: unknown } };
    if (typeof data.message?.content !== 'string') throw new Error('classificatie gaf geen tekst terug');
    return data.message.content;
  };
}

/** Koppelt de pure router (src/router) aan de echte modellen en Ollama. */
export function buildRouterContext(snapshot: CatalogSnapshot, config: RelayConfig): RouterContext {
  const transport = createOllamaTransport(config.ollamaUrl);
  return {
    roles: snapshot.roles,
    installed: snapshot.installed,
    classify: async (text) => {
      const model = snapshot.roles.background.model;
      if (!model) return { classification: null, ms: 0, error: 'geen background-model geïnstalleerd' };
      return classifyMessage(transport, model, text, config.router.classifyTimeoutMs, config.router.backgroundKeepAlive);
    },
  };
}
