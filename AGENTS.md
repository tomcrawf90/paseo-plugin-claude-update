# Maintaining claude-update

A Paseo plugin that runs the Claude Code CLI's own updater on a schedule.

**Why it exists.** Claude Code's native auto-updater is part of its interactive terminal interface.
Paseo runs `claude` headless (`--output-format stream-json`), so on a host that uses Claude mostly
through Paseo the updater never fires and the CLI falls behind; new models then go missing because
they need a newer CLI. `"autoUpdates": false` in `~/.claude.json` is not the cause: it is the native
installer's marker against the old npm updater. See `README.md` for what users are told.

## Layout

| Path | Holds |
| --- | --- |
| `paseo-plugin.json` | Manifest: `id`, `description`, `requirements.paseo`. Paseo Cafe rejects any other key. |
| `index.server.ts` | Daemon entry: wires real dependencies (process runner, fetch, files, clock) into the service and registers settings and RPCs. |
| `server/updater.ts` | One check, start to finish (`runCheck`), plus the schedule arithmetic (`isDue`, `backoffMs`). All the decisions are here. |
| `server/service.ts` | The timer, the one-check-at-a-time guard, and the status the UI reads. |
| `server/claude.ts` | The only calls to the CLI: `--version`, `update`, `install <version>`; the release pointer; Claude's own channel. |
| `server/processes.ts` | Lists running Claude processes and their versions (`ps` + `lsof`, macOS). Read only. |
| `server/store.ts`, `paths.ts`, `run.ts`, `notify.ts` | State and log files; data directory and finding `claude`; running a program without a shell; macOS notification. |
| `shared/` | Settings schema, RPC contracts, version and display helpers. No Node or React imports. |
| `index.client.tsx`, `client/` | Status page, settings screen, sidebar row, Command Center items. React Native primitives only. |
| `test/stub/claude` | A stand-in CLI for tests. `test/support.ts` has the in-memory doubles. |
| `test/cafe-scan.mjs` | Local copy of the Paseo Cafe scanner's rules. |
| `docs/listing-preview.html`, `SUBMISSION.md` | Listing preview and the publish and submission checklist. |

Code lives only in `client/`, `server/`, `shared/` and the two entries; a module at the root does not compile in Paseo.

## Commands

```bash
npm install
npm run typecheck
npm test            # vitest; uses test/stub/claude, no network, no real install
npm run lint:cafe   # Paseo Cafe pre-check
npm run verify      # all three
npm pack --dry-run  # exactly what would be published
```

The stub keeps its "installed version" in files under `STUB_CLAUDE_DIR` (see the comments at its
top). `test/stub-claude.test.ts` puts it on `PATH` with an empty home and drives the real runner,
store and service against it.

## Trying it against a throwaway home

Never run `claude update` against the real install while developing, and never touch
`~/.local/bin/claude`, `~/.local/share/claude` or `~/.claude.json`. To exercise the real CLI, copy
it and give it a home of its own:

```bash
S=/tmp/cc-sandbox
mkdir -p $S/.local/bin $S/.local/share/claude/versions
cp ~/.local/share/claude/versions/<an older version> $S/.local/share/claude/versions/
ln -s $S/.local/share/claude/versions/<that version> $S/.local/bin/claude
printf '{"installMethod":"native","autoUpdates":false,"autoUpdatesProtectedForNative":true}' > $S/.claude.json

# Gate: every path doctor prints must be under the sandbox. If one is not, stop.
env -i HOME=$S PATH=/usr/bin:/bin USER=$USER $S/.local/bin/claude doctor </dev/null
```

`env -i` matters: a shell inside a Claude session has `CLAUDE_CODE_EXECPATH` pointing at the real
binary. On macOS, wrap commands in `sandbox-exec -f profile.sb` with a profile that denies
`file-write*` under the real `~/.local`, `~/.claude*` and `~/.paseo` for a hard guarantee (in the
2026-10-07 run `ps` failed to start with EPERM under such a profile, cause not confirmed, so the
process list read as unsupported there).

To run the plugin itself, use a second daemon with its own home and port, never the live one:

```bash
mkdir -p /tmp/pcu-paseo
printf '{"version":1,"daemon":{"listen":"127.0.0.1:6790","relay":{"enabled":false}},"pluginsEnabled":true}' > /tmp/pcu-paseo/config.json
env -i HOME=$S PATH="$(dirname "$(which node)"):/usr/bin:/bin" USER=$USER paseo daemon run --home /tmp/pcu-paseo &
paseo --host 127.0.0.1:6790 plugin install /absolute/path/to/a/copy/of/this/repo
paseo --host 127.0.0.1:6790 plugin logs claude-update
ls /tmp/pcu-paseo/plugin-data/claude-update/
paseo daemon stop --home /tmp/pcu-paseo
```

Every `paseo` command must carry `--host 127.0.0.1:6790` (or `--home /tmp/pcu-paseo` for `daemon`
subcommands); without it the command goes to the live daemon. With `HOME=$S` the plugin finds the
copied CLI and updates that. Desktop notifications still reach the real screen: turn them off or
expect one. Afterwards compare `ls -la ~/.local/bin/claude ~/.local/share/claude/versions` with
before, and remove `/tmp/cc-sandbox` and `/tmp/pcu-paseo`.

