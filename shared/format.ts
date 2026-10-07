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

/** How long something has been going: `8 s`, `1 min 05 s`. */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

type Noticed = Pick<Status, "attention" | "staleProcesses" | "processListSupported">;

/**
 * The sidebar row, or null for no row. The plugin stays out of the sidebar
 * until there is something to act on: an update waiting, a failure, a
 * mismatch, or an update that running processes have not picked up yet. The
 * row goes when the notice is dismissed or the thing is resolved.
 */
export function sidebarRow(status: Noticed | null): { title: string; icon: string } | null {
  const attention = status?.attention ?? null;
  if (status === null || attention === null) return null;
  switch (attention.kind) {
    case "updated": {
      const old = status.staleProcesses.length;
      // Everything is on the new version already: the update needs nothing from anyone.
      if (status.processListSupported && old === 0) return null;
      return { title: old === 0 ? "Claude Code updated" : `Claude Code updated · ${old} on an old version`, icon: "CircleCheck" };
    }
    case "update-available":
      return { title: "Claude Code update available", icon: "CircleArrowUp" };
    case "failed":
      return { title: "Claude Code update failing", icon: "TriangleAlert" };
    case "pin-mismatch":
    case "channel-mismatch":
      return { title: "Claude Code update needs a look", icon: "TriangleAlert" };
  }
}
