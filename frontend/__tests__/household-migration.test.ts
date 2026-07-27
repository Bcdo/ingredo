import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';

import journal from '../drizzle/meta/_journal.json';

function applyMigration(sqlite: InstanceType<typeof Database>, tag: string): void {
  const sql = readFileSync(join(__dirname, '..', 'drizzle', `${tag}.sql`), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    sqlite.exec(statement);
  }
}

const tags = journal.entries.map((entry) => entry.tag);
const legacyTags = tags.filter((tag) => !tag.startsWith('0005'));
const partitionTag = tags.find((tag) => tag.startsWith('0005'))!;

function makeLegacyDb(): InstanceType<typeof Database> {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const tag of legacyTags) applyMigration(sqlite, tag);
  return sqlite;
}

function seedContent(sqlite: InstanceType<typeof Database>): void {
  sqlite
    .prepare(
      `INSERT INTO recipes (id, title, servings, created_at, updated_at, dirty)
       VALUES ('r1', 'Tacos', 4, 1, 1, 0)`
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO meal_plan_entries (id, date, recipe_id, servings, sort_order, created_at, updated_at, dirty)
       VALUES ('e1', '2026-07-27', 'r1', 4, 0, 1, 1, 0)`
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO shopping_items (id, name, normalized_name, sources, status, created_at, updated_at, dirty)
       VALUES ('s1', 'Melk', 'melk', '[]', 'active', 1, 1, 0)`
    )
    .run();
}

describe('migration 0005 backfill', () => {
  it('tags every existing row with the synced household', () => {
    const sqlite = makeLegacyDb();
    seedContent(sqlite);
    sqlite.prepare(`INSERT INTO settings (key, value) VALUES ('sync_household_id', 'h1')`).run();

    applyMigration(sqlite, partitionTag);

    for (const table of ['recipes', 'meal_plan_entries', 'shopping_items']) {
      const row = sqlite.prepare(`SELECT household_id FROM ${table}`).get() as {
        household_id: string | null;
      };
      expect(row.household_id).toBe('h1');
    }

    // The upgrade path must also seed the NEW active_household_id settings
    // key from the OLD sync_household_id key, atomically with the content
    // backfill — otherwise a cold-started or signed-out upgraded device
    // never restores its partition and sees an empty NULL bucket.
    const activeHousehold = sqlite
      .prepare(`SELECT value FROM settings WHERE key = 'active_household_id'`)
      .get() as { value: string } | undefined;
    expect(activeHousehold?.value).toBe('h1');
  });

  it('leaves a never-synced device in the NULL bucket', () => {
    const sqlite = makeLegacyDb();
    seedContent(sqlite);

    applyMigration(sqlite, partitionTag);

    for (const table of ['recipes', 'meal_plan_entries', 'shopping_items']) {
      const row = sqlite.prepare(`SELECT household_id FROM ${table}`).get() as {
        household_id: string | null;
      };
      expect(row.household_id).toBeNull();
    }

    // With no sync_household_id row to select from, the INSERT..SELECT
    // backfill must insert zero rows — not a NULL-valued row.
    const activeHousehold = sqlite
      .prepare(`SELECT value FROM settings WHERE key = 'active_household_id'`)
      .get() as { value: string } | undefined;
    expect(activeHousehold).toBeUndefined();
  });
});
