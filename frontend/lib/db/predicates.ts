import { isNull, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

// The one tombstone filter. Every read of a synced table that should see
// only live rows goes through this — grep for isNull(...deletedAt) should
// return nothing outside this file.
export function notDeleted(table: { deletedAt: SQLiteColumn }): SQL {
  return isNull(table.deletedAt);
}
