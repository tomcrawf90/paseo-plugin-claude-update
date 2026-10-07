import { afterEach, describe, expect, it } from "vitest";

import { harness, ok, settingsWith } from "../test/support";
import type { UpdateSettings } from "../shared/settings";
import { startService, type Service } from "./service";

const HOUR = 60 * 60_000;
/** Timers far enough out that only explicit `tick()` calls drive these tests. */
const NEVER = { startupDelayMs: 2 ** 30, tickMs: 2 ** 30, platform: "darwin" as const };

let service: Service | null = null;
afterEach(() => {
  service?.stop();
  service = null;
});

function start(h: ReturnType<typeof harness>, settings: UpdateSettings | null = settingsWith(), options = {}) {
  service = startService(h.deps, async () => settings, { ...NEVER, ...options });
  return service;
}

describe("the schedule", () => {
  it("checks when due and then not again until the interval has passed", async () => {
    const h = harness("2.1.285", "2.1.292");
    const s = start(h, settingsWith({ intervalHours: 4 }), { minimumGapMs: 0 });
    await s.tick();
    expect(h.claude.calls).toEqual(["--version", "update", "--version"]);
    await s.tick();
    h.clock.now += 3 * HOUR;
    await s.tick();
    expect(h.claude.calls).toHaveLength(3);
    h.clock.now += 1 * HOUR;
    await s.tick();
    expect(h.claude.calls).toEqual(["--version", "update", "--version", "--version"]);
  });

  it("does nothing while disabled", async () => {
    const h = harness("2.1.285", "2.1.292");
    const s = start(h, settingsWith({ enabled: false }));
    await s.tick();
    await s.tick();
    expect(h.claude.calls).toEqual([]);
    expect(h.store.lines).toEqual([]);
  });

  it("does nothing while the settings are invalid", async () => {
    const h = harness("2.1.285", "2.1.292");
    const s = start(h, null);
    await s.tick();
    expect(h.claude.calls).toEqual([]);
  });

  it("picks up where the last run left off after a restart", async () => {
    const h = harness("2.1.292", "2.1.292", { lastCheckAt: new Date(Date.parse("2026-10-07T10:00:00Z") - HOUR).toISOString() });
    const s = start(h, settingsWith({ intervalHours: 4 }));
    await s.tick();
    expect(h.claude.calls).toEqual([]);
  });

  it("never runs two checks at once", async () => {
    const h = harness("2.1.285", "2.1.292");
    let release: () => void = () => {};
    let updates = 0;
    h.claude.on.update = () =>
      new Promise((resolve) => {
        updates += 1;
        release = () => {
          h.claude.installed = "2.1.292";
          resolve(ok("Successfully updated"));
        };
      });
    const s = start(h, settingsWith(), { minimumGapMs: 0 });
    const first = s.tick();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await s.tick();
    const manual = s.check("manual", true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await s.status()).checking).toBe(true);
    release();
    await first;
    const state = await manual;
    expect(updates).toBe(1);
    expect(state.lastOutcome).toBe("updated");
    expect((await s.status()).checking).toBe(false);
  });

  it("runs one update when a manual check lands while a tick is deciding", async () => {
    const h = harness("2.1.285", "2.1.292");
    const s = start(h, settingsWith(), { minimumGapMs: 0 });
    // No waiting between the two: the manual check starts while the tick is
    // still reading the settings and the state.
    const [, state] = await Promise.all([s.tick(), s.check("manual", true)]);
    expect(h.claude.calls.filter((call) => call === "update")).toHaveLength(1);
    expect(h.store.lines).toHaveLength(1);
    expect(state.lastOutcome).toBe("updated");
    expect((await s.status()).checking).toBe(false);
  });

  it("does not hammer when the state cannot be saved", async () => {
    const h = harness("2.1.292", "2.1.292");
    h.store.writeState = async () => {
      throw new Error("disk full");
    };
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      const s = start(h, settingsWith(), { minimumGapMs: 15 * 60_000 });
      for (let minute = 0; minute < 10; minute += 1) {
        await s.tick();
        h.clock.now += 60_000;
      }
      expect(h.claude.calls).toEqual(["--version"]);
      h.clock.now += 10 * 60_000;
      await s.tick();
      expect(h.claude.calls).toEqual(["--version", "--version"]);
      expect(errors.length).toBe(2);
    } finally {
      console.error = original;
    }
  });

  it("stops ticking once stopped", async () => {
    const h = harness("2.1.285", "2.1.292");
    const s = start(h);
    s.stop();
    await s.tick();
    expect(h.claude.calls).toEqual([]);
  });

  it("runs from its own timers", async () => {
    const h = harness("2.1.292", "2.1.292");
    start(h, settingsWith(), { startupDelayMs: 5, tickMs: 5, minimumGapMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    // Due once; every later tick finds the interval has not passed.
    expect(h.claude.calls).toEqual(["--version"]);
  });
});

