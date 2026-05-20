import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "strava_challenge.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
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
`);

db.exec("DELETE FROM activities");
db.exec("DELETE FROM users");

const now = Math.floor(Date.now() / 1000);

const users = [
  { strava_id: 100001, name: "Mike Thompson", profile_pic: null },
  { strava_id: 100002, name: "Sarah Chen", profile_pic: null },
  { strava_id: 100003, name: "Jake Rivera", profile_pic: null },
];

const insertUser = db.prepare(`
  INSERT INTO users (strava_id, name, profile_pic, access_token, refresh_token, token_expires_at, last_sync_at)
  VALUES (?, ?, ?, 'mock', 'mock', ?, ?)
`);

for (const u of users) {
  insertUser.run(u.strava_id, u.name, u.profile_pic, now + 3600, now);
}

const allUsers = db.prepare("SELECT * FROM users").all() as { id: number; name: string }[];

const runNames = ["Morning Run", "Easy Run", "Lunch Run", "Evening Run", "Long Run", "Recovery Run", "Tempo Run", "Trail Run"];
const rideNames = ["Morning Ride", "Weekend Ride", "Evening Spin", "Hill Climb", "Long Ride", "Recovery Ride", "Group Ride"];

let activityId = 900000;

function randBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function seedActivities(
  userId: number,
  runsPerWeek: number,
  ridesPerWeek: number,
  runMilesRange: [number, number],
  rideMilesRange: [number, number]
) {
  const start = new Date("2026-03-16");
  const today = new Date("2026-05-19");
  const activities: {
    strava_activity_id: number;
    user_id: number;
    type: string;
    distance_miles: number;
    activity_date: string;
    name: string;
  }[] = [];

  const current = new Date(start);
  while (current <= today) {
    const dayOfWeek = current.getDay();

    const weekSeed = Math.random();
    if (weekSeed < runsPerWeek / 7) {
      activities.push({
        strava_activity_id: activityId++,
        user_id: userId,
        type: "Run",
        distance_miles: randBetween(...runMilesRange),
        activity_date: current.toISOString().split("T")[0],
        name: runNames[Math.floor(Math.random() * runNames.length)],
      });
    }

    if (weekSeed > 1 - ridesPerWeek / 7 || (dayOfWeek === 0 || dayOfWeek === 6) && Math.random() < 0.6) {
      activities.push({
        strava_activity_id: activityId++,
        user_id: userId,
        type: "Ride",
        distance_miles: randBetween(...rideMilesRange),
        activity_date: current.toISOString().split("T")[0],
        name: rideNames[Math.floor(Math.random() * rideNames.length)],
      });
    }

    current.setDate(current.getDate() + 1);
  }

  return activities;
}

// Mike: strong runner, occasional biker
const mikeActivities = seedActivities(allUsers[0].id, 5, 2, [3, 8], [12, 30]);

// Sarah: balanced runner and biker
const sarahActivities = seedActivities(allUsers[1].id, 3, 3, [3, 6], [15, 40]);

// Jake: heavy biker, light runner
const jakeActivities = seedActivities(allUsers[2].id, 2, 4, [2, 5], [20, 50]);

const insertActivity = db.prepare(`
  INSERT INTO activities (strava_activity_id, user_id, type, distance_miles, activity_date, name)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const allActivities = [...mikeActivities, ...sarahActivities, ...jakeActivities];

const insertAll = db.transaction((items: typeof allActivities) => {
  for (const a of items) {
    insertActivity.run(a.strava_activity_id, a.user_id, a.type, a.distance_miles, a.activity_date, a.name);
  }
});

insertAll(allActivities);

for (const u of allUsers) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN type = 'Run' THEN distance_miles ELSE 0 END), 0) as run_miles,
      COALESCE(SUM(CASE WHEN type = 'Ride' THEN distance_miles ELSE 0 END), 0) as ride_miles
    FROM activities WHERE user_id = ?
  `).get(u.id) as { count: number; run_miles: number; ride_miles: number };

  const challengeMiles = stats.run_miles + stats.ride_miles * 0.25;
  console.log(
    `${u.name}: ${stats.count} activities | Run: ${stats.run_miles.toFixed(1)} mi | Bike: ${stats.ride_miles.toFixed(1)} mi | Challenge: ${challengeMiles.toFixed(1)} mi`
  );
}

console.log("\nDone! Mock data seeded.");
db.close();
