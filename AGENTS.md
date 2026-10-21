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
| `paseo-plugin.json` | Manifest: `id`, `description`, `requirements.paseo`. Paseo Cafe rejects any other key while the minimum is below 0.11, and Paseo 0.10 refuses `name`, `icon` and `media`. The description is the same sentence as `package.json`'s. |
| `OVERVIEW.md` | The official Paseo directory's page for the plugin, shipped in the package: what it installs, runs, reads and sends. No install commands in it. |
| `images/` | The listing screenshots, made by `npm run screenshots`. Paseo Cafe shows every file here, so nothing but images; each is shown in the README. |
| `index.server.ts` | Daemon entry: wires real dependencies (process runner, fetch, files, clock) into the service and registers settings and RPCs. |
| `server/updater.ts` | One check, start to finish (`runCheck`), plus the schedule arithmetic (`isDue`, `backoffMs`). All the decisions are here. |
| `server/service.ts` | The timer, the one-check-at-a-time guard, and the status the UI reads. |
| `server/handlers.ts` | The three RPCs (`status.get`, `status.check`, `status.dismiss`), each answering with the status after the call. |
| `server/notes.ts`, `shared/notes.ts` | Release notes: which versions to show (`notesRange`), when to read them again (`notesWanted`), reading and cutting the changelog (`parseChangelog`, `selectNotes`). The service reads them after a check, never inside one. |
| `server/claude.ts` | The only calls to the CLI: `--version`, `update`, `install <version>`; the release pointer; Claude's own channel. |
| `server/processes.ts` | Lists running Claude processes and their versions (`ps` + `lsof`, macOS). Read only. |
| `server/store.ts`, `paths.ts`, `run.ts`, `notify.ts` | State, notes and log files; data directory and finding `claude`; running a program without a shell; macOS notification. |
| `shared/` | Settings schema, RPC contracts, version and display helpers. No Node or React imports. |
| `index.client.tsx`, `client/` | Status page, settings screen, sidebar row, Command Center items. React Native primitives only. Three modules hold logic apart from React Native so it can be tested: `client/sidebar.ts` (adding, changing and removing the row, one change at a time), `client/activity.ts` (what the buttons and the progress line say) and `client/bus.ts` (passes each status read to the sidebar row). `client/check.ts` is the hook both screens use for the status and the two buttons. What the "Checks" lines say (last check, last result, last update, next check) is in `shared/format.ts`. `test/client-entry.test.ts` runs the entry against a pretend app. |
| `test/stub/claude` | A stand-in CLI for tests. `test/support.ts` has the in-memory doubles. |
| `test/listing-check.mjs` | Local copy of both listings' rules that can be checked here (`npm run lint:listings`). |
| `SUBMISSION.md` | What each listing needs and the exact submission for each. |
| `scripts/daemon.mjs`, `scripts/screenshots.mjs`, `test/stub/fake-ps/` | A throwaway daemon of any Paseo version with the plugin installed and the stand-in CLI; the screenshot run on top of it (Paseo's web app in headless Chrome, a made-up process list, the host name "Demo Mac"). Not published, never run in CI. |
| `scripts/release.mjs` | The release checks (`check`, `unpublished`, `notes`) and the version bump (`prepare`). Plain Node, no dependencies; `scripts/release.test.mjs` tests it. Not published. |
| `.github/workflows/ci.yml` | Verify on Linux and macOS with Node 22 and 24, lint the workflows, and one `CI passed` check for branch protection. |
| `.github/workflows/release.yml` | Runs on a pushed tag `vX.Y.Z`: verify, publish to npm, GitHub release. npm names this file as the trusted publisher, so do not rename it. |
| `RELEASING.md` | The release steps, the one-time npm setup, what to do when a release fails, the repository settings to switch on. |
| `CONTRIBUTING.md`, `SECURITY.md`, `.github/` templates, `.github/dependabot.yml` | For people outside. Dependabot opens no version-update pull requests for `@getpaseo/plugin`, `react`, `react-native` and `@types/react`: they follow the supported Paseo version. A security update for one of them still comes, and is judged against that version. |

Code lives only in `client/`, `server/`, `shared/` and the two entries; a module at the root does not compile in Paseo.

## Commands

```bash
npm install
npm run typecheck
npm test            # vitest; uses test/stub/claude, no network, no real install
npm run lint:listings   # official directory and Paseo Cafe pre-check
npm run screenshots     # retake images/ (macOS, Chrome; starts its own throwaway daemon)
npm run check:release   # package.json and the top CHANGELOG.md entry name the same version
npm run verify      # all four
npm pack --dry-run  # exactly what would be published
actionlint          # after changing a workflow (CI runs it too)
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

`scripts/daemon.mjs` does all of this with the stand-in CLI in a temporary directory (`installPaseo`,
`copyPlugin`, `startDaemon`); the steps by hand, with a copied real CLI, follow.

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
| Calling an RPC without the app | `DaemonClient` in `@getpaseo/client` (the export `@getpaseo/client/internal/daemon-client`, in 0.10.3 and 0.12.0; `scripts/daemon.mjs` loads it from the same install as the daemon) has `invokePluginRpc(pluginId, method, input)`. Connect to `ws://127.0.0.1:<port>/ws` with any non-empty `clientId`, then call `status.get`, or `status.check` with `{ "apply": false }` to look without installing. |

## Conventions

- Commits: one logical change each, imperative subject in sentence case. Changes reach `main` through a pull request (<https://github.com/tomcrawf90/paseo-plugin-claude-update>); nothing is pushed to `main` directly.
- Workflows: actions pinned to a commit with the version in a comment (Dependabot updates both), `permissions: {}` at the top and the least each job needs, no secret but the optional `NPM_TOKEN`. The job that publishes installs no dependencies and runs no package script.
- No credentials in code, tests, logs or commits. `ps -E` output contains every process's environment: take `PASEO_AGENT_ID` from it and nothing else, and never log or store the raw text.
- The install changes only through `claude update` and `claude install <version>`. Never download a release, write under `~/.local/share/claude`, relink `~/.local/bin/claude`, or read-modify-write `~/.claude.json` or `~/.claude/settings.json` (the latter is read, never written). That rule is about this plugin's code. The CLI's own installer does write there: `claude install <version>` (pin and rollback) rewrites `installMethod`, `autoUpdates` and `autoUpdatesProtectedForNative` in `~/.claude.json`, so never describe the plugin as leaving that file untouched.
- Never restart, stop or message an agent. The plugin lists old processes and stops there.
- Start processes with `execFile` (or `spawn`) only. An older Paseo Cafe rule, still in its repository though no workflow there ran it on 2026-10-21, fails any source file, comments and tests included, that contains the text of a synchronous process call, a shell `-c`, or a command-line download tool; `npm run lint:listings` keeps every source file clear of it.
- Screenshots hold made-up data only: no host name, user name, real path, workspace or agent. `scripts/screenshots.mjs` refuses to save a picture whose visible text names this machine, the user or a local path.
- A fresh install has "Auto-update Claude Code" off. Only two things install: the schedule with that switch on, and "Update now" (`apply: true`). "Check now" (`apply: false`) must stay look-only either way.
- The switch is stored as `mode` (`notify` off, `auto` on) under settings version 1, as 0.1.0 stored its two-way choice. Do not rename the key or raise the version for it: an installed plugin's settings file must keep reading as the choice it held, without being rewritten.
- The sidebar row is always there and opens the status page: it is the way in, and without it the owner could not find "Check now" or the last check (2026-10-08; 0.2.0 and the first 0.2.1 had no row while there was nothing to do). While there is no news it reads `QUIET_ROW` ("Claude Code updates"), which says nothing about the state and so never changes. `sidebarRow` in `shared/format.ts` is the one rule for when the title names news instead: an update that will not install itself (`autoInstall` in the status is false), a failure, a mismatch. An update that went in never changes the row or raises a toast, and the rule is not given the process list, so old processes cannot change it; they are on the status page only. A title is at most `SIDEBAR_TITLE_MAX` (20) characters, so that it stays on one line; the detail goes on the status page. No row title and no toast may say "up to date" or give a time: that is for the status page and the settings screen.
- "Is it working?" is answered on both screens. The status page begins with the "Checks" card (under a notice, while one is showing) and the settings screen with the "Checks" section: last check (relative and clock time), last result, next scheduled check, "Check now". Keep them first. So the settings screen says "Up to date" too.
- The buttons follow the host: `activity` in the status says what is running, since when and whether it has reached the installer, and is set the moment a check is asked for. The page asks every 2 seconds while it is set.
- A failure is told at the third in a row, or at once when the check had reached the installer (`fail` in `server/updater.ts`; told at the first failure of that install, through `failedInstall` in the state, and again only if the failures reach three in a row). While that notice is showing, a look that works leaves it alone, and the update still waiting is told again by the first look after it is dismissed.
- A check makes one attempt and never retries inside itself. The state is written first; anything after a successful update (the history line, the log line, counting old processes, notifying) must not be able to lose the record of it.
- UI: React Native primitives, colours from `theme.colors`, padding from `layout.compact`.
- Release notes are read by the service after a check (`refreshNotes` in `server/service.ts`), never inside `runCheck`: a slow or failed read must not delay, fail or change an update. They change nothing in the sidebar row or the notices.
- Every behaviour change comes with a test. A new CLI output or failure mode goes into `test/stub/claude` too.

## Releases

`package.json` holds the version. Every released version is a tag `vX.Y.Z` on `main`, and pushing
that tag is what publishes. [RELEASING.md](RELEASING.md) has every step; in short:

1. Between releases, a change a user would notice gets a line under `## Unreleased` at the top of `CHANGELOG.md`, and `package.json` keeps the version that is on npm.
2. On a release branch: `npm run release:prepare -- <patch|minor|major>` (or an exact version) bumps `package.json` and `package-lock.json` and dates the changelog entry. Semantic versioning; both listings detect updates by this number, so never reuse one.
3. `npm run verify` and `npm pack --dry-run`, commit, pull request, merge.
4. Tag `main` (`git tag -a v<version> -m <version>`) and push the tag. `.github/workflows/release.yml` checks the tag against `package.json` and the changelog, verifies, publishes to npm and creates the GitHub release. Tagging, and so publishing, is the owner's decision: an agent prepares the release pull request and stops.
5. Submitting to the official Paseo directory and to Paseo Cafe is the owner's decision too; every field is in [SUBMISSION.md](SUBMISSION.md). After the first listing, a new npm version is picked up by both without a new submission.

Never run `npm publish` by hand, never move or reuse a tag, and never put a token in the repository.

If the minimum Paseo version changes, update `requirements.paseo` in `paseo-plugin.json`, the
`@getpaseo/plugin` version in `package.json`, and the README. It is `>=0.10.3 <0.13.0`: 0.10.3 is the
oldest version the plugin has been typechecked and run against. No separate prerelease branch is needed:
Paseo (`assertPluginCompatibility` in `packages/protocol/src/plugin-requirements.ts`, the same in 0.10.3
and 0.12.0) accepts a version when either it or its `major.minor.patch` satisfies the range, so
`0.12.0-beta.1` passes as `0.12.0`. The app runs the same check before it loads a plugin's client code. The `<0.13.0` bound was raised on
2026-10-20 after the plugin ran in throwaway 0.11.4 and 0.12.0 daemons (look, update, release notes;
the 0.12.0 status page and settings screen in its own web UI) and typechecked against
`@getpaseo/plugin` 0.12.0, whose types are the same as 0.11.4's. Raise it again once it has run on 0.13.

## Known limits and unverified points

| Point | State |
| --- | --- |
| `claude update` with no terminal, from a plugin subprocess | Verified 2026-10-07 on macOS with CLI 2.1.285 → 2.1.292 in a throwaway daemon and home. |
| `claude install <version>` with no terminal | Verified the same way (used for a pin and as the rollback). |
| Status page, settings screen, sidebar row in the app | 0.1.0 was used in the app by its owner on 2026-10-07 (an update through "Update now" worked). The 0.2.0 sidebar row was seen in the app by its owner the same day ("Claude Code updated · 6 on an old version", wrapped onto two lines), which is why 0.2.1 has no row after an update and keeps titles to 20 characters. The 0.2.1 screens as they were on 2026-10-07 were not seen in the app (for 2026-10-08 see the next row): they were drawn outside it with react-native-web from the bundle a 0.10.3 daemon built, and the entry was run against a pretend app. |
| The always-present row, the "Checks" card and the settings "Checks" section | Seen 2026-10-08 in the Paseo 0.10.3 app's own web bundle (served from `Paseo.app/Contents/Resources/app-dist` on a local port and opened in a browser, not the desktop window), connected to a throwaway 0.10.3 daemon with the stub CLI. The row read "Claude update ready" with an update waiting and auto-update off, and "Claude Code updates" after "Update now" and a dismissal; "Check now" worked from the status page and from the settings screen; a failed check showed its reason; the narrow layout stacked. To repeat it, the daemon needs the page's origin in `daemon.cors.allowedOrigins` of its `config.json`. Paseo's bar above the page keeps the title the row had when the page was opened until the page is opened again. Not seen in the desktop app or on a phone. |
| Paseo 0.11.4 and 0.12.0 | Checked 2026-10-20 in throwaway daemons of each (`@getpaseo/cli` from npm, its own home and port, a copied CLI 2.1.302): the plugin loaded, a look reported 2.1.304 and installed nothing, "Update now" installed it, and the release notes were read. On 0.12.0 the status page (with "Check now") and the settings screen ("Checks" section) worked in the web UI that daemon serves itself: `"features": {"webUi": {"enabled": true}}` in its `config.json` serves it on the daemon's port, with no CORS setting. Writing `config.json` after an install drops the install (it is recorded there). The process list read as unsupported under `sandbox-exec`, as before. Not seen in the 0.12 desktop app. |
| The row after an update (0.2.1) | The row is now always there (see Conventions), so read "registered no row" below as "the row keeps its plain title". Checked 2026-10-07 in a throwaway 0.10.3 daemon with the stub CLI: after a scheduled update `status.get` reported `updated` with two processes on another version, and the client entry, given that answer by a pretend app, registered no row. A look with auto-update off gave "Claude update ready", and a failed "Update now" gave "Claude update failed", which a following look left in place. Not seen in the app's own sidebar, so that the titles stay on one line there is taken from their length (20 characters at most, against the 33 that fitted on the first line of the 0.2.0 row in the owner's screenshot), not seen. |
| Adding and removing the sidebar row at runtime | Read from the Paseo 0.10.3 app bundle, not from documentation: the function `addSidebarItem` returns takes the item out of the list, frees its id and tells the app to redraw, at any time; a plugin may register no row at start. Paseo 0.11 documents runtime add and remove for its newer `addSidebarHeaderItem`/`addSidebarFooterItem` and calls `addSidebarItem` deprecated, so move to those when 0.10 support is dropped. |
| `useRpc` and the query client on the settings screen | The "Checks" section of the settings screen uses `useRpc` and `useQuery`. Read from the Paseo 0.10.3 app bundle: a settings screen is wrapped in the same `PluginRuntimeBoundary` as a surface (RPC provider, the plugin's one query client), so both screens share the cached status. The spinner and the "Finished" line belong to the screen that was pressed; the other screen shows the result at its next read (30 s at most). |
| `useSettings` on the status page | The switch on the status page saves through `useSettings`, which the app builds on the same RPC and query hooks the page already used. Not seen working in the app. |
| Cost of the status call | `status.get` runs `ps`, `lsof` and an agent list each time, and is polled every 60 s by each connected app and every 30 s by an open status page or settings screen (every 2 s while a check is running). Fine on one machine; a lighter notice-only call is the obvious next step if it ever matters. |
| macOS notification raised from the daemon | Not confirmed. One may have been raised during the throwaway-daemon run; errors from it are swallowed by design and nobody was watching the screen. |
| Listing old processes | Verified through a live 0.10.3 daemon on 2026-10-07 (`status.get`): supported, and it reported the one process on an old version (a leftover 2.1.269) while the ten on the installed version were not listed. A home directory with a space in it is covered by tests only. |
| A manual look-only check | Verified through a live daemon the same day: `status.check` with `apply: false` reported 2.1.285 against 2.1.292 and ran only `claude --version`. |
| The release workflow | Never run (2026-10-07): no tag has been pushed and nothing is on npm. `actionlint` passes and the checks it calls are tested; publishing by token and by trusted publisher are both unseen. See "Not verified" in `RELEASING.md`. |
| Linux, Windows | Untested. The process list and notifications are macOS only by design. |
| Homebrew, WinGet, npm installs of Claude Code | Not supported; `claude update` is for the native installer. |
| An update cut short by a plugin reload or daemon stop | Not tested. The CLI is assumed to leave the old version in place. |
| The "Full release notes" button | Uses `openExternalUrl` from `@getpaseo/plugin/client`, which the Paseo 0.11.2 app gives plugins (read from its bundle). Not checked on 0.10.3; the card guards it with `typeof` and always shows the address to copy. The card has not been seen in the app. |
| Whether Paseo's "refresh" of an agent starts a new `claude` process | Unknown, so no "restart this agent" action is offered. |

## When Claude Code changes

| Change | What to check |
| --- | --- |
| Output of `claude --version` | `extractVersion` in `shared/version.ts`. Only this output is parsed; success is judged by comparing versions before and after, never by the updater's wording. |
| Exit codes of `update` / `install` | `runCheck`. Today: 0 on success and on "up to date"; 0 with no change when updates are disabled by policy; 1 on a failed download or unknown version. |
| Release pointer URL | `RELEASES_URL` in `server/claude.ts` (`https://downloads.claude.ai/claude-code-releases/<channel>`, a bare version). If it moves, checks fail with a clear message and nothing is installed. |
| Changelog location or format | `CHANGELOG_SOURCE_URL` and `RELEASE_NOTES_URL` in `shared/notes.ts`. The source is `CHANGELOG.md` in `anthropics/claude-code` (`## 2.1.300`, then `- ` lines; some version numbers have no entry); the link is the documentation's changelog page, built from it. If either moves, the card shows the reason and the link, and updates are unaffected. |
| Channels | `CHANNELS` in `shared/settings.ts`. The CLI also accepts an undocumented `rc`; it is left out on purpose. `claude update` follows `autoUpdatesChannel` in `~/.claude/settings.json`, which the plugin reads to detect a mismatch. Managed and project settings can set it too and are not read (`readClaudeChannel` in `server/claude.ts`). |
| A check-only or dry-run flag on `claude update` | None exists (2.1.292). If one appears, use it in place of the release pointer. |
| Headless sessions start updating themselves | The plugin becomes a status display; auto-update off is already the default. |
| Install location | `findClaude` in `server/paths.ts` and the `/claude/versions/<version>` pattern in `server/processes.ts`. |
| New settings that block updates (`DISABLE_UPDATES`, `minimumVersion`, managed ranges) | They apply inside the CLI. The plugin reports "exited 0 but the version is still …" with the CLI's own words. |

Re-run the throwaway-home recipe above after any such change; the stub only proves the plugin's own logic.
