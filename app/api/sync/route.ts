import { NextRequest, NextResponse } from "next/server";
import {
  getAllUsers,
  getStaleUsers,
  updateUserTokens,
  upsertActivities,
  updateLastSync,
} from "@/lib/db";
import type { User } from "@/lib/db";
import {
  refreshAccessToken,
  fetchActivities,
  metersToMiles,
} from "@/lib/strava";
import {
  CHALLENGE_CONFIG,
  getChallengeStartEpoch,
  getChallengeEndEpoch,
} from "@/lib/config";

export const dynamic = "force-dynamic";

async function syncUser(
  user: User
): Promise<{ name: string; synced: number; error?: string }> {
  try {
    let accessToken = user.access_token;

    if (user.token_expires_at < Math.floor(Date.now() / 1000)) {
      const refreshed = await refreshAccessToken(user.refresh_token);
      await updateUserTokens(user.id, {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        token_expires_at: refreshed.expires_at,
      });
      accessToken = refreshed.access_token;
    }

    const activities = await fetchActivities(
      accessToken,
      getChallengeStartEpoch(),
      getChallengeEndEpoch()
    );

    const activityRows = activities.map((a) => ({
      user_id: user.id,
      strava_activity_id: a.id,
      type: a.type,
      distance_miles: metersToMiles(a.distance),
      activity_date: a.start_date_local.split("T")[0],
      name: a.name,
    }));

    if (activityRows.length > 0) {
      await upsertActivities(activityRows);
    }
    await updateLastSync(user.id);
    return { name: user.name, synced: activityRows.length };
  } catch (err) {
    console.error(`Sync error for ${user.name}:`, err);
    return {
      name: user.name,
      synced: 0,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function POST(request: NextRequest) {
  const staleOnly =
    request.nextUrl.searchParams.get("staleOnly") === "true";

  const users = staleOnly
    ? await getStaleUsers(CHALLENGE_CONFIG.syncStaleAfterSeconds)
    : await getAllUsers();

  if (users.length === 0) {
    return NextResponse.json({
      results: [],
      message: staleOnly
        ? "All users are up to date"
        : "No users to sync",
    });
  }

  const results = await Promise.all(users.map(syncUser));

  return NextResponse.json({ results });
}
