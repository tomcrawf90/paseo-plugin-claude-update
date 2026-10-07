import { describe, expect, it } from "vitest";

import { exit, ok } from "../test/support";
import {
  claudeEnvironment,
  describeFailure,
  outputTail,
  readChannelVersion,
  readClaudeChannel,
  readInstalledVersion,
  RELEASES_URL,
} from "./claude";

describe("readInstalledVersion", () => {
  it("parses what the CLI prints", async () => {
    expect(await readInstalledVersion(async () => ok("2.1.285 (Claude Code)\n"), "/c", {})).toEqual({ version: "2.1.285" });
  });
  it("reports a failing or silent CLI", async () => {
    expect(await readInstalledVersion(async () => exit(126, "", "cannot execute"), "/c", {})).toEqual({
      error: "claude --version: exit code 126: cannot execute",
    });
    expect(await readInstalledVersion(async () => ok("hello"), "/c", {})).toHaveProperty("error");
  });
  it("does not pass a running session's variables to the CLI", async () => {
    let seen: NodeJS.ProcessEnv | undefined;
    await readInstalledVersion(
      async (_file, _args, options) => {
        seen = options?.env;
        return ok("2.1.285");
      },
      "/c",
      { CLAUDE_CODE_EXECPATH: "/real/versions/2.1.285", CLAUDECODE: "1", HOME: "/home/u" },
    );
    expect(seen).toEqual({ HOME: "/home/u" });
  });
});

describe("claudeEnvironment", () => {
  it("leaves the caller's environment untouched", () => {
    const env = { CLAUDE_CODE_ENTRYPOINT: "sdk-cli", PATH: "/usr/bin" };
    expect(claudeEnvironment(env)).toEqual({ PATH: "/usr/bin" });
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe("sdk-cli");
  });
});

describe("readChannelVersion", () => {
  it("reads the pointer for the channel", async () => {
    const urls: string[] = [];
    const version = await readChannelVersion(async (url) => {
      urls.push(url);
      return "2.1.292\n";
    }, "stable");
    expect(version).toBe("2.1.292");
    expect(urls).toEqual([`${RELEASES_URL}/stable`]);
  });
  it("rejects anything that is not exactly a version", async () => {
    await expect(readChannelVersion(async () => "<html>", "latest")).rejects.toThrow(/did not hold a version/);
    await expect(readChannelVersion(async () => "2.1.292; rm", "latest")).rejects.toThrow();
  });
});

describe("readClaudeChannel", () => {
  const read = (text: string | null) => readClaudeChannel(async () => text, "/home/u");
  it("defaults to latest", async () => {
    expect(await read(null)).toBe("latest");
    expect(await read("{}")).toBe("latest");
  });
  it("reads autoUpdatesChannel from ~/.claude/settings.json", async () => {
    const paths: string[] = [];
    const channel = await readClaudeChannel(async (path) => {
      paths.push(path);
      return '{"autoUpdatesChannel":"stable"}';
    }, "/home/u");
    expect(channel).toBe("stable");
    expect(paths).toEqual(["/home/u/.claude/settings.json"]);
  });
  it("is null when the file cannot be understood", async () => {
    expect(await read("{not json")).toBeNull();
    expect(await read('{"autoUpdatesChannel":3}')).toBeNull();
    expect(await read("[]")).toBe("latest");
  });
});

describe("output helpers", () => {
  it("keeps only the end of long output", () => {
    const tail = outputTail(ok("x".repeat(5000)));
    expect(tail.length).toBeLessThan(1300);
    expect(tail.startsWith("…")).toBe(true);
  });
  it("describes a failure with and without output", () => {
    expect(describeFailure("claude update", exit(1))).toBe("claude update: exit code 1");
    expect(describeFailure("claude update", { code: null, stdout: "", stderr: "", error: "timed out", timedOut: true })).toBe(
      "claude update: timed out",
    );
  });
});
