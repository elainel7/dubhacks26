/** Pure helpers for the posture points UI. Scoring itself lives in the API. */

export const UPRIGHT_BASE_POINTS = 10;
export const POINTS_POLL_MS = 25_000;
export const POINTS_HOURS = 168;
export const DAILY_GOAL_MINUTES = 60;
export const DAY_STREAK_MINUTES = 30;

export type PointEvent = {
  time: string;
  points: number;
  reason: string;
};

export type LevelInfo = {
  level: number;
  title: string;
  points_into_level: number;
  points_to_next_level: number;
  xp: number;
};

export type PostureBadge = {
  id: string;
  name: string;
  description: string;
  earned: boolean;
  earned_at: string | null;
};

export type PointsSnapshot = {
  user_id: string;
  hours: number;
  tz: string;
  total_points: number;
  points_today: number;
  today_upright_minutes: number;
  daily_goal_minutes: number;
  goal_progress: number;
  flow_streak_minutes: number;
  flow_multiplier: number;
  best_streak_minutes: number;
  day_streak: number;
  level: LevelInfo;
  badges: PostureBadge[];
  recent: PointEvent[];
};

export type Leader = {
  rank: number;
  display_name: string;
  points: number;
};

export type LeaderboardSnapshot = {
  hours: number;
  tz: string;
  leaders: Leader[];
};

/** Matches the ESP32 save rule: a forward head or a score of 60 or below is not upright. */
export function isUprightPosture(score: { face: boolean; posture: number; head: string }) {
  if (score.face !== true) return false;
  if (score.head === "forward") return false;
  if (!Number.isFinite(score.posture)) return false;
  return score.posture > 60;
}

export function formatMultiplier(multiplier: number) {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return "1";
  if (Number.isInteger(multiplier)) return String(multiplier);
  const text = multiplier.toFixed(1);
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

export function uprightPointsToast(multiplier: number) {
  const mult = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  const awarded = Math.round(UPRIGHT_BASE_POINTS * mult);
  return `+${awarded} points ×${formatMultiplier(mult)}`;
}

export function toastForPointEvent(event: { points: number; reason: string }) {
  if (!event || event.points <= 0 || !event.reason.startsWith("Upright minute")) return null;
  const match = /×(\d+(?:\.\d+)?)/.exec(event.reason);
  return `+${event.points} points ×${match ? match[1] : "1"}`;
}

/** Newest upright award inside the window, skipping future rows more than a minute ahead. */
export function freshUprightEvent(recent: PointEvent[], nowMs: number, windowMs = 5 * 60 * 1000) {
  for (const event of recent) {
    const at = Date.parse(event.time);
    if (!Number.isFinite(at)) continue;
    const age = nowMs - at;
    if (age < -60_000 || age > windowMs) continue;
    if (toastForPointEvent(event)) return event;
  }
  return null;
}

export function goalFraction(uprightMinutes: number, goalMinutes: number) {
  if (!Number.isFinite(uprightMinutes) || !Number.isFinite(goalMinutes) || goalMinutes <= 0) return 0;
  return Math.min(1, Math.max(0, uprightMinutes / goalMinutes));
}

export function levelFraction(pointsIntoLevel: number, pointsToNextLevel: number) {
  const into = Number.isFinite(pointsIntoLevel) ? Math.max(0, pointsIntoLevel) : 0;
  const remaining = Number.isFinite(pointsToNextLevel) ? Math.max(0, pointsToNextLevel) : 0;
  const span = into + remaining;
  if (span <= 0) return 0;
  return Math.min(1, into / span);
}

export function dayStreakDetail(streak: number, todayMinutes: number, goal = DAY_STREAK_MINUTES) {
  if (streak <= 0) return `${goal} upright minutes starts a day streak.`;
  if (todayMinutes >= goal) return "Today is in the streak.";
  const remaining = goal - todayMinutes;
  return `${remaining} more upright ${remaining === 1 ? "minute" : "minutes"} today extends it.`;
}

export function flowDetail(minutes: number, multiplier: number, best: number) {
  if (minutes <= 0) {
    return best > 0 ? `No live streak. Best is ${best} ${best === 1 ? "minute" : "minutes"}.` : "Sit upright to start a streak.";
  }
  const unit = minutes === 1 ? "minute" : "minutes";
  return `${minutes} ${unit} at ×${formatMultiplier(multiplier)}. Best is ${best}.`;
}
