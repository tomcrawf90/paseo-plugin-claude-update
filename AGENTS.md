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
| `index.client.tsx`, `client/` | Status page, settings screen, sidebar row, Command Center items. React Native primitives only. Three modules hold logic apart from React Native so it can be tested: `client/sidebar.ts` (adding, changing and removing the row, one change at a time), `client/activity.ts` (what the buttons and the progress line say) and `client/bus.ts` (passes each status read to the sidebar row). `test/client-entry.test.ts` runs the entry against a pretend app. |
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

Three facts about Paseo 0.10.3 that help here (read from the daemon's code, then used):

| Fact | Detail |
| --- | --- |
| Where settings live | `$PASEO_HOME/plugin-settings/claude-update/update.json`, as `{"version": 1, "values": {…}}`. It is read from disk on every read, and `paseo plugin install` leaves an existing file alone (`remove` deletes it), so writing it before installing fixes the mode before the first check. |
| A directory install runs in place | Paseo loads the plugin from the directory it was installed from. Edits to that checkout reach the running plugin at its next reload. |
| Calling an RPC without the app | `DaemonClient` in `@getpaseo/client` (`dist/daemon-client.js`, an internal module) has `invokePluginRpc(pluginId, method, input)`. Connect to `ws://127.0.0.1:<port>/ws` with any non-empty `clientId`, then call `status.get`, or `status.check` with `{ "apply": false }` to look without installing. |

## Conventions

- Commits: one logical change each, imperative subject in sentence case, on `main` until there is a remote.
- No credentials in code, tests, logs or commits. `ps -E` output contains every process's environment: take `PASEO_AGENT_ID` from it and nothing else, and never log or store the raw text.
- The install changes only through `claude update` and `claude install <version>`. Never download a release, write under `~/.local/share/claude`, relink `~/.local/bin/claude`, or read-modify-write `~/.claude.json` or `~/.claude/settings.json` (the latter is read, never written). That rule is about this plugin's code. The CLI's own installer does write there: `claude install <version>` (pin and rollback) rewrites `installMethod`, `autoUpdates` and `autoUpdatesProtectedForNative` in `~/.claude.json`, so never describe the plugin as leaving that file untouched.
- Never restart, stop or message an agent. The plugin lists old processes and stops there.
- Start processes with `execFile` only. The Paseo Cafe scanner fails any source file, comments and tests included, that contains the text of a synchronous process call, a shell `-c`, or a command-line download tool; `npm run lint:cafe` checks this.
- A fresh install has "Auto-update Claude Code" off. Only two things install: the schedule with that switch on, and "Update now" (`apply: true`). "Check now" (`apply: false`) must stay look-only either way.
- The switch is stored as `mode` (`notify` off, `auto` on) under settings version 1, as 0.1.0 stored its two-way choice. Do not rename the key or raise the version for it: an installed plugin's settings file must keep reading as the choice it held, without being rewritten.
- No sidebar row while there is nothing for the user to do. `sidebarRow` in `shared/format.ts` is the one rule for when there is a row and what it says: an update that will not install itself (`autoInstall` in the status is false), a failure, a mismatch. An update that went in never has a row or a toast, and the rule is not given the process list, so old processes cannot bring one; they are on the status page only. A title is at most `SIDEBAR_TITLE_MAX` (20) characters, so that it stays on one line; the detail goes on the status page. Nothing may say "up to date" outside the status page.
- The buttons follow the host: `activity` in the status says what is running, since when and whether it has reached the installer, and is set the moment a check is asked for. The page asks every 2 seconds while it is set.
- A failure is told at the third in a row, or at once when the check had reached the installer (`fail` in `server/updater.ts`; told at the first failure of that install, through `failedInstall` in the state, and again only if the failures reach three in a row). While that notice is showing, a look that works leaves it alone, and the update still waiting is told again by the first look after it is dismissed.
- A check makes one attempt and never retries inside itself. The state is written first; anything after a successful update (the history line, the log line, counting old processes, notifying) must not be able to lose the record of it.
- UI: React Native primitives, colours from `theme.colors`, padding from `layout.compact`.
- Every behaviour change comes with a test. A new CLI output or failure mode goes into `test/stub/claude` too.

## Releases

1. Change `version` in `package.json` (semantic versioning; Paseo Cafe detects updates by this number, so never reuse one).
2. Add a dated entry to `CHANGELOG.md`.
3. `npm run verify` and `npm pack --dry-run`.
4. Commit, tag `v<version>`, and, once there is a remote, push.
5. Publishing to npm and submitting to Paseo Cafe are the owner's decisions; the steps and every form field are in [SUBMISSION.md](SUBMISSION.md). After the first listing, a new npm version is picked up without a new submission.

If the minimum Paseo version changes, update `requirements.paseo` in `paseo-plugin.json`, the
`@getpaseo/plugin` version in `package.json`, and the README. It is `>=0.10.3 <0.12.0 || >=0.11.0-beta.1 <0.12.0`: 0.10.3 is the
only version the plugin has been typechecked and run against, and the second half is there because a
plain `>=0.10.3` does not match an 0.11 beta. Raise the `<0.12.0` bound once it has run on 0.12.

## Known limits and unverified points

| Point | State |
| --- | --- |
| `claude update` with no terminal, from a plugin subprocess | Verified 2026-10-07 on macOS with CLI 2.1.285 → 2.1.292 in a throwaway daemon and home. |
| `claude install <version>` with no terminal | Verified the same way (used for a pin and as the rollback). |
| Status page, settings screen, sidebar row in the app | 0.1.0 was used in the app by its owner on 2026-10-07 (an update through "Update now" worked). The 0.2.0 sidebar row was seen in the app by its owner the same day ("Claude Code updated · 6 on an old version", wrapped onto two lines), which is why 0.2.1 has no row after an update and keeps titles to 20 characters. The 0.2.1 row and the other 0.2 screens have not been seen in the app: they were drawn outside it with react-native-web from the bundle a 0.10.3 daemon built, and the entry was run against a pretend app. |
| No sidebar row after an update (0.2.1) | Checked 2026-10-07 in a throwaway 0.10.3 daemon with the stub CLI: after a scheduled update `status.get` reported `updated` with two processes on another version, and the client entry, given that answer by a pretend app, registered no row. A look with auto-update off gave "Claude update ready", and a failed "Update now" gave "Claude update failed", which a following look left in place. Not seen in the app's own sidebar, so that the titles stay on one line there is taken from their length (20 characters at most, against the 33 that fitted on the first line of the 0.2.0 row in the owner's screenshot), not seen. |
| Adding and removing the sidebar row at runtime | Read from the Paseo 0.10.3 app bundle, not from documentation: the function `addSidebarItem` returns takes the item out of the list, frees its id and tells the app to redraw, at any time; a plugin may register no row at start. Paseo 0.11 documents runtime add and remove for its newer `addSidebarHeaderItem`/`addSidebarFooterItem` and calls `addSidebarItem` deprecated, so move to those when 0.10 support is dropped. |
| `useSettings` on the status page | The switch at the top of the status page saves through `useSettings`, which the app builds on the same RPC and query hooks the page already used. Not seen working in the app. |
| Cost of the status call | `status.get` runs `ps`, `lsof` and an agent list each time, and is polled every 60 s by each connected app and every 30 s by an open status page (every 2 s while a check is running). Fine on one machine; a lighter notice-only call is the obvious next step if it ever matters. |
| macOS notification raised from the daemon | Not confirmed. One may have been raised during the throwaway-daemon run; errors from it are swallowed by design and nobody was watching the screen. |
| Listing old processes | Verified through a live 0.10.3 daemon on 2026-10-07 (`status.get`): supported, and it reported the one process on an old version (a leftover 2.1.269) while the ten on the installed version were not listed. A home directory with a space in it is covered by tests only. |
| A manual look-only check | Verified through a live daemon the same day: `status.check` with `apply: false` reported 2.1.285 against 2.1.292 and ran only `claude --version`. |
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
| Channels | `CHANNELS` in `shared/settings.ts`. The CLI also accepts an undocumented `rc`; it is left out on purpose. `claude update` follows `autoUpdatesChannel` in `~/.claude/settings.json`, which the plugin reads to detect a mismatch. Managed and project settings can set it too and are not read (`readClaudeChannel` in `server/claude.ts`). |
| A check-only or dry-run flag on `claude update` | None exists (2.1.292). If one appears, use it in place of the release pointer. |
| Headless sessions start updating themselves | The plugin becomes a status display; auto-update off is already the default. |
| Install location | `findClaude` in `server/paths.ts` and the `/claude/versions/<version>` pattern in `server/processes.ts`. |
| New settings that block updates (`DISABLE_UPDATES`, `minimumVersion`, managed ranges) | They apply inside the CLI. The plugin reports "exited 0 but the version is still …" with the CLI's own words. |

Re-run the throwaway-home recipe above after any such change; the stub only proves the plugin's own logic.
