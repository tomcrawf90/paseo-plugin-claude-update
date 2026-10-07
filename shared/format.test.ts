import { describe, expect, it } from "vitest";

import { elapsed, relativeTime, sidebarRow } from "./format";

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
  type Kind = "updated" | "failed" | "update-available" | "channel-mismatch" | "pin-mismatch";
  const process = (pid: number) => ({ pid, version: "2.1.285", kind: "agent" as const, agentId: null, title: null, startedAt: null });
  const status = (kind: Kind | null, old = 0, supported = true) => ({
    attention: kind === null ? null : { kind, message: "", at: at(0) },
    staleProcesses: Array.from({ length: old }, (_, index) => process(index + 1)),
    processListSupported: supported,
  });

  it("is absent when there is nothing to say", () => {
    expect(sidebarRow(null)).toBeNull();
    expect(sidebarRow(status(null))).toBeNull();
  });

  it("is absent for old processes alone: a dismissed notice stays dismissed", () => {
    expect(sidebarRow(status(null, 3))).toBeNull();
  });

  it("carries the news", () => {
    expect(sidebarRow(status("update-available"))).toEqual({ title: "Claude Code update available", icon: "CircleArrowUp" });
    expect(sidebarRow(status("failed"))).toEqual({ title: "Claude Code update failing", icon: "TriangleAlert" });
    expect(sidebarRow(status("channel-mismatch"))?.title).toBe("Claude Code update needs a look");
    expect(sidebarRow(status("pin-mismatch"))?.icon).toBe("TriangleAlert");
  });

  it("stays after an update only while something still runs the old version", () => {
    expect(sidebarRow(status("updated", 9))).toEqual({ title: "Claude Code updated · 9 on an old version", icon: "CircleCheck" });
    expect(sidebarRow(status("updated", 0))).toBeNull();
  });

  it("stays after an update where the processes cannot be listed", () => {
    expect(sidebarRow(status("updated", 0, false))).toEqual({ title: "Claude Code updated", icon: "CircleCheck" });
  });
});
