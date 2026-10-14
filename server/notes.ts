import { CHANGELOG_SOURCE_URL, parseChangelog, selectNotes, type NotesRange, type ReleaseNotes } from "../shared/notes";
import { compareVersions } from "../shared/version";
import type { HistoryEntry } from "../shared/status";
import type { FetchText } from "./claude";
import type { State } from "./store";

/** After notes could not be read, the wait before asking again. */
export const NOTES_RETRY_MS = 60 * 60_000;

/**
 * Whose notes the status page shows: an update that is waiting (what
 * "Update now" would bring), else the last update this plugin made, while it
 * is still the installed version, else the installed version alone. Null
 * before the first check. `history` is newest first.
 */
export function notesRange(state: State, history: readonly HistoryEntry[]): NotesRange | null {
  const installed = state.installedVersion;
  if (installed === null) return null;
  if (state.targetVersion !== null && compareVersions(state.targetVersion, installed) > 0) {
    return { from: installed, to: state.targetVersion };
  }
  // Claude Code can also update itself from a terminal; then the last update here is not what is installed.
  const last = history.find((entry) => entry.outcome === "updated" || entry.outcome === "pin-applied");
  if (last?.from != null && last.to === installed && compareVersions(last.from, installed) < 0) {
    return { from: last.from, to: installed };
  }
  return { from: null, to: installed };
}

/** The notes when they are for `range`, else null: notes for another range are not shown. */
export function notesFor(notes: ReleaseNotes | null, range: NotesRange | null): ReleaseNotes | null {
  return notes !== null && range !== null && notes.from === range.from && notes.to === range.to ? notes : null;
}

/** True when the notes on disk are for another range, or could not be read and the wait is over. */
export function notesWanted(notes: ReleaseNotes | null, range: NotesRange, now: number): boolean {
  const current = notesFor(notes, range);
  if (current === null) return true;
  if (current.error === null) return false;
  const fetched = Date.parse(current.fetchedAt);
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
