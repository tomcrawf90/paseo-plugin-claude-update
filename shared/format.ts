import type { HistoryEntry, Outcome, Status } from "./status";

export const OUTCOME_LABELS: Record<Outcome, string> = {
  "up-to-date": "Up to date",
  updated: "Updated",
  "update-available": "Update available",
  pinned: "Pinned",
  "pin-applied": "Moved to pinned version",
  "pin-mismatch": "Not at pinned version",
  "channel-mismatch": "Channel mismatch",
  failed: "Failed",
};

/** `in 3 h`, `5 min ago`, `just now`; `never` for null. */
export function relativeTime(iso: string | null, now: number): string {
  if (iso === null) return "never";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";
  const seconds = Math.round((then - now) / 1000);
  const size = Math.abs(seconds);
  if (size < 60) return seconds > 0 ? "in under a minute" : "just now";
  const amount =
    size < 3600 ? `${Math.round(size / 60)} min` : size < 86_400 ? `${Math.round(size / 3600)} h` : `${Math.round(size / 86_400)} d`;
  return seconds > 0 ? `in ${amount}` : `${amount} ago`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * The clock time, in the reader's own time zone: `today at 08:09`,
 * `yesterday at 19:22`, `Thu 8 Oct at 08:09`, with the year when it is not
 * this one. `offsetMinutes` is how far that zone is ahead of UTC; left out,
 * it is this machine's at that moment.
 */
export function absoluteTime(iso: string | null, now: number, offsetMinutes?: number): string {
  if (iso === null) return "never";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";
  const offset = (at: number) => (offsetMinutes ?? -new Date(at).getTimezoneOffset()) * MINUTE_MS;
  // Shifted so that the UTC fields read as the local ones.
  const local = new Date(then + offset(then));
  const day = Math.floor(local.getTime() / DAY_MS) - Math.floor((now + offset(now)) / DAY_MS);
  const clock = `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
  if (day === 0) return `today at ${clock}`;
  if (day === -1) return `yesterday at ${clock}`;
  if (day === 1) return `tomorrow at ${clock}`;
  const year = local.getUTCFullYear() === new Date(now + offset(now)).getUTCFullYear() ? "" : ` ${local.getUTCFullYear()}`;
  return `${DAY_NAMES[local.getUTCDay()]} ${local.getUTCDate()} ${MONTH_NAMES[local.getUTCMonth()]}${year} at ${clock}`;
}

/** Both at once: `5 min ago · today at 08:09`. `never` for null. */
export function bothTimes(iso: string | null, now: number, offsetMinutes?: number): string {
  if (iso === null) return "never";
  if (Number.isNaN(Date.parse(iso))) return "unknown";
  return `${relativeTime(iso, now)} · ${absoluteTime(iso, now, offsetMinutes)}`;
}

/** When the last check was, for the status page and the settings screen. */
export function lastCheckText(status: Pick<Status, "lastCheckAt">, now: number, offsetMinutes?: number): string {
  return status.lastCheckAt === null ? "not checked yet" : bothTimes(status.lastCheckAt, now, offsetMinutes);
}

/**
 * When the schedule checks next. `off` while scheduled checks are switched
 * off, `shortly` before the first one, and `due now` once the time has come:
 * the schedule looks once a minute, so a time just past is not a fault.
 */
export function nextCheckText(status: Pick<Status, "lastCheckAt" | "nextCheckAt">, now: number, offsetMinutes?: number): string {
  if (status.nextCheckAt === null) return status.lastCheckAt === null ? "shortly" : "off";
  const next = Date.parse(status.nextCheckAt);
  if (Number.isNaN(next)) return "unknown";
  return next <= now ? "due now" : bothTimes(status.nextCheckAt, now, offsetMinutes);
}

/**
 * How the last check ended: the outcome in a word or two, and under it the
 * check's own sentence, which names the versions or the reason it failed.
 */
export function lastResult(status: Pick<Status, "lastOutcome" | "lastMessage" | "consecutiveFailures">): { label: string; detail: string | null } {
  if (status.lastOutcome === null) return { label: "none yet", detail: null };
  const repeated = status.lastOutcome === "failed" && status.consecutiveFailures > 1 ? ` (${status.consecutiveFailures} in a row)` : "";
  return { label: `${OUTCOME_LABELS[status.lastOutcome]}${repeated}`, detail: status.lastMessage };
}

/**
 * The last time the version changed, newest first in `history`: `2.1.293 →
 * 2.1.294, 2 h ago · today at 07:09`. Checks since then that found nothing
 * new do not hide it. Null when the history shown holds no update.
 */
export function lastUpdateText(history: readonly HistoryEntry[], now: number, offsetMinutes?: number): string | null {
  const entry = history.find((each) => each.outcome === "updated" || each.outcome === "pin-applied");
  if (entry === undefined) return null;
  const versions = entry.from !== null && entry.to !== null ? `${entry.from} → ${entry.to}, ` : entry.to !== null ? `to ${entry.to}, ` : "";
  return `${versions}${bothTimes(entry.at, now, offsetMinutes)}`;
}

/** How long something has been going: `8 s`, `1 min 05 s`. */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

/** The longest row title: longer ones wrap onto a second line in the Paseo sidebar. */
export const SIDEBAR_TITLE_MAX = 20;

type Noticed = Pick<Status, "attention" | "autoInstall">;

/**
 * The row while there is no news: only the way in to the status page, where
 * "Check now" and the time of the last check are. It says nothing about the
 * state, so it never has to change while all is well.
 */
export const QUIET_ROW = { title: "Claude Code updates", icon: "RefreshCw" } as const;

/**
 * What the sidebar row says when there is news, or null when there is none
 * and the row reads as `QUIET_ROW`. There is news only while the user has
 * something to do or to know about: an update that will not install itself, a
 * failure, a mismatch. An update that went in is not news, whatever is still
 * running the version before: that is on the status page. The news goes when
 * the notice is dismissed or the thing is resolved. The title names the thing
 * and stays within `SIDEBAR_TITLE_MAX`; the detail is on the status page.
 */
export function sidebarRow(status: Noticed | null): { title: string; icon: string } | null {
  const attention = status?.attention ?? null;
  if (status === null || attention === null) return null;
  switch (attention.kind) {
    case "updated":
      return null;
    case "update-available":
      // The next scheduled check installs it: nothing to do.
      return status.autoInstall ? null : { title: "Claude update ready", icon: "CircleArrowUp" };
    case "pin-mismatch":
      return status.autoInstall ? null : { title: "Claude pin mismatch", icon: "TriangleAlert" };
    case "failed":
      return { title: "Claude update failed", icon: "TriangleAlert" };
    case "channel-mismatch":
      return { title: "Claude channel issue", icon: "TriangleAlert" };
  }
}
