import { DEFAULT_SETTINGS, type UpdateSettings } from "../shared/settings";
import type { HistoryEntry } from "../shared/status";
import type { RunResult, Runner } from "../server/run";
import { EMPTY_STATE, type State, type Store } from "../server/store";
import type { UpdaterDependencies } from "../server/updater";

/** Test doubles shared by the test files. */

export function memoryStore(initial: Partial<State> = {}): Store & { state: State; history: HistoryEntry[]; lines: string[] } {
  const store = {
    directory: "/memory",
    state: { ...EMPTY_STATE, ...initial } as State,
    history: [] as HistoryEntry[],
    lines: [] as string[],
    async readState() {
      return { ...store.state };
    },
    async writeState(state: State) {
      store.state = { ...state };
    },
    async appendHistory(entry: HistoryEntry) {
      store.history.push(entry);
    },
    async readHistory(limit: number) {
      return store.history.slice(-limit).reverse();
    },
    async log(line: string) {
      store.lines.push(line);
    },
  };
  return store;
}

export const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "", error: null, timedOut: false });
export const exit = (code: number, stdout = "", stderr = ""): RunResult => ({ code, stdout, stderr, error: null, timedOut: false });

/**
 * A pretend CLI: `installed` is what `--version` reports, `update` moves it to
 * `latest`, `install <v>` moves it to `v`. Override one command's behaviour
 * with `on`.
 */
export interface FakeClaude {
  installed: string;
  latest: string;
  calls: string[];
  on: Partial<Record<"--version" | "update" | "install", (args: readonly string[]) => RunResult | Promise<RunResult>>>;
  run: Runner;
}

export function fakeClaude(installed: string, latest = installed): FakeClaude {
  const fake: FakeClaude = {
    installed,
    latest,
    calls: [],
    on: {},
    async run(file, args) {
      if (!file.endsWith("claude")) return exit(127, "", `unexpected program ${file}`);
      fake.calls.push(args.join(" "));
      const command = args[0] as "--version" | "update" | "install";
      const override = fake.on[command];
      if (override) return override(args);
      if (command === "--version") return ok(`${fake.installed} (Claude Code)\n`);
      if (command === "update") {
        if (fake.installed === fake.latest) return ok(`Claude Code is up to date (${fake.installed})\n`);
        const from = fake.installed;
        fake.installed = fake.latest;
        return ok(`Successfully updated from ${from} to version ${fake.latest}\n`);
      }
      if (command === "install") {
        fake.installed = args[1] ?? fake.installed;
        return ok("✔ Claude Code successfully installed!\n");
      }
      return exit(2, "", "unsupported");
    },
  };
  return fake;
}

export interface Harness {
  deps: UpdaterDependencies;
  claude: FakeClaude;
  store: ReturnType<typeof memoryStore>;
  notifications: string[];
  fetched: string[];
  /** What the channel pointers hold; set one to an Error to fail the read. */
  pointers: Record<string, string | Error>;
  clock: { now: number };
  files: Record<string, string>;
}

export function harness(installed: string, latest = installed, state: Partial<State> = {}): Harness {
  const claude = fakeClaude(installed, latest);
  const store = memoryStore(state);
  const h: Harness = {
    claude,
    store,
    notifications: [],
    fetched: [],
    pointers: { latest, stable: installed },
    clock: { now: Date.parse("2026-10-07T10:00:00Z") },
    files: {},
    deps: {
      run: claude.run,
      async fetchText(url) {
        h.fetched.push(url);
        const value = h.pointers[url.split("/").pop() ?? ""];
        if (value === undefined) throw new Error("HTTP 404");
        if (value instanceof Error) throw value;
        return `${value}\n`;
      },
      now: () => new Date(h.clock.now),
      async readFile(path) {
        return h.files[path] ?? null;
      },
      async isExecutable(path) {
        return path === "/home/u/.local/bin/claude" || path === "/opt/claude";
      },
      env: { PATH: "/usr/bin" },
      home: "/home/u",
      store,
      async notify(_title, message) {
        h.notifications.push(message);
      },
      async countStale() {
        return 2;
      },
    },
  };
  return h;
}

/** Settings for a test. Most tests are about installing, so the mode here is `auto`, not the shipped default. */
export const settingsWith = (patch: Partial<UpdateSettings> = {}): UpdateSettings => ({ ...DEFAULT_SETTINGS, mode: "auto", ...patch });
