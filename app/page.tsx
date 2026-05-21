"use client";

import { useEffect, useState, useCallback } from "react";

interface ChallengeInfo {
  name: string;
  startDate: string;
  endDate: string;
  daysRemaining: number;
  daysElapsed: number;
  totalDays: number;
  runRatio: string;
  bikeRatio: string;
}

interface LeaderboardEntry {
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

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return <span className="text-2xl" title="1st place">&#x1F451;</span>;
  if (rank === 2)
    return <span className="text-xl text-silver font-bold">2nd</span>;
  if (rank === 3)
    return <span className="text-xl text-bronze font-bold">3rd</span>;
  return <span className="text-lg text-muted font-mono">{rank}th</span>;
}

function formatMiles(miles: number): string {
  return miles.toFixed(1);
}

function timeAgo(epochSeconds: number | null): string {
  if (!epochSeconds) return "Never";
  const diff = Math.floor(Date.now() / 1000) - epochSeconds;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function Home() {
  const [challenge, setChallenge] = useState<ChallengeInfo | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard");
      const data = await res.json();
      setChallenge(data.challenge);
      setLeaderboard(data.leaderboard);
      return (data.needsSync || data.needsClubSync) as boolean;
    } catch {
      console.error("Failed to load leaderboard");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const backgroundSync = useCallback(async (syncClub = false) => {
    setSyncing(true);
    try {
      const promises: Promise<Response>[] = [];
      promises.push(fetch("/api/sync?staleOnly=true", { method: "POST" }));
      if (syncClub) {
        promises.push(fetch("/api/sync-club", { method: "POST" }));
      }
      await Promise.all(promises);
      await fetchLeaderboard();
    } catch {
      console.error("Background sync failed");
    } finally {
      setSyncing(false);
    }
  }, [fetchLeaderboard]);

  useEffect(() => {
    fetchLeaderboard().then((needsSync) => {
      if (needsSync) {
        backgroundSync(true);
      }
    });
    const params = new URLSearchParams(window.location.search);
    const welcome = params.get("welcome");
    const error = params.get("error");
    if (welcome) {
      setToast(`Welcome, ${welcome}! Your activities have been synced.`);
      window.history.replaceState({}, "", "/");
    }
    if (error) {
      setToast(
        error === "auth_denied"
          ? "Strava connection was denied."
          : "Something went wrong connecting to Strava."
      );
      window.history.replaceState({}, "", "/");
    }
  }, [fetchLeaderboard, backgroundSync]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleSync() {
    setSyncing(true);
    try {
      await Promise.all([
        fetch("/api/sync", { method: "POST" }),
        fetch("/api/sync-club", { method: "POST" }),
      ]);
      await fetchLeaderboard();
      setToast("All activities synced!");
    } catch {
      setToast("Sync failed. Try again.");
    } finally {
      setSyncing(false);
    }
  }

  const progressPercent = challenge
    ? Math.min(100, (challenge.daysElapsed / challenge.totalDays) * 100)
    : 0;

  const maxMiles =
    leaderboard.length > 0
      ? Math.max(...leaderboard.map((e) => e.challenge_miles))
      : 0;

  return (
    <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-accent text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-slide-up font-medium">
          {toast}
        </div>
      )}

      <header className="text-center mb-10">
        <h1 className="text-4xl font-bold tracking-tight mb-2">
          Mile Challenge
        </h1>
        {challenge && (
          <div className="space-y-3">
            <p className="text-muted text-sm">
              {challenge.startDate} &mdash; {challenge.endDate}
            </p>
            <div className="max-w-md mx-auto">
              <div className="flex justify-between text-xs text-muted mb-1">
                <span>Day {challenge.daysElapsed}</span>
                <span>{challenge.daysRemaining} days left</span>
              </div>
              <div className="h-2 bg-card rounded-full overflow-hidden border border-card-border">
                <div
                  className="h-full bg-gradient-to-r from-accent to-accent-light rounded-full transition-all duration-1000"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
            <div className="flex justify-center gap-6 text-xs text-muted">
              <span>Running = 1:1 miles</span>
              <span>Biking = 4:1 miles</span>
            </div>
          </div>
        )}
      </header>

      <div className="flex justify-end items-center mb-6">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="bg-card hover:bg-card-border text-foreground font-medium px-4 py-2.5 rounded-lg border border-card-border transition-colors text-sm disabled:opacity-50 flex items-center gap-2"
        >
          {syncing && (
            <div className="h-3.5 w-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          )}
          {syncing ? "Syncing..." : "Refresh All"}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : leaderboard.length === 0 ? (
        <div className="text-center py-20 text-muted">
          <p className="text-xl mb-2">No riders yet!</p>
          <p className="text-sm">
            Connect your Strava account to join the challenge.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {leaderboard.map((entry, idx) => {
            const rank = idx + 1;
            const barWidth =
              maxMiles > 0 ? (entry.challenge_miles / maxMiles) * 100 : 0;
            const bikeChallengeMiles = entry.ride_miles * 0.25;
            return (
              <div
                key={entry.user_id}
                className={`bg-card border rounded-xl p-4 transition-all animate-slide-up ${
                  rank === 1
                    ? "border-accent glow-pulse"
                    : "border-card-border hover:border-accent/50"
                }`}
                style={{ animationDelay: `${idx * 80}ms` }}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 text-center shrink-0">
                    <RankBadge rank={rank} />
                  </div>
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-card-border shrink-0">
                    {entry.profile_pic ? (
                      <img
                        src={entry.profile_pic}
                        alt={entry.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted text-sm font-bold">
                        {entry.name.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between mb-1.5">
                      <h3 className="font-semibold text-base truncate">
                        {entry.name}
                      </h3>
                      <span className="text-2xl font-bold text-accent tabular-nums ml-2 shrink-0">
                        {formatMiles(entry.challenge_miles)}
                        <span className="text-sm font-normal text-muted ml-1">
                          mi
                        </span>
                      </span>
                    </div>
                    <div className="h-1.5 bg-background rounded-full overflow-hidden mb-2">
                      <div
                        className="h-full bg-gradient-to-r from-accent to-accent-light rounded-full transition-all duration-1000"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <div className="flex gap-4 text-xs text-muted">
                      <span title="Running miles (1:1)">
                        Run: {formatMiles(entry.run_miles)} mi
                      </span>
                      <span title="Raw biking miles">
                        Bike: {formatMiles(entry.ride_miles)} mi
                      </span>
                      <span title="Biking miles after 4:1 ratio">
                        Bike (adj): {formatMiles(bikeChallengeMiles)} mi
                      </span>
                      <span>{entry.activity_count} activities</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <footer className="mt-12 text-center text-xs text-muted pb-4 space-y-2">
        <p>
          <a
            href="https://www.strava.com/clubs/2016343"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[#fc4c02] hover:text-[#e04400] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
            </svg>
            View Club on Strava
          </a>
        </p>
        <p className="flex items-center justify-center gap-2">
          {syncing && (
            <span className="inline-flex items-center gap-1.5 text-accent">
              <span className="h-2 w-2 bg-accent rounded-full animate-pulse" />
              Updating from Strava...
            </span>
          )}
          {!syncing && (
            <>
              Synced via Strava &middot; Last refreshed:{" "}
              {leaderboard.length > 0
                ? timeAgo(
                    Math.max(
                      ...leaderboard.map((e) => e.last_sync_at ?? 0)
                    )
                  )
                : "N/A"}
            </>
          )}
        </p>
      </footer>
    </main>
  );
}
