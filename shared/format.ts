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

/** The longest row title: longer ones wrap onto a second line in the Paseo sidebar. */
export const SIDEBAR_TITLE_MAX = 20;

type Noticed = Pick<Status, "attention" | "autoInstall">;

/**
 * The sidebar row, or null for no row. There is a row only while the user has
 * something to do or to know about: an update that will not install itself, a
 * failure, a mismatch. An update that went in has none, whatever is still
 * running the version before: that is on the status page. The row goes when
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
