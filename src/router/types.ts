/** Rollen zoals in config.json (`models`). Alleen de chat-rollen vormen de escalatieladder. */
export type Role = 'fast' | 'reasoning' | 'max' | 'background' | 'embedding';
export type ChatRole = 'fast' | 'reasoning' | 'max';

/** Van laag naar hoog: escalatie en stickiness rekenen in deze volgorde. */
export const CHAT_LADDER: readonly ChatRole[] = ['fast', 'reasoning', 'max'];

export type Task = 'chat' | 'redeneren' | 'code' | 'onderzoek';
export type Complexity = 'laag' | 'middel' | 'hoog';

export const TASKS: readonly Task[] = ['chat', 'redeneren', 'code', 'onderzoek'];
export const COMPLEXITIES: readonly Complexity[] = ['laag', 'middel', 'hoog'];

export interface Classification {
  taak: Task;
  complexiteit: Complexity;
}

/** Werk dat Relay zelf aan een model vraagt, los van het gesprek. */
export type InternalTask = 'titel' | 'geheugen' | 'zoekvraag';

export type RoleModels = Record<Role, string>;

export interface InstalledModel {
  name: string;
  sizeBytes: number;
  /** Uit /api/show; null als Ollama ze niet meldt (oudere versie). */
  capabilities: string[] | null;
  /** Ollama-cloudmodel (draait niet lokaal): nooit als automatische vervanger. */
  remote?: boolean;
}

export interface ResolvedRole {
  role: Role;
  /** Wat in config.json staat. */
  configured: string;
  /** Wat echt gebruikt wordt; null als er niets geschikts geïnstalleerd is. */
  model: string | null;
  /** true als `configured` ontbrak en `model` een vervanger is. */
  fallback: boolean;
}

export type ResolvedRoles = Record<Role, ResolvedRole>;

export type DecisionSource = 'rule' | 'classifier' | 'fallback' | 'sticky' | 'fixed' | 'escalation';

export interface RouteDecision {
  model: string;
  /** null als het model bij geen enkele rol hoort (bv. een vast gekozen model). */
  role: Role | null;
  source: DecisionSource;
  /** Korte uitleg voor het label onder het antwoord, bv. "code" of "afbeelding". */
  reason: string;
  classification?: Classification;
  classifyMs?: number;
}
