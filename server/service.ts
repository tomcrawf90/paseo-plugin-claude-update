import type { PluginHandlerContext } from "@getpaseo/plugin/server";

import type { UpdateSettings } from "../shared/settings";
import type { Activity, ClaudeProcess, Status } from "../shared/status";
import { listClaudeProcesses, staleProcesses } from "./processes";
import type { State } from "./store";
import { isDue, nextCheckAt, runCheck, type Trigger, type UpdaterDependencies } from "./updater";

type PaseoApi = PluginHandlerContext["paseo"];

export interface ServiceOptions {
  /** The wait before the first look after the plugin starts. */
  startupDelayMs?: number;
  /** How often to ask whether a check is due. Short, so a laptop that slept catches up soon after waking. */
  tickMs?: number;
  /** The least time between two scheduled checks, whatever the state on disk says. */
  minimumGapMs?: number;
  platform?: NodeJS.Platform;
}

export interface Service {
  /** One scheduler tick; resolves when any check it started has finished. */
  tick(): Promise<void>;
  /** Checks now. Joins a check already running instead of starting a second one. */
  check(trigger: Trigger, apply: boolean): Promise<State>;
  status(paseo?: PaseoApi): Promise<Status>;
  dismiss(): Promise<void>;
  stop(): void;
}

const HISTORY_SHOWN = 20;

/** Paseo's titles for agents, by id. Best effort: the list is only decoration. */
async function agentTitles(paseo: PaseoApi | undefined): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  if (paseo === undefined) return titles;
  try {
    const { entries } = await paseo.agents.list();
    for (const entry of entries) {
      const agent = (entry as { agent?: { id?: unknown; title?: unknown } }).agent;
      if (typeof agent?.id === "string" && typeof agent.title === "string") titles.set(agent.id, agent.title);
    }
  } catch {
    // Without titles the list still shows ids.
  }
  return titles;
}

/**
 * The schedule. Paseo has no scheduler for plugins, so this is a timer in the
 * plugin's own process: every tick it asks whether a check is due, from the
 * time of the last one on disk. Reloading the plugin or restarting the daemon
 * therefore neither skips a check nor adds one.
 */
export function startService(
  deps: UpdaterDependencies,
  readSettings: () => Promise<UpdateSettings | null>,
  options: ServiceOptions = {},
): Service {
  const startupDelayMs = options.startupDelayMs ?? 30_000;
  const tickMs = options.tickMs ?? 60_000;
  const minimumGapMs = options.minimumGapMs ?? 15 * 60_000;
  const platform = options.platform ?? process.platform;
  let running: Promise<State> | null = null;
  // What the status reports as running. Set as soon as a check is asked for,
  // before its settings are read, so a status read right behind it sees it.
  let activity: Activity | null = null;
  let lastScheduledAt: number | null = null;
  let stopped = false;

  /**
   * The one place a check starts. Callers await between looking at `running`
   * and getting here, so this looks again: whoever arrives second joins the
   * check already running instead of starting another.
   */
  function start(settings: UpdateSettings, trigger: Trigger, apply: boolean): Promise<State> {
    if (running !== null) return running;
    activity = { phase: "checking", trigger, startedAt: activity?.startedAt ?? deps.now().toISOString() };
    const options = {
      apply,
      onPhase(phase: Activity["phase"]) {
        if (activity !== null) activity = { ...activity, phase };
      },
    };
    const check = runCheck(deps, settings, trigger, options).finally(() => {
      running = null;
      activity = null;
    });
    running = check;
    return check;
  }

  async function tick(): Promise<void> {
    if (stopped || running !== null) return;
    try {
      const settings = await readSettings();
      if (settings === null || stopped || running !== null) return;
      const now = deps.now().getTime();
      // The state file says when the last check was. If it cannot be written,
      // every tick would look due; this gap is the stop for that.
      if (lastScheduledAt !== null && now - lastScheduledAt < minimumGapMs) return;
      if (!isDue(await deps.store.readState(), settings, now)) return;
      lastScheduledAt = now;
      await start(settings, "schedule", false);
    } catch (error) {
      console.error("[claude-update] scheduled check failed:", error);
    }
  }

  const startup = setTimeout(() => void tick(), startupDelayMs);
  const interval = setInterval(() => void tick(), tickMs);

  return {
    tick,
    async check(trigger, apply) {
      if (running !== null) return running;
      activity ??= { phase: "checking", trigger, startedAt: deps.now().toISOString() };
      try {
        const settings = await readSettings();
        if (settings === null) throw new Error("The plugin settings are invalid; reset them in Settings.");
        if (running !== null) return running;
        return start(settings, trigger, apply);
      } finally {
        // Nothing started (the settings could not be read): nothing is running.
        if (running === null) activity = null;
      }
    },
    async status(paseo) {
      const [state, settings, history, listed, titles] = await Promise.all([
        deps.store.readState(),
        readSettings(),
        deps.store.readHistory(HISTORY_SHOWN),
        listClaudeProcesses(deps.run, platform),
        agentTitles(paseo),
      ]);
      const stale: ClaudeProcess[] = staleProcesses(listed.processes, state.installedVersion).map((process) => ({
        ...process,
        title: process.agentId === null ? null : (titles.get(process.agentId) ?? null),
      }));
      const next = settings !== null && settings.enabled ? nextCheckAt(state, settings) : null;
      return {
        claudePath: state.claudePath,
        installedVersion: state.installedVersion,
        targetVersion: state.targetVersion,
        claudeChannel: state.claudeChannel,
        lastCheckAt: state.lastCheckAt,
        nextCheckAt: next === null ? null : new Date(next).toISOString(),
        lastOutcome: state.lastOutcome,
        lastMessage: state.lastMessage,
        consecutiveFailures: state.consecutiveFailures,
        previousVersion: state.previousVersion,
        rollbackCommand: state.previousVersion === null ? null : `claude install ${state.previousVersion}`,
        attention: state.attention,
        checking: activity !== null,
        activity,
        staleProcesses: stale,
        processListSupported: listed.supported,
        history,
        dataDirectory: deps.store.directory,
      };
    },
    async dismiss() {
      const state = await deps.store.readState();
      if (state.attention !== null) await deps.store.writeState({ ...state, attention: null });
    },
    stop() {
      stopped = true;
      clearTimeout(startup);
      clearInterval(interval);
    },
  };
}
