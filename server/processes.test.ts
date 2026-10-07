import { describe, expect, it } from "vitest";

import { exit, ok } from "../test/support";
import { listClaudeProcesses, parseOpenBinaries, parseProcessList, staleProcesses } from "./processes";

const PS = [
  " 4086 Tue Oct  6 19:46:36 2026     /Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=utility",
  " 4377 Tue Oct  6 14:49:39 2026     /Users/u/.local/bin/claude --output-format stream-json --model claude-opus-5-5 PATH=/usr/bin PASEO_AGENT_ID=4bc7e7b3-5ea2 API_KEY=do-not-leak",
  "38507 Tue Sep 29 22:31:03 2026     /Users/u/.local/bin/claude daemon run --json-path /Users/u/.claude/daemon.json HOME=/Users/u",
  "74223 Sat Sep 12 16:34:34 2026     claude bg-pty-host --bg-pty-host /tmp/x.sock 200 50 -- /Users/u/.local/share/claude/versions/2.1.269 --bg-spare /tmp/y",
  "  999 Wed Oct  7 11:00:00 2026     /usr/bin/vim /Users/u/notes/claude.md",
  "garbage line",
].join("\n");

describe("parseProcessList", () => {
  it("keeps Claude Code processes and nothing else", () => {
    expect(parseProcessList(PS).map((candidate) => candidate.pid)).toEqual([4377, 38507, 74223]);
  });
  it("classifies each and reads only the agent id from the environment", () => {
    const [agent, daemon, other] = parseProcessList(PS);
    expect(agent).toMatchObject({ kind: "agent", agentId: "4bc7e7b3-5ea2", versionHint: null });
    expect(daemon).toMatchObject({ kind: "daemon", agentId: null });
    expect(other).toMatchObject({ kind: "other", versionHint: "2.1.269" });
    expect(JSON.stringify(parseProcessList(PS))).not.toContain("do-not-leak");
    expect(agent?.startedAt).toBe(new Date("Tue Oct 6 14:49:39 2026").toISOString());
  });
});

describe("parseOpenBinaries", () => {
  it("maps each pid to the version of the binary it has open", () => {
    const text = "p4377\nn/Users/u/.local/share/claude/versions/2.1.285\nn/usr/lib/dyld\np38507\nn/Users/u/.local/share/claude/versions/2.1.280\np74223\n";
    expect([...parseOpenBinaries(text)]).toEqual([
      [4377, "2.1.285"],
      [38507, "2.1.280"],
    ]);
  });
});

describe("listClaudeProcesses", () => {
  it("joins ps and lsof, falling back to the version on the command line", async () => {
    const calls: string[] = [];
    const listed = await listClaudeProcesses(async (file, args) => {
      calls.push(`${file} ${args.join(" ")}`);
      if (file === "ps") return ok(PS);
      // One process had gone: lsof exits 1 and still prints the others.
      return exit(1, "p4377\nn/Users/u/.local/share/claude/versions/2.1.285\n");
    }, "darwin");
    expect(listed.supported).toBe(true);
    expect(listed.processes.map((process) => [process.pid, process.version])).toEqual([
      [4377, "2.1.285"],
      [38507, null],
      [74223, "2.1.269"],
    ]);
    expect(calls[1]).toBe("lsof -a -p 4377,38507,74223 -d txt -Fpn");
  });
  it("is unsupported off macOS and when ps fails", async () => {
    expect((await listClaudeProcesses(async () => ok(""), "linux")).supported).toBe(false);
    expect((await listClaudeProcesses(async () => exit(1), "darwin")).supported).toBe(false);
  });
  it("skips lsof when no Claude process is running", async () => {
    const calls: string[] = [];
    const listed = await listClaudeProcesses(async (file) => {
      calls.push(file);
      return ok("  1 Wed Oct  7 11:00:00 2026     /sbin/launchd");
    }, "darwin");
    expect(listed).toEqual({ supported: true, processes: [] });
    expect(calls).toEqual(["ps"]);
  });
});

describe("staleProcesses", () => {
  const base = { kind: "agent" as const, agentId: null, title: null, startedAt: null };
  const processes = [
    { ...base, pid: 1, version: "2.1.285" },
    { ...base, pid: 2, version: "2.1.292" },
    { ...base, pid: 3, version: null },
  ];
  it("lists processes on another version, not ones whose version is unknown", () => {
    expect(staleProcesses(processes, "2.1.292").map((process) => process.pid)).toEqual([1]);
  });
  it("lists nothing before the installed version is known", () => {
    expect(staleProcesses(processes, null)).toEqual([]);
  });
});
