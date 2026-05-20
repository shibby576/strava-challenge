import path from "path";

// ── Types ──────────────────────────────────────────────────────

export interface User {
  id: number;
  strava_id: number;
  name: string;
  profile_pic: string | null;
  access_token: string;
  refresh_token: string;
  token_expires_at: number;
  last_sync_at: number | null;
}

export interface Activity {
  id: number;
  user_id: number;
  strava_activity_id: number;
  type: "Run" | "Ride";
  distance_miles: number;
  activity_date: string;
  name: string | null;
}

export interface LeaderboardEntry {
  user_id: number;
  name: string;
  profile_pic: string | null;
  run_miles: number;
  ride_miles: number;
  challenge_miles: number;
  activity_count: number;
  last_sync_at: number | null;
}

// ── Backend detection ──────────────────────────────────────────

const USE_POSTGRES = !!process.env.POSTGRES_URL;

// ── SQLite backend (local dev) ─────────────────────────────────

let _sqliteDb: import("better-sqlite3").Database | null = null;

function getSqliteDb(): import("better-sqlite3").Database {
  if (!_sqliteDb) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    const DB_PATH = path.join(process.cwd(), "strava_challenge.db");
    _sqliteDb = new Database(DB_PATH);
    _sqliteDb!.pragma("journal_mode = WAL");
    _sqliteDb!.pragma("foreign_keys = ON");
    _sqliteDb!.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strava_id INTEGER UNIQUE NOT NULL,
        name TEXT NOT NULL,
        profile_pic TEXT,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        token_expires_at INTEGER NOT NULL,
        last_sync_at INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        strava_activity_id INTEGER UNIQUE NOT NULL,
        type TEXT NOT NULL,
        distance_miles REAL NOT NULL,
        activity_date TEXT NOT NULL,
        name TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_activities_user ON activities(user_id);
      CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(activity_date);
    `);
  }
  return _sqliteDb!;
}

// ── Postgres backend (Vercel) ──────────────────────────────────

let _pgPool: ReturnType<typeof import("@vercel/postgres").createPool> | null =
  null;
let _pgInitialized = false;

function getPgPool() {
  if (!_pgPool) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createPool } = require("@vercel/postgres");
    _pgPool = createPool();
  }
  return _pgPool!;
}

async function initPostgres() {
  if (_pgInitialized) return;
  const pool = getPgPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      strava_id INTEGER UNIQUE NOT NULL,
      name TEXT NOT NULL,
      profile_pic TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expires_at INTEGER NOT NULL,
      last_sync_at INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activities (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      strava_activity_id BIGINT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      distance_miles DOUBLE PRECISION NOT NULL,
      activity_date TEXT NOT NULL,
      name TEXT
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_activities_user ON activities(user_id)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(activity_date)`
  );
  _pgInitialized = true;
}

// ── Query helpers ──────────────────────────────────────────────

// All SQL uses $1, $2, ... params. For SQLite we convert to ?.
async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  if (USE_POSTGRES) {
    await initPostgres();
    const pool = getPgPool();
    const result = await pool.query(text, params);
    return result.rows as T[];
  } else {
    const sqliteText = text.replace(/\$\d+/g, "?");
    const db = getSqliteDb();
    return db.prepare(sqliteText).all(...params) as T[];
  }
}

async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

async function execute(
  text: string,
  params: unknown[] = []
): Promise<void> {
  if (USE_POSTGRES) {
    await initPostgres();
    const pool = getPgPool();
    await pool.query(text, params);
  } else {
    const sqliteText = text.replace(/\$\d+/g, "?");
    const db = getSqliteDb();
    db.prepare(sqliteText).run(...params);
  }
}

// ── User functions ─────────────────────────────────────────────

export async function upsertUser(user: {
  strava_id: number;
  name: string;
  profile_pic: string | null;
  access_token: string;
  refresh_token: string;
  token_expires_at: number;
}): Promise<User> {
  if (USE_POSTGRES) {
    await initPostgres();
    const pool = getPgPool();
    const result = await pool.query(
      `INSERT INTO users (strava_id, name, profile_pic, access_token, refresh_token, token_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT(strava_id) DO UPDATE SET
         name = $2, profile_pic = $3, access_token = $4,
         refresh_token = $5, token_expires_at = $6
       RETURNING *`,
      [
        user.strava_id,
        user.name,
        user.profile_pic,
        user.access_token,
        user.refresh_token,
        user.token_expires_at,
      ]
    );
    return result.rows[0] as User;
  } else {
    const db = getSqliteDb();
    db.prepare(
      `INSERT INTO users (strava_id, name, profile_pic, access_token, refresh_token, token_expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(strava_id) DO UPDATE SET
         name = excluded.name, profile_pic = excluded.profile_pic,
         access_token = excluded.access_token, refresh_token = excluded.refresh_token,
         token_expires_at = excluded.token_expires_at`
    ).run(
      user.strava_id,
      user.name,
      user.profile_pic,
      user.access_token,
      user.refresh_token,
      user.token_expires_at
    );
    return db
      .prepare("SELECT * FROM users WHERE strava_id = ?")
      .get(user.strava_id) as User;
  }
}

