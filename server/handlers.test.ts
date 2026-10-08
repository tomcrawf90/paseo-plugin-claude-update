import { afterEach, describe, expect, it } from "vitest";

import type { PluginServerContext } from "@getpaseo/plugin/server";

import { harness, settingsWith } from "../test/support";
import type { UpdateSettings } from "../shared/settings";
import { statusSchema, type Status } from "../shared/status";
import { handleRpcs } from "./handlers";
import { startService, type Service } from "./service";

const HOUR = 60 * 60_000;
const NEVER = { startupDelayMs: 2 ** 30, tickMs: 2 ** 30, platform: "darwin" as const };

let service: Service | null = null;
afterEach(() => {
  service?.stop();
  service = null;
});

type Handler = (input: unknown, context: unknown) => Promise<unknown> | unknown;

/** The plugin's calls as the app makes them: by name, with the input and output put through the contract. */
function rpcs(h: ReturnType<typeof harness>, settings: UpdateSettings | null = settingsWith()) {
  service = startService(h.deps, async () => settings, NEVER);
  const handlers = new Map<string, { contract: { input: { parse(value: unknown): unknown } }; handler: Handler }>();
  const server = {
    handle(contract: { name: string; input: { parse(value: unknown): unknown } }, handler: Handler) {
      handlers.set(contract.name, { contract, handler });
      return () => {};
    },
  };
  handleRpcs(server as unknown as Pick<PluginServerContext, "handle">, service);
  return {
    names: () => [...handlers.keys()].sort(),
    async call(name: string, input: unknown = {}): Promise<Status> {
      const entry = handlers.get(name);
      if (entry === undefined) throw new Error(`no handler for ${name}`);
      return statusSchema.parse(await entry.handler(entry.contract.input.parse(input), { paseo: undefined }));
    },
  };
}

describe("the calls the app makes", () => {
  it("are status.get, status.check and status.dismiss", () => {
    expect(rpcs(harness("2.1.292", "2.1.292")).names()).toEqual(["status.check", "status.dismiss", "status.get"]);
  });

  it("status.get says nothing has been checked before the first check, and runs nothing", async () => {
    const h = harness("2.1.292", "2.1.292");
    const status = await rpcs(h).call("status.get");
    expect(status).toMatchObject({ lastCheckAt: null, nextCheckAt: null, scheduled: true, lastOutcome: null, lastMessage: null, checking: false });
    expect(h.claude.calls).toEqual([]);
  });

  it("status.check runs one check at once and answers with when it was, how it ended and when the next is", async () => {
    const h = harness("2.1.292", "2.1.292");
    const app = rpcs(h, settingsWith({ intervalHours: 4 }));
    const checkedAt = new Date(h.clock.now).toISOString();
    const status = await app.call("status.check");
    expect(h.claude.calls).toEqual(["--version"]);
    expect(status).toMatchObject({
      lastCheckAt: checkedAt,
      nextCheckAt: new Date(h.clock.now + 4 * HOUR).toISOString(),
      lastOutcome: "up-to-date",
      installedVersion: "2.1.292",
      checking: false,
      activity: null,
    });
    expect(status.lastMessage).toContain("2.1.292 is up to date");
    // A later read gives the same answer: it was stored, not only returned.
    h.clock.now += 10 * 60_000;
    expect(await app.call("status.get")).toMatchObject({ lastCheckAt: checkedAt, lastOutcome: "up-to-date" });
    // And a second press checks again, whatever the schedule says.
    const again = await app.call("status.check", { apply: false });
    expect(again.lastCheckAt).toBe(new Date(h.clock.now).toISOString());
    expect(h.claude.calls).toEqual(["--version", "--version"]);
  });

  it("status.check only looks unless told to apply, with auto-update on as well", async () => {
    const h = harness("2.1.285", "2.1.292");
    const app = rpcs(h, settingsWith({ mode: "auto" }));
    const looked = await app.call("status.check");
    expect(h.claude.calls).toEqual(["--version"]);
    expect(looked).toMatchObject({ lastOutcome: "update-available", installedVersion: "2.1.285", targetVersion: "2.1.292" });
    expect(looked.lastMessage).toContain("2.1.292 is available");

    const updated = await app.call("status.check", { apply: true });
    expect(h.claude.calls).toEqual(["--version", "--version", "update", "--version"]);
    expect(updated).toMatchObject({ lastOutcome: "updated", installedVersion: "2.1.292", previousVersion: "2.1.285" });
    expect(updated.lastMessage).toContain("from 2.1.285 to 2.1.292");
    expect(updated.history[0]).toMatchObject({ outcome: "updated", from: "2.1.285", to: "2.1.292", trigger: "manual" });
  });

  it("status.check answers a failed check with the reason, and still says when it was", async () => {
    const h = harness("2.1.285", "2.1.292");
    h.pointers.latest = new Error("HTTP 503");
    const status = await rpcs(h).call("status.check");
    expect(status).toMatchObject({ lastCheckAt: new Date(h.clock.now).toISOString(), lastOutcome: "failed", consecutiveFailures: 1 });
    expect(status.lastMessage).toContain("HTTP 503");
  });

  it("status.get says the schedule is off, before the first check as well, so the screens do not promise one", async () => {
    const off = await rpcs(harness("2.1.292", "2.1.292"), settingsWith({ enabled: false })).call("status.get");
    expect(off).toMatchObject({ scheduled: false, nextCheckAt: null, lastCheckAt: null });
    service?.stop();
    const unreadable = await rpcs(harness("2.1.292", "2.1.292"), null).call("status.get");
    expect(unreadable).toMatchObject({ scheduled: false, nextCheckAt: null });
  });

  it("status.check with settings that cannot be read is refused, and nothing is left running", async () => {
    const h = harness("2.1.292", "2.1.292");
    const app = rpcs(h, null);
    await expect(app.call("status.check")).rejects.toThrow(/settings are invalid/);
    expect(await app.call("status.get")).toMatchObject({ checking: false, lastCheckAt: null });
  });

  it("status.dismiss clears the notice and answers with the status after it", async () => {
    const h = harness("2.1.285", "2.1.292");
    const app = rpcs(h);
    expect((await app.call("status.check")).attention).toMatchObject({ kind: "update-available" });
    const after = await app.call("status.dismiss");
    expect(after.attention).toBeNull();
    expect(after.lastOutcome).toBe("update-available");
  });
});
