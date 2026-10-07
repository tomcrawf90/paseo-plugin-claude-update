import { describe, expect, it } from "vitest";

import { relativeTime, sidebarIcon, sidebarTitle } from "./format";

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

describe("the sidebar row", () => {
  const notice = (kind: "updated" | "failed" | "update-available" | "channel-mismatch") => ({
    attention: { kind, message: "", at: at(0) },
  });
  it("is plain when there is nothing to say", () => {
    expect(sidebarTitle(null)).toBe("Claude Code updates");
    expect(sidebarTitle({ attention: null })).toBe("Claude Code updates");
    expect(sidebarIcon(null)).toBe("RefreshCw");
    expect(sidebarIcon({ attention: null })).toBe("RefreshCw");
  });
  it("carries the news", () => {
    expect(sidebarTitle(notice("updated"))).toBe("Claude Code updated");
    expect(sidebarTitle(notice("failed"))).toBe("Claude Code update failing");
    expect(sidebarIcon(notice("failed"))).toBe("TriangleAlert");
    expect(sidebarIcon(notice("update-available"))).toBe("CircleArrowUp");
    expect(sidebarTitle(notice("channel-mismatch"))).toBe("Claude Code update needs a look");
  });
});
