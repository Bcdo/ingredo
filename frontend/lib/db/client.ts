import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';
import type { DB } from './types';

const expoDb = openDatabaseSync('ingredo.db', { enableChangeListener: true });
expoDb.execSync('PRAGMA foreign_keys = ON');

export const db: DB = drizzle(expoDb, { schema }) as unknown as DB;
