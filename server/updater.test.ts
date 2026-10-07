import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../shared/settings";
import { exit, harness, ok, settingsWith } from "../test/support";
import { backoffMs, FAILURE_ALERT_AFTER, isDue, nextCheckAt, runCheck } from "./updater";
import { EMPTY_STATE } from "./store";

const HOUR = 60 * 60_000;

describe("runCheck when nothing is new", () => {
  it("is quiet: no install, no history, no notification", async () => {
    const h = harness("2.1.292", "2.1.292");
    const state = await runCheck(h.deps, settingsWith(), "schedule");
    expect(state.lastOutcome).toBe("up-to-date");
    expect(state.installedVersion).toBe("2.1.292");
    expect(state.targetVersion).toBe("2.1.292");
    expect(h.claude.calls).toEqual(["--version"]);
    expect(h.store.history).toEqual([]);
    expect(h.notifications).toEqual([]);
    expect(state.attention).toBeNull();
  });

  it("is idempotent: a second check changes only the time", async () => {
    const h = harness("2.1.292", "2.1.292");
    const first = await runCheck(h.deps, settingsWith(), "schedule");
    h.clock.now += 4 * HOUR;
    const second = await runCheck(h.deps, settingsWith(), "schedule");
    expect({ ...second, lastCheckAt: null }).toEqual({ ...first, lastCheckAt: null });
    expect(second.lastCheckAt).not.toBe(first.lastCheckAt);
    expect(h.store.history).toEqual([]);
    expect(h.claude.calls).toEqual(["--version", "--version"]);
  });

  it("does not downgrade when the installed version is ahead of the channel", async () => {
    const h = harness("2.1.292");
    h.pointers.stable = "2.1.285";
    const state = await runCheck(h.deps, settingsWith({ channel: "stable" }), "schedule");
    expect(state.lastOutcome).toBe("up-to-date");
    expect(h.claude.calls).toEqual(["--version"]);
  });
});

describe("runCheck when an update exists", () => {
  it("installs it with claude update, confirms the version and keeps a rollback note", async () => {
    const h = harness("2.1.285", "2.1.292");
    const state = await runCheck(h.deps, settingsWith(), "schedule");
    expect(h.claude.calls).toEqual(["--version", "update", "--version"]);
    expect(state.lastOutcome).toBe("updated");
    expect(state.installedVersion).toBe("2.1.292");
    expect(state.previousVersion).toBe("2.1.285");
    expect(state.lastMessage).toContain("claude install 2.1.285");
    expect(state.lastMessage).toContain("2 running Claude processes are still on an older version");
    expect(state.attention?.kind).toBe("updated");
    expect(h.store.history).toHaveLength(1);
    expect(h.store.history[0]).toMatchObject({ outcome: "updated", from: "2.1.285", to: "2.1.292", trigger: "schedule" });
    expect(h.notifications).toHaveLength(1);
  });

  it("is quiet again on the check after an update", async () => {
    const h = harness("2.1.285", "2.1.292");
    await runCheck(h.deps, settingsWith(), "schedule");
    const state = await runCheck(h.deps, settingsWith(), "schedule");
    expect(state.lastOutcome).toBe("up-to-date");
    expect(h.store.history).toHaveLength(1);
    expect(h.notifications).toHaveLength(1);
    expect(state.previousVersion).toBe("2.1.285");
    // The update notice stays until the user dismisses it.
    expect(state.attention?.kind).toBe("updated");
  });

  it("records a second update after a manual rollback", async () => {
    const h = harness("2.1.285", "2.1.292");
    await runCheck(h.deps, settingsWith(), "schedule");
    h.claude.installed = "2.1.285";
    await runCheck(h.deps, settingsWith(), "schedule");
    expect(h.store.history.map((entry) => entry.outcome)).toEqual(["updated", "updated"]);
  });

  it("still records the update when counting old processes or notifying fails", async () => {
    const h = harness("2.1.285", "2.1.292");
    h.deps.countStale = async () => {
      throw new Error("spawn EPERM");
    };
    h.deps.notify = async () => {
      throw new Error("no notification centre");
    };
    const state = await runCheck(h.deps, settingsWith(), "schedule");
    expect(state.lastOutcome).toBe("updated");
    expect(state.previousVersion).toBe("2.1.285");
    expect(state.lastMessage).toContain("Running agents keep 2.1.285");
    expect(h.store.history).toHaveLength(1);
  });

  it("respects the notification switch", async () => {
    const h = harness("2.1.285", "2.1.292");
    await runCheck(h.deps, settingsWith({ desktopNotifications: false }), "schedule");
    expect(h.notifications).toEqual([]);
    expect(h.store.history).toHaveLength(1);
  });

  it("only ever runs --version, update and install", async () => {
    const h = harness("2.1.285", "2.1.292");
    await runCheck(h.deps, settingsWith(), "schedule");
    await runCheck(h.deps, settingsWith({ pinnedVersion: "2.1.280" }), "schedule");
    for (const call of h.claude.calls) expect(call).toMatch(/^(--version|update|install \d+\.\d+\.\d+)$/);
  });
});

