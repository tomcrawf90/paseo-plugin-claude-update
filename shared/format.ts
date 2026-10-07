import type { Outcome, Status } from "./status";

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

/** The sidebar row's title: it carries the news, since the row is the one thing always on screen. */
export function sidebarTitle(status: Pick<Status, "attention" | "staleProcesses"> | null): string {
  const base = "Claude Code updates";
  if (status === null) return base;
  switch (status.attention?.kind) {
    case "updated":
      return "Claude Code updated";
    case "failed":
      return "Claude Code update failing";
    case "update-available":
      return "Claude Code update available";
    case "pin-mismatch":
    case "channel-mismatch":
      return "Claude Code update needs a look";
    default:
      return base;
  }
}

export function sidebarIcon(status: Pick<Status, "attention"> | null): string {
  switch (status?.attention?.kind) {
    case undefined:
      return "RefreshCw";
    case "updated":
      return "CircleCheck";
    case "update-available":
      return "CircleArrowUp";
    default:
      return "TriangleAlert";
  }
}
