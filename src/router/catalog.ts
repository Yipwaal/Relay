import type { InstalledModel, ResolvedRoles, Role, RoleModels } from './types';

const ROLES: readonly Role[] = ['fast', 'reasoning', 'max', 'background', 'embedding'];

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

export function supportsVision(installed: InstalledModel[], name: string): boolean {
  return findInstalled(installed, name)?.capabilities?.includes('vision') ?? false;
}

function largest(models: InstalledModel[]): InstalledModel | undefined {
  return [...models].sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
}

/**
 * Vervanger voor een ontbrekend model: het grootste geïnstalleerde model dat
 * de rol aankan. Voor fast/vision eerst een model met beeldondersteuning,
 * zodat de afbeeldingsregel blijft werken.
 */
function fallbackFor(role: Role, installed: InstalledModel[]): InstalledModel | undefined {
  if (role === 'embedding') return largest(installed.filter(isEmbeddingModel));
  const chat = installed.filter(canChat);
  if (role === 'fast') return largest(chat.filter((m) => m.capabilities?.includes('vision'))) ?? largest(chat);
  return largest(chat);
}

/** Koppelt elke rol aan een geïnstalleerd model (zie /api/tags bij opstarten). */
export function resolveRoles(configured: RoleModels, installed: InstalledModel[]): ResolvedRoles {
  const entries = ROLES.map((role) => {
    const wanted = configured[role];
    const exact = findInstalled(installed, wanted);
    if (exact) return [role, { role, configured: wanted, model: exact.name, fallback: false }] as const;
    const replacement = fallbackFor(role, installed);
    return [role, { role, configured: wanted, model: replacement?.name ?? null, fallback: replacement !== undefined }] as const;
  });
  return Object.fromEntries(entries) as ResolvedRoles;
}
