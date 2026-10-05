import type { InternalTask, Role } from './types';

export interface RuleInput {
  /** Aantal afbeeldingen in het bericht. */
  images: number;
  /** Gezet voor werk dat Relay zelf doet (chattitel, geheugen samenvatten, zoekvraag herschrijven). */
  internalTask?: InternalTask;
  /** Gezet voor embeddings (documenten indexeren, zoekvraag omzetten naar een vector). */
  embedding?: boolean;
}

export interface RuleMatch {
  role: Role;
  reason: string;
}

const INTERNAL_TASK_LABELS: Record<InternalTask, string> = {
  titel: 'chattitel',
  geheugen: 'geheugen samenvatten',
  zoekvraag: 'zoekvraag herschrijven',
};

/** Vaste regels gaan vóór de classificatie: daar is geen modeloordeel voor nodig. */
export function applyRules(input: RuleInput): RuleMatch | null {
  if (input.embedding) return { role: 'embedding', reason: 'embeddings' };
  if (input.internalTask) return { role: 'background', reason: INTERNAL_TASK_LABELS[input.internalTask] };
  if (input.images > 0) return { role: 'fast', reason: 'afbeelding' };
  return null;
}
