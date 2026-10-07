import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export const PLUGIN_ID = "claude-update";

export function paseoHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.PASEO_HOME ?? join(homedir(), ".paseo");
}

/** `$PASEO_HOME/plugin-data/claude-update/`, which Paseo never deletes on update or removal. */
export function dataDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return join(paseoHome(env), "plugin-data", PLUGIN_ID);
}

export interface FindClaudeInput {
  /** The path from settings; empty means look for it. */
  configured: string;
  home: string;
  env: NodeJS.ProcessEnv;
  isExecutable(path: string): Promise<boolean>;
}

/**
 * The `claude` launcher to run: the configured path, else the native
 * installer's `~/.local/bin/claude`, else the first one on `PATH`. The daemon
 * is often started by the desktop app with a short `PATH`, which is why the
 * native location is tried before it.
 */
export async function findClaude(input: FindClaudeInput): Promise<string | null> {
  const configured = input.configured.trim();
  if (configured !== "") return (await input.isExecutable(configured)) ? configured : null;
  const candidates = [join(input.home, ".local", "bin", "claude")];
  for (const directory of (input.env.PATH ?? "").split(delimiter)) {
    if (directory !== "") candidates.push(join(directory, "claude"));
  }
  for (const candidate of candidates) {
    if (await input.isExecutable(candidate)) return candidate;
  }
  return null;
}
