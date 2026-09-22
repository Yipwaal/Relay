import type { ToolModeSetting } from '../config';

export type ToolMode = 'native' | 'prompt';

const capabilityCache = new Map<string, boolean>();

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
    console.error(`[relay] kon tool-capability niet detecteren voor model "${model}": ${message} — val terug op prompt-modus`);
    capabilityCache.set(model, false);
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
