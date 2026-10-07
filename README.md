# claude-update

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
| Reports | An update that went in: on its status page and in the history there, with a macOS notification. Something you have to act on (an update waiting with auto-update off, a failure): a short sidebar row as well. Everything goes to a log file. |
| Lists old processes | On the status page: running Claude Code processes (Paseo agents and Claude's own background daemon) that are still on an older version. It never restarts or interrupts them. |
| Stays out of the way | While Claude Code is up to date, and after an update that worked, the plugin has no sidebar row and raises no toast, whatever is still running an older version. A check that finds nothing new changes nothing you can see. |

New agents use the new version as soon as it is installed. Agents that are already running keep the
version they started with until they are restarted; that is how Claude Code works, and the plugin
only lists them.

## Install

Requires Paseo 0.10.3 or 0.11 (betas included), with plugins enabled (**Settings → Plugins**), and Claude Code
installed with its native installer on the daemon host.

```bash
paseo plugin install npm:paseo-plugin-claude-update
```

Or from a checkout of this repository:

```bash
paseo plugin install /absolute/path/to/paseo-plugin-claude-update
```

Then `paseo plugin ls` should show `claude-update` as `running`. The first check happens about 30
seconds after the plugin starts. A fresh install only tells you when an update is available and
changes nothing; turn on **Auto-update Claude Code**, at the top of the status page or in the
settings, to have it update on the schedule.

**Where to find it.** The plugin has no sidebar row while there is nothing for you to do. Open the
Command Center (⌘K) and choose "Claude Code updates: open status" for the status page, "Claude Code
updates: check now", or "Claude Code updates: settings"; the settings are also under **Settings →
Plugins → Claude Code updates**. A sidebar row appears by itself only when:

| The row reads | When | It goes when |
| --- | --- | --- |
| Claude update ready | A newer version is out and will not install itself: auto-update is off, or scheduled checks are | You dismiss the notice, or the update is installed |
| Claude update failed | An update was tried and did not go in, or three checks in a row have failed | You dismiss the notice, or a check works again |
| Claude pin mismatch | The installed version is not the pinned one, and auto-update is off | You dismiss the notice, or it matches again |
| Claude channel issue | Claude Code's own channel is not the plugin's, so nothing was installed | You dismiss the notice, or they match again |

The row opens the status page, which has the detail. An update that went in never has a row: it is
on the status page and in its history, with a macOS notification if those are on. Processes still on
an older version are listed on the status page and nowhere else.

**Auto-update Claude Code.** On: the next scheduled check installs a new version by itself, with
`claude update`. Off: you are only told. Either way, agents that are already running keep the
version they started with until they are restarted, and after every update the status page shows
the command that goes back to the version before.

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
| Auto-update Claude Code | off | Off reports the update and changes nothing. On installs it at the next scheduled check. "Update now" on the status page installs it either way. The same switch is at the top of the status page. (Stored as `mode`: `notify` or `auto`, as in 0.1.0, so an existing choice carries over.) |
| Channel | `latest` | The channel the installed version is compared with: `latest` or `stable` (about a week behind). See the note below. |
| Check every (hours) | 4 | 1 to 168. |
| Pinned version | empty | An exact version such as `2.1.285`. While set, the plugin holds the CLI at that version with `claude install <version>` and never updates. |
| Path to claude | empty | Empty looks in `~/.local/bin/claude`, then on the daemon's `PATH`. |
| Desktop notifications | on | A macOS notification after an update, after an update that failed, and after three failed checks in a row. |

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
| Failures | One attempt per check, no retry inside a check. After a failure the wait doubles (4 h, 8 h, 16 h, then 24 h at the default interval). An update that was tried and did not go in is told at once; a check that fails before that (no network, say) is told once, at the third failure in a row. |
| Overlap | One check at a time. The CLI's installer also takes its own lock. |
| Your environment | To find which agent a process belongs to it reads process environments on the host, takes only `PASEO_AGENT_ID` from them, and stores and logs nothing else. |

## Rolling back

After an update the status page shows the command for the previous version, for example:

```bash
claude install 2.1.285
```

Run it in a terminal, and set **Pinned version** to the same version, or the next check will update
again. Setting the pin alone also works: the plugin then runs that install itself. Clear the pin to
follow the channel again.

## Where things are kept

Under `$PASEO_HOME/plugin-data/claude-update/` (normally `~/.paseo/plugin-data/claude-update/`):

| File | Holds |
| --- | --- |
| `state.json` | Installed and target version, last check and result, failure count, previous version. |
| `history.jsonl` | One line per update, failure or notice. |
| `plugin.log` | One line per check, rotated once at 512 KB. |

`paseo plugin logs claude-update` shows start-up and unexpected errors.

## Limitations

- Supports Claude Code's native installer. A Homebrew, WinGet or npm install has a different update command and is not handled.
- Tested on macOS only. Linux and Windows are untested; listing old processes and desktop notifications are macOS only.
- Running agents and Claude's background daemon keep their old version until you restart them. The plugin does not restart anything.
- The schedule runs only while the Paseo daemon is running and the plugin is enabled. A check missed while the machine slept runs within a minute of waking.
- Paseo gives plugin server code no notification of its own, so outside the app the only notice is the macOS notification.
- `claude update` follows Claude Code's own channel; this plugin cannot choose a different one for it.
- The channel check reads `autoUpdatesChannel` from `~/.claude/settings.json` only. Claude Code can also take it from managed settings (on macOS `/Library/Application Support/ClaudeCode/managed-settings.json`) or a project's `.claude/settings.json`, which the plugin does not read, so with one of those set `claude update` may follow a channel other than the one the plugin compared against.
- An update that is running when the plugin is reloaded or the daemon stops may be cut short; the next check tries again.

Not verified at the time of writing (0.2.1): how the status page, settings screen and sidebar row
look in the Paseo app (they were drawn outside it, from the bundle a Paseo daemon builds), and
whether a macOS notification is displayed when raised from the daemon. The update itself, the schedule, and the state and log files were verified in a real Paseo
0.10.3 daemon against a throwaway copy of the CLI.

## Development

```bash
npm install
npm run verify    # typecheck, tests, and a local pre-check for the Paseo Cafe scanner
```

The tests use a stand-in `claude` (`test/stub/claude`) and never touch a real install or the
network. See [AGENTS.md](AGENTS.md) for how to try the plugin against a throwaway home and how
releases are cut, and [SUBMISSION.md](SUBMISSION.md) for publishing.

## License

[MIT](LICENSE)