describe("notify-only mode", () => {
  it("is what a fresh install runs in: the scheduled check installs nothing", async () => {
    const h = harness("2.1.285", "2.1.292");
    expect(DEFAULT_SETTINGS.mode).toBe("notify");
    const state = await runCheck(h.deps, DEFAULT_SETTINGS, "schedule");
    expect(state.lastOutcome).toBe("update-available");
    expect(h.claude.calls).toEqual(["--version"]);
    expect(h.claude.installed).toBe("2.1.285");
  });

  it("reports an update once and never installs", async () => {
    const h = harness("2.1.285", "2.1.292");
    const settings = settingsWith({ mode: "notify" });
    const first = await runCheck(h.deps, settings, "schedule");
    const second = await runCheck(h.deps, settings, "schedule");
    expect(first.lastOutcome).toBe("update-available");
    expect(second.lastOutcome).toBe("update-available");
    expect(h.claude.calls).toEqual(["--version", "--version"]);
    expect(h.store.history).toHaveLength(1);
    expect(h.notifications).toHaveLength(1);
    expect(h.claude.installed).toBe("2.1.285");
  });

  it("reports again when a newer version appears", async () => {
    const h = harness("2.1.285", "2.1.292");
    const settings = settingsWith({ mode: "notify" });
    await runCheck(h.deps, settings, "schedule");
    h.pointers.latest = "2.1.293";
    await runCheck(h.deps, settings, "schedule");
    expect(h.notifications).toHaveLength(2);
  });

  it("a manual look installs nothing in auto mode either, pin included", async () => {
    const h = harness("2.1.285", "2.1.292");
    const looked = await runCheck(h.deps, settingsWith({ mode: "auto" }), "manual");
    expect(looked.lastOutcome).toBe("update-available");
    expect(looked.lastMessage).toContain("next scheduled check installs it");
    const pinned = await runCheck(h.deps, settingsWith({ mode: "auto", pinnedVersion: "2.1.280" }), "manual", { apply: false });
    expect(pinned.lastOutcome).toBe("pin-mismatch");
    expect(h.claude.calls).toEqual(["--version", "--version"]);
    // The schedule then installs what the look found.
    const scheduled = await runCheck(h.deps, settingsWith({ mode: "auto" }), "schedule");
    expect(scheduled.lastOutcome).toBe("updated");
  });

  it("installs when the user asks for it", async () => {
    const h = harness("2.1.285", "2.1.292");
    const state = await runCheck(h.deps, settingsWith({ mode: "notify" }), "manual", { apply: true });
    expect(state.lastOutcome).toBe("updated");
    expect(h.claude.calls).toContain("update");
  });
});

describe("recording an update", () => {
  it("keeps the version to roll back to when the history cannot be written", async () => {
    const h = harness("2.1.285", "2.1.292");
    h.store.appendHistory = async () => {
      throw new Error("disk full");
    };
    h.store.log = async () => {
      throw new Error("disk full");
    };
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      const state = await runCheck(h.deps, settingsWith(), "schedule");
      expect(state.lastOutcome).toBe("updated");
      expect(h.store.state.previousVersion).toBe("2.1.285");
      expect(h.store.state.installedVersion).toBe("2.1.292");
      expect(h.notifications).toHaveLength(1);
      expect(errors).toHaveLength(2);
    } finally {
      console.error = original;
    }
  });

  it("still writes the history and the log when the state cannot be written, then says so", async () => {
    const h = harness("2.1.285", "2.1.292");
    h.store.writeState = async () => {
      throw new Error("disk full");
    };
    await expect(runCheck(h.deps, settingsWith(), "schedule")).rejects.toThrow("disk full");
    expect(h.store.history.map((entry) => [entry.outcome, entry.from, entry.to])).toEqual([["updated", "2.1.285", "2.1.292"]]);
    expect(h.store.lines).toHaveLength(1);
  });
});

