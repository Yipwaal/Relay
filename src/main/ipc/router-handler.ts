import { ipcMain } from 'electron';
import { loadConfig } from '../config';
import type { ModelCatalog } from '../model-catalog';
import type { SettingsStore } from '../routing/settings-store';
import type { RouterRoleInfo, RouterSettingsInfo } from '../../shared/ipc-types';

/** Routerinstellingen voor het instellingenscherm: max toestaan + welk model elke rol echt krijgt. */
export function registerRouterHandlers(settingsStore: SettingsStore, catalog: ModelCatalog): void {
  async function info(): Promise<RouterSettingsInfo> {
    const allowMax = settingsStore.get('allowMax', loadConfig().router.allowMax);
    const roles: RouterRoleInfo[] = await catalog
      .refresh()
      .then((snapshot) => Object.values(snapshot.roles).map((r) => ({ role: r.role, configured: r.configured, model: r.model, fallback: r.fallback })))
      .catch(() => []);
    return { allowMax, roles };
  }

  ipcMain.handle('relay:router:settings', info);

  ipcMain.handle('relay:router:set-allow-max', async (_event, value: unknown): Promise<RouterSettingsInfo> => {
    if (typeof value !== 'boolean') throw new Error('Ongeldige waarde.');
    settingsStore.set('allowMax', value);
    return info();
  });
}
