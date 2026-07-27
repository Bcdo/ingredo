import { eq, isNull, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

// The one tombstone filter. Every read of a synced table that should see
// only live rows goes through this — grep for isNull(...deletedAt) should
// return nothing outside this file.
export function notDeleted(table: { deletedAt: SQLiteColumn }): SQL {
  return isNull(table.deletedAt);
}

// The one partition filter, same grep-enforceable rule: no household_id
// comparison outside this file. NULL is the local/never-signed-in bucket,
// so the bucket is a partition like any other — not a wildcard.
export function inHousehold(table: { householdId: SQLiteColumn }, householdId: string | null): SQL {
  return householdId === null ? isNull(table.householdId) : eq(table.householdId, householdId);
}
