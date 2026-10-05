import type { DatabaseSync } from 'node:sqlite';

/** Instellingen uit het instellingenscherm. Een ontbrekende rij betekent: standaard uit config.json. */
export interface AppSettings {
  allowMax: boolean;
}

export interface SettingsStore {
  get<K extends keyof AppSettings>(key: K, fallback: AppSettings[K]): AppSettings[K];
  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void;
}

export function createSettingsStore(db: DatabaseSync): SettingsStore {
  const getStmt = db.prepare('SELECT value FROM app_settings WHERE key = ?');
  const setStmt = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

  return {
    get(key, fallback) {
      const row = getStmt.get(key) as unknown as { value: string } | undefined;
      if (!row) return fallback;
      try {
        const parsed: unknown = JSON.parse(row.value);
        return typeof parsed === typeof fallback ? (parsed as typeof fallback) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      setStmt.run(key, JSON.stringify(value));
    },
  };
}
