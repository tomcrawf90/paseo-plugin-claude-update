import { CHANGELOG_SOURCE_URL, parseChangelog, selectNotes, type NotesRange, type ReleaseNotes } from "../shared/notes";
import { compareVersions } from "../shared/version";
import type { FetchText } from "./claude";
import type { State } from "./store";

/** After notes could not be read, the wait before asking again. */
export const NOTES_RETRY_MS = 60 * 60_000;

/**
 * Whose notes the status page shows: an update that is waiting (what
 * "Update now" would bring), else the last update, else the installed
 * version alone. Null before the first check.
 */
export function notesRange(state: State): NotesRange | null {
  const installed = state.installedVersion;
  if (installed === null) return null;
  if (state.targetVersion !== null && compareVersions(state.targetVersion, installed) > 0) {
    return { from: installed, to: state.targetVersion };
  }
  if (state.previousVersion !== null && compareVersions(state.previousVersion, installed) < 0) {
    return { from: state.previousVersion, to: installed };
  }
  return { from: null, to: installed };
}

/** True when the notes on disk are for another range, or could not be read and the wait is over. */
export function notesWanted(notes: ReleaseNotes | null, range: NotesRange, now: number): boolean {
  if (notes === null || notes.from !== range.from || notes.to !== range.to) return true;
  if (notes.error === null) return false;
  const fetched = Date.parse(notes.fetchedAt);
  return Number.isNaN(fetched) || now - fetched >= NOTES_RETRY_MS;
}

/**
 * Reads the changelog and picks the range out of it. Never throws: when the
 * notes cannot be had, the answer says why and the page still links to them.
 */
export async function readReleaseNotes(fetchText: FetchText, range: NotesRange, now: Date): Promise<ReleaseNotes> {
  const fetchedAt = now.toISOString();
  try {
    return selectNotes(parseChangelog(await fetchText(CHANGELOG_SOURCE_URL)), range, fetchedAt);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { from: range.from, to: range.to, versions: [], moreVersions: 0, fetchedAt, error: `Could not read the release notes: ${reason}` };
  }
}
