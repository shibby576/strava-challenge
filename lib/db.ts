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
  user_id: number | null;
  name: string;
  profile_pic: string | null;
  run_miles: number;
  ride_miles: number;
  challenge_miles: number;
  activity_count: number;
  last_sync_at: number | null;
  source: "oauth" | "club";
}

export interface ClubAthleteSummary {
  athlete_name: string;
  run_miles: number;
  ride_miles: number;
  activity_count: number;
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

      CREATE TABLE IF NOT EXISTS club_sync (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        club_id TEXT UNIQUE NOT NULL,
        last_sync_at INTEGER,
        synced_by_user_id INTEGER
      );

      CREATE TABLE IF NOT EXISTS club_athletes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        club_id TEXT NOT NULL,
        athlete_name TEXT NOT NULL,
        run_miles REAL NOT NULL DEFAULT 0,
        ride_miles REAL NOT NULL DEFAULT 0,
        activity_count INTEGER NOT NULL DEFAULT 0,
        matched_user_id INTEGER,
        UNIQUE(club_id, athlete_name)
      );
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS club_sync (
      id SERIAL PRIMARY KEY,
      club_id TEXT UNIQUE NOT NULL,
      last_sync_at INTEGER,
      synced_by_user_id INTEGER
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS club_athletes (
      id SERIAL PRIMARY KEY,
      club_id TEXT NOT NULL,
      athlete_name TEXT NOT NULL,
      run_miles DOUBLE PRECISION NOT NULL DEFAULT 0,
      ride_miles DOUBLE PRECISION NOT NULL DEFAULT 0,
      activity_count INTEGER NOT NULL DEFAULT 0,
      matched_user_id INTEGER,
      UNIQUE(club_id, athlete_name)
    );
  `);
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

// ── Club data functions ────────────────────────────────────────

export async function upsertClubAthletes(
  clubId: string,
  athletes: ClubAthleteSummary[]
): Promise<void> {
  // Clear existing club data and replace with fresh totals
  await execute("DELETE FROM club_athletes WHERE club_id = $1", [clubId]);
  for (const a of athletes) {
    await execute(
      `INSERT INTO club_athletes (club_id, athlete_name, run_miles, ride_miles, activity_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [clubId, a.athlete_name, a.run_miles, a.ride_miles, a.activity_count]
    );
  }
}

export async function updateClubSync(
  clubId: string,
  userId: number
): Promise<void> {
  if (USE_POSTGRES) {
    await initPostgres();
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO club_sync (club_id, last_sync_at, synced_by_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT(club_id) DO UPDATE SET last_sync_at = $2, synced_by_user_id = $3`,
      [clubId, Math.floor(Date.now() / 1000), userId]
    );
  } else {
    const db = getSqliteDb();
    db.prepare(
      `INSERT INTO club_sync (club_id, last_sync_at, synced_by_user_id)
       VALUES (?, ?, ?)
       ON CONFLICT(club_id) DO UPDATE SET last_sync_at = excluded.last_sync_at, synced_by_user_id = excluded.synced_by_user_id`
    ).run(clubId, Math.floor(Date.now() / 1000), userId);
  }
}

export async function getClubSyncTime(
  clubId: string
): Promise<number | null> {
  const row = await queryOne<{ last_sync_at: number | null }>(
    "SELECT last_sync_at FROM club_sync WHERE club_id = $1",
    [clubId]
  );
  return row?.last_sync_at ?? null;
}

export async function matchClubAthleteToUser(
  clubId: string,
  athleteName: string,
  userId: number
): Promise<void> {
  await execute(
    "UPDATE club_athletes SET matched_user_id = $1 WHERE club_id = $2 AND athlete_name = $3",
    [userId, clubId, athleteName]
  );
}

// ── Leaderboard (merged: OAuth users + unmatched club athletes) ──

export async function getLeaderboard(
  startDate: string,
  endDate: string,
  bikeRatio: number,
  clubId: string
): Promise<LeaderboardEntry[]> {
  // 1. Get OAuth users with their activity totals
  const oauthEntries = await query<
    LeaderboardEntry & { source: string }
  >(
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

  // Mark OAuth entries
  const oauthResults: LeaderboardEntry[] = oauthEntries.map((e) => ({
    ...e,
    run_miles: Number(e.run_miles),
    ride_miles: Number(e.ride_miles),
    challenge_miles: Number(e.challenge_miles),
    activity_count: Number(e.activity_count),
    source: "oauth" as const,
  }));

  // 2. Get club athletes that are NOT matched to any OAuth user
  const clubEntries = await query<{
    athlete_name: string;
    run_miles: number;
    ride_miles: number;
    activity_count: number;
  }>(
    `SELECT athlete_name, run_miles, ride_miles, activity_count
     FROM club_athletes
     WHERE club_id = $1 AND matched_user_id IS NULL`,
    [clubId]
  );

  // Get club sync time for display
  const clubSyncTime = await getClubSyncTime(clubId);

  const clubResults: LeaderboardEntry[] = clubEntries.map((c) => ({
    user_id: null,
    name: c.athlete_name,
    profile_pic: null,
    run_miles: Number(c.run_miles),
    ride_miles: Number(c.ride_miles),
    challenge_miles:
      Number(c.run_miles) + Number(c.ride_miles) * bikeRatio,
    activity_count: Number(c.activity_count),
    last_sync_at: clubSyncTime,
    source: "club" as const,
  }));

  // 3. Merge and sort
  const all = [...oauthResults, ...clubResults];
  all.sort((a, b) => b.challenge_miles - a.challenge_miles);
  return all;
}
