import { z } from "zod";

import { compareVersions, isExactVersion } from "./version";

/**
 * Claude Code's release notes. The source is the changelog in Anthropic's
 * public repository, plain Markdown: `## 2.1.300` and then `- ` lines. The
 * page people are sent to is the documentation's changelog, which is built
 * from that file and also has the release dates.
 */
export const CHANGELOG_SOURCE_URL = "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md";
export const RELEASE_NOTES_URL = "https://code.claude.com/docs/en/changelog";

/** The newest versions shown in full; older ones in the range are counted. */
export const NOTES_VERSIONS_SHOWN = 3;
/** One release can list well over a hundred changes; the rest are counted and are on the full page. */
export const NOTES_ITEMS_SHOWN = 12;

export const releaseNotesSchema = z.object({
  /** The version the range starts after; null for the notes of `to` alone. */
  from: z.string().nullable(),
  to: z.string(),
  /** Newest first. Versions with no entry in the changelog (some are never released) are not listed. */
  versions: z.array(z.object({ version: z.string(), items: z.array(z.string()), moreItems: z.number() })),
  /** Versions in the range that are not shown. */
  moreVersions: z.number(),
  fetchedAt: z.string(),
  /** Why the notes could not be read; the link is shown either way. */
  error: z.string().nullable(),
});
export type ReleaseNotes = z.infer<typeof releaseNotesSchema>;

export interface ChangelogSection {
  version: string;
  items: string[];
}

/**
 * The sections of the changelog, in file order. A heading that is not an
 * exact version ends the section before it and starts none; a line that is
 * not a list item continues the item above it.
 */
export function parseChangelog(text: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^#{1,2}\s/.test(line)) {
      const heading = line.replace(/^#+\s*/, "").split(/\s/)[0] ?? "";
      current = line.startsWith("## ") && isExactVersion(heading) ? { version: heading, items: [] } : null;
      if (current !== null) sections.push(current);
      continue;
    }
    // A smaller heading inside a version (none so far) groups its items; they stay with the version.
    if (line.startsWith("#")) continue;
    if (current === null || line === "") continue;
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) current.items.push(item[1] ?? "");
    else if (current.items.length > 0) current.items[current.items.length - 1] += ` ${line}`;
  }
  return sections;
}

export type NotesRange = { from: string | null; to: string };

/**
 * The notes for the versions after `from` up to and including `to`, newest
 * first and cut to length. With no `from`, the newest entry at or below `to`.
 * Throws when the changelog has nothing for the range: either it has not
 * caught up with `to` yet, or it is not the changelog.
 */
export function selectNotes(sections: ChangelogSection[], range: NotesRange, fetchedAt: string): ReleaseNotes {
  if (sections.length === 0) throw new Error("the changelog held no versions");
  const newest = sections.reduce((top, section) => (compareVersions(section.version, top) > 0 ? section.version : top), "0.0.0");
  if (compareVersions(newest, range.to) < 0) throw new Error(`the changelog has no notes for ${range.to} yet`);
  const inRange = sections
    .filter((section) => compareVersions(section.version, range.to) <= 0)
    .filter((section) => range.from === null || compareVersions(section.version, range.from) > 0)
    .sort((a, b) => compareVersions(b.version, a.version));
  const wanted = range.from === null ? inRange.slice(0, 1) : inRange;
  const shown = wanted.slice(0, NOTES_VERSIONS_SHOWN);
  return {
    from: range.from,
    to: range.to,
    versions: shown.map((section) => ({
      version: section.version,
      items: section.items.slice(0, NOTES_ITEMS_SHOWN),
      moreItems: Math.max(0, section.items.length - NOTES_ITEMS_SHOWN),
    })),
    moreVersions: wanted.length - shown.length,
    fetchedAt,
    error: null,
  };
}
