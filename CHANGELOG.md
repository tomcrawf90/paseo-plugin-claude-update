# Changelog

All notable changes to this plugin are listed here. Versions follow [semantic versioning](https://semver.org).
A version marked "not published" was finished but never reached npm; its changes are in the next published one.

## Unreleased

- Runs on any Paseo from 0.9.0 on, 0.13 and later included: the supported range is now `>=0.9.0`, with no upper bound. 0.3.0 and earlier refused any Paseo from 0.13 on ("requires Paseo >=0.10.3 <0.13.0"), so after a Paseo update the plugin stopped loading. A new Paseo no longer needs a new release of the plugin.
- If a later Paseo drops a plugin function the plugin calls, the plugin stops at start with a message naming it (in Settings → Plugins and the log), in place of a bare "is not a function".

## 0.3.0 - 2026-10-23

- A "Show in the sidebar" switch, on the status page and in the settings, takes the "Claude Code updates" sidebar row away. It is on by default, so nothing changes until it is switched off, and the row comes back as soon as it is on again. With the row off, the status page is opened from the Command Center ("Claude Code updates: open status"); the notices, desktop notifications and the settings screen's "Checks" lines are unchanged. The status RPC reports `showInSidebar`.

## 0.2.1 - 2026-10-20

- Runs on Paseo 0.12 as well as 0.10.3 and 0.11.
- The screens and README say what a pin does while auto-update is off (it is reported, and "Update now" installs it), which notices raise a desktop notification, and "Not checked yet" for old processes before the first check. An applied pin shows as a good result.
- The sidebar row is always there, reading "Claude Code updates", and opens the status page. 0.2.0 took the row away while there was nothing to act on, which left the page, its "Check now" button and the time of the last check reachable only from the Command Center.
- The status page begins with a "Checks" card: when the last check was (how long ago and the clock time), how it ended, the last time the version changed and from what to what, when the next scheduled check is, and the "Check now" and "Update now" buttons.
- The settings screen (Settings → Plugins → Claude Code updates) has the same lines and a "Check now" action.
- The row's title changes only for something to act on, and fits on one line (20 characters at most): "Claude update ready", "Claude update failed", "Claude pin mismatch", "Claude channel issue". After an update, and for processes still on an older version, it keeps its plain title: those are on the status page only. An update that went in is on the status page and in the history, with a macOS notification if those are on; it no longer raises a toast.
- The plain title also stays for an update that the next scheduled check installs by itself (auto-update on, schedule on), such as one found by "Check now".
- An update that was tried and did not go in is told at once, in the row, on the status page and by macOS notification. Before, it waited for the third failure in a row, as a failed check still does. The notice stays through a "Check now" that works, until it is dismissed or the update goes in.
- A notice of a waiting update that was replaced by a failure notice comes back when checks work again.
- The status RPC reports `autoInstall`: whether the schedule installs what it finds.
- The status page has a "Release notes" card: the Claude Code release notes for the update that is waiting, or else the last update (the newest three versions, each cut to its first 12 changes), and a link to the full changelog for every release. They are read from Anthropic's changelog after a check, never during one; if they cannot be read the card says why and keeps the link. The status RPC reports them as `releaseNotes`.
- "Update now" pressed while a check is already looking waits for it and then installs. Before, it joined the look, installed nothing and said "Nothing was changed".
- A Claude Code settings file that cannot be read (for example, no permission) no longer makes a check fail without a trace: the check goes on as for a file it cannot parse, and is recorded.

## 0.2.0 - not published

- No sidebar row while Claude Code is up to date. The row appears for an update that is waiting, a failure, a mismatch, or an update that running processes have not picked up yet, and goes when the notice is dismissed or resolved. The status page is opened from the Command Center ("Claude Code updates: open status").
- "Check now" and "Update now" show a spinner and what they are doing; the status page says how long the run has been going, also for a scheduled run or one started elsewhere, and shows the result when it ends. A look that finds nothing new no longer raises a toast.
- "When an update is found" is now a switch, "Auto-update Claude Code", on the settings screen and at the top of the status page. The stored setting is unchanged (`mode`: `notify` is off, `auto` is on), so an existing choice carries over.
- A check that finds the install where it should be clears an earlier "update available" or mismatch notice, for instance after an update run in a terminal.
- The status RPC reports the running check (`activity`: phase, trigger, start time).

## 0.1.0 - not published

First version.

- Scheduled check of the installed Claude Code CLI against the `latest` or `stable` release channel.
- Starts in "Only tell me" mode, which reports an available update without installing. "Install updates" runs `claude update` on the schedule and confirms the new version.
- Pin to an exact version with `claude install <version>`; a disable switch for the schedule.
- Status page, settings screen, Command Center items, a sidebar row that carries news, macOS notifications.
- Lists running Claude Code processes that are still on an older version (macOS).
- State, history and log files under `$PASEO_HOME/plugin-data/claude-update/`.
- Failure backoff, one check at a time, and a rollback note after every update.
