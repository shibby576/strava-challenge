import { NextResponse } from "next/server";
import {
  getAllUsers,
  updateUserTokens,
  upsertClubAthletes,
  updateClubSync,
  matchClubAthleteToUser,
} from "@/lib/db";
import type { ClubAthleteSummary } from "@/lib/db";
import {
  refreshAccessToken,
  fetchClubActivities,
  metersToMiles,
} from "@/lib/strava";
import { CHALLENGE_CONFIG } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST() {
  const users = await getAllUsers();

  // We need at least one OAuth user to call the club API
  if (users.length === 0) {
    return NextResponse.json(
      { error: "No connected users to fetch club data" },
      { status: 400 }
    );
  }

  // Use the first available user's token
  const user = users[0];
  let accessToken = user.access_token;

  try {
    // Refresh token if expired
    if (user.token_expires_at < Math.floor(Date.now() / 1000)) {
      const refreshed = await refreshAccessToken(user.refresh_token);
      await updateUserTokens(user.id, {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        token_expires_at: refreshed.expires_at,
      });
      accessToken = refreshed.access_token;
    }

    const clubActivities = await fetchClubActivities(
      accessToken,
      CHALLENGE_CONFIG.clubId
    );

    // Aggregate by athlete
    const athleteMap = new Map<string, ClubAthleteSummary>();
    for (const a of clubActivities) {
      const name = `${a.athlete.firstname} ${a.athlete.lastname}`;
      const existing = athleteMap.get(name) || {
        athlete_name: name,
        run_miles: 0,
        ride_miles: 0,
        activity_count: 0,
      };
      const miles = metersToMiles(a.distance);
      if (a.type === "Run") {
        existing.run_miles += miles;
      } else if (a.type === "Ride") {
        existing.ride_miles += miles;
      }
      existing.activity_count += 1;
      athleteMap.set(name, existing);
    }

    const athletes = Array.from(athleteMap.values());

    // Save to DB
    await upsertClubAthletes(CHALLENGE_CONFIG.clubId, athletes);
    await updateClubSync(CHALLENGE_CONFIG.clubId, user.id);

    // Auto-match: if an OAuth user's name starts with the same first name
    // and last initial, mark that club athlete as matched
    for (const oauthUser of users) {
      const parts = oauthUser.name.split(" ");
      if (parts.length < 2) continue;
      const firstName = parts[0];
      const lastInitial = parts[parts.length - 1].charAt(0) + ".";
      const clubName = `${firstName} ${lastInitial}`;
      const matched = athletes.find((a) => a.athlete_name === clubName);
      if (matched) {
        await matchClubAthleteToUser(
          CHALLENGE_CONFIG.clubId,
          clubName,
          oauthUser.id
        );
      }
    }

    return NextResponse.json({
      athletes: athletes.length,
      activities: clubActivities.length,
    });
  } catch (err) {
    console.error("Club sync error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