describe("failures", () => {
  it("fails when the launcher cannot be found, without running anything", async () => {
    const h = harness("2.1.285", "2.1.292");
    h.deps.isExecutable = async () => false;
    const state = await runCheck(h.deps, settingsWith(), "schedule");
    expect(state.lastOutcome).toBe("failed");
    expect(state.lastMessage).toContain("Could not find the claude launcher");
    expect(h.claude.calls).toEqual([]);
  });

  it("fails when a configured path is wrong, rather than falling back to another install", async () => {
    const h = harness("2.1.285", "2.1.292");
    const state = await runCheck(h.deps, settingsWith({ claudePath: "/nope/claude" }), "schedule");
    expect(state.lastMessage).toContain("/nope/claude");
    expect(h.claude.calls).toEqual([]);
  });

  it("fails without installing when there is no network", async () => {
    const h = harness("2.1.285", "2.1.292");
    h.pointers.latest = new Error("fetch failed");
    const state = await runCheck(h.deps, settingsWith(), "schedule");
    expect(state.lastOutcome).toBe("failed");
    expect(state.lastMessage).toContain("fetch failed");
    expect(h.claude.calls).toEqual(["--version"]);
    expect(state.installedVersion).toBe("2.1.285");
  });

  it("fails when the pointer holds something that is not a version", async () => {
    const h = harness("2.1.285", "2.1.292");
    h.pointers.latest = "<html>captive portal</html>";
    const state = await runCheck(h.deps, settingsWith(), "schedule");
    expect(state.lastOutcome).toBe("failed");
    expect(h.claude.calls).toEqual(["--version"]);
  });

  it("fails when claude update exits non-zero, and runs it only once", async () => {
    const h = harness("2.1.285", "2.1.292");
    h.claude.on.update = () => exit(1, "Error: Failed to install native update", "getaddrinfo ENOTFOUND");
    const state = await runCheck(h.deps, settingsWith(), "schedule");
    expect(state.lastOutcome).toBe("failed");
    expect(state.lastMessage).toContain("exit code 1");
    expect(state.lastMessage).toContain("ENOTFOUND");
    expect(h.claude.calls.filter((call) => call === "update")).toHaveLength(1);
  });

  it("fails when claude update exits 0 but nothing changed (updates disabled by policy)", async () => {
    const h = harness("2.1.285", "2.1.292");
    h.claude.on.update = () => ok("Updates are disabled by your administrator.");
    const state = await runCheck(h.deps, settingsWith(), "schedule");
    expect(state.lastOutcome).toBe("failed");
    expect(state.lastMessage).toContain("still 2.1.285");
    expect(state.lastMessage).toContain("disabled by your administrator");
  });

  it("tells of an update that failed at once, and once", async () => {
    const h = harness("2.1.285", "2.1.292");
    h.claude.on.update = () => exit(1, "Error: Failed to install native update");
    const settings = settingsWith({ intervalHours: 4 });
    const first = await runCheck(h.deps, settings, "schedule");
    expect(first.consecutiveFailures).toBe(1);
    expect(first.attention).toMatchObject({ kind: "failed" });
    expect(first.attention?.message).toContain("could not be updated");
    expect(first.attention?.message).toContain("exit code 1");
    expect(h.notifications).toHaveLength(1);

    // Dismissed; the retry fails the same way and says nothing new.
    h.store.state = { ...h.store.state, attention: null };
    h.clock.now = Date.parse(first.retryNotBefore ?? "");
    const second = await runCheck(h.deps, settings, "schedule");
    expect(second.consecutiveFailures).toBe(2);
    expect(second.attention).toBeNull();
    expect(h.notifications).toHaveLength(1);

    // The third in a row is the standing alert.
    h.clock.now = Date.parse(second.retryNotBefore ?? "");
    const third = await runCheck(h.deps, settings, "schedule");
    expect(third.attention?.message).toContain("3 times in a row");
    expect(h.notifications).toHaveLength(2);

    // It installs in the end: the failure notice gives way, and a later failed update is news again.
    h.claude.on.update = undefined;
    const done = await runCheck(h.deps, settings, "manual", { apply: true });
    expect(done.lastOutcome).toBe("updated");
    expect(done.attention?.kind).toBe("updated");
    expect(done.announced).toBeNull();
  });

  it("tells of an update that changed nothing, and of a pin that could not be installed", async () => {
    const h = harness("2.1.285", "2.1.292");
    h.claude.on.update = () => ok("Updates are disabled by your administrator.");
    expect((await runCheck(h.deps, settingsWith(), "schedule")).attention?.kind).toBe("failed");

    const pinned = harness("2.1.292", "2.1.292");
    pinned.claude.on.install = () => exit(1, "✘ Installation failed");
    const state = await runCheck(pinned.deps, settingsWith({ pinnedVersion: "2.1.285" }), "schedule");
    expect(state.attention?.kind).toBe("failed");
    expect(pinned.notifications).toHaveLength(1);
  });

  it("says nothing at the first failure of a check that never reached the installer", async () => {
    const h = harness("2.1.285", "2.1.292");
    h.pointers.latest = new Error("offline");
    const state = await runCheck(h.deps, settingsWith(), "schedule");
    expect(state.lastOutcome).toBe("failed");
    expect(state.attention).toBeNull();
    expect(h.notifications).toEqual([]);
  });

  it("fails on a timeout", async () => {
    const h = harness("2.1.285", "2.1.292");
    h.claude.on.update = () => ({ code: null, stdout: "", stderr: "", error: "timed out", timedOut: true });
    const state = await runCheck(h.deps, settingsWith(), "schedule");
    expect(state.lastMessage).toContain("timed out");
  });

  it("fails when the version cannot be read", async () => {
    const h = harness("2.1.285", "2.1.292");
    h.claude.on["--version"] = () => exit(126, "", "cannot execute binary file");
    const state = await runCheck(h.deps, settingsWith(), "schedule");
    expect(state.lastOutcome).toBe("failed");
    expect(h.claude.calls).toEqual(["--version"]);
  });

  it("backs off, alerts once on the third failure in a row and recovers quietly", async () => {
    const h = harness("2.1.285", "2.1.292");
    h.pointers.latest = new Error("offline");
    const settings = settingsWith({ intervalHours: 4 });
    const waits: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const state = await runCheck(h.deps, settings, "schedule");
      expect(state.consecutiveFailures).toBe(attempt);
      waits.push((Date.parse(state.retryNotBefore ?? "") - h.clock.now) / HOUR);
      h.clock.now = Date.parse(state.retryNotBefore ?? "");
    }
    expect(waits).toEqual([4, 8, 16, 24, 24]);
    expect(FAILURE_ALERT_AFTER).toBe(3);
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0]).toContain("3 times in a row");
    expect(h.store.state.attention?.kind).toBe("failed");
    expect(h.store.history).toHaveLength(5);

    h.pointers.latest = "2.1.285";
    const recovered = await runCheck(h.deps, settings, "schedule");
    expect(recovered.lastOutcome).toBe("up-to-date");
    expect(recovered.consecutiveFailures).toBe(0);
    expect(recovered.retryNotBefore).toBeNull();
    expect(recovered.attention).toBeNull();
    expect(h.notifications).toHaveLength(1);
  });
});

