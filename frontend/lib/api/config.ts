import Constants from 'expo-constants';
import { eq } from 'drizzle-orm';

import { settings } from '../db/schema';
import type { DB } from '../db/types';

const API_URL_KEY = 'api_base_url';
const DEV_DEFAULT = 'http://10.0.2.2:8080';

// Device-local preference — must be excluded if settings ever sync.
export function getApiUrlOverride(db: DB): string | null {
  const row = db.select().from(settings).where(eq(settings.key, API_URL_KEY)).get();
  return row?.value ? row.value : null;
}

export function setApiUrlOverride(db: DB, url: string | null): void {
  const value = url?.trim() ?? '';
  if (!value) {
    db.delete(settings).where(eq(settings.key, API_URL_KEY)).run();
    return;
  }
  db.insert(settings)
    .values({ key: API_URL_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export function getApiBaseUrl(db: DB): string {
  const configured =
    getApiUrlOverride(db) ??
    (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
    DEV_DEFAULT;
  return configured.replace(/\/+$/, '');
}
