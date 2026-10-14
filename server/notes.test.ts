import { describe, expect, it } from "vitest";

import { CHANGELOG_SOURCE_URL, type ReleaseNotes } from "../shared/notes";
import { EMPTY_STATE } from "./store";
import { NOTES_RETRY_MS, notesRange, notesWanted, readReleaseNotes } from "./notes";

const NOW = Date.parse("2026-10-14T10:00:00Z");
const notes = (patch: Partial<ReleaseNotes> = {}): ReleaseNotes => ({
  from: "2.1.292",
  to: "2.1.300",
  versions: [],
  moreVersions: 0,
  fetchedAt: new Date(NOW).toISOString(),
  error: null,
  ...patch,
});

describe("notesRange", () => {
  it("is nothing before the first check", () => {
    expect(notesRange(EMPTY_STATE)).toBeNull();
  });

  it("is the update that is waiting, first", () => {
    const state = { ...EMPTY_STATE, installedVersion: "2.1.292", targetVersion: "2.1.300", previousVersion: "2.1.285" };
    expect(notesRange(state)).toEqual({ from: "2.1.292", to: "2.1.300" });
  });

  it("is the last update when nothing is waiting", () => {
    const state = { ...EMPTY_STATE, installedVersion: "2.1.300", targetVersion: "2.1.300", previousVersion: "2.1.292" };
    expect(notesRange(state)).toEqual({ from: "2.1.292", to: "2.1.300" });
  });

  it("is the installed version alone with no update behind it, or after a move back to an older one", () => {
    expect(notesRange({ ...EMPTY_STATE, installedVersion: "2.1.300", targetVersion: "2.1.300" })).toEqual({ from: null, to: "2.1.300" });
    const rolledBack = { ...EMPTY_STATE, installedVersion: "2.1.285", targetVersion: "2.1.285", previousVersion: "2.1.292" };
    expect(notesRange(rolledBack)).toEqual({ from: null, to: "2.1.285" });
  });
});

describe("notesWanted", () => {
  const range = { from: "2.1.292", to: "2.1.300" };
  it("asks when there are none or they are for another range", () => {
    expect(notesWanted(null, range, NOW)).toBe(true);
    expect(notesWanted(notes({ from: "2.1.285" }), range, NOW)).toBe(true);
  });

  it("keeps notes that were read", () => {
    expect(notesWanted(notes(), range, NOW + 30 * 86_400_000)).toBe(false);
  });

  it("asks again after a failure, but not before the wait is over", () => {
    const failed = notes({ error: "Could not read the release notes: HTTP 503" });
    expect(notesWanted(failed, range, NOW + NOTES_RETRY_MS - 1)).toBe(false);
    expect(notesWanted(failed, range, NOW + NOTES_RETRY_MS)).toBe(true);
  });
});

describe("readReleaseNotes", () => {
  const range = { from: "2.1.299", to: "2.1.300" };

  it("reads the changelog from its source", async () => {
    const asked: string[] = [];
    const read = await readReleaseNotes(
      async (url) => {
        asked.push(url);
        return "# Changelog\n\n## 2.1.300\n\n- Added a thing\n\n## 2.1.299\n\n- Older\n";
      },
      range,
      new Date(NOW),
    );
    expect(asked).toEqual([CHANGELOG_SOURCE_URL]);
    expect(read).toMatchObject({ error: null, versions: [{ version: "2.1.300", items: ["Added a thing"], moreItems: 0 }] });
  });

  it("answers with the reason instead of throwing when the changelog cannot be had", async () => {
    const offline = await readReleaseNotes(async () => Promise.reject(new Error("HTTP 503")), range, new Date(NOW));
    expect(offline).toEqual({ ...range, versions: [], moreVersions: 0, fetchedAt: new Date(NOW).toISOString(), error: "Could not read the release notes: HTTP 503" });
    const behind = await readReleaseNotes(async () => "## 2.1.299\n\n- Older\n", range, new Date(NOW));
    expect(behind.error).toBe("Could not read the release notes: the changelog has no notes for 2.1.300 yet");
  });
});