describe("a notice once the install is where it should be", () => {
  const NOTIFY = { ...DEFAULT_SETTINGS };

  it("drops an \"available\" notice when the update was installed some other way", async () => {
    const h = harness("2.1.285", "2.1.292");
    expect((await runCheck(h.deps, NOTIFY, "schedule")).attention?.kind).toBe("update-available");
    // Someone ran the updater in a terminal.
    h.claude.installed = "2.1.292";
    const state = await runCheck(h.deps, NOTIFY, "schedule");
    expect(state.lastOutcome).toBe("up-to-date");
    expect(state.attention).toBeNull();
    expect(h.claude.calls).toEqual(["--version", "--version"]);
  });

  it("keeps an \"available\" notice while the update is still waiting", async () => {
    const h = harness("2.1.285", "2.1.292");
    await runCheck(h.deps, NOTIFY, "schedule");
    const state = await runCheck(h.deps, NOTIFY, "schedule");
    expect(state.lastOutcome).toBe("update-available");
    expect(state.attention?.kind).toBe("update-available");
  });

  it("does not bring back a dismissed notice for the same version", async () => {
    const h = harness("2.1.285", "2.1.292");
    await runCheck(h.deps, NOTIFY, "schedule");
    h.store.state = { ...h.store.state, attention: null };
    expect((await runCheck(h.deps, NOTIFY, "schedule")).attention).toBeNull();
    // A newer version is news again.
    h.pointers.latest = "2.1.300";
    expect((await runCheck(h.deps, NOTIFY, "schedule")).attention?.kind).toBe("update-available");
  });

  it("tells the same news again when it comes back after being resolved", async () => {
    const h = harness("2.1.285", "2.1.292");
    await runCheck(h.deps, NOTIFY, "schedule");
    h.claude.installed = "2.1.292";
    expect((await runCheck(h.deps, NOTIFY, "schedule")).attention).toBeNull();
    // Rolled back in a terminal: the update is waiting again.
    h.claude.installed = "2.1.285";
    const state = await runCheck(h.deps, NOTIFY, "schedule");
    expect(state.attention?.kind).toBe("update-available");
    expect(h.store.history).toHaveLength(2);
  });

  it("drops a pin notice once the pinned version is installed", async () => {
    const h = harness("2.1.292", "2.1.292");
    const pinned = { ...NOTIFY, pinnedVersion: "2.1.285" };
    expect((await runCheck(h.deps, pinned, "schedule")).attention?.kind).toBe("pin-mismatch");
    h.claude.installed = "2.1.285";
    const state = await runCheck(h.deps, pinned, "schedule");
    expect(state.lastOutcome).toBe("pinned");
    expect(state.attention).toBeNull();
  });
});

