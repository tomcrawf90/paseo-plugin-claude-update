import type { UpdateSettings } from "../shared/settings";
import type { Attention, HistoryEntry, Outcome } from "../shared/status";
import { compareVersions } from "../shared/version";
import {
  describeFailure,
  outputTail,
  readChannelVersion,
  readClaudeChannel,
  readInstalledVersion,
  runInstall,
  runUpdate,
  type FetchText,
} from "./claude";
import { findClaude } from "./paths";
import type { Runner } from "./run";
import type { State, Store } from "./store";

export type Trigger = "schedule" | "manual";

export interface UpdaterDependencies {
  run: Runner;
  fetchText: FetchText;
  now(): Date;
  /** The file's text, or null when it does not exist. */
  readFile(path: string): Promise<string | null>;
  isExecutable(path: string): Promise<boolean>;
  env: NodeJS.ProcessEnv;
  home: string;
  store: Store;
  /** Raises an operating-system notification; does nothing where there is none. Never throws. */
  notify(title: string, message: string): Promise<void>;
  /** How many Claude processes are running a version other than `installed`; null when unknown. */
  countStale(installed: string): Promise<number | null>;
}

const HOUR_MS = 60 * 60_000;
const MAX_BACKOFF_MS = 24 * HOUR_MS;
/** A failure is logged every time and raised to the user once, when it has happened this many times in a row. */
export const FAILURE_ALERT_AFTER = 3;
const NOTIFICATION_TITLE = "Claude Code update";

function time(text: string | null): number | null {
  if (text === null) return null;
  const value = Date.parse(text);
  return Number.isNaN(value) ? null : value;
}

/**
 * How long to wait after the nth failure in a row: the normal interval, then
 * double each time, up to a day (or the interval, when that is longer). So a
 * host that is offline is asked a handful of times a day, not every minute.
 */
export function backoffMs(failures: number, intervalMs: number): number {
  const doubled = intervalMs * 2 ** Math.max(0, failures - 1);
  return Math.min(doubled, Math.max(MAX_BACKOFF_MS, intervalMs));
}

/** When the next scheduled check is due; null when nothing has been checked yet, which means now. */
export function nextCheckAt(state: State, settings: UpdateSettings): number | null {
  const last = time(state.lastCheckAt);
  if (last === null) return null;
  return Math.max(last + settings.intervalHours * HOUR_MS, time(state.retryNotBefore) ?? 0);
}

export function isDue(state: State, settings: UpdateSettings, now: number): boolean {
  if (!settings.enabled) return false;
  const next = nextCheckAt(state, settings);
  return next === null || now >= next;
}

export interface CheckOptions {
  /**
   * Install whatever the mode: the user pressed "Update now". Without it a
   * manual check only looks, and only the schedule installs, in `auto` mode.
   */
  apply?: boolean;
}

/**
 * One check, start to finish. It reads the installed version and the version
 * the channel points at, installs when it should, and writes down what
 * happened. It runs the CLI at most once to change anything and never retries
 * inside itself: a failure waits for the next scheduled check.
 *
 * Only two commands ever change the install, both the CLI's own:
 * `claude update`, and `claude install <version>` for a pin. Nothing here
 * writes to the install directory, the launcher or `~/.claude.json`; the CLI
 * does, and `claude install` rewrites its install keys in `~/.claude.json`.
 */
