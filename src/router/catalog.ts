import type { InstalledModel, ResolvedRole, ResolvedRoles, Role, RoleModels } from './types';

/** Ollama behandelt "naam" en "naam:latest" als hetzelfde model. */
export function sameModel(a: string, b: string): boolean {
  const norm = (name: string): string => (name.includes(':') ? name : `${name}:latest`);
  return norm(a) === norm(b);
}

export function findInstalled(installed: InstalledModel[], name: string): InstalledModel | undefined {
  return installed.find((m) => sameModel(m.name, name));
}

function isEmbeddingModel(m: InstalledModel): boolean {
  if (m.capabilities) return m.capabilities.includes('embedding') && !m.capabilities.includes('completion');
  return /embed/i.test(m.name);
}

function canChat(m: InstalledModel): boolean {
  return m.capabilities ? m.capabilities.includes('completion') : !isEmbeddingModel(m);
}

/** Ziet dit model beelden? Een cloudmodel telt niet: afbeeldingen verlaten deze computer nooit. */
export function supportsVision(installed: InstalledModel[], name: string): boolean {
  const model = findInstalled(installed, name);
  return !model?.remote && (model?.capabilities?.includes('vision') ?? false);
}

function largest(models: InstalledModel[]): InstalledModel | undefined {
  return [...models].sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
}

function sizeOf(installed: InstalledModel[], name: string | null): number {
  return name ? (findInstalled(installed, name)?.sizeBytes ?? 0) : 0;
}

function resolved(role: Role, configured: string, model: InstalledModel | undefined, fallback: boolean): ResolvedRole {
  return { role, configured, model: model?.name ?? null, fallback: fallback && model !== undefined };
}

/**
 * Koppelt elke rol aan een geïnstalleerd model (zie /api/tags bij opstarten).
 * Staat het geconfigureerde model er niet, dan krijgt de rol het grootste
 * geschikte model, met drie grenzen zodat een vervanger nooit om
 * "Max-model toestaan" heen gaat of het classificeren traag maakt:
 * - fast en reasoning nemen nooit het geïnstalleerde max-model over (tenzij
 *   er niets anders is); fast kiest eerst een model dat beelden ziet;
 * - een vervangend max-model moet groter zijn dan reasoning en mag geen
 *   model van fast/reasoning zijn — anders blijft max leeg;
 * - background valt terug op het fast-model (dat staat toch al geladen).
 * Cloudmodellen (draaien niet lokaal) zijn nooit een automatische vervanger.
 */
export function resolveRoles(configured: RoleModels, installed: InstalledModel[]): ResolvedRoles {
  const exact = (role: Role): InstalledModel | undefined => findInstalled(installed, configured[role]);
  const local = installed.filter((m) => !m.remote);
  const chat = local.filter(canChat);
  const exactMax = exact('max');
  const belowMax = exactMax ? chat.filter((m) => !sameModel(m.name, exactMax.name)) : chat;
  const pick = (candidates: InstalledModel[]): InstalledModel | undefined => largest(candidates) ?? (exactMax && canChat(exactMax) ? exactMax : undefined);

  const visionBelowMax = belowMax.filter((m) => m.capabilities?.includes('vision'));
  const fastModel = exact('fast') ?? pick(visionBelowMax.length > 0 ? visionBelowMax : belowMax);
  const reasoningModel = exact('reasoning') ?? pick(belowMax);
  const lower = [fastModel?.name, reasoningModel?.name].filter((n): n is string => Boolean(n));
  const reasoningSize = sizeOf(installed, reasoningModel?.name ?? null);
  const maxModel = exactMax ?? largest(chat.filter((m) => m.sizeBytes > reasoningSize && !lower.some((n) => sameModel(n, m.name))));

  return {
    fast: resolved('fast', configured.fast, fastModel, !exact('fast')),
    reasoning: resolved('reasoning', configured.reasoning, reasoningModel, !exact('reasoning')),
    max: resolved('max', configured.max, maxModel, !exactMax),
    background: resolved('background', configured.background, exact('background') ?? fastModel, !exact('background')),
    embedding: resolved('embedding', configured.embedding, exact('embedding') ?? largest(local.filter(isEmbeddingModel)), !exact('embedding')),
  };
}
