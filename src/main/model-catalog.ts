import { resolveRoles } from '../router/catalog';
import type { InstalledModel, ResolvedRoles, Role, RoleModels } from '../router/types';
import { listInstalledModels } from './models';
import type { LocalModel } from '../shared/ipc-types';

const STALE_AFTER_MS = 60_000;

export interface CatalogSnapshot {
  installed: InstalledModel[];
  models: LocalModel[];
  roles: ResolvedRoles;
}

export interface ModelCatalog {
  /** Haalt /api/tags opnieuw op; gooit als Ollama niet bereikbaar is. */
  refresh(): Promise<CatalogSnapshot>;
  /** Laatste stand; ververst eerst als die leeg of ouder dan een minuut is (bv. Ollama draaide bij opstarten nog niet). */
  current(): Promise<CatalogSnapshot>;
}

function describeFallbacks(roles: ResolvedRoles): string[] {
  return (Object.values(roles) as ResolvedRoles[Role][])
    .filter((r) => r.model !== r.configured)
    .map((r) => (r.model ? `${r.role}: ${r.configured} niet geïnstalleerd → ${r.model}` : `${r.role}: ${r.configured} niet geïnstalleerd, geen vervanger`));
}

/**
 * Welke modellen er echt zijn, en welk model elke rol daardoor krijgt. Bij
 * opstarten één keer gevuld (main.ts); de config wordt per keer gelezen, dus
 * een aangepaste config.json telt bij de volgende verversing mee.
 */
export function createModelCatalog(config: () => { ollamaUrl: string; models: RoleModels }): ModelCatalog {
  let snapshot: CatalogSnapshot | null = null;
  let fetchedAt = 0;
  let inFlight: Promise<CatalogSnapshot> | null = null;
  let loggedFallbacks = '';

  async function load(): Promise<CatalogSnapshot> {
    const { ollamaUrl, models: configured } = config();
    const models = await listInstalledModels(ollamaUrl);
    const installed = models.map((m) => ({ name: m.name, sizeBytes: m.sizeBytes, capabilities: m.capabilities, remote: m.remote }));
    const next = { installed, models, roles: resolveRoles(configured, installed) };
    // Alleen loggen als het verandert: de dropdown ververst de catalogus bij elke opening.
    const fallbacks = describeFallbacks(next.roles);
    if (fallbacks.join('\n') !== loggedFallbacks) {
      for (const line of fallbacks) console.log(`[relay] router: ${line}`);
      loggedFallbacks = fallbacks.join('\n');
    }
    snapshot = next;
    fetchedAt = Date.now();
    return next;
  }

  const refresh = (): Promise<CatalogSnapshot> => {
    inFlight ??= load().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    refresh,
    async current() {
      if (snapshot && snapshot.installed.length > 0 && Date.now() - fetchedAt < STALE_AFTER_MS) return snapshot;
      return refresh();
    },
  };
}
