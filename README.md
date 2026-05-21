# Mile Challenge

A leaderboard app for a friends' mileage challenge running from March 16 to June 30, 2026. Pulls activity data from Strava and ranks participants by weighted miles.

**Live site:** [strava-challenge-liart.vercel.app](https://strava-challenge-liart.vercel.app/)

## Rules

- **Running** counts 1:1 (1 mile run = 1 challenge mile)
- **Biking** counts 4:1 (4 miles biked = 1 challenge mile)
- Only runs and rides are tracked

## Tech Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Strava API (Club Activities)
- PostgreSQL (Vercel) / SQLite (local dev)
- Deployed on Vercel