export async function getAllUsers(): Promise<User[]> {
  return query<User>("SELECT * FROM users ORDER BY name");
}

export async function getStaleUsers(
  staleThresholdSeconds: number
): Promise<User[]> {
  const cutoff = Math.floor(Date.now() / 1000) - staleThresholdSeconds;
  return query<User>(
    "SELECT * FROM users WHERE last_sync_at IS NULL OR last_sync_at < $1 ORDER BY name",
    [cutoff]
  );
}

export async function hasStaleUsers(
  staleThresholdSeconds: number
): Promise<boolean> {
  const cutoff = Math.floor(Date.now() / 1000) - staleThresholdSeconds;
  const row = await queryOne<{ count: number | string }>(
    "SELECT COUNT(*) as count FROM users WHERE last_sync_at IS NULL OR last_sync_at < $1",
    [cutoff]
  );
  return Number(row?.count ?? 0) > 0;
}

export async function updateUserTokens(
  userId: number,
  tokens: {
    access_token: string;
    refresh_token: string;
    token_expires_at: number;
  }
): Promise<void> {
  await execute(
    `UPDATE users SET access_token = $1, refresh_token = $2,
     token_expires_at = $3 WHERE id = $4`,
    [tokens.access_token, tokens.refresh_token, tokens.token_expires_at, userId]
  );
}

export async function updateLastSync(userId: number): Promise<void> {
  await execute("UPDATE users SET last_sync_at = $1 WHERE id = $2", [
    Math.floor(Date.now() / 1000),
    userId,
  ]);
}

// ── Activity functions ─────────────────────────────────────────

export async function upsertActivities(
  activities: {
    user_id: number;
    strava_activity_id: number;
    type: string;
    distance_miles: number;
    activity_date: string;
    name: string | null;
  }[]
): Promise<void> {
  if (USE_POSTGRES) {
    await initPostgres();
    const pool = getPgPool();
    for (const a of activities) {
      await pool.query(
        `INSERT INTO activities (user_id, strava_activity_id, type, distance_miles, activity_date, name)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT(strava_activity_id) DO UPDATE SET
           distance_miles = $4, name = $6`,
        [
          a.user_id,
          a.strava_activity_id,
          a.type,
          a.distance_miles,
          a.activity_date,
          a.name,
        ]
      );
    }
  } else {
    const db = getSqliteDb();
    const stmt = db.prepare(
      `INSERT INTO activities (user_id, strava_activity_id, type, distance_miles, activity_date, name)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(strava_activity_id) DO UPDATE SET
         distance_miles = excluded.distance_miles, name = excluded.name`
    );
    const insertMany = db.transaction(
      (
        items: typeof activities
      ) => {
        for (const a of items) {
          stmt.run(
            a.user_id,
            a.strava_activity_id,
            a.type,
            a.distance_miles,
            a.activity_date,
            a.name
          );
        }
      }
    );
    insertMany(activities);
  }
}

// ── Leaderboard ────────────────────────────────────────────────

export async function getLeaderboard(
  startDate: string,
  endDate: string,
  bikeRatio: number
): Promise<LeaderboardEntry[]> {
  return query<LeaderboardEntry>(
    `SELECT
      u.id as user_id,
      u.name,
      u.profile_pic,
      u.last_sync_at,
      COALESCE(SUM(CASE WHEN a.type = 'Run' THEN a.distance_miles ELSE 0 END), 0) as run_miles,
      COALESCE(SUM(CASE WHEN a.type = 'Ride' THEN a.distance_miles ELSE 0 END), 0) as ride_miles,
      COALESCE(
        SUM(CASE WHEN a.type = 'Run' THEN a.distance_miles ELSE 0 END) +
        SUM(CASE WHEN a.type = 'Ride' THEN a.distance_miles ELSE 0 END) * $1,
        0
      ) as challenge_miles,
      COUNT(a.id) as activity_count
    FROM users u
    LEFT JOIN activities a ON u.id = a.user_id
      AND a.activity_date >= $2
      AND a.activity_date <= $3
    GROUP BY u.id, u.name, u.profile_pic, u.last_sync_at
    ORDER BY challenge_miles DESC`,
    [bikeRatio, startDate, endDate]
  );
}