export async function runCheck(
  deps: UpdaterDependencies,
  settings: UpdateSettings,
  trigger: Trigger,
  options: CheckOptions = {},
): Promise<State> {
  const { store } = deps;
  const previous = await store.readState();
  const at = deps.now().toISOString();
  // "Check now" must never install: only "Update now" does, or the schedule in auto mode.
  const wantApply = options.apply === true || (trigger === "schedule" && settings.mode === "auto");
  // Why a look that found something left it alone, for the message.
  const untouched =
    trigger === "schedule"
      ? "Nothing was changed."
      : settings.mode === "auto"
        ? 'Nothing was changed: the next scheduled check installs it, or use "Update now".'
        : 'Nothing was changed. Use "Update now" to install it.';
  const known: Partial<State> = {};

  /**
   * Writes down a finished check. The state goes first and is the only write
   * that may fail the check: it holds what a later check and the rollback note
   * need, such as the version before an update. The history line and the log
   * line are records of it and are attempted whatever happens to each other.
   */
  async function save(state: State, line: string, history?: HistoryEntry): Promise<State> {
    let failure: unknown = null;
    try {
      await store.writeState(state);
    } catch (error) {
      failure = error;
    }
    if (history !== undefined) {
      await store.appendHistory(history).catch((error: unknown) => console.error("[claude-update] could not write the history:", error));
    }
    await store.log(`${at} ${trigger} ${line}`).catch((error: unknown) => console.error("[claude-update] could not write the log:", error));
    if (failure !== null) throw failure;
    return state;
  }

  function entry(outcome: Outcome, message: string, from: string | null, to: string | null): HistoryEntry {
    return { at, trigger, outcome, from, to, target: known.targetVersion ?? null, message };
  }

  /** A success with nothing new to say: no history line, no notice. */
  function quiet(outcome: Outcome, message: string): Promise<State> {
    return save(
      {
        ...previous,
        ...known,
        lastCheckAt: at,
        lastOutcome: outcome,
        lastMessage: message,
        consecutiveFailures: 0,
        retryNotBefore: null,
        // A failure notice is stale once a check works again.
        attention: previous.attention?.kind === "failed" ? null : previous.attention,
      },
      `${outcome}: ${message}`,
    );
  }

  /**
   * News for the user. With a `key`, the same news is told once and is quiet
   * after that; a change to the install has no key and is always told.
   */
  async function notable(
    outcome: Outcome,
    kind: Attention["kind"],
    message: string,
    extra: Partial<State>,
    change: { from: string | null; to: string | null; key: string | null },
  ): Promise<State> {
    if (change.key !== null && previous.announced === change.key) return quiet(outcome, message);
    const saved = await save(
      {
        ...previous,
        ...known,
        ...extra,
        lastCheckAt: at,
        lastOutcome: outcome,
        lastMessage: message,
        consecutiveFailures: 0,
        retryNotBefore: null,
        attention: { kind, message, at },
        announced: change.key,
      },
      `${outcome}: ${message}`,
      entry(outcome, message, change.from, change.to),
    );
    if (settings.desktopNotifications) await deps.notify(NOTIFICATION_TITLE, message).catch(() => undefined);
    return saved;
  }

  async function fail(message: string): Promise<State> {
    const failures = previous.consecutiveFailures + 1;
    const retryNotBefore = new Date(deps.now().getTime() + backoffMs(failures, settings.intervalHours * HOUR_MS)).toISOString();
    const alert = failures === FAILURE_ALERT_AFTER;
    const notice = `Claude Code update check has failed ${failures} times in a row. Last error: ${message}`;
    const saved = await save(
      {
        ...previous,
        ...known,
        lastCheckAt: at,
        lastOutcome: "failed",
        lastMessage: message,
        consecutiveFailures: failures,
        retryNotBefore,
        attention: alert ? { kind: "failed", message: notice, at } : previous.attention,
      },
      `failed (${failures} in a row, next not before ${retryNotBefore}): ${message}`,
      entry("failed", message, known.installedVersion ?? null, null),
    );
    if (alert && settings.desktopNotifications) await deps.notify(NOTIFICATION_TITLE, notice).catch(() => undefined);
    return saved;
  }

  const claudePath = await findClaude({
    configured: settings.claudePath,
    home: deps.home,
    env: deps.env,
    isExecutable: deps.isExecutable,
  });
  if (claudePath === null) {
    return fail(
      settings.claudePath.trim() === ""
        ? "Could not find the claude launcher in ~/.local/bin or on PATH. Set its path in the plugin settings."
        : `The configured claude path is not an executable file: ${settings.claudePath}`,
    );
  }
  known.claudePath = claudePath;

  const before = await readInstalledVersion(deps.run, claudePath, deps.env);
  if ("error" in before) return fail(before.error);
  const installed = before.version;
  known.installedVersion = installed;
  known.claudeChannel = await readClaudeChannel(deps.readFile, deps.home);

  const pin = settings.pinnedVersion;
  if (pin !== "") {
    known.targetVersion = pin;
    if (installed === pin) return quiet("pinned", `Claude Code is pinned at ${pin}.`);
    if (!wantApply) {
      return notable(
        "pin-mismatch",
        "pin-mismatch",
        `Claude Code is pinned at ${pin} but ${installed} is installed. ${untouched}`,
        {},
        { from: installed, to: null, key: `pin-mismatch:${pin}:${installed}` },
      );
    }
    const result = await runInstall(deps.run, claudePath, pin, deps.env);
    if (result.code !== 0) return fail(describeFailure(`claude install ${pin}`, result));
    const after = await readInstalledVersion(deps.run, claudePath, deps.env);
    if ("error" in after) return fail(after.error);
    known.installedVersion = after.version;
    if (after.version !== pin) {
      return fail(`claude install ${pin} exited 0 but the installed version is ${after.version}: ${outputTail(result)}`);
    }
    return notable(
      "pin-applied",
      "updated",
      `Moved Claude Code from ${installed} to the pinned version ${pin}. New agents use ${pin}. To go back: claude install ${installed}`,
      { previousVersion: installed },
      { from: installed, to: pin, key: null },
    );
  }

  let target: string;
  try {
    target = await readChannelVersion(deps.fetchText, settings.channel);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return fail(`Could not read the ${settings.channel} release pointer: ${reason}`);
  }
  known.targetVersion = target;

  if (compareVersions(installed, target) >= 0) {
    return quiet("up-to-date", `Claude Code ${installed} is up to date (${settings.channel} is ${target}).`);
  }

  if (!wantApply) {
    return notable(
      "update-available",
      "update-available",
      `Claude Code ${target} is available (${installed} is installed). ${untouched}`,
      {},
      { from: installed, to: null, key: `available:${installed}:${target}` },
    );
  }

  // `claude update` follows Claude Code's own channel, not this plugin's. When
  // they differ it would install something other than what was compared, so
  // say so and leave the install alone.
  if (known.claudeChannel !== settings.channel) {
    const theirs = known.claudeChannel ?? "unreadable";
    return notable(
      "channel-mismatch",
      "channel-mismatch",
      `Claude Code ${target} is available on the ${settings.channel} channel, but Claude Code's own channel is ${theirs}, which is what "claude update" follows. Nothing was changed. Set "autoUpdatesChannel": "${settings.channel}" in ~/.claude/settings.json, or change this plugin's channel.`,
      {},
      { from: installed, to: null, key: `channel:${settings.channel}:${theirs}:${target}` },
    );
  }

  const result = await runUpdate(deps.run, claudePath, deps.env);
  if (result.code !== 0) return fail(describeFailure("claude update", result));
  const after = await readInstalledVersion(deps.run, claudePath, deps.env);
  if ("error" in after) return fail(after.error);
  known.installedVersion = after.version;
  // The exit code alone is not proof: with updates disabled by policy the CLI
  // prints why and still exits 0.
  if (compareVersions(after.version, installed) <= 0) {
    return fail(`claude update exited 0 but the installed version is still ${after.version}: ${outputTail(result)}`);
  }
  // The update is done; counting what is still on the old version only
  // decorates the message and must not stop it being recorded.
  const stale = await deps.countStale(after.version).catch(() => null);
  const running =
    stale === null || stale === 0
      ? `Running agents keep ${installed} until they are restarted.`
      : `${stale} running Claude ${stale === 1 ? "process is" : "processes are"} still on an older version until restarted.`;
  return notable(
    "updated",
    "updated",
    `Updated Claude Code from ${installed} to ${after.version}. New agents use ${after.version}. ${running} To go back: claude install ${installed}`,
    { previousVersion: installed },
    { from: installed, to: after.version, key: null },
  );
}
