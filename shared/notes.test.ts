import { describe, expect, it } from "vitest";

import { NOTES_ITEMS_SHOWN, NOTES_VERSIONS_SHOWN, parseChangelog, selectNotes } from "./notes";

/** The shape of the real file, trimmed. 2.1.297 and 2.1.298 have no entry, as in the real one. */
const CHANGELOG = `# Changelog

## 2.1.300

- Added \`virtualText\` to a mod's prompt decorations
- Fixed \`/autocompact\` warning about high token usage
  when you choose a smaller window

## 2.1.299

- Added OpenTelemetry attributes
  - a nested detail

### Fixes

- Fixed SessionEnd hooks

## 2.1.296

- Fixed \`claude --help\`

## 2.1.295

* Fixed the agents view

## 2.1.294

- Fixed a login
`;

const AT = "2026-10-14T10:00:00.000Z";
const sections = parseChangelog(CHANGELOG);

describe("parseChangelog", () => {
  it("reads each version with its list, joining wrapped lines and keeping items under smaller headings", () => {
    expect(sections.map((section) => section.version)).toEqual(["2.1.300", "2.1.299", "2.1.296", "2.1.295", "2.1.294"]);
    expect(sections[0]?.items).toEqual([
      "Added `virtualText` to a mod's prompt decorations",
      "Fixed `/autocompact` warning about high token usage when you choose a smaller window",
    ]);
    expect(sections[1]?.items).toEqual(["Added OpenTelemetry attributes", "a nested detail", "Fixed SessionEnd hooks"]);
    expect(sections[3]?.items).toEqual(["Fixed the agents view"]);
  });

  it("finds nothing in text that is not a changelog", () => {
    expect(parseChangelog("<!doctype html><html>Not found</html>")).toEqual([]);
    expect(parseChangelog("## Unreleased\n\n- something\n")).toEqual([]);
  });

  it("reads Windows line endings", () => {
    expect(parseChangelog("## 2.1.300\r\n\r\n- Added a thing\r\n")).toEqual([{ version: "2.1.300", items: ["Added a thing"] }]);
  });
});

describe("selectNotes", () => {
  it("takes the versions after `from` up to `to`, newest first, skipping numbers with no entry", () => {
    const notes = selectNotes(sections, { from: "2.1.295", to: "2.1.300" }, AT);
    expect(notes.versions.map((version) => version.version)).toEqual(["2.1.300", "2.1.299", "2.1.296"]);
    expect(notes).toMatchObject({ from: "2.1.295", to: "2.1.300", moreVersions: 0, fetchedAt: AT, error: null });
  });

  it("shows the newest few in full and counts the rest", () => {
    const notes = selectNotes(sections, { from: "2.1.200", to: "2.1.300" }, AT);
    expect(notes.versions).toHaveLength(NOTES_VERSIONS_SHOWN);
    expect(notes.moreVersions).toBe(5 - NOTES_VERSIONS_SHOWN);
  });

  it("cuts a long release and counts what was cut", () => {
    const long = [{ version: "2.1.300", items: Array.from({ length: 40 }, (_, index) => `change ${index}`) }];
    const [version] = selectNotes(long, { from: "2.1.299", to: "2.1.300" }, AT).versions;
    expect(version?.items).toHaveLength(NOTES_ITEMS_SHOWN);
    expect(version?.items[0]).toBe("change 0");
    expect(version?.moreItems).toBe(40 - NOTES_ITEMS_SHOWN);
  });

  it("without `from`, shows the newest entry at or below `to`", () => {
    expect(selectNotes(sections, { from: null, to: "2.1.296" }, AT).versions.map((version) => version.version)).toEqual(["2.1.296"]);
    // 2.1.298 was never in the changelog: its notes are 2.1.296's.
    expect(selectNotes(sections, { from: null, to: "2.1.298" }, AT).versions.map((version) => version.version)).toEqual(["2.1.296"]);
  });

  it("refuses when the changelog has not caught up with `to`, or is empty", () => {
    expect(() => selectNotes(sections, { from: "2.1.300", to: "2.1.301" }, AT)).toThrow("no notes for 2.1.301 yet");
    expect(() => selectNotes([], { from: null, to: "2.1.300" }, AT)).toThrow("held no versions");
  });
});
