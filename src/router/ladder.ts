import { findInstalled, sameModel, supportsVision } from './catalog';
import { CHAT_LADDER, type ChatRole, type InstalledModel, type ResolvedRoles } from './types';

const MAX_LEVEL = CHAT_LADDER.indexOf('max');

/**
 * Plaats van een model op de ladder fast → reasoning → max (0, 1, 2), of -1
 * als het bij geen chat-rol hoort. Wijzen twee rollen door een fallback naar
 * hetzelfde model, dan telt de hoogste.
 */
export function levelOf(model: string, roles: ResolvedRoles): number {
  let level = -1;
  CHAT_LADDER.forEach((role, index) => {
    const resolved = roles[role].model;
    if (model && resolved && sameModel(resolved, model)) level = index;
  });
  return level;
}

export function chatRoleOf(model: string, roles: ResolvedRoles): ChatRole | null {
  const level = levelOf(model, roles);
  return level >= 0 ? (CHAT_LADDER[level] ?? null) : null;
}

/**
 * Stickiness: binnen een gesprek alleen wisselen als de nieuwe keuze minstens
 * één niveau hoger is — elke wissel kost laadtijd. Een model buiten de ladder
 * (of max terwijl max niet meer mag) houden we niet vast.
 */
export function keepCurrentModel(currentModel: string, chosen: ChatRole, roles: ResolvedRoles, allowMax: boolean): boolean {
  if (!currentModel) return false;
  const current = levelOf(currentModel, roles);
  if (current < 0) return false;
  if (current === MAX_LEVEL && !allowMax) return false;
  return CHAT_LADDER.indexOf(chosen) <= current;
}

export interface EscalationTarget {
  role: ChatRole;
  model: string;
}

/**
 * Het eerstvolgende model omhoog op de ladder. Voor een model buiten de
 * ladder (vast gekozen) telt de grootte: het eerste rol-model dat groter is.
 * Rollen die via een fallback naar hetzelfde model wijzen worden
 * overgeslagen, max alleen als dat mag, en met afbeeldingen alleen modellen
 * met beeldondersteuning.
 */
export function nextModelUp(
  currentModel: string,
  roles: ResolvedRoles,
  installed: InstalledModel[],
  opts: { allowMax: boolean; needsVision: boolean },
): EscalationTarget | null {
  const currentLevel = levelOf(currentModel, roles);
  const currentSize = findInstalled(installed, currentModel)?.sizeBytes ?? 0;

  for (const [index, role] of CHAT_LADDER.entries()) {
    const model = roles[role].model;
    if (!model || sameModel(model, currentModel)) continue;
    if (role === 'max' && !opts.allowMax) continue;
    const higher = currentLevel >= 0 ? index > currentLevel : (findInstalled(installed, model)?.sizeBytes ?? 0) > currentSize;
    if (!higher) continue;
    if (opts.needsVision && !supportsVision(installed, model)) continue;
    return { role, model };
  }
  return null;
}
