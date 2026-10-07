import { describe, expect, it } from "vitest";

import { elapsed, relativeTime, sidebarRow, SIDEBAR_TITLE_MAX } from "./format";

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

  it("is absent when there is nothing to say", () => {
    expect(sidebarRow(null)).toBeNull();
    expect(sidebarRow(status(null))).toBeNull();
  });

  it("is absent after an update, whatever is still running the version before", () => {
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
