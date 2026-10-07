import { describe, expect, it } from "vitest";

import { activityView, resultOf, runEnded, type Pending } from "./activity";

const now = Date.parse("2026-10-07T10:00:12Z");
const startedAt = "2026-10-07T10:00:00.000Z";
const idle = { activity: null };
const running = (phase: "checking" | "installing", trigger: "schedule" | "manual") => ({ activity: { phase, trigger, startedAt } });
const pressed = (action: Pending["action"], secondsAgo = 2): Pending => ({ action, since: now - secondsAgo * 1000 });

describe("the buttons", () => {
  it("are plain and enabled when nothing is running", () => {
    expect(activityView(idle, null, now)).toEqual({ busy: false, active: null, checkLabel: "Check now", updateLabel: "Update now", line: null });
    expect(activityView(null, null, now).busy).toBe(false);
  });

  it("show the pressed button working before the host has answered", () => {
    expect(activityView(idle, pressed("check"), now)).toEqual({
      busy: true,
      active: "check",
      checkLabel: "Checking…",
      updateLabel: "Update now",
      line: "Checking for a new version… 2 s",
    });
    expect(activityView(idle, pressed("update"), now)).toMatchObject({ active: "update", checkLabel: "Check now", updateLabel: "Checking…" });
  });

  it("say the update is being installed once the host has reached the updater, timed from the host's start", () => {
    expect(activityView(running("installing", "manual"), pressed("update"), now)).toEqual({
      busy: true,
      active: "update",
      checkLabel: "Check now",
      updateLabel: "Updating Claude Code…",
      line: "Updating Claude Code… 12 s",
    });
  });

  it("follow a scheduled run this page did not start", () => {
    expect(activityView(running("checking", "schedule"), null, now)).toMatchObject({
      busy: true,
      active: "check",
      checkLabel: "Checking…",
      line: "Checking for a new version… 12 s (scheduled check)",
    });
    expect(activityView(running("installing", "schedule"), null, now)).toMatchObject({
      busy: true,
      active: "update",
      updateLabel: "Updating Claude Code…",
      line: "Updating Claude Code… 12 s (scheduled check)",
    });
  });

  it("follow a manual run from another window without calling it scheduled", () => {
    expect(activityView(running("checking", "manual"), null, now).line).toBe("Checking for a new version… 12 s");
  });

  it("move the spinner to Update now when a look this page asked for joined a run that installs", () => {
    expect(activityView(running("installing", "schedule"), pressed("check"), now)).toMatchObject({
      active: "update",
      checkLabel: "Check now",
      updateLabel: "Updating Claude Code…",
    });
  });

  it("stay busy while the host still says a run is going, after this page's own request ended", () => {
    expect(activityView(running("checking", "manual"), null, now).busy).toBe(true);
  });

  it("count minutes on a long run and never go below zero", () => {
    expect(activityView(running("installing", "manual"), null, now + 60_000).line).toBe("Updating Claude Code… 1 min 12 s");
    expect(activityView(running("checking", "manual"), null, now - 60_000).line).toBe("Checking for a new version… 0 s");
  });
});

describe("the result of a run", () => {
  it("is good, bad or news", () => {
    expect(resultOf({ lastOutcome: "up-to-date", lastMessage: "Claude Code 2.1.292 is up to date." }, now)).toEqual({
      outcome: "up-to-date",
      message: "Claude Code 2.1.292 is up to date.",
      tone: "good",
      at: now,
    });
    expect(resultOf({ lastOutcome: "updated", lastMessage: "Updated." }, now).tone).toBe("good");
    expect(resultOf({ lastOutcome: "failed", lastMessage: "offline" }, now).tone).toBe("bad");
    expect(resultOf({ lastOutcome: "update-available", lastMessage: "2.1.300 is available" }, now).tone).toBe("news");
    expect(resultOf({ lastOutcome: null, lastMessage: null }, now).message).toBe("Checked.");
  });

  it("is shown when a run seen running is seen to have ended, and only then", () => {
    expect(runEnded(running("installing", "schedule"), idle)).toBe(true);
    expect(runEnded(idle, idle)).toBe(false);
    expect(runEnded(null, idle)).toBe(false);
    expect(runEnded(running("checking", "schedule"), running("installing", "schedule"))).toBe(false);
  });
});
