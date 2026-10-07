# Security

This plugin runs on the Paseo daemon host, starts the Claude Code CLI's updater and reads the list
of running processes, so a flaw in it matters.

## Reporting a problem

Report it privately: on the repository's **Security** tab choose **Report a vulnerability**
(<https://github.com/tomcrawf90/paseo-plugin-claude-update/security/advisories/new>). Please do not
open a public issue for it. Say which version you run, what you did and what happened.

Only the latest published version is supported; a fix is released as a new version.

## What a release carries

Versions are published to npm from this repository's release workflow, with a provenance statement
that names the repository, the workflow and the commit. `npm audit signatures` checks it. The same
tarball is attached to the GitHub release.
