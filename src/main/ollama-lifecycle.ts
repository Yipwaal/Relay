/**
 * Laden/unloaden van modellen in Ollama. Ollama houdt een model standaard 5
 * minuten in (V)RAM na het laatste verzoek (keep_alive), en met
 * OLLAMA_MAX_LOADED_MODELS op "auto" kunnen er meerdere tegelijk resident
 * zijn — daarom vragen we /api/ps wat er écht geladen is i.p.v. alleen het
 * model uit config.json te unloaden.
 */

export async function listLoadedModels(baseUrl: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/ps`, { signal });
  if (!response.ok) throw new Error(`/api/ps mislukt: ${response.status}`);
  const data = (await response.json()) as { models?: Array<{ name?: unknown; model?: unknown }> };
  if (!Array.isArray(data.models)) return [];
  return data.models
    .map((m) => (typeof m.name === 'string' ? m.name : typeof m.model === 'string' ? m.model : null))
    .filter((name): name is string => name !== null);
}

/** keep_alive: 0 zonder prompt laat Ollama het model direct uit het geheugen halen. */
export async function unloadModel(baseUrl: string, model: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: 0 }),
    signal,
  });
  if (!response.ok) throw new Error(`unload van "${model}" mislukt: ${response.status}`);
}

/**
 * Unloadt alle geladen modellen (optioneel behalve `keep`), parallel en
 * begrensd door timeoutMs. Gooit nooit: een gestopte of hangende Ollama mag
 * afsluiten of van model wisselen niet blokkeren. Geeft terug welke modellen
 * een unload-verzoek kregen.
 */
export async function unloadLoadedModels(baseUrl: string, timeoutMs: number, keep?: string): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const loaded = (await listLoadedModels(baseUrl, controller.signal)).filter((name) => name !== keep);
    const results = await Promise.allSettled(loaded.map((model) => unloadModel(baseUrl, model, controller.signal)));
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.error(`[relay] unload van "${loaded[i]}" mislukt: ${reason}`);
      }
    });
    if (loaded.length > 0) console.log(`[relay] modellen ge-unload: ${loaded.join(', ')}`);
    return loaded;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`[relay] modellen niet ge-unload (${reason}) — Ollama draait waarschijnlijk niet`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** true als `model` nu in het geheugen staat; null als dat niet te bepalen is (Ollama onbereikbaar). */
export async function isModelLoaded(baseUrl: string, model: string, timeoutMs: number): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const loaded = await listLoadedModels(baseUrl, controller.signal);
    return loaded.some((name) => name === model || name === `${model}:latest`);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** true als Ollama antwoordt op /api/version binnen timeoutMs. */
export async function pingOllama(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/version`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
