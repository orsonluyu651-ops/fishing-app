import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

/**
 * Database Migration System
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * Centralized schema versioning using SQLite's built-in `PRAGMA user_version`
 * integer. Every database file (fishlore_offline.db, fishingPins.db) is tracked
 * independently, so adding a new database later requires zero changes to this
 * module — just register a new `DbMigrationPlan`.
 *
 * Design contract:
 * 1. `user_version` starts at 0 (fresh database).
 * 2. Each migration step is idempotent — `CREATE TABLE IF NOT EXISTS`, etc.
 * 3. Migrations run inside a single transaction to guarantee atomicity.
 * 4. Existing data (catch logs, pins, telemetry) is never dropped or overwritten.
 */

/** Target databases the migration runner knows about. */
export type DbName = 'fishlore_offline.db' | 'fishingPins.db';

/** A single migration step: bumps user_version from N → N+1. */
export interface MigrationStep {
  version: number;
  description: string;
  sql: string[];
}

/** Full migration plan for a single database file. */
export interface DbMigrationPlan {
  dbName: DbName;
  steps: MigrationStep[];
}

/** ────────────── fishlore_offline.db migration plan ────────────── */
const fishloreMigrations: DbMigrationPlan = {
  dbName: 'fishlore_offline.db',
  steps: [
    {
      version: 1,
      description: 'Create base offline_catches table (initial schema)',
      sql: [`
        CREATE TABLE IF NOT EXISTS offline_catches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          species TEXT NOT NULL,
          weight TEXT,
          length TEXT,
          location_name TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          synced INTEGER DEFAULT 0
        );
      `],
    },
    {
      version: 2,
      description: 'Add geo columns (latitude, longitude) for map pin rendering',
      sql: [
        `ALTER TABLE offline_catches ADD COLUMN latitude REAL;`,
        `ALTER TABLE offline_catches ADD COLUMN longitude REAL;`,
      ],
    },
    {
      version: 3,
      description: 'Add solunar_rating column for activity-based catch analytics',
      sql: [`ALTER TABLE offline_catches ADD COLUMN solunar_rating TEXT;`],
    },
    {
      version: 4,
      description: 'Create video_metadata table for compressed upload asset tracking',
      sql: [`
        CREATE TABLE IF NOT EXISTS video_metadata (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          catch_id INTEGER NOT NULL,
          compressed_uri TEXT NOT NULL,
          original_size INTEGER NOT NULL,
          compressed_size INTEGER NOT NULL,
          compression_ratio TEXT NOT NULL,
          duration_seconds REAL,
          quality TEXT NOT NULL DEFAULT 'medium',
          created_at INTEGER NOT NULL,
          FOREIGN KEY (catch_id) REFERENCES offline_catches(id) ON DELETE CASCADE
        );
      `],
    },
        {
      version: 5,
      description: 'Add video_index column to offline_catches + performance indexes',
      sql: [
        `ALTER TABLE offline_catches ADD COLUMN video_index_id TEXT;`,
        `CREATE INDEX IF NOT EXISTS idx_offline_catches_timestamp ON offline_catches(timestamp);`,
        `CREATE INDEX IF NOT EXISTS idx_offline_catches_synced ON offline_catches(synced);`,
        `CREATE INDEX IF NOT EXISTS idx_video_metadata_catch_id ON video_metadata(catch_id);`,
      ],
    },
    {
      version: 6,
      description: 'Create solunar_calendar_cache table for 30-day offline forecasts',
      sql: [`
        CREATE TABLE IF NOT EXISTS solunar_calendar_cache (
          iso_date TEXT PRIMARY KEY,
          date_unix INTEGER NOT NULL,
          moon_phase REAL NOT NULL,
          activity_index INTEGER NOT NULL,
          rating TEXT NOT NULL,
          moon_icon TEXT NOT NULL,
          major_count INTEGER NOT NULL,
          minor_count INTEGER NOT NULL,
          peak_time TEXT,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          generated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_calendar_coords ON solunar_calendar_cache(latitude, longitude);
        CREATE INDEX IF NOT EXISTS idx_calendar_date ON solunar_calendar_cache(date_unix);
      `],
    },
    ],
};

