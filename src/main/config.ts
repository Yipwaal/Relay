import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import type { ChatOptions } from '../shared/ipc-types';
import type { Role, RoleModels } from '../router/types';

dotenv.config();

export type ToolModeSetting = 'auto' | 'native' | 'prompt';

export interface RouterSettings {
  /** Standaard voor "Max-model toestaan"; de keuze in het instellingenscherm wint (app_settings). */
  allowMax: boolean;
  /** Hoe lang het background-model mag classificeren voordat de router fast kiest. */
  classifyTimeoutMs: number;
  /** keep_alive voor het background-model, zodat classificeren niet elke keer een koude start is. */
  backgroundKeepAlive: string;
}

export interface RelayConfig {
  ollamaUrl: string;
  systemPrompt: string;
  toolMode: ToolModeSetting;
  /** Model per rol voor de router (src/router); ontbrekende modellen krijgen een vervanger, zie router/catalog.ts. */
  models: RoleModels;
  router: RouterSettings;
  /** Standaard voor nieuwe gesprekken; elk gesprek bewaart daarna zijn eigen kopie (zie conversations/store.ts). */
  options: ChatOptions;
  /** Alleen uit .env (OLLAMA_API_KEY) — nooit in config.json, dat in git staat. */
  ollamaApiKey: string | null;
}

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'config.json');

interface RawConfig {
  ollamaUrl: string;
  systemPrompt: string;
  toolMode: ToolModeSetting;
  models: RoleModels;
  router: RouterSettings;
  options: { num_ctx: number; num_predict: number; temperature: number };
}

const ROLES: readonly Role[] = ['fast', 'reasoning', 'max', 'background', 'embedding'];

function isRoleModels(value: unknown): value is RoleModels {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return ROLES.every((role) => typeof v[role] === 'string' && (v[role] as string).trim().length > 0);
}

function isRouterSettings(value: unknown): value is RouterSettings {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.allowMax === 'boolean' &&
    typeof v.classifyTimeoutMs === 'number' &&
    Number.isInteger(v.classifyTimeoutMs) &&
    v.classifyTimeoutMs >= 100 &&
    v.classifyTimeoutMs <= 60_000 &&
    typeof v.backgroundKeepAlive === 'string' &&
    /^(-1|0|\d+[smh])$/.test(v.backgroundKeepAlive)
  );
}

export function isValidNumCtx(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 512 && value <= 262_144;
}

export function isValidNumPredict(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && (value === -1 || (value >= 16 && value <= 131_072));
}

export function isValidTemperature(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2;
}

function isRawOptions(value: unknown): value is RawConfig['options'] {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isValidNumCtx(v.num_ctx) && isValidNumPredict(v.num_predict) && isValidTemperature(v.temperature);
}

function isToolModeSetting(value: unknown): value is ToolModeSetting {
  return value === 'auto' || value === 'native' || value === 'prompt';
}

function isRelayConfig(value: unknown): value is RawConfig {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.ollamaUrl === 'string' &&
    typeof v.systemPrompt === 'string' &&
    isToolModeSetting(v.toolMode) &&
    isRoleModels(v.models) &&
    isRouterSettings(v.router) &&
    isRawOptions(v.options)
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
    throw new Error(
      `Ongeldige config in ${CONFIG_PATH}: verwacht ollamaUrl, systemPrompt, toolMode, ` +
        'models { fast, reasoning, max, background, embedding }, ' +
        'router { allowMax, classifyTimeoutMs (100–60000), backgroundKeepAlive (bv. "30m") } en ' +
        'options { num_ctx (512–262144), num_predict (-1 of 16–131072), temperature (0–2) }.',
    );
  }

  const ollamaUrl = process.env.OLLAMA_URL ?? parsed.ollamaUrl;
  assertLocalOllamaUrl(ollamaUrl);

  return {
    ollamaUrl,
    systemPrompt: parsed.systemPrompt,
    toolMode: parsed.toolMode,
    models: {
      ...parsed.models,
      fast: process.env.RELAY_MODEL ?? parsed.models.fast,
      embedding: process.env.RELAY_EMBED_MODEL ?? parsed.models.embedding,
    },
    router: parsed.router,
    options: { numCtx: parsed.options.num_ctx, numPredict: parsed.options.num_predict, temperature: parsed.options.temperature },
    ollamaApiKey: process.env.OLLAMA_API_KEY?.trim() || null,
  };
}
