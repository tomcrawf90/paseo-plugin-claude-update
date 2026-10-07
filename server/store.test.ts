import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { HistoryEntry } from "../shared/status";
import { createFileStore, EMPTY_STATE } from "./store";

let directory = "";
beforeEach(async () => {
  directory = join(await mkdtemp(join(tmpdir(), "claude-update-store-")), "plugin-data", "claude-update");
});
afterEach(async () => {
  await rm(join(directory, "..", ".."), { recursive: true, force: true });
});

const entry = (message: string): HistoryEntry => ({
  at: "2026-10-07T10:00:00.000Z",
  trigger: "schedule",
  outcome: "updated",
  from: "2.1.285",
  to: "2.1.292",
  target: "2.1.292",
  message,
});

describe("the file store", () => {
  it("starts empty without creating anything", async () => {
    const store = createFileStore(directory);
    expect(await store.readState()).toEqual(EMPTY_STATE);
    expect(await store.readHistory(10)).toEqual([]);
    await expect(readdir(directory)).rejects.toThrow();
  });

  it("round-trips state and leaves no temporary file", async () => {
    const store = createFileStore(directory);
    await store.writeState({ ...EMPTY_STATE, installedVersion: "2.1.292", consecutiveFailures: 2 });
    expect(await createFileStore(directory).readState()).toMatchObject({ installedVersion: "2.1.292", consecutiveFailures: 2 });
    expect(await readdir(directory)).toEqual(["state.json"]);
  });

  it("starts again from a damaged state file and fills in fields an older version lacked", async () => {
    const store = createFileStore(directory);
    await store.writeState(EMPTY_STATE);
    await writeFile(join(directory, "state.json"), "{half");
    expect(await store.readState()).toEqual(EMPTY_STATE);
    await writeFile(join(directory, "state.json"), '{"installedVersion":"2.1.1"}');
    expect(await store.readState()).toEqual({ ...EMPTY_STATE, installedVersion: "2.1.1" });
  });

  it("returns the newest history first and skips a torn line", async () => {
    const store = createFileStore(directory);
    await store.appendHistory(entry("one"));
    await store.appendHistory(entry("two"));
    await writeFile(join(directory, "history.jsonl"), `${await readFile(join(directory, "history.jsonl"), "utf8")}{"at":"torn\n`);
    await store.appendHistory(entry("three"));
    expect((await store.readHistory(2)).map((item) => item.message)).toEqual(["three", "two"]);
  });

  it("appends to the log and rotates it once it is large", async () => {
    const store = createFileStore(directory);
    await store.log("first");
    await store.log("second");
    expect(await readFile(join(directory, "plugin.log"), "utf8")).toBe("first\nsecond\n");
    await writeFile(join(directory, "plugin.log"), "x".repeat(600 * 1024));
    await store.log("after rotation");
    expect(await readFile(join(directory, "plugin.log"), "utf8")).toBe("after rotation\n");
    expect((await readdir(directory)).sort()).toEqual(["plugin.log", "plugin.log.1"]);
  });
});
