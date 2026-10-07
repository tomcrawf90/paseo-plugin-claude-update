# Changelog

All notable changes to this plugin are listed here. Versions follow [semantic versioning](https://semver.org).

## 0.1.0 - unreleased

First version.

- Scheduled check of the installed Claude Code CLI against the `latest` or `stable` release channel.
- Installs updates with `claude update` and confirms the new version; "Only tell me" mode reports without installing.
- Pin to an exact version with `claude install <version>`; a disable switch for the schedule.
- Status page, settings screen, Command Center items, a sidebar row that carries news, macOS notifications.
- Lists running Claude Code processes that are still on an older version (macOS).
- State, history and log files under `$PASEO_HOME/plugin-data/claude-update/`.
- Failure backoff, one check at a time, and a rollback note after every update.
