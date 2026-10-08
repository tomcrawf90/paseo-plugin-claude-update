import { describe, expect, it } from "vitest";

import {
  absoluteTime,
  bothTimes,
  elapsed,
  lastCheckText,
  lastResult,
  lastUpdateText,
  nextCheckText,
  QUIET_ROW,
  relativeTime,
  sidebarRow,
  SIDEBAR_TITLE_MAX,
} from "./format";
import type { HistoryEntry } from "./status";

const now = Date.parse("2026-10-07T10:00:00Z");
const at = (seconds: number) => new Date(now + seconds * 1000).toISOString();

describe("relativeTime", () => {
  it("reads naturally in both directions", () => {
    expect(relativeTime(null, now)).toBe("never");
    expect(relativeTime(at(-20), now)).toBe("just now");
    expect(relativeTime(at(-300), now)).toBe("5 min ago");
    expect(relativeTime(at(3 * 3600), now)).toBe("in 3 h");
    expect(relativeTime(at(-2 * 86_400), now)).toBe("2 d ago");
    expect(relativeTime("nonsense", now)).toBe("unknown");
  });
});

describe("absoluteTime", () => {
  // `now` is Wednesday 7 October 2026, 10:00 UTC. An offset of 60 is British Summer Time.
  it("names today, yesterday and tomorrow, and the date beyond them", () => {
    expect(absoluteTime(null, now, 0)).toBe("never");
    expect(absoluteTime("nonsense", now, 0)).toBe("unknown");
    expect(absoluteTime(at(-300), now, 0)).toBe("today at 09:55");
    expect(absoluteTime(at(4 * 3600), now, 0)).toBe("today at 14:00");
    expect(absoluteTime(at(-14 * 3600), now, 0)).toBe("yesterday at 20:00");
    expect(absoluteTime(at(20 * 3600), now, 0)).toBe("tomorrow at 06:00");
    expect(absoluteTime("2026-10-02T08:05:00Z", now, 0)).toBe("Fri 2 Oct at 08:05");
    expect(absoluteTime("2025-12-31T23:59:00Z", now, 0)).toBe("Wed 31 Dec 2025 at 23:59");
  });

  it("is in the reader's time zone, which decides the day as well as the hour", () => {
    expect(absoluteTime("2026-10-07T07:09:09.848Z", now, 60)).toBe("today at 08:09");
    // 23:30 UTC on the 6th is half past midnight on the 7th in BST, and still the 6th in New York.
    expect(absoluteTime("2026-10-06T23:30:00Z", now, 60)).toBe("today at 00:30");
    expect(absoluteTime("2026-10-06T23:30:00Z", now, 0)).toBe("yesterday at 23:30");
    expect(absoluteTime("2026-10-06T23:30:00Z", now, -240)).toBe("yesterday at 19:30");
    expect(absoluteTime("2026-10-07T01:00:00Z", now, -240)).toBe("yesterday at 21:00");
  });

  it("uses this machine's zone when none is given", () => {
    const local = new Date(now - 300_000);
    const clock = `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`;
    expect(absoluteTime(at(-300), now)).toMatch(new RegExp(`^(today|yesterday|tomorrow) at ${clock}$`));
  });
});

describe("the check lines", () => {
  it("give the last check both ways round", () => {
    expect(bothTimes(at(-300), now, 60)).toBe("5 min ago · today at 10:55");
    expect(bothTimes(null, now, 60)).toBe("never");
    expect(bothTimes("nonsense", now, 60)).toBe("unknown");
    expect(lastCheckText({ lastCheckAt: at(-2 * 3600) }, now, 60)).toBe("2 h ago · today at 09:00");
    expect(lastCheckText({ lastCheckAt: null }, now, 60)).toBe("not checked yet");
  });

  it("say when the schedule checks next, or why it will not", () => {
    expect(nextCheckText({ scheduled: true, nextCheckAt: at(50 * 60) }, now, 60)).toBe("in 50 min · today at 11:50");
    expect(nextCheckText({ scheduled: true, nextCheckAt: at(20 * 3600) }, now, 60)).toBe("in 20 h · tomorrow at 07:00");
    // Before the first check there is no time yet; the first one is about 30 seconds after the plugin starts.
    expect(nextCheckText({ scheduled: true, nextCheckAt: null }, now, 60)).toBe("shortly");
    // Switched off, before the first check or after it: never "shortly".
    expect(nextCheckText({ scheduled: false, nextCheckAt: null }, now, 60)).toBe("off");
    expect(nextCheckText({ scheduled: false, nextCheckAt: at(50 * 60) }, now, 60)).toBe("off");
    // The time has come and the next tick takes it: not "2 min ago".
    expect(nextCheckText({ scheduled: true, nextCheckAt: at(-120) }, now, 60)).toBe("due now");
    expect(nextCheckText({ scheduled: true, nextCheckAt: at(0) }, now, 60)).toBe("due now");
    expect(nextCheckText({ scheduled: true, nextCheckAt: "nonsense" }, now, 60)).toBe("unknown");
  });

  it("say how the last check ended, with its own sentence", () => {
    const result = (lastOutcome: Parameters<typeof lastResult>[0]["lastOutcome"], lastMessage: string | null, consecutiveFailures = 0) =>
      lastResult({ lastOutcome, lastMessage, consecutiveFailures });
    expect(result(null, null)).toEqual({ label: "none yet", detail: null });
    expect(result("up-to-date", "Claude Code 2.1.294 is up to date (latest is 2.1.294).")).toEqual({
      label: "Up to date",
      detail: "Claude Code 2.1.294 is up to date (latest is 2.1.294).",
    });
    expect(result("updated", "Updated Claude Code from 2.1.293 to 2.1.294.")).toEqual({
      label: "Updated",
      detail: "Updated Claude Code from 2.1.293 to 2.1.294.",
    });
    expect(result("failed", "The release pointer could not be read: HTTP 503", 1)).toEqual({
      label: "Failed",
      detail: "The release pointer could not be read: HTTP 503",
    });
    expect(result("failed", "The release pointer could not be read: HTTP 503", 3).label).toBe("Failed (3 in a row)");
    expect(result("update-available", "Claude Code 2.1.300 is available.").label).toBe("Update available");
  });

  it("find the last time the version changed, behind checks that changed nothing", () => {
    const entry = (outcome: HistoryEntry["outcome"], seconds: number, from: string | null, to: string | null): HistoryEntry => ({
      at: at(seconds),
      trigger: "schedule",
      outcome,
      from,
      to,
      target: to,
      message: "",
    });
    const last = (history: HistoryEntry[], previousVersion: string | null = null, installedVersion: string | null = "2.1.294") =>
      lastUpdateText({ history, previousVersion, installedVersion }, now, 60);
    expect(last([])).toBeNull();
    expect(last([entry("update-available", -60, "2.1.293", null), entry("failed", -120, "2.1.293", null)])).toBeNull();
    // The update has gone from the entries shown, but the state still knows the version before.
    expect(last([entry("failed", -120, "2.1.294", null)], "2.1.293")).toBe("2.1.293 → 2.1.294, before the history below");
    expect(last([], "2.1.293", null)).toBeNull();
    // Newest first, as the status gives it.
    const history = [
      entry("failed", -600, "2.1.294", null),
      entry("updated", -2 * 3600, "2.1.293", "2.1.294"),
      entry("updated", -15 * 3600, "2.1.292", "2.1.293"),
    ];
    expect(last(history, "2.1.293")).toBe("2.1.293 → 2.1.294, 2 h ago · today at 09:00");
    expect(last([entry("pin-applied", -26 * 3600, "2.1.294", "2.1.285")])).toBe("2.1.294 → 2.1.285, 1 d ago · yesterday at 09:00");
    expect(last([entry("updated", -3600, null, "2.1.294")])).toBe("to 2.1.294, 1 h ago · today at 10:00");
  });
});

