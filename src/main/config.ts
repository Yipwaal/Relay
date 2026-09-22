import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config();

export type ToolModeSetting = 'auto' | 'native' | 'prompt';

export interface RelayConfig {
  model: string;
  ollamaUrl: string;
  systemPrompt: string;
  toolMode: ToolModeSetting;
  /** Alleen uit .env (OLLAMA_API_KEY) — nooit in config.json, dat in git staat. */
  ollamaApiKey: string | null;
}

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'config.json');

interface RawConfig {
  model: string;
  ollamaUrl: string;
  systemPrompt: string;
  toolMode: ToolModeSetting;
}

function isToolModeSetting(value: unknown): value is ToolModeSetting {
  return value === 'auto' || value === 'native' || value === 'prompt';
}

function isRelayConfig(value: unknown): value is RawConfig {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.model === 'string' &&
    typeof v.ollamaUrl === 'string' &&
    typeof v.systemPrompt === 'string' &&
    isToolModeSetting(v.toolMode)
  );
}

const ALLOWED_OLLAMA_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Relay is bedoeld voor lokaal gebruik (zie "Niet-doelen" in CLAUDE.md).
 * Deze check voorkomt dat de volledige gespreksgeschiedenis stilzwijgend naar
 * een niet-lokaal adres gestuurd wordt door een verkeerde config of .env.
 */
function assertLocalOllamaUrl(ollamaUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(ollamaUrl);
  } catch {
    throw new Error(`Ongeldige ollamaUrl in config: "${ollamaUrl}"`);
  }

  if (!ALLOWED_OLLAMA_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(
      `ollamaUrl "${ollamaUrl}" wijst niet naar localhost. Relay praat alleen met een lokale Ollama-instantie.`,
    );
  }
}

/**
 * Leest config/config.json bij elke aanroep opnieuw, zodat een wijziging in
 * de system prompt direct van kracht is zonder de app te herstarten.
 */
export function loadConfig(): RelayConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const parsed: unknown = JSON.parse(raw);

  if (!isRelayConfig(parsed)) {
    throw new Error(`Ongeldige config in ${CONFIG_PATH}: verwacht model, ollamaUrl en systemPrompt als strings.`);
  }

  const ollamaUrl = process.env.OLLAMA_URL ?? parsed.ollamaUrl;
  assertLocalOllamaUrl(ollamaUrl);

  return {
    model: process.env.RELAY_MODEL ?? parsed.model,
    ollamaUrl,
    systemPrompt: parsed.systemPrompt,
    toolMode: parsed.toolMode,
    ollamaApiKey: process.env.OLLAMA_API_KEY?.trim() || null,
  };
}
