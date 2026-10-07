import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { historyEntrySchema, type Attention, type HistoryEntry, type Outcome } from "../shared/status";

/** What the plugin remembers between checks and across restarts: `state.json`. */
export interface State {
  claudePath: string | null;
  installedVersion: string | null;
  targetVersion: string | null;
  claudeChannel: string | null;
  lastCheckAt: string | null;
  lastOutcome: Outcome | null;
  lastMessage: string | null;
  consecutiveFailures: number;
  /** No scheduled check before this, after a failure. */
  retryNotBefore: string | null;
  previousVersion: string | null;
  attention: Attention | null;
  /** What was last announced, so the same news is not announced again. */
  announced: string | null;
  /** The failed install that was last told (`from:to`), so its retries are not told again. Absent in a 0.2.0 file, which reads as null. */
  failedInstall: string | null;
}

export const EMPTY_STATE: State = {
  claudePath: null,
  installedVersion: null,
  targetVersion: null,
  claudeChannel: null,
  lastCheckAt: null,
  lastOutcome: null,
  lastMessage: null,
  consecutiveFailures: 0,
  retryNotBefore: null,
  previousVersion: null,
  attention: null,
  announced: null,
  failedInstall: null,
};

export interface Store {
  readonly directory: string;
  readState(): Promise<State>;
  writeState(state: State): Promise<void>;
  appendHistory(entry: HistoryEntry): Promise<void>;
  readHistory(limit: number): Promise<HistoryEntry[]>;
  log(line: string): Promise<void>;
}

const LOG_ROTATE_BYTES = 512 * 1024;

/**
 * Files under one directory:
 * - `state.json`: the latest state, replaced whole.
 * - `history.jsonl`: one line per event worth keeping (an update, a failure, a notice).
 * - `plugin.log`: one line per check, rotated once to `plugin.log.1`.
 */
export function createFileStore(directory: string): Store {
  const statePath = join(directory, "state.json");
  const historyPath = join(directory, "history.jsonl");
  const logPath = join(directory, "plugin.log");

  async function ensureDirectory(): Promise<void> {
    await mkdir(directory, { recursive: true });
  }

  return {
    directory,
    async readState() {
      try {
        const parsed: unknown = JSON.parse(await readFile(statePath, "utf8"));
        if (parsed === null || typeof parsed !== "object") return { ...EMPTY_STATE };
        return { ...EMPTY_STATE, ...(parsed as Partial<State>) };
      } catch {
        // Missing or damaged: start again rather than stop checking.
        return { ...EMPTY_STATE };
      }
    },
    async writeState(state) {
      await ensureDirectory();
      const temporary = `${statePath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(temporary, statePath);
    },
    async appendHistory(entry) {
      await ensureDirectory();
      await appendFile(historyPath, `${JSON.stringify(entry)}\n`, "utf8");
    },
    async readHistory(limit) {
      let text: string;
      try {
        text = await readFile(historyPath, "utf8");
      } catch {
        return [];
      }
      const entries: HistoryEntry[] = [];
      for (const line of text.split("\n")) {
        if (line.trim() === "") continue;
        try {
          const parsed = historyEntrySchema.safeParse(JSON.parse(line));
          if (parsed.success) entries.push(parsed.data);
        } catch {
          // A torn line is skipped; the rest of the file still reads.
        }
      }
      return entries.slice(-limit).reverse();
    },
    async log(line) {
      await ensureDirectory();
      try {
        if ((await stat(logPath)).size > LOG_ROTATE_BYTES) await rename(logPath, `${logPath}.1`);
      } catch {
        // No log yet.
      }
      await appendFile(logPath, `${line}\n`, "utf8");
    },
  };
}
