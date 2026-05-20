import { NextResponse } from "next/server";
import { getLeaderboard, hasStaleUsers } from "@/lib/db";
import {
  CHALLENGE_CONFIG,
  getDaysRemaining,
  getDaysElapsed,
  getTotalDays,
} from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await getLeaderboard(
    CHALLENGE_CONFIG.startDate,
    CHALLENGE_CONFIG.endDate,
    CHALLENGE_CONFIG.bikeRatio
  );

  const needsSync =
    entries.length > 0 &&
    (await hasStaleUsers(CHALLENGE_CONFIG.syncStaleAfterSeconds));

  return NextResponse.json({
    challenge: {
      name: CHALLENGE_CONFIG.name,
      startDate: CHALLENGE_CONFIG.startDate,
      endDate: CHALLENGE_CONFIG.endDate,
      daysRemaining: getDaysRemaining(),
      daysElapsed: getDaysElapsed(),
      totalDays: getTotalDays(),
      runRatio: `${CHALLENGE_CONFIG.runRatio}:1`,
      bikeRatio: "4:1 (4 bike miles = 1 challenge mile)",
    },
    leaderboard: entries,
    needsSync,
  });
}
