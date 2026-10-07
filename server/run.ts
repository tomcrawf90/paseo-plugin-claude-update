import { execFile } from "node:child_process";

export interface RunResult {
  /** The exit code, or null when the process did not exit by itself. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** Why the process could not be started or was stopped; null when it ran to an exit code. */
  error: string | null;
  timedOut: boolean;
}

export interface RunOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export type Runner = (file: string, args: readonly string[], options?: RunOptions) => Promise<RunResult>;

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Runs one program without a shell and with no terminal: stdin is closed at
 * once, so a program that asks a question gets end-of-file instead of waiting.
 * Never rejects; every way of failing is in the result.
 */
export const runCommand: Runner = (file, args, options = {}) =>
  new Promise((resolve) => {
    try {
      const child = execFile(
        file,
        [...args],
        { timeout: options.timeoutMs ?? 0, maxBuffer: MAX_OUTPUT_BYTES, env: options.env, windowsHide: true },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ code: 0, stdout, stderr, error: null, timedOut: false });
            return;
          }
          const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
          if (typeof failure.code === "number") {
            resolve({ code: failure.code, stdout, stderr, error: null, timedOut: false });
            return;
          }
          const timedOut = failure.killed === true;
          resolve({ code: null, stdout, stderr, error: timedOut ? "timed out" : failure.message, timedOut });
        },
      );
      child.stdin?.end();
    } catch (error) {
      // Starting a process can throw outright, not only fail later: a sandbox
      // that forbids it (EPERM) does, and so does a malformed path.
      resolve({ code: null, stdout: "", stderr: "", error: error instanceof Error ? error.message : String(error), timedOut: false });
    }
  });
