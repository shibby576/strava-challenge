const STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_API_URL = "https://www.strava.com/api/v3";

export function getAuthUrl(): string {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/callback`;
  const params = new URLSearchParams({
    client_id: clientId!,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read",
  });
  return `${STRAVA_AUTH_URL}?${params.toString()}`;
}

export interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete: {
    id: number;
    firstname: string;
    lastname: string;
    profile: string;
  };
}

export async function exchangeCode(
  code: string
): Promise<StravaTokenResponse> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava token exchange failed: ${text}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
}> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error("Failed to refresh Strava token");
  }
  return res.json();
}

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  distance: number; // meters
  start_date: string;
  start_date_local: string;
}

export async function fetchActivities(
  accessToken: string,
  after: number,
  before: number
): Promise<StravaActivity[]> {
  const allActivities: StravaActivity[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const params = new URLSearchParams({
      after: after.toString(),
      before: before.toString(),
      page: page.toString(),
      per_page: perPage.toString(),
    });
    const res = await fetch(
      `${STRAVA_API_URL}/athlete/activities?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok) {
      throw new Error(`Strava API error: ${res.status}`);
    }
    const activities: StravaActivity[] = await res.json();
    if (activities.length === 0) break;
    allActivities.push(...activities);
    if (activities.length < perPage) break;
    page++;
  }

  return allActivities.filter(
    (a) => a.type === "Run" || a.type === "Ride"
  );
}

export interface ClubActivity {
  athlete: {
    firstname: string;
    lastname: string; // last initial + "."
  };
  name: string;
  distance: number; // meters
  type: string;
  sport_type: string;
}

export async function fetchClubActivities(
  accessToken: string,
  clubId: string
): Promise<ClubActivity[]> {
  const allActivities: ClubActivity[] = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const params = new URLSearchParams({
      page: page.toString(),
      per_page: perPage.toString(),
    });
    const res = await fetch(
      `${STRAVA_API_URL}/clubs/${clubId}/activities?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok) {
      throw new Error(`Strava Club API error: ${res.status}`);
    }
    const activities: ClubActivity[] = await res.json();
    if (activities.length === 0) break;
    allActivities.push(...activities);
    if (activities.length < perPage) break;
    page++;
  }

  return allActivities.filter(
    (a) => a.type === "Run" || a.type === "Ride"
  );
}

export function metersToMiles(meters: number): number {
  return meters * 0.000621371;
}
