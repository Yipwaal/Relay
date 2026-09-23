import { unloadLoadedModels } from './ollama-lifecycle';

export const UNLOAD_ON_QUIT_TIMEOUT_MS = 2000;

export interface QuitDeps {
  /** Lopende chatbeurten afbreken, zodat niets meer naar de database schrijft als die sluit. */
  abortActive(): void;
  /** Kan gooien (ongeldige config) — afsluiten gaat dan gewoon door zonder unload. */
  ollamaUrl(): string;
  closeDb(): void;
  /** app.exit(), níet app.quit(): dat vuurt before-quit opnieuw af. */
  exit(): void;
  timeoutMs?: number;
}

/**
 * Handler voor Electron's before-quit: houdt het afsluiten eenmalig tegen,
 * unloadt alle geladen Ollama-modellen (begrensd door een timeout), sluit de
 * database en sluit dan echt af. Een tweede before-quit tijdens dat proces
 * (bv. nogmaals Cmd+Q) wordt ook tegengehouden, zodat de database niet
 * halverwege sluit.
 */
export function createBeforeQuitHandler(deps: QuitDeps): (event: { preventDefault(): void }) => void {
  let quitting = false;

  return (event) => {
    event.preventDefault();
    if (quitting) return;
    quitting = true;

    void (async () => {
      deps.abortActive();
      try {
        await unloadLoadedModels(deps.ollamaUrl(), deps.timeoutMs ?? UNLOAD_ON_QUIT_TIMEOUT_MS);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`[relay] unload bij afsluiten overgeslagen: ${reason}`);
      }
      try {
        deps.closeDb();
      } finally {
        deps.exit();
      }
    })();
  };
}
