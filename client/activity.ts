import { elapsed } from "../shared/format";
import type { Outcome, Status } from "../shared/status";

/** The two buttons: "Check now" only looks, "Update now" installs. */
export type Action = "check" | "update";

/** A button this page pressed and has not heard back from yet. */
export interface Pending {
  action: Action;
  since: number;
}

export interface ActivityView {
  /** Something is running, here or on the host: both buttons are off. */
  busy: boolean;
  /** The button that shows the spinner. */
  active: Action | null;
  checkLabel: string;
  updateLabel: string;
  /** What is running and for how long, for the page. Null when nothing is. */
  line: string | null;
}

export const CHECK_LABEL = "Check now";
export const UPDATE_LABEL = "Update now";

/**
 * What the buttons and the progress line say. The host's word comes first: a
 * check the schedule started, or one started from another window, shows here
 * the same as one this page started. The page's own press covers the moment
 * before the host has answered.
 */
export function activityView(status: Pick<Status, "activity"> | null, pending: Pending | null, now: number): ActivityView {
  const running = status?.activity ?? null;
  if (running === null && pending === null) {
    return { busy: false, active: null, checkLabel: CHECK_LABEL, updateLabel: UPDATE_LABEL, line: null };
  }
  const installing = running?.phase === "installing";
  const active: Action = installing ? "update" : (pending?.action ?? "check");
  const started = running === null ? Number.NaN : Date.parse(running.startedAt);
  const since = Number.isNaN(started) ? (pending?.since ?? now) : started;
  const doing = installing ? "Updating Claude Code" : "Checking for a new version";
  const who = pending === null && running?.trigger === "schedule" ? " (scheduled check)" : "";
  return {
    busy: true,
    active,
    checkLabel: active === "check" ? "Checking…" : CHECK_LABEL,
    updateLabel: active === "update" ? (installing ? "Updating Claude Code…" : "Checking…") : UPDATE_LABEL,
    line: `${doing}… ${elapsed(now - since)}${who}`,
  };
}

/** How the last run ended, shown on the page until the next one. */
export interface RunResult {
  outcome: Outcome | null;
  message: string;
  tone: "good" | "bad" | "news";
  at: number;
}

export function resultOf(status: Pick<Status, "lastOutcome" | "lastMessage">, at: number): RunResult {
  const outcome = status.lastOutcome;
  const tone = outcome === "failed" ? "bad" : outcome === "up-to-date" || outcome === "updated" || outcome === "pinned" || outcome === "pin-applied" ? "good" : "news";
  return { outcome, message: status.lastMessage ?? "Checked.", tone, at };
}

/**
 * A run this page did not start has just ended: the status said one was
 * running and now says none is. Its result is shown the same as a pressed
 * button's.
 */
export function runEnded(before: Pick<Status, "activity"> | null, after: Pick<Status, "activity">): boolean {
  return before !== null && before.activity !== null && after.activity === null;
}
