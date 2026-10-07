import type { ClaudeProcess } from "../shared/status";
import { extractVersion } from "../shared/version";
import type { Runner } from "./run";

const LIST_TIMEOUT_MS = 15_000;

/** `<pid> <weekday> <month> <day> <time> <year> <command and environment>`, as macOS `ps` prints `lstart`. */
const PS_LINE = /^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/;
const VERSION_PATH = /\/claude\/versions\/(\d+\.\d+\.\d+)/;
const AGENT_ID = /\sPASEO_AGENT_ID=(\S+)/;

interface Candidate {
  pid: number;
  startedAt: string | null;
  kind: ClaudeProcess["kind"];
  agentId: string | null;
  /** A version named on the command line, for a process whose binary can no longer be read. */
  versionHint: string | null;
}

function isClaudeCommand(command: string): boolean {
  const program = command.split(/\s+/, 1)[0] ?? "";
  return program === "claude" || program.endsWith("/claude") || VERSION_PATH.test(program);
}

/**
 * Picks the Claude Code processes out of `ps` output that carries each
 * process's environment. The environment holds secrets, so exactly one value
 * is read from it, the Paseo agent id, and the text is never kept or logged.
 */
export function parseProcessList(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const line of text.split("\n")) {
    const match = PS_LINE.exec(line);
    if (!match) continue;
    const command = match[3] ?? "";
    if (!isClaudeCommand(command)) continue;
    const started = Date.parse(match[2] ?? "");
    const agentId = AGENT_ID.exec(command)?.[1] ?? null;
    const isDaemon = /^\S+\s+daemon\s+run(\s|$)/.test(command);
    candidates.push({
      pid: Number(match[1]),
      startedAt: Number.isNaN(started) ? null : new Date(started).toISOString(),
      kind: agentId !== null ? "agent" : isDaemon ? "daemon" : "other",
      agentId,
      versionHint: VERSION_PATH.exec(command)?.[1] ?? null,
    });
  }
  return candidates;
}

/** Reads `lsof -Fpn` output: a `p<pid>` line, then `n<path>` lines for that process. */
export function parseOpenBinaries(text: string): Map<number, string> {
  const versions = new Map<number, string>();
  let pid: number | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
    } else if (line.startsWith("n") && pid !== null && !versions.has(pid)) {
      const version = VERSION_PATH.exec(line)?.[1];
      if (version !== undefined) versions.set(pid, version);
    }
  }
  return versions;
}

export interface ProcessList {
  supported: boolean;
  processes: ClaudeProcess[];
}

/**
 * The Claude Code processes running on this host and the version each was
 * started from. A process keeps the binary it started with, so after an update
 * these are the ones still on the old version. Reads only: `ps` for the
 * processes, `lsof` for the binary each has open. macOS only for now.
 */
export async function listClaudeProcesses(run: Runner, platform: NodeJS.Platform): Promise<ProcessList> {
  if (platform !== "darwin") return { supported: false, processes: [] };
  const listed = await run("ps", ["-axEww", "-o", "pid=,lstart=,command="], { timeoutMs: LIST_TIMEOUT_MS });
  if (listed.code !== 0) return { supported: false, processes: [] };
  const candidates = parseProcessList(listed.stdout);
  if (candidates.length === 0) return { supported: true, processes: [] };
  // lsof exits 1 when any one of the processes has gone; what it printed is still good.
  const open = await run("lsof", ["-a", "-p", candidates.map((candidate) => candidate.pid).join(","), "-d", "txt", "-Fpn"], {
    timeoutMs: LIST_TIMEOUT_MS,
  });
  const binaries = parseOpenBinaries(open.stdout);
  return {
    supported: true,
    processes: candidates.map((candidate) => ({
      pid: candidate.pid,
      version: binaries.get(candidate.pid) ?? candidate.versionHint,
      kind: candidate.kind,
      agentId: candidate.agentId,
      title: null,
      startedAt: candidate.startedAt,
    })),
  };
}

/** The processes on a version other than the installed one. One whose version is unknown is not called stale. */
export function staleProcesses(processes: readonly ClaudeProcess[], installed: string | null): ClaudeProcess[] {
  if (installed === null) return [];
  return processes.filter((process) => process.version !== null && extractVersion(process.version) !== installed);
}