## Conventions

- Commits: one logical change each, imperative subject in sentence case, on `main` until there is a remote.
- No credentials in code, tests, logs or commits. `ps -E` output contains every process's environment: take `PASEO_AGENT_ID` from it and nothing else, and never log or store the raw text.
- The install changes only through `claude update` and `claude install <version>`. Never download a release, write under `~/.local/share/claude`, relink `~/.local/bin/claude`, or read-modify-write `~/.claude.json` or `~/.claude/settings.json` (the latter is read, never written).
- Never restart, stop or message an agent. The plugin lists old processes and stops there.
- Start processes with `execFile` only. The Paseo Cafe scanner fails any source file, comments and tests included, that contains the text of a synchronous process call, a shell `-c`, or a command-line download tool; `npm run lint:cafe` checks this.
- A check makes one attempt and never retries inside itself. Anything optional after a successful update (counting old processes, notifying) must not be able to lose the record of it.
- UI: React Native primitives, colours from `theme.colors`, padding from `layout.compact`.
- Every behaviour change comes with a test. A new CLI output or failure mode goes into `test/stub/claude` too.

## Releases

1. Change `version` in `package.json` (semantic versioning; Paseo Cafe detects updates by this number, so never reuse one).
2. Add a dated entry to `CHANGELOG.md`.
3. `npm run verify` and `npm pack --dry-run`.
4. Commit, tag `v<version>`, and, once there is a remote, push.
5. Publishing to npm and submitting to Paseo Cafe are the owner's decisions; the steps and every form field are in [SUBMISSION.md](SUBMISSION.md). After the first listing, a new npm version is picked up without a new submission.

If the minimum Paseo version changes, update `requirements.paseo` in `paseo-plugin.json`, the
`@getpaseo/plugin` version in `package.json`, and the README. It is `>=0.10.3` because that is the
only version the plugin has been typechecked and run against.

## Known limits and unverified points

| Point | State |
| --- | --- |
| `claude update` with no terminal, from a plugin subprocess | Verified 2026-10-07 on macOS with CLI 2.1.285 → 2.1.292 in a throwaway daemon and home. |
| `claude install <version>` with no terminal | Verified the same way (used for a pin and as the rollback). |
| Status page, settings screen, sidebar row, toasts in the app | Not seen in the app. Typechecked only. Changing the sidebar row by removing and re-adding it is an assumption about `addSidebarItem` in 0.10; Paseo 0.11 documents runtime add and remove for its newer `addSidebarHeaderItem`/`addSidebarFooterItem` and calls `addSidebarItem` deprecated. |
| Cost of the status call | `status.get` runs `ps`, `lsof` and an agent list each time, and is polled every 60 s by each connected app and every 30 s by an open status page. Fine on one machine; a lighter notice-only call is the obvious next step if it ever matters. |
| macOS notification raised from the daemon | Not confirmed. One may have been raised during the throwaway-daemon run; errors from it are swallowed by design and nobody was watching the screen. |
| Listing old processes | The plugin's own code was run read-only on the host on 2026-10-07 and classified 11 live processes correctly (agents, Claude's daemon, a leftover 2.1.269 process). Not exercised through a daemon: in the sandboxed throwaway daemon `ps` failed to start (EPERM). |
| Linux, Windows | Untested. The process list and notifications are macOS only by design. |
| Homebrew, WinGet, npm installs of Claude Code | Not supported; `claude update` is for the native installer. |
| An update cut short by a plugin reload or daemon stop | Not tested. The CLI is assumed to leave the old version in place. |
| Whether Paseo's "refresh" of an agent starts a new `claude` process | Unknown, so no "restart this agent" action is offered. |

## When Claude Code changes

| Change | What to check |
| --- | --- |
| Output of `claude --version` | `extractVersion` in `shared/version.ts`. Only this output is parsed; success is judged by comparing versions before and after, never by the updater's wording. |
| Exit codes of `update` / `install` | `runCheck`. Today: 0 on success and on "up to date"; 0 with no change when updates are disabled by policy; 1 on a failed download or unknown version. |
| Release pointer URL | `RELEASES_URL` in `server/claude.ts` (`https://downloads.claude.ai/claude-code-releases/<channel>`, a bare version). If it moves, checks fail with a clear message and nothing is installed. |
| Channels | `CHANNELS` in `shared/settings.ts`. The CLI also accepts an undocumented `rc`; it is left out on purpose. `claude update` follows `autoUpdatesChannel` in `~/.claude/settings.json`, which the plugin reads to detect a mismatch. |
| A check-only or dry-run flag on `claude update` | None exists (2.1.292). If one appears, use it in place of the release pointer. |
| Headless sessions start updating themselves | The plugin becomes a status display; "Only tell me" is already the default. |
| Install location | `findClaude` in `server/paths.ts` and the `/claude/versions/<version>` pattern in `server/processes.ts`. |
| New settings that block updates (`DISABLE_UPDATES`, `minimumVersion`, managed ranges) | They apply inside the CLI. The plugin reports "exited 0 but the version is still …" with the CLI's own words. |

Re-run the throwaway-home recipe above after any such change; the stub only proves the plugin's own logic.