describe("the phase a check reports", () => {
  it("says it is installing just before the updater runs, and not at all for a look", async () => {
    const h = harness("2.1.285", "2.1.292");
    const seen: string[] = [];
    const onPhase = (phase: string) => seen.push(`${phase} after ${h.claude.calls.join(",")}`);
    await runCheck(h.deps, settingsWith(), "manual", { onPhase });
    expect(seen).toEqual([]);
    await runCheck(h.deps, settingsWith(), "manual", { apply: true, onPhase });
    expect(seen).toEqual(["installing after --version,--version"]);
  });

  it("says it is installing before a pin is applied", async () => {
    const h = harness("2.1.292", "2.1.292");
    const seen: string[] = [];
    await runCheck(h.deps, settingsWith({ pinnedVersion: "2.1.285" }), "schedule", { onPhase: (phase) => seen.push(phase) });
    expect(seen).toEqual(["installing"]);
    expect(h.claude.calls).toEqual(["--version", "install 2.1.285", "--version"]);
  });

  it("does not say so when there is nothing to install", async () => {
    const h = harness("2.1.292", "2.1.292");
    const seen: string[] = [];
    await runCheck(h.deps, settingsWith(), "manual", { apply: true, onPhase: (phase) => seen.push(phase) });
    expect(seen).toEqual([]);
  });
});

