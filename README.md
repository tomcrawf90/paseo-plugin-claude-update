# claude-update

[![CI](https://github.com/tomcrawf90/paseo-plugin-claude-update/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/tomcrawf90/paseo-plugin-claude-update/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/paseo-plugin-claude-update)](https://www.npmjs.com/package/paseo-plugin-claude-update)
[![License: MIT](https://img.shields.io/github/license/tomcrawf90/paseo-plugin-claude-update)](https://github.com/tomcrawf90/paseo-plugin-claude-update/blob/main/LICENSE)

A [Paseo](https://paseo.sh) plugin that keeps the Claude Code CLI up to date on the machine your
Paseo daemon runs on. Its status page shows which running agents are still on an old version.

## Why

Claude Code updates itself only from its interactive terminal interface. Paseo runs `claude` without
one, so on a machine that uses Claude mostly through Paseo the updater never runs and the CLI falls
behind. New models often need a newer CLI, so a stale CLI means missing them.

This plugin checks for a new version on a schedule and tells you. Once you turn on **Auto-update
Claude Code** it also runs the CLI's own updater, `claude update`, and tells you what happened.

## What it does

| | |
| --- | --- |
| Checks | Every 4 hours by default, it compares `claude --version` with the version the release channel points at. |
| Updates | Off until you choose it. With "Auto-update Claude Code" on, the scheduled check runs `claude update` when the CLI is behind, then reads the version again to confirm. Until then it only tells you; "Update now" installs on request. |
| Reports | An update that went in: on its status page and in the history there, with a macOS notification. Something you have to act on (an update waiting with auto-update off, a failure): named on its sidebar row as well, unless the row is switched off. Everything goes to a log file. |
| Lists old processes | On the status page: running Claude Code processes (Paseo agents and Claude's own background daemon) that are still on an older version. It never restarts or interrupts them. |
| Shows release notes | On the status page: the notes for the update that is waiting, or else for the last update, with a link to the full notes for every release. |
| Shows that it is working | Its status page says when it last checked (how long ago and the clock time), how that ended, when the version last changed, and when it checks next, and has a "Check now" button. The settings screen has the same lines. |
| Stays out of the way | While Claude Code is up to date, and after an update that worked, the sidebar row reads only "Claude Code updates" and no toast is raised, whatever is still running an older version. A check that finds nothing new changes only the "Last checked" time and the "Last result" line. |

New agents use the new version as soon as it is installed. Agents that are already running keep the
version they started with until they are restarted; that is how Claude Code works, and the plugin
only lists them.

## Screenshots

Taken from Paseo 0.12's own web app against a throwaway daemon with made-up data (`npm run screenshots`).

An update is waiting and auto-update is off, so the sidebar row says so:

![The status page with an update waiting](https://raw.githubusercontent.com/tomcrawf90/paseo-plugin-claude-update/main/docs/screenshots/01-status-update-ready.png)

After "Update now": the release notes, the command to go back, and the processes still on the old version:

![The status page after an update](https://raw.githubusercontent.com/tomcrawf90/paseo-plugin-claude-update/main/docs/screenshots/02-status-after-update.png)

The settings screen:

![The settings screen](https://raw.githubusercontent.com/tomcrawf90/paseo-plugin-claude-update/main/docs/screenshots/03-settings.png)

## Install

Requires Paseo 0.10.3 to 0.13 (betas included), with plugins enabled (**Settings → Plugins**), and Claude Code
installed with its native installer on the daemon host.

From the official Paseo plugin directory, once it is listed there (Paseo 0.11 or later):

```bash
paseo plugin add tomcrawf90/claude-update
```

From npm, on any supported Paseo:

```bash
paseo plugin install npm:paseo-plugin-claude-update
```

Or from a checkout of this repository:

```bash
paseo plugin install /absolute/path/to/paseo-plugin-claude-update
```

Then `paseo plugin ls` should show `claude-update` as `running`. The first check happens about 30
seconds after the plugin starts. A fresh install only tells you when an update is available and
changes nothing; turn on **Auto-update Claude Code**, on the status page or in the
settings, to have it update on the schedule.

**Where to find it.** The sidebar row "Claude Code updates" opens the status page. Its first card,
"Checks", says when the plugin last checked, how that ended and when it checks next, and has the
"Check now" button (it only looks) and "Update now" (it installs). The same lines and "Check now"
are on the settings screen, under **Settings → Plugins → Claude Code updates**. The Command Center
(⌘K) has "Claude Code updates: open status", "Claude Code updates: check now" and "Claude Code
updates: settings"; Paseo lists them while a host's page is open, such as a workspace or this status page,
not on its start page. With **Show in the sidebar** off there is no row, and the Command Center is the
way to the status page and its "Update now" (on a phone, where there may be no Command Center, turn the
switch back on under Settings → Plugins to reach the page). The row's title changes only when:

| The row reads | When | It goes back to "Claude Code updates" when |
| --- | --- | --- |
| Claude update ready | A newer version is out and will not install itself: auto-update is off, or scheduled checks are | You dismiss the notice, or the update is installed |
| Claude update failed | An update was tried and did not go in, or three checks in a row have failed | You dismiss the notice, or the update goes in. After failed checks alone, also when a check works again |
| Claude pin mismatch | The installed version is not the pinned one and will not be moved to it by itself: auto-update is off, or scheduled checks are | You dismiss the notice, or it matches again |
| Claude channel issue | Claude Code's own channel is not the plugin's, so nothing was installed | You dismiss the notice, or they match again |

Whatever it reads, the row opens the status page, which has the detail. An update that went in
never changes the row: it is on the status page and in its history, with a macOS notification if those are on. Processes still on
an older version are listed on the status page and nowhere else.

**Release notes.** The "Release notes" card on the status page shows what changed: for an update
that is waiting, the versions it would bring; otherwise the versions the plugin's last update brought (or the
installed version alone, before any update or after Claude Code updated itself). The newest three versions are shown, each with its
first 12 changes, and the rest are counted. "Full release notes" opens
[the Claude Code changelog](https://code.claude.com/docs/en/changelog), which has every release; its
address is on the card as well, to copy. The notes come from the changelog Anthropic publishes in
[the claude-code repository](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md). They are
read right after a check, never as part of it, so they cannot hold up or change an update, and read
again only when the versions to show change. If they cannot be read, the card says why, keeps the link, and tries
again an hour later.

**Auto-update Claude Code.** On: the next scheduled check installs a new version by itself, with
`claude update` (or moves to the pinned version, with `claude install <version>`). Off: you are only
told. After every update the status page shows the command that goes back to the version before.

**Check now** only looks: it compares versions and installs nothing, whether auto-update is on or
off. **Update now** on the status page is the one button that installs. While either runs, or while
a scheduled check runs, the button shows a spinner, the page says what is happening and for how
long, and the result is shown on the page when it ends. A look counts as a check, so the next
scheduled one is a full interval after it.

## Configuration

Settings are per daemon host, under **Settings → Plugins → Claude Code updates**.

| Setting | Default | What it does |
| --- | --- | --- |
| Check on a schedule | on | The disable switch. Off stops every scheduled check; "Check now" and "Update now" still work. |
| Auto-update Claude Code | off | Off reports the update and changes nothing. On installs it at the next scheduled check. "Update now" on the status page installs it either way. The same switch is on the status page. (Stored as `mode`: `notify` or `auto`, as in 0.1.0, so an existing choice carries over.) |
| Channel | `latest` | The channel the installed version is compared with: `latest` or `stable` (about a week behind). See the note below. |
| Check every (hours) | 4 | 1 to 168. |
| Pinned version | empty | An exact version such as `2.1.285`. While set, newer versions are not installed. When another version is installed, a scheduled check with auto-update on, or "Update now", moves to the pin with `claude install <version>`; otherwise you are told ("Claude pin mismatch"). |
| Path to claude | empty | Empty looks in `~/.local/bin/claude`, then on the daemon's `PATH`. |
| Desktop notifications | on | A macOS notification for each new thing to know: an update that went in, a new version found and not installed, a pin or channel mismatch (each told once), an update that failed, and three failed checks in a row. |
| Show in the sidebar | on | The "Claude Code updates" sidebar row. Off takes it away, with the news its title gives; it comes back as soon as the switch is on again, without restarting Paseo. Everything else stays: the notices on the status page, desktop notifications, the settings screen with its "Checks" lines and "Check now", and the Command Center items, which are then the way to the status page and "Update now". With desktop notifications off as well, news is shown only on the status page, which says so. The same switch is on the status page. With the row off it may still show for a moment while the app starts, until the plugin has read the setting from the host, and it stays while the host cannot be reached. |

**Channel.** `claude update` follows Claude Code's own channel, the `autoUpdatesChannel` key in
`~/.claude/settings.json` (`latest` when unset), not this plugin's setting. If the two differ the
plugin installs nothing and tells you. To follow `stable`, set `"autoUpdatesChannel": "stable"`
there yourself and choose `stable` here. The plugin never edits Claude Code's files.

## Safety

| Concern | What the plugin does |
| --- | --- |
| Changing the install | Only through the CLI's own commands: `claude update`, and `claude install <version>` for a pin. The plugin's own code never downloads a binary and never writes to the install directory, the launcher or `~/.claude.json`; the CLI does all of that. Note that `claude install <version>` (a pin, or the rollback) is the CLI's installer, and it rewrites `installMethod`, `autoUpdates` and `autoUpdatesProtectedForNative` in `~/.claude.json`. Release verification stays with the CLI. |
| Running sessions | Not touched. Claude Code keeps each version in its own file and keeps the versions that are in use, so an update does not pull the binary from under a live session. |
| Restarts | None. It lists old processes and leaves restarting to you. |
| A bad release | Roll back (below), or turn auto-update off, use the `stable` channel, or a pin. |
| Failures | One attempt per check, no retry inside a check. After a failure the wait doubles (4 h, 8 h, 16 h, then 24 h at the default interval). An update that was tried and did not go in is told at once (and again if it makes three failures in a row); a check that fails before that (no network, say) is told once, at the third failure in a row. |
| Overlap | One check at a time. The CLI's installer also takes its own lock. |
| Network | Two reads, nothing sent: the release channel's pointer (`downloads.claude.ai`), and the Claude Code changelog on GitHub (`raw.githubusercontent.com`) for the release notes: when the versions to show change, and hourly while a read fails. |
| Your environment | To find which agent a process belongs to it reads process environments on the host, takes only `PASEO_AGENT_ID` from them, and stores and logs nothing else. |

## Rolling back

After an update the status page shows the command for the previous version, for example:

```bash
claude install 2.1.285
```

Run it in a terminal, and set **Pinned version** to the same version: with auto-update on, the next
scheduled check would otherwise update again, and with it off, the next check would report the newer
version as waiting. Setting the pin alone also works: "Update now", or the next scheduled check with
auto-update on, then runs that install. Clear the pin to follow the channel again.

## Where things are kept

Under `$PASEO_HOME/plugin-data/claude-update/` (normally `~/.paseo/plugin-data/claude-update/`):

| File | Holds |
| --- | --- |
| `state.json` | Installed and target version, last check and result, failure count, previous version. |
| `history.jsonl` | One line per update, failure or notice. |
| `plugin.log` | One line per check, rotated once at 512 KB. |
| `notes.json` | The release notes the status page shows, and when they were read. |

`paseo plugin logs claude-update` shows start-up and unexpected errors.

## Limitations

- Supports Claude Code's native installer. Claude Code installed with Homebrew, WinGet or through npm has a different update command and is not handled.
- Tested on macOS only. Linux and Windows are untested; listing old processes and desktop notifications are macOS only.
- Running agents and Claude's background daemon keep their old version until you restart them. The plugin does not restart anything.
- The schedule runs only while the Paseo daemon is running and the plugin is enabled. A check missed while the machine slept runs within a minute of waking.
- Paseo gives plugin server code no notification of its own, so outside the app the only notice is the macOS notification.
- `claude update` follows Claude Code's own channel; this plugin cannot choose a different one for it.
- The channel check reads `autoUpdatesChannel` from `~/.claude/settings.json` only. Claude Code can also take it from managed settings (on macOS `/Library/Application Support/ClaudeCode/managed-settings.json`) or a project's `.claude/settings.json`, which the plugin does not read, so with one of those set `claude update` may follow a channel other than the one the plugin compared against.
- An update that is running when the plugin is reloaded or the daemon stops may be cut short; the next check tries again.

Not verified at the time of writing (0.2.1): how the status page, settings screen and sidebar row
look in the Paseo desktop window or on a phone (they were seen in the app's own web bundle in a browser, against a throwaway daemon), and
whether a macOS notification is displayed when raised from the daemon. The update itself, the schedule, and the state and log files were verified in a real Paseo
0.10.3 daemon against a throwaway copy of the CLI; in 0.11.4 and 0.12.0 daemons a look, "Update now"
and the release notes were. As of 2026-10-23, in throwaway 0.10.3, 0.12.0 and 0.13.0-beta.2 daemons with a
stand-in CLI, the scheduled update and its notification, the sidebar row and its switch, the status page,
the settings screen and the Command Center items were checked in each daemon's own web app (`npm run check:ui`).

## Development

```bash
npm install
npm run verify    # typecheck, tests, a local pre-check for both listings' rules, the changelog check
npm run check:compat              # the oldest and the newest Paseo: range, typecheck, a throwaway daemon
npm run check:ui -- --paseo 0.13.0-beta.2   # the screens in that Paseo's own web app (macOS, Chrome)
```

The tests use a stand-in `claude` (`test/stub/claude`) and never touch a real install or the
network. See [AGENTS.md](https://github.com/tomcrawf90/paseo-plugin-claude-update/blob/main/AGENTS.md) for how to try the plugin against a throwaway home,
[CONTRIBUTING.md](https://github.com/tomcrawf90/paseo-plugin-claude-update/blob/main/CONTRIBUTING.md) before opening a pull request, and [SECURITY.md](https://github.com/tomcrawf90/paseo-plugin-claude-update/blob/main/SECURITY.md) to
report a security problem.

**Versions and releases.** Versions follow [semantic versioning](https://semver.org) and are listed
in [CHANGELOG.md](https://github.com/tomcrawf90/paseo-plugin-claude-update/blob/main/CHANGELOG.md). The version in `package.json` is the one source; every released
version is a git tag `vX.Y.Z` on `main`. Pushing that tag runs the release workflow, which checks
the tag against `package.json` and the changelog, publishes to npm with a provenance statement and
creates the GitHub release with the same tarball attached. A release is prepared with
`npm run release:prepare -- <patch|minor|major>` on a branch; the steps are in
[RELEASING.md](https://github.com/tomcrawf90/paseo-plugin-claude-update/blob/main/RELEASING.md), and listing in the official Paseo directory and on Paseo Cafe is in [SUBMISSION.md](https://github.com/tomcrawf90/paseo-plugin-claude-update/blob/main/SUBMISSION.md).

## License

[MIT](https://github.com/tomcrawf90/paseo-plugin-claude-update/blob/main/LICENSE)
