import type { ToolModeSetting } from '../config';

export type ToolMode = 'native' | 'prompt';

const capabilityCache = new Map<string, boolean>();
const PROBE_TIMEOUT_MS = 5000;

/**
 * Vraagt Ollama of dit model tool-calling ondersteunt via /api/show's
 * "capabilities"-veld. Gemma-modellen staan van oudsher niet op Ollama's
 * lijst van tools-compatibele modellen (zie architect-advies Fase 2) — als
 * het veld ontbreekt (oudere Ollama) of geen "tools" bevat, valt dit terug
 * op false, wat resolveToolMode naar de prompt-fallback stuurt.
 */
async function probeNativeToolSupport(baseUrl: string, model: string): Promise<boolean> {
  if (capabilityCache.has(model)) {
    return capabilityCache.get(model) as boolean;
  }

  try {
    const response = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      // Een Ollama die wel verbindt maar niet antwoordt mag de beurt niet eindeloos ophouden.
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }

    const data = (await response.json()) as { capabilities?: unknown };
    const supported = Array.isArray(data.capabilities) && data.capabilities.includes('tools');
    capabilityCache.set(model, supported);
    return supported;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Niet cachen: na een tijdelijke storing mag de volgende beurt het opnieuw vragen.
    console.error(`[relay] kon tool-capability niet detecteren voor model "${model}": ${message} — val terug op prompt-modus`);
    return false;
  }
}

export async function resolveToolMode(
  baseUrl: string,
  model: string,
  setting: ToolModeSetting,
): Promise<ToolMode> {
  if (setting === 'native' || setting === 'prompt') return setting;
  const supported = await probeNativeToolSupport(baseUrl, model);
  return supported ? 'native' : 'prompt';
}
