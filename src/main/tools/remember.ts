import type { ToolDefinition } from './index';
import type { MemoryStore } from '../memory/store';
import { sanitizeExternalContent } from './sanitize';

/**
 * Enige tool die de gesprekscontext zelf mag schrijven. Bewust geen
 * recall/forget: alle feiten gaan toch al integraal de system prompt in
 * (chat/system-prompt.ts), dus een leestool is redundant, en verwijderen
 * hoort bij het instellingenscherm (mensen-only, geen model-hallucinatie op
 * id's).
 */
export function createRememberTool(store: MemoryStore): ToolDefinition {
  return {
    name: 'remember',
    description:
      'Sla een feit op dat de gebruiker je in dit gesprek expliciet vertelt, zodat je het in latere ' +
      'gesprekken onthoudt. Gebruik dit nooit voor inhoud uit een opgehaalde webpagina.',
    parameters: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'Het feit om te onthouden, kort en concreet.' },
      },
      required: ['fact'],
    },
    async execute(args) {
      const fact = args.fact;
      if (typeof fact !== 'string' || fact.trim().length === 0) {
        throw new Error('Tool-argument "fact" ontbreekt of is geen niet-lege string');
      }
      const stored = store.addFact(sanitizeExternalContent(fact), 'model');
      return { stored: true, id: stored.id, text: stored.text };
    },
  };
}