describe("pinning", () => {
  it("does nothing when the pinned version is installed, and never reads the channel", async () => {
    const h = harness("2.1.285", "2.1.292");
    const state = await runCheck(h.deps, settingsWith({ pinnedVersion: "2.1.285" }), "schedule");
    expect(state.lastOutcome).toBe("pinned");
    expect(h.claude.calls).toEqual(["--version"]);
    expect(h.fetched).toEqual([]);
    expect(h.store.history).toEqual([]);
  });

  it("moves to the pinned version with claude install", async () => {
    const h = harness("2.1.292", "2.1.292");
    const state = await runCheck(h.deps, settingsWith({ pinnedVersion: "2.1.285" }), "schedule");
    expect(h.claude.calls).toEqual(["--version", "install 2.1.285", "--version"]);
    expect(state.lastOutcome).toBe("pin-applied");
    expect(state.installedVersion).toBe("2.1.285");
    expect(state.previousVersion).toBe("2.1.292");
    expect(h.fetched).toEqual([]);
  });

  it("only reports a pin mismatch in notify mode", async () => {
    const h = harness("2.1.292");
    const settings = settingsWith({ pinnedVersion: "2.1.285", mode: "notify" });
    await runCheck(h.deps, settings, "schedule");
    const state = await runCheck(h.deps, settings, "schedule");
    expect(state.lastOutcome).toBe("pin-mismatch");
    expect(h.claude.calls).toEqual(["--version", "--version"]);
    expect(h.notifications).toHaveLength(1);
  });

  it("fails when the pinned version cannot be installed", async () => {
    const h = harness("2.1.292");
    h.claude.on.install = () => exit(1, "✘ Installation failed\nRequest failed with status code 404");
    const state = await runCheck(h.deps, settingsWith({ pinnedVersion: "9.9.999" }), "schedule");
    expect(state.lastOutcome).toBe("failed");
    expect(state.lastMessage).toContain("404");
  });
});

describe("channel", () => {
  it("leaves the install alone when Claude Code follows a different channel", async () => {
    const h = harness("2.1.280", "2.1.292");
    h.pointers.stable = "2.1.285";
    const settings = settingsWith({ channel: "stable" });
    const first = await runCheck(h.deps, settings, "schedule");
    await runCheck(h.deps, settings, "schedule");
    expect(first.lastOutcome).toBe("channel-mismatch");
    expect(first.lastMessage).toContain('"autoUpdatesChannel": "stable"');
    expect(h.claude.calls).toEqual(["--version", "--version"]);
    expect(h.notifications).toHaveLength(1);
  });

  it("updates on stable when Claude Code is on stable too", async () => {
    const h = harness("2.1.280", "2.1.285");
    h.pointers.stable = "2.1.285";
    h.files["/home/u/.claude/settings.json"] = JSON.stringify({ autoUpdatesChannel: "stable" });
    const state = await runCheck(h.deps, settingsWith({ channel: "stable" }), "schedule");
    expect(state.lastOutcome).toBe("updated");
    expect(state.claudeChannel).toBe("stable");
    expect(h.fetched).toEqual(["https://downloads.claude.ai/claude-code-releases/stable"]);
  });
});

describe("schedule arithmetic", () => {
  const now = Date.parse("2026-10-07T10:00:00Z");
  const at = (offsetHours: number) => new Date(now + offsetHours * HOUR).toISOString();

  it("is due at once when nothing was ever checked", () => {
    expect(isDue(EMPTY_STATE, settingsWith(), now)).toBe(true);
    expect(nextCheckAt(EMPTY_STATE, settingsWith())).toBeNull();
  });
  it("is never due when disabled", () => {
    expect(isDue(EMPTY_STATE, settingsWith({ enabled: false }), now)).toBe(false);
  });
  it("is due once the interval has passed", () => {
    const settings = settingsWith({ intervalHours: 4 });
    expect(isDue({ ...EMPTY_STATE, lastCheckAt: at(-3.9) }, settings, now)).toBe(false);
    expect(isDue({ ...EMPTY_STATE, lastCheckAt: at(-4) }, settings, now)).toBe(true);
  });
  it("waits for the backoff after failures", () => {
    const settings = settingsWith({ intervalHours: 4 });
    const state = { ...EMPTY_STATE, lastCheckAt: at(-5), retryNotBefore: at(3) };
    expect(isDue(state, settings, now)).toBe(false);
    expect(isDue(state, settings, now + 3 * HOUR)).toBe(true);
  });
  it("treats an unreadable time as never checked", () => {
    expect(isDue({ ...EMPTY_STATE, lastCheckAt: "garbage" }, settingsWith(), now)).toBe(true);
  });
  it("doubles the wait up to a day, or the interval when that is longer", () => {
    expect([1, 2, 3, 4, 9].map((n) => backoffMs(n, 4 * HOUR) / HOUR)).toEqual([4, 8, 16, 24, 24]);
    expect(backoffMs(5, 48 * HOUR) / HOUR).toBe(48);
  });
});