describe("elapsed", () => {
  it("counts seconds, then minutes and seconds", () => {
    expect(elapsed(-50)).toBe("0 s");
    expect(elapsed(8_900)).toBe("8 s");
    expect(elapsed(65_000)).toBe("1 min 05 s");
  });
});

describe("the sidebar row", () => {
  const KINDS = ["updated", "failed", "update-available", "channel-mismatch", "pin-mismatch"] as const;
  type Kind = (typeof KINDS)[number];
  const status = (kind: Kind | null, autoInstall = false) => ({
    attention: kind === null ? null : { kind, message: "", at: at(0) },
    autoInstall,
  });

  it("has a plain title for when there is no news, short enough for one line and silent on the state", () => {
    expect(QUIET_ROW).toEqual({ title: "Claude Code updates", icon: "RefreshCw" });
    expect(QUIET_ROW.title.length).toBeLessThanOrEqual(SIDEBAR_TITLE_MAX);
    expect(QUIET_ROW.title).not.toMatch(/updated|up to date|old version|ago/i);
  });

  it("has no news when there is nothing to say", () => {
    expect(sidebarRow(null)).toBeNull();
    expect(sidebarRow(status(null))).toBeNull();
  });

  it("has no news after an update, whatever is still running the version before", () => {
    // The rule is not given the process list at all: old processes cannot bring a row.
    const process = { pid: 1, version: "2.1.285", kind: "agent" as const, agentId: null, title: null, startedAt: null };
    const six = { ...status("updated"), staleProcesses: Array.from({ length: 6 }, () => process), processListSupported: true };
    const unlisted = { ...status("updated"), staleProcesses: [], processListSupported: false };
    const dismissed = { ...status(null), staleProcesses: [process, process, process], processListSupported: true };
    for (const each of [status("updated"), status("updated", true), six, unlisted, dismissed]) expect(sidebarRow(each)).toBeNull();
  });

  it("says an update is ready only while it will not install itself", () => {
    expect(sidebarRow(status("update-available"))).toEqual({ title: "Claude update ready", icon: "CircleArrowUp" });
    expect(sidebarRow(status("update-available", true))).toBeNull();
    expect(sidebarRow(status("pin-mismatch"))).toEqual({ title: "Claude pin mismatch", icon: "TriangleAlert" });
    expect(sidebarRow(status("pin-mismatch", true))).toBeNull();
  });

  it("says what the schedule cannot put right, auto-update on or off", () => {
    for (const autoInstall of [false, true]) {
      expect(sidebarRow(status("failed", autoInstall))).toEqual({ title: "Claude update failed", icon: "TriangleAlert" });
      expect(sidebarRow(status("channel-mismatch", autoInstall))).toEqual({ title: "Claude channel issue", icon: "TriangleAlert" });
    }
  });

  it("never has a title long enough to wrap, and never says that all is well", () => {
    expect(SIDEBAR_TITLE_MAX).toBe(20);
    const titles = KINDS.flatMap((kind) => [false, true].map((autoInstall) => sidebarRow(status(kind, autoInstall))?.title ?? null)).filter(
      (title) => title !== null,
    );
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      expect(title.length).toBeLessThanOrEqual(SIDEBAR_TITLE_MAX);
      expect(title).not.toMatch(/updated|up to date|old version/i);
    }
  });
});