describe("a manual check", () => {
  it("runs even when the schedule is off or backing off", async () => {
    const h = harness("2.1.285", "2.1.292", { lastCheckAt: "2026-10-07T09:59:00Z", retryNotBefore: "2026-10-08T00:00:00Z" });
    const s = start(h, settingsWith({ enabled: false }));
    const state = await s.check("manual", false);
    expect(state.lastOutcome).toBe("updated");
    expect(h.store.history[0]?.trigger).toBe("manual");
  });

  it("refuses with invalid settings", async () => {
    const h = harness("2.1.285", "2.1.292");
    await expect(start(h, null).check("manual", false)).rejects.toThrow(/settings are invalid/);
  });
});

describe("status", () => {
  it("reports versions, the next check, the rollback command and stale processes", async () => {
    const h = harness("2.1.285", "2.1.292");
    const run = h.deps.run;
    h.deps.run = async (file, args, options) => {
      if (file === "ps") {
        return ok(
          [
            "  100 Tue Oct  6 14:49:39 2026     /home/u/.local/bin/claude --output-format stream-json PASEO_AGENT_ID=agent-old SECRET_TOKEN=hunter2",
            "  200 Wed Oct  7 09:40:28 2026     /home/u/.local/bin/claude --output-format stream-json PASEO_AGENT_ID=agent-new",
            "  300 Tue Sep 29 22:31:03 2026     /home/u/.local/bin/claude daemon run --json-path /x HOME=/home/u",
          ].join("\n"),
        );
      }
      if (file === "lsof") {
        return ok("p100\nn/home/u/.local/share/claude/versions/2.1.285\np200\nn/home/u/.local/share/claude/versions/2.1.292\np300\nn/home/u/.local/share/claude/versions/2.1.285\n");
      }
      return run(file, args, options);
    };
    const s = start(h, settingsWith({ intervalHours: 4 }));
    await s.check("manual", false);
    const paseo = {
      agents: { list: async () => ({ entries: [{ agent: { id: "agent-old", title: "Fix the login test" } }] }) },
    } as unknown as Parameters<Service["status"]>[0];
    const status = await s.status(paseo);
    expect(status.installedVersion).toBe("2.1.292");
    expect(status.previousVersion).toBe("2.1.285");
    expect(status.rollbackCommand).toBe("claude install 2.1.285");
    expect(status.nextCheckAt).toBe(new Date(h.clock.now + 4 * HOUR).toISOString());
    expect(status.processListSupported).toBe(true);
    expect(status.staleProcesses.map((process) => [process.pid, process.kind, process.version, process.title])).toEqual([
      [100, "agent", "2.1.285", "Fix the login test"],
      [300, "daemon", "2.1.285", null],
    ]);
    expect(JSON.stringify(status)).not.toContain("hunter2");
    expect(status.history).toHaveLength(1);
    expect(status.dataDirectory).toBe("/memory");
  });

  it("has no next check while disabled, and clears a notice on dismiss", async () => {
    const h = harness("2.1.285", "2.1.292");
    const s = start(h, settingsWith({ enabled: false }));
    await s.check("manual", false);
    expect((await s.status()).attention?.kind).toBe("updated");
    await s.dismiss();
    const status = await s.status();
    expect(status.attention).toBeNull();
    expect(status.nextCheckAt).toBeNull();
  });

  it("says so where processes cannot be listed", async () => {
    const h = harness("2.1.292");
    const s = start(h, settingsWith(), { platform: "linux" });
    const status = await s.status();
    expect(status.processListSupported).toBe(false);
    expect(status.staleProcesses).toEqual([]);
  });
});
