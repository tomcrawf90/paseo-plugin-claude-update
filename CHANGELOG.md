# Changelog

All notable changes to this plugin are listed here. Versions follow [semantic versioning](https://semver.org).
A version marked "not published" was finished but never reached npm; its changes are in the next published one.

## 0.2.1 - unreleased

- No sidebar row after an update, and none for processes still on an older version: those are listed on the status page only. An update that went in is on the status page and in the history, with a macOS notification if those are on; it no longer raises a toast.
- The row is there only for something to act on, and its title fits on one line (20 characters at most): "Claude update ready", "Claude update failed", "Claude pin mismatch", "Claude channel issue".
- No row for an update that the next scheduled check installs by itself (auto-update on, schedule on), such as one found by "Check now".
- An update that was tried and did not go in is told at once, in the row, on the status page and by macOS notification. Before, it waited for the third failure in a row, as a failed check still does. The notice stays through a "Check now" that works, until it is dismissed or the update goes in.
- A notice of a waiting update that was replaced by a failure notice comes back when checks work again.
- The status RPC reports `autoInstall`: whether the schedule installs what it finds.

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
