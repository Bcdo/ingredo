import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

// Sync SQLite database over our schema. Satisfied by both the expo-sqlite
// driver (app) and the better-sqlite3 driver (tests).
export type DB = BaseSQLiteDatabase<'sync', unknown, typeof schema>;
