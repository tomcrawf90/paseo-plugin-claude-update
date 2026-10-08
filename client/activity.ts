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
/** Under the buttons, so that pressing "Check now" is known to be safe. */
export const CHECK_NOW_HINT = "Check now only looks and installs nothing. Update now installs a newer version if there is one.";

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
 * A run this screen did not start has ended since the status was last read:
 * the status said one was running and now says none is, or the time of the
 * last check has moved with none running (a run that began and ended between
 * two reads, such as one pressed on the other screen). Its result is shown
 * the same as a pressed button's.
 */
export function runEnded(before: Pick<Status, "activity" | "lastCheckAt"> | null, after: Pick<Status, "activity" | "lastCheckAt">): boolean {
  if (before === null || after.activity !== null) return false;
  return before.activity !== null || before.lastCheckAt !== after.lastCheckAt;
}

/** What each button asks the host for: only "Update now" may install. */
export function checkInput(action: Action): { apply: boolean } {
  return { apply: action === "update" };
}