/** ────────────── fishingPins.db migration plan ────────────── */
const fishingPinsMigrations: DbMigrationPlan = {
  dbName: 'fishingPins.db',
  steps: [
    {
      version: 1,
      description: 'Create base fishing_pins table for standalone map markers',
      sql: [`
        CREATE TABLE IF NOT EXISTS fishing_pins (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          species TEXT,
          weight TEXT,
          length TEXT,
          location_name TEXT,
          notes TEXT,
          timestamp INTEGER NOT NULL,
          solunar_rating TEXT,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        );
      `],
    },
  ],
};

/** Registry of all databases and their migration plans. */
const MIGRATION_PLANS: Record<DbName, DbMigrationPlan> = {
  'fishlore_offline.db': fishloreMigrations,
  'fishingPins.db': fishingPinsMigrations,
};

/**
 * Read the current `user_version` pragma from an open SQLite database.
 * Returns 0 for fresh databases that have never been migrated.
 */
async function getCurrentUserVersion(db: any): Promise<number> {
  try {
    const result = (await db.getAllAsync(
      `PRAGMA user_version;`,
    )) as Array<{ user_version: number }>;
    return result?.[0]?.user_version ?? 0;
  } catch (error) {
    console.error('[Database Migration] Failed to read user_version:', error);
    return 0;
  }
}

/**
 * Execute all pending migrations for a given database inside an atomic
 * transaction. Reads `user_version`, applies each step in order, and bumps
 * the pragma after each step.
 *
 * @param db        An open expo-sqlite database connection.
 * @param dbName    Which database in the registry we are migrating.
 * @returns         The final `user_version` after all migrations.
 */
export async function runMigrations(
  db: any,
  dbName: DbName,
): Promise<number> {
  if (Platform.OS === 'web') {
    console.log('[Database Migration] Web platform — skipping native SQLite migrations.');
    return 0;
  }

  const plan = MIGRATION_PLANS[dbName];
  if (!plan) {
    console.warn(`[Database Migration] No migration plan registered for "${dbName}".`);
    return 0;
  }

  const currentVersion = await getCurrentUserVersion(db);
  const pendingSteps = plan.steps.filter((s) => s.version > currentVersion);

  if (pendingSteps.length === 0) {
    console.log(
      `[Database Migration] "${dbName}" is at version ${currentVersion} — no migrations needed.`,
    );
    return currentVersion;
  }

  console.log(
    `[Database Migration] "${dbName}" at v${currentVersion}, applying ${pendingSteps.length} migration(s).`,
  );

  try {
    // ── Wrap everything in a transaction so a mid-migration failure rolls back. ──
    await db.withTransactionAsync(async () => {
      for (const step of pendingSteps) {
        console.log(
          `[Database Migration] v${step.version}: ${step.description}`,
        );

        for (const sql of step.sql) {
          try {
            await db.execAsync(sql);
          } catch (sqlError) {
            const errMsg = sqlError instanceof Error ? sqlError.message : String(sqlError);
            // ALTER TABLE on an existing column throws — the column was likely
            // added by a previous run that crashed before bumping user_version.
            // Log and continue.
            if (errMsg.includes('duplicate column name')) {
              console.warn(
                `[Database Migration] v${step.version}: non-fatal — ${errMsg}`,
              );
            } else {
              throw sqlError;
            }
          }
        }

        // Bump user_version after successful step execution.
        await db.execAsync(`PRAGMA user_version = ${step.version};`);
        console.log(`[Database Migration] v${step.version} applied successfully.`);
      }
    });

    const finalVersion = await getCurrentUserVersion(db);
    console.log(
      `[Database Migration] "${dbName}" migration complete — now at v${finalVersion}.`,
    );
    return finalVersion;
  } catch (error) {
    console.error(
      `[Database Migration] CRITICAL FAILURE on "${dbName}":`,
      error instanceof Error ? error.message : String(error),
    );
    throw new Error(
      `[Database Migration] ${dbName} migration failed: ` +
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Convenience: run migrations for a database that has already been opened.
 * Returns the final user_version, or re-throws on critical failure.
 */
export async function migrateDatabase(dbName: DbName): Promise<number> {
  const db = await SQLite.openDatabaseAsync(dbName);
  return runMigrations(db, dbName);
}
