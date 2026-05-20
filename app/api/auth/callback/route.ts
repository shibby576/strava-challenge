import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, fetchActivities, metersToMiles } from "@/lib/strava";
import { upsertUser, upsertActivities, updateLastSync } from "@/lib/db";
import {
  getChallengeStartEpoch,
  getChallengeEndEpoch,
} from "@/lib/config";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(
      new URL("/?error=auth_denied", request.url)
    );
  }

  try {
    const tokenData = await exchangeCode(code);
    const { athlete } = tokenData;

    const user = await upsertUser({
      strava_id: athlete.id,
      name: `${athlete.firstname} ${athlete.lastname}`,
      profile_pic: athlete.profile,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: tokenData.expires_at,
    });

    const activities = await fetchActivities(
      tokenData.access_token,
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

    return NextResponse.redirect(
      new URL(`/?welcome=${encodeURIComponent(athlete.firstname)}`, request.url)
    );
  } catch (err) {
    console.error("Auth callback error:", err);
    return NextResponse.redirect(
      new URL("/?error=auth_failed", request.url)
    );
  }
}
