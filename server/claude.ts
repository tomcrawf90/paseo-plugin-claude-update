import { join } from "node:path";

import type { Channel } from "../shared/settings";
import { extractVersion, isExactVersion } from "../shared/version";
import type { RunResult, Runner } from "./run";

export const RELEASES_URL = "https://downloads.claude.ai/claude-code-releases";

const VERSION_TIMEOUT_MS = 30_000;
/** A release is a download of a few hundred megabytes; give a slow line time. */
export const UPDATE_TIMEOUT_MS = 15 * 60_000;
const OUTPUT_TAIL = 1_200;

/**
 * Variables a running Claude Code session sets for its children. The daemon
 * does not normally have them, but a daemon started from inside a session
 * would pass them on, and the CLI must judge its own install, not that one.
 */
const SESSION_VARIABLES = ["CLAUDE_CODE_EXECPATH", "CLAUDE_CODE_ENTRYPOINT", "CLAUDECODE"];

export function claudeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned = { ...env };
  for (const name of SESSION_VARIABLES) delete cleaned[name];
  return cleaned;
}

/** The end of a command's output, for a log line or an error message. */
export function outputTail(result: RunResult): string {
  const text = `${result.stdout}\n${result.stderr}`.trim();
  return text.length > OUTPUT_TAIL ? `…${text.slice(-OUTPUT_TAIL)}` : text;
}

export function describeFailure(command: string, result: RunResult): string {
  const how = result.error ?? `exit code ${result.code}`;
  const tail = outputTail(result);
  return tail === "" ? `${command}: ${how}` : `${command}: ${how}: ${tail}`;
}

export type VersionRead = { version: string } | { error: string };

/** Asks the launcher which version it is: `claude --version` prints `2.1.285 (Claude Code)`. */
export async function readInstalledVersion(run: Runner, claudePath: string, env: NodeJS.ProcessEnv): Promise<VersionRead> {
  const result = await run(claudePath, ["--version"], { timeoutMs: VERSION_TIMEOUT_MS, env: claudeEnvironment(env) });
  if (result.code !== 0) return { error: describeFailure("claude --version", result) };
  const version = extractVersion(result.stdout);
  return version === null ? { error: `claude --version printed no version: ${outputTail(result)}` } : { version };
}

export type FetchText = (url: string) => Promise<string>;

/**
 * The version a channel points at, from the public pointer the CLI itself
 * reads. A read, never a download: installing stays with the CLI, which
 * verifies the signed release manifest.
 */
export async function readChannelVersion(fetchText: FetchText, channel: Channel): Promise<string> {
  const text = (await fetchText(`${RELEASES_URL}/${channel}`)).trim();
  if (!isExactVersion(text)) throw new Error(`the ${channel} channel pointer did not hold a version`);
  return text;
}

/**
 * Claude Code's own channel, which decides what `claude update` installs:
 * `autoUpdatesChannel` in `~/.claude/settings.json`, `latest` when unset.
 * Read only; null when the file is there but cannot be understood.
 */
export async function readClaudeChannel(
  readFile: (path: string) => Promise<string | null>,
  home: string,
): Promise<string | null> {
  const text = await readFile(join(home, ".claude", "settings.json"));
  if (text === null) return "latest";
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") return null;
    const channel = (parsed as Record<string, unknown>).autoUpdatesChannel;
    if (channel === undefined) return "latest";
    return typeof channel === "string" ? channel : null;
  } catch {
    return null;
  }
}

/** `claude update`: the supported updater. It takes its own lock and keeps versions in use. */
export function runUpdate(run: Runner, claudePath: string, env: NodeJS.ProcessEnv): Promise<RunResult> {
  return run(claudePath, ["update"], { timeoutMs: UPDATE_TIMEOUT_MS, env: claudeEnvironment(env) });
}

/** `claude install <version>`: the supported way to move to one exact version, used for a pin. */
export function runInstall(run: Runner, claudePath: string, version: string, env: NodeJS.ProcessEnv): Promise<RunResult> {
  return run(claudePath, ["install", version], { timeoutMs: UPDATE_TIMEOUT_MS, env: claudeEnvironment(env) });
}
