import { afterEach, describe, expect, it, vi } from "vitest";

import type { PluginClientContext } from "@getpaseo/plugin/client";

import { checkNow, getStatus, type Status } from "../shared/status";

// The entry pulls in the screens, which import the host's modules. Nothing
// here renders them, so empty stand-ins are enough to load the entry.
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => undefined, useSettings: () => undefined }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ ScrollView: () => null, useToast: () => undefined }));
vi.mock("@getpaseo/plugin/client/ui", () => ({}));
vi.mock("@tanstack/react-query", () => ({}));
vi.mock("react-native", () => ({}));

const { default: contribute } = await import("../index.client");

const QUIET: Status = {
  claudePath: "/home/u/.local/bin/claude",
  installedVersion: "2.1.292",
  targetVersion: "2.1.292",
  claudeChannel: "latest",
  lastCheckAt: "2026-10-07T10:00:00.000Z",
  nextCheckAt: "2026-10-07T14:00:00.000Z",
  lastOutcome: "up-to-date",
  lastMessage: "Claude Code 2.1.292 is up to date (latest is 2.1.292).",
  consecutiveFailures: 0,
  previousVersion: null,
  rollbackCommand: null,
  attention: null,
  checking: false,
  activity: null,
  staleProcesses: [],
  processListSupported: true,
  history: [],
  dataDirectory: "/data",
};
const AVAILABLE: Status = {
  ...QUIET,
  targetVersion: "2.1.300",
  lastOutcome: "update-available",
  attention: { kind: "update-available", message: "Claude Code 2.1.300 is available.", at: "2026-10-07T10:00:00.000Z" },
};

type Command = { id: string; onSelect(context: unknown): void | Promise<void> };

/** A pretend Paseo app: it records what the plugin registers and answers its calls. */
function app(answers: { status: Status; check?: Status }) {
  const fake = {
    answers,
    rows: [] as { id: string; title: string; icon: string; surface: string }[],
    surfaces: [] as string[],
    settingsScreens: [] as string[],
    commands: [] as Command[],
    calls: [] as { name: string; input: unknown }[],
    opened: [] as string[],
    async rpc(contract: { name: string }, input: unknown) {
      fake.calls.push({ name: contract.name, input });
      if (contract.name === checkNow.name) return fake.answers.check ?? fake.answers.status;
      return fake.answers.status;
    },
    openSurface(id: string) {
      fake.opened.push(`surface:${id}`);
    },
    openSettings(id: string) {
      fake.opened.push(`settings:${id}`);
    },
    addSurface(id: string) {
      fake.surfaces.push(id);
      return () => {};
    },
    addSettingsScreen(screen: { id: string }) {
      fake.settingsScreens.push(screen.id);
      return () => {};
    },
    addSidebarItem(row: { id: string; title: string; icon: string; surface: string }) {
      if (fake.rows.some((other) => other.id === row.id)) throw new Error(`Duplicate sidebar item: ${row.id}`);
      fake.rows.push(row);
      return () => {
        fake.rows = fake.rows.filter((other) => other !== row);
      };
    },
    addCommandCenterItem(command: Command) {
      fake.commands.push(command);
      return () => {};
    },
    select(id: string) {
      const command = fake.commands.find((other) => other.id === id);
      if (command === undefined) throw new Error(`no command ${id}`);
      return command.onSelect({ rpc: fake.rpc, openSurface: fake.openSurface, openSettings: fake.openSettings });
    },
  };
  return fake;
}

/** Long enough for the first status read and the row change behind it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

let cleanup: (() => void | Promise<void>) | null = null;
function load(fake: ReturnType<typeof app>): void {
  cleanup = contribute(fake as unknown as PluginClientContext);
}
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe("the plugin in the app", () => {
  it("adds no sidebar row while there is nothing new, and stays reachable", async () => {
    const fake = app({ status: QUIET });
    load(fake);
    expect(fake.rows).toEqual([]);
    await settle();
    expect(fake.calls).toEqual([{ name: getStatus.name, input: {} }]);
    expect(fake.rows).toEqual([]);
    expect(fake.surfaces).toEqual(["status"]);
    expect(fake.settingsScreens).toEqual(["settings"]);
    expect(fake.commands.map((command) => command.id)).toEqual(["open-status", "check-now", "open-settings"]);
    await fake.select("open-status");
    await fake.select("open-settings");
    expect(fake.opened).toEqual(["surface:status", "settings:settings"]);
  });

  it("adds the row when there is news", async () => {
    const fake = app({ status: AVAILABLE });
    load(fake);
    await settle();
    expect(fake.rows).toEqual([{ id: "status", title: "Claude Code update available", icon: "CircleArrowUp", surface: "status" }]);
  });

  it("a check from the Command Center that finds nothing opens the page and leaves the sidebar empty", async () => {
    const fake = app({ status: QUIET });
    load(fake);
    await settle();
    await fake.select("check-now");
    await settle();
    expect(fake.opened).toEqual(["surface:status"]);
    expect(fake.calls.at(-1)).toEqual({ name: checkNow.name, input: { apply: false } });
    expect(fake.rows).toEqual([]);
  });

  it("a check from the Command Center that finds an update adds the row, and a later quiet status takes it away", async () => {
    const fake = app({ status: QUIET, check: AVAILABLE });
    load(fake);
    await settle();
    await fake.select("check-now");
    await settle();
    expect(fake.rows.map((row) => row.title)).toEqual(["Claude Code update available"]);
    // Dismissed, or installed: the next status has no notice.
    fake.answers.check = QUIET;
    await fake.select("check-now");
    await settle();
    expect(fake.rows).toEqual([]);
  });

  it("changes nothing after it has been stopped", async () => {
    const fake = app({ status: QUIET, check: AVAILABLE });
    load(fake);
    await settle();
    await cleanup?.();
    await fake.select("check-now");
    await settle();
    expect(fake.rows).toEqual([]);
  });
});
