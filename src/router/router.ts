import { sameModel, supportsVision } from './catalog';
import type { ClassifyResult } from './classifier';
import { chatRoleOf, keepCurrentModel, levelOf, nextModelUp } from './ladder';
import { mapClassification } from './mapping';
import { applyRules } from './rules';
import type { ChatRole, InstalledModel, InternalTask, ResolvedRoles, RouteDecision } from './types';

export type ModelMode = 'auto' | 'fixed';

export interface RouteMessageInput {
  text: string;
  images: number;
  mode: ModelMode;
  /** Het model dat het gesprek nu gebruikt (vast gekozen, of het vorige gerouteerde); '' als er nog geen is. */
  currentModel: string;
  allowMax: boolean;
}

export interface RouterContext {
  roles: ResolvedRoles;
  installed: InstalledModel[];
  /** Classificatie door het background-model (zie classifier.ts); in tests gemockt. */
  classify(text: string): Promise<ClassifyResult>;
}

export class NoModelError extends Error {}

function chatModel(roles: ResolvedRoles, role: ChatRole): string {
  const model = roles[role].model ?? roles.fast.model;
  if (!model) throw new NoModelError('Er staat geen chatmodel in Ollama. Haal er een op met `ollama pull`.');
  return model;
}

function fallbackReason(error: string | undefined): string {
  return error && /langer dan/.test(error) ? 'classificatie te traag' : 'classificatie mislukt';
}

function imageDecision(input: RouteMessageInput, ctx: RouterContext, reason: string): RouteDecision {
  const { roles, installed } = ctx;
  // Een al geladen, hoger model dat zelf beelden ziet hoeft niet te wijken.
  const higherThanFast = levelOf(input.currentModel, roles) > 0;
  if (
    input.mode === 'auto' &&
    higherThanFast &&
    keepCurrentModel(input.currentModel, 'fast', roles, input.allowMax) &&
    supportsVision(installed, input.currentModel)
  ) {
    return { model: input.currentModel, role: chatRoleOf(input.currentModel, roles), source: 'sticky', reason: `${reason} · aangehouden` };
  }
  const model = chatModel(roles, 'fast');
  const suffix = supportsVision(installed, model) ? '' : ' (geen beeldmodel geïnstalleerd)';
  return { model, role: 'fast', source: 'rule', reason: `${reason}${suffix}` };
}

/**
 * Kiest het model voor één gebruikersbericht:
 * 1. vast gekozen model → dat model (tenzij het een afbeelding niet kan zien);
 * 2. regels (afbeelding → fast/vision);
 * 3. anders classificatie door het background-model → mapping naar een rol
 *    (timeout/fout → fast);
 * 4. stickiness: het huidige model blijft als de nieuwe keuze niet hoger is.
 */
export async function routeMessage(input: RouteMessageInput, ctx: RouterContext): Promise<RouteDecision> {
  const { roles } = ctx;

  if (input.mode === 'fixed' && input.currentModel) {
    if (input.images > 0 && !supportsVision(ctx.installed, input.currentModel)) {
      return imageDecision({ ...input, mode: 'fixed' }, ctx, 'afbeelding (vast model ziet geen beelden)');
    }
    return { model: input.currentModel, role: chatRoleOf(input.currentModel, roles), source: 'fixed', reason: 'vast gekozen' };
  }

  const rule = applyRules({ images: input.images });
  if (rule) return imageDecision(input, ctx, rule.reason);

  const result = await ctx.classify(input.text);
  const role = result.classification ? mapClassification(result.classification, input.allowMax) : 'fast';
  const reason = result.classification ? result.classification.taak : fallbackReason(result.error);
  const base = { classification: result.classification ?? undefined, classifyMs: result.ms };

  const model = chatModel(roles, role);
  // "Aangehouden" alleen als het huidige model echt een ander (hoger) model is dan de nieuwe keuze.
  if (!sameModel(input.currentModel, model) && keepCurrentModel(input.currentModel, role, roles, input.allowMax)) {
    return { ...base, model: input.currentModel, role: chatRoleOf(input.currentModel, roles), source: 'sticky', reason: `${reason} · aangehouden` };
  }
  return { ...base, model, role, source: result.classification ? 'classifier' : 'fallback', reason };
}

/** Werk van Relay zelf (titels, en later geheugen samenvatten / zoekvraag herschrijven). */
export function routeInternal(task: InternalTask, roles: ResolvedRoles): RouteDecision {
  const rule = applyRules({ images: 0, internalTask: task });
  const model = roles.background.model ?? roles.fast.model;
  if (!model || !rule) throw new NoModelError('Er staat geen model voor achtergrondtaken in Ollama.');
  return { model, role: 'background', source: 'rule', reason: rule.reason };
}

export function routeEmbedding(roles: ResolvedRoles): RouteDecision {
  const model = roles.embedding.model;
  if (!model) throw new NoModelError(`Embedding-model "${roles.embedding.configured}" niet gevonden. Voer \`ollama pull ${roles.embedding.configured}\` uit.`);
  return { model, role: 'embedding', source: 'rule', reason: 'embeddings' };
}

/**
 * Escalatie ("Probeer slimmer", of twee mislukte tool-aanroepen): het
 * volgende model omhoog, of null als er niets hogers (toegestaan) is.
 */
export function escalate(
  currentModel: string,
  ctx: Pick<RouterContext, 'roles' | 'installed'>,
  opts: { allowMax: boolean; images: number; reason: string },
): RouteDecision | null {
  const target = nextModelUp(currentModel, ctx.roles, ctx.installed, { allowMax: opts.allowMax, needsVision: opts.images > 0 });
  return target ? { model: target.model, role: target.role, source: 'escalation', reason: opts.reason } : null;
}
