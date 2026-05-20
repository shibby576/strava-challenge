export const CHALLENGE_CONFIG = {
  name: "Strava Mile Challenge",
  startDate: "2026-03-16",
  endDate: "2026-06-30",
  runRatio: 1,
  bikeRatio: 0.25, // 4 bike miles = 1 challenge mile
  syncStaleAfterSeconds: 60 * 60, // auto-sync if data is older than 1 hour
};

export function getChallengeStartEpoch(): number {
  return Math.floor(new Date(CHALLENGE_CONFIG.startDate).getTime() / 1000);
}

export function getChallengeEndEpoch(): number {
  const end = new Date(CHALLENGE_CONFIG.endDate);
  end.setHours(23, 59, 59);
  return Math.floor(end.getTime() / 1000);
}

export function getDaysRemaining(): number {
  const now = new Date();
  const end = new Date(CHALLENGE_CONFIG.endDate);
  const diff = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function getDaysElapsed(): number {
  const now = new Date();
  const start = new Date(CHALLENGE_CONFIG.startDate);
  const diff = now.getTime() - start.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

export function getTotalDays(): number {
  const start = new Date(CHALLENGE_CONFIG.startDate);
  const end = new Date(CHALLENGE_CONFIG.endDate);
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}
