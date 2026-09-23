import { fetchOllama } from './ollama-errors';
import type { LocalModel } from '../shared/ipc-types';

const SHOW_TIMEOUT_MS = 3000;

interface TagsModel {
  name?: unknown;
  size?: unknown;
  details?: { family?: unknown; parameter_size?: unknown; quantization_level?: unknown };
}

interface ShowResult {
  capabilities: string[] | null;
  kvBytesPerToken: number | null;
}

/** /api/show verandert niet voor een geïnstalleerd model; per sessie één keer vragen is genoeg. */
const showCache = new Map<string, ShowResult>();

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sumOrScale(value: unknown, layers: number): number | null {
  if (typeof value === 'number') return value * layers;
  if (Array.isArray(value) && value.every((v) => typeof v === 'number')) return (value as number[]).reduce((a, b) => a + b, 0);
  return null;
}

/**
 * Ruwe schatting van de KV-cache per token in bytes (f16): lagen × KV-heads ×
 * (key- + value-dimensie) × 2 bytes. Modellen met sliding-window-attentie
 * gebruiken in de praktijk minder — daarom toont de UI dit als "≈".
 */
export function estimateKvBytesPerToken(modelInfo: Record<string, unknown>): number | null {
  const arch = str(modelInfo['general.architecture']);
  if (!arch) return null;
  const layers = modelInfo[`${arch}.block_count`];
  if (typeof layers !== 'number' || layers <= 0) return null;
  const kvHeadsTotal = sumOrScale(modelInfo[`${arch}.attention.head_count_kv`], layers);
  const headCount = modelInfo[`${arch}.attention.head_count`];
  const embedding = modelInfo[`${arch}.embedding_length`];
  const fallbackDim = typeof headCount === 'number' && typeof embedding === 'number' && headCount > 0 ? embedding / headCount : null;
  const keyLength = typeof modelInfo[`${arch}.attention.key_length`] === 'number' ? (modelInfo[`${arch}.attention.key_length`] as number) : fallbackDim;
  const valueLength =
    typeof modelInfo[`${arch}.attention.value_length`] === 'number' ? (modelInfo[`${arch}.attention.value_length`] as number) : fallbackDim;
  if (kvHeadsTotal === null || keyLength === null || valueLength === null) return null;
  return Math.round(kvHeadsTotal * (keyLength + valueLength) * 2);
}

async function showModel(baseUrl: string, name: string): Promise<ShowResult> {
  const cached = showCache.get(name);
  if (cached) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHOW_TIMEOUT_MS);
  try {
    const response = await fetchOllama(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name }),
      signal: controller.signal,
    });
    if (!response.ok) return { capabilities: null, kvBytesPerToken: null };
    const data = (await response.json()) as { capabilities?: unknown; model_info?: unknown };
    const result: ShowResult = {
      capabilities: Array.isArray(data.capabilities) ? data.capabilities.filter((c): c is string => typeof c === 'string') : null,
      kvBytesPerToken: data.model_info && typeof data.model_info === 'object' ? estimateKvBytesPerToken(data.model_info as Record<string, unknown>) : null,
    };
    showCache.set(name, result);
    return result;
  } catch {
    return { capabilities: null, kvBytesPerToken: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * De lokaal geïnstalleerde modellen waarmee je kunt chatten (/api/tags).
 * Embedding-modellen (bv. embeddinggemma voor documenten) vallen weg: daarmee
 * kun je niet chatten. Onbekende capabilities (oude Ollama) laten we staan.
 */
export async function listChatModels(baseUrl: string): Promise<LocalModel[]> {
  const response = await fetchOllama(`${baseUrl}/api/tags`, {});
  if (!response.ok) throw new Error(`Kon de modellenlijst niet ophalen (${response.status}).`);
  const data = (await response.json()) as { models?: TagsModel[] };
  const tags = Array.isArray(data.models) ? data.models.filter((m) => typeof m.name === 'string') : [];

  const models = await Promise.all(
    tags.map(async (m): Promise<LocalModel | null> => {
      const name = m.name as string;
      const show = await showModel(baseUrl, name);
      if (show.capabilities && !show.capabilities.includes('completion')) return null;
      return {
        name,
        sizeBytes: typeof m.size === 'number' ? m.size : 0,
        parameterSize: str(m.details?.parameter_size),
        family: str(m.details?.family),
        quantization: str(m.details?.quantization_level),
        kvBytesPerToken: show.kvBytesPerToken,
      };
    }),
  );
  return models.filter((m): m is LocalModel => m !== null).sort((a, b) => a.name.localeCompare(b.name));
}
