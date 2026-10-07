/**
 * End to end against a stand-in `claude` on PATH (test/stub/claude): the real
 * command runner, the real files on disk, a throwaway home. No real install is
 * involved, and nothing here reaches the network.
 */
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCommand } from "../server/run";
import { startService } from "../server/service";
import { createFileStore } from "../server/store";
import { runCheck, type UpdaterDependencies } from "../server/updater";
import { settingsWith } from "./support";

const STUB_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "stub");
const STUB = join(STUB_DIRECTORY, "claude");

let root = "";
let stubState = "";
let notifications: string[] = [];
let pointer: string | Error = "2.1.292";
let deps: UpdaterDependencies;

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const calls = async () => (await readFile(join(stubState, "calls"), "utf8")).trim().split("\n");
const installed = async () => (await readFile(join(stubState, "version"), "utf8")).trim();
const setMode = (mode: string) => writeFile(join(stubState, "mode"), mode);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "claude-update-stub-"));
  stubState = join(root, "stub-state");
  await mkdir(stubState, { recursive: true });
  await writeFile(join(stubState, "version"), "2.1.285\n");
  await writeFile(join(stubState, "latest"), "2.1.292\n");
  notifications = [];
  pointer = "2.1.292";
  const env = { PATH: `${STUB_DIRECTORY}:/usr/bin:/bin`, STUB_CLAUDE_DIR: stubState };
  deps = {
    run: runCommand,
    async fetchText() {
      if (pointer instanceof Error) throw pointer;
      return pointer;
    },
    now: () => new Date(),
    async readFile(path) {
      try {
        return await readFile(path, "utf8");
      } catch {
        return null;
      }
    },
    isExecutable,
    env,
    // An empty home: there is no ~/.local/bin/claude in it, so the stub is found on PATH.
    home: join(root, "home"),
    store: createFileStore(join(root, "paseo", "plugin-data", "claude-update")),
    async notify(_title, message) {
      notifications.push(message);
    },
    async countStale() {
      return 0;
    },
  };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("with a stub claude on PATH", () => {
  it("finds the CLI on PATH, updates it and records the result on disk", async () => {
    const state = await runCheck(deps, settingsWith(), "schedule");
    expect(state.claudePath).toBe(STUB);
    expect(state.lastOutcome).toBe("updated");
    expect(await installed()).toBe("2.1.292");
    expect(await calls()).toEqual(["--version", "update", "--version"]);

    const directory = deps.store.directory;
    const saved = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
    expect(saved).toMatchObject({ installedVersion: "2.1.292", previousVersion: "2.1.285", lastOutcome: "updated" });
    const history = (await readFile(join(directory, "history.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ outcome: "updated", from: "2.1.285", to: "2.1.292" });
    expect(await readFile(join(directory, "plugin.log"), "utf8")).toMatch(/schedule updated: Updated Claude Code from 2\.1\.285 to 2\.1\.292/);
    expect(notifications).toHaveLength(1);
  });

  it("does nothing more on the next check", async () => {
    await runCheck(deps, settingsWith(), "schedule");
    const state = await runCheck(deps, settingsWith(), "schedule");
    expect(state.lastOutcome).toBe("up-to-date");
    expect(await calls()).toEqual(["--version", "update", "--version", "--version"]);
    expect((await readFile(join(deps.store.directory, "history.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);
    expect(notifications).toHaveLength(1);
  });

  it("leaves the version alone when the CLI cannot download", async () => {
    await setMode("offline");
    const state = await runCheck(deps, settingsWith(), "schedule");
    expect(state.lastOutcome).toBe("failed");
    expect(state.lastMessage).toContain("exit code 1");
    expect(state.lastMessage).toContain("Failed to install native update");
    expect(await installed()).toBe("2.1.285");
    // An update that failed is told at once.
    expect(state.attention?.kind).toBe("failed");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("could not be updated");
  });

  it("notices when the CLI exits 0 without updating", async () => {
    await setMode("disabled");
    const state = await runCheck(deps, settingsWith(), "schedule");
    expect(state.lastOutcome).toBe("failed");
    expect(state.lastMessage).toContain("disabled by your administrator");
  });

  it("fails when the CLI cannot report its version", async () => {
    await setMode("broken");
    const state = await runCheck(deps, settingsWith(), "schedule");
    expect(state.lastOutcome).toBe("failed");
    expect(state.lastMessage).toContain("exit code 126");
    expect(await calls()).toEqual(["--version"]);
  });

  it("pins with claude install and rolls back the same way", async () => {
    await runCheck(deps, settingsWith(), "schedule");
    const state = await runCheck(deps, settingsWith({ pinnedVersion: "2.1.285" }), "schedule");
    expect(state.lastOutcome).toBe("pin-applied");
    expect(await installed()).toBe("2.1.285");
    expect((await calls()).slice(-3)).toEqual(["--version", "install 2.1.285", "--version"]);
    const again = await runCheck(deps, settingsWith({ pinnedVersion: "2.1.285" }), "schedule");
    expect(again.lastOutcome).toBe("pinned");
  });

  it("does not run the CLI's updater in notify mode or while the network is down", async () => {
    await runCheck(deps, settingsWith({ mode: "notify" }), "schedule");
    pointer = new Error("getaddrinfo ENOTFOUND");
    await runCheck(deps, settingsWith(), "schedule");
    expect(await calls()).toEqual(["--version", "--version"]);
    expect(await installed()).toBe("2.1.285");
  });

  it("runs on the service's own timer and survives a restart without a second update", async () => {
    const first = startService(deps, async () => settingsWith(), { startupDelayMs: 5, tickMs: 20, minimumGapMs: 0 });
    // Wait for the first check to finish, however slow the machine: a second
    // service started over a check still running would be a different test.
    for (let waited = 0; waited < 10_000 && (await calls().catch(() => [])).length < 3; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    first.stop();
    const second = startService(deps, async () => settingsWith(), { startupDelayMs: 5, tickMs: 20, minimumGapMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    second.stop();
    expect(await calls()).toEqual(["--version", "update", "--version"]);
  });
});

describe("the command runner", () => {
  const env = () => ({ PATH: "/usr/bin:/bin", STUB_CLAUDE_DIR: stubState });

  it("gives a program that asks a question end-of-file instead of a terminal", async () => {
    await setMode("asks");
    const result = await runCommand(STUB, ["update"], { env: env(), timeoutMs: 5000 });
    expect(result).toMatchObject({ code: 4, timedOut: false });
    expect(result.stdout).toContain("no terminal");
  });

  it("stops a program that hangs", async () => {
    await setMode("hang");
    const started = Date.now();
    const result = await runCommand(STUB, ["update"], { env: env(), timeoutMs: 300 });
    expect(result).toMatchObject({ code: null, timedOut: true, error: "timed out" });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("reports a program that does not exist without throwing", async () => {
    const result = await runCommand(join(root, "no-such-claude"), ["--version"]);
    expect(result.code).toBeNull();
    expect(result.error).toMatch(/ENOENT/);
  });

  it("reports a process that cannot even be started without throwing", async () => {
    const result = await runCommand("bad\0path", ["--version"]);
    expect(result.code).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it("does not use a shell", async () => {
    const result = await runCommand(STUB, ["install", "2.1.300; touch injected"], { env: env() });
    expect(result.code).toBe(0);
    await expect(access(join(process.cwd(), "injected"))).rejects.toThrow();
    expect(await installed()).toBe("2.1.300; touch injected");
  });
});
