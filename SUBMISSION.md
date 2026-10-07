# Publishing and submitting to Paseo Cafe

The GitHub repository exists and is public: <https://github.com/tomcrawf90/paseo-plugin-claude-update>.
Nothing else here has been done: no release tag, no npm package, no registry entry. Every step
below is the owner's decision. How a version is released is in [RELEASING.md](RELEASING.md).

Sources, read 2026-10-07: <https://paseo.cafe/submit>, the registry repository
<https://github.com/paseo-cafe/paseo-cafe> (README, `.github/ISSUE_TEMPLATE/plugin-submission.yml`,
`src/lib/registry-schema.ts`, `.github/security/semgrep.yml`, `scripts/plugin-security/static-scan.ts`),
the catalog <https://paseo.cafe/api/plugins> (231 plugins), and <https://paseo.sh/docs/plugins/publishing.md>.

## 1. Decide before anything is published

| # | Decision | Proposed | Why it matters |
| --- | --- | --- | --- |
| 1 | Plugin id | `claude-update` | It is the registry filename, the id in `paseo-plugin.json` and the name on the listing. Changing it later is a new listing. Free on Paseo Cafe on 2026-10-07. |
| 2 | npm package name | `paseo-plugin-claude-update` (unscoped) | Free on npm on 2026-10-07. Alternative: a scope, e.g. `@tomcrawf90/paseo-claude-update` (138 of 231 listed plugins are scoped). Change `name` in `package.json` and the install line in `README.md` if you choose another. |
| 3 | GitHub repository | `tomcrawf90/paseo-plugin-claude-update`, public. Decided: it exists | Paseo Cafe needs a public GitHub repository. `package.json` (`homepage`, `repository`, `bugs`) points at it, and npm provenance checks that it does. |
| 4 | Licence and author | MIT, "Tom Crawford" | In `LICENSE` and `package.json`. 216 of 231 listed plugins are MIT. |
| 5 | Supported Paseo versions | `>=0.10.3 <0.12.0 \|\| >=0.11.0-beta.1 <0.12.0` | Typechecked and run against 0.10.3 only. The second half lets 0.11 betas load it, which a plain `>=0.10.3` does not (a prerelease only matches a range that names one). Untested on 0.11; 0.12 needs a new release. Lowering the minimum needs a test on the older version. |
| 6 | First-run behaviour | Auto-update off: a fresh install reports an available update and changes nothing until the user turns on "Auto-update Claude Code" | Installing a plugin should not change the host's CLI unasked. The alternative is to default to installing (`mode` in `shared/settings.ts`). |

## 2. Before publishing

| Step | Command or action | Done |
| --- | --- | --- |
| Install it in your own Paseo and use it | `paseo plugin install /absolute/path/to/paseo-plugin-claude-update` (your checkout), then `paseo plugin ls` | no |
| Check the screens in the app, in a wide window, a narrow one and a dark theme | Status page (the auto-update switch, the spinner on "Check now" and "Update now", the result line), settings screen, the sidebar row ("Claude update ready", on one line) appearing while an update waits with auto-update off and going when it is dismissed or installed, and no row after an update | no |
| Capture screenshots into `images/` | PNG or WebP, e.g. `images/status.png`, `images/settings.png`. Paseo Cafe shows every image in that folder. None exist yet: the screens have not been seen in the app. | no |
| Set the release date | `npm run release:prepare -- 0.2.1` on a release branch dates the `CHANGELOG.md` entry (RELEASING.md) | no |
| Verify | `npm run verify` and `npm pack --dry-run` | passes on 2026-10-07 |

## 3. Publish

Publishing is done by the release workflow when a tag is pushed, not by hand. The one-time npm
setup (an account, a token for the first release, the trusted publisher after it) and the release
steps are in [RELEASING.md](RELEASING.md).

| # | Step | Done |
| --- | --- | --- |
| 1 | GitHub repository, public | yes |
| 2 | npm credentials for the first release (`NPM_TOKEN`, RELEASING.md "Once, before the first release") | no |
| 3 | Release pull request for 0.2.1, merged; tag `v0.2.1` pushed from `main` | no |
| 4 | The Release workflow ended green: the package is on npm and the GitHub release exists | no |
| 5 | The published package installs: `paseo plugin install npm:paseo-plugin-claude-update@0.2.1` | no |

`npm pack --dry-run` on 2026-10-07 (24 files, 31.3 kB packed, 103.9 kB unpacked): `CHANGELOG.md`,
`LICENSE`, `README.md`, `package.json`, `paseo-plugin.json`, `index.client.tsx`, `index.server.ts`,
`client/{settings,status}.tsx`, `client/{activity,bus,sidebar}.ts`, `server/{claude,notify,paths,processes,run,service,store,updater}.ts`,
`shared/{format,settings,status,version}.ts`. Tests, the stub, the release script, CI and these notes are not published.

## 4. Submit to Paseo Cafe

Submission is a form at <https://paseo.cafe/submit>. It opens a prefilled GitHub issue in
`paseo-cafe/paseo-cafe`; a bot turns the issue into a pull request that adds
`registry/claude-update.json`. There is no CLI. You need to be signed in to GitHub.

| Form field | Value to enter | Notes |
| --- | --- | --- |
| Registry id | `claude-update` | Must equal `id` in `paseo-plugin.json`. |
| GitHub repository | `tomcrawf90/paseo-plugin-claude-update` | `owner/repo`, not a URL. Must be public. |
| Plugin subpath | leave empty | The repository is the plugin. |
| npm package | `paseo-plugin-claude-update` | Must be public on npmjs.org with the same id and version as the repository. |
| Categories | `automation`, `monitoring` | Allowed: automation, browser, code-review, git, github, monitoring, orchestration, productivity, provider, theme, other. |
| Platforms | `macos` | Only macOS has been tested. Leave blank only once Linux or Windows is known to work. |
| Caveats | the six lines below | One per line, up to 6, each one sentence of at most 140 characters. |
| Confirmation 1 | tick | "`paseo-plugin.json.id` in my repo matches the registry filename". True. |
| Confirmation 2 | tick after publishing | "The npm package is public, contains the same plugin ID, and has a released semantic version rather than `0.0.0`". True once step 3 is done. |

Caveats to paste (each is under 140 characters):

```text
Only reports updates until you turn on "Auto-update Claude Code"; then it runs claude update on a schedule.
Supports Claude Code's native installer only, not Homebrew, WinGet or npm installs.
Tested on macOS only; listing old processes and desktop notifications are macOS only.
Running agents keep their old Claude Code version until you restart them; nothing is restarted for you.
Follows Claude Code's own autoUpdatesChannel; set that to stable yourself to follow the stable channel.
Reads process environments on the host to match processes to agents; only the Paseo agent id is used.
```

## 5. What the listing is built from

| Listing part | Comes from | State |
| --- | --- | --- |
| Name | The registry id | `claude-update` |
| Description, author, licence | `package.json`, `paseo-plugin.json`, `README.md` | Filled in |
| Version | The published npm version, which must match `package.json` in the repository | `0.2.1` |
| Install notes | The `## Install` section of `README.md`, quoted as written | Written |
| Limitations | The `## Limitations` section of `README.md`, plus the caveats above | Written |
| Screenshots | Every image in `images/` | **Missing**: see step 2 |
| Demo video | A YouTube or Loom link in `README.md` | None; optional |
| Health badges | Valid manifest, README, LICENSE, a `test` script, a `typecheck` script, recent activity | All present |
| Icon | Not used. The scanner rejects the manifest keys `name`, `icon` and `media` that Paseo 0.11 added | Nothing to do |

## 6. Rules the scanner enforces

`npm run lint:cafe` checks the ones that can be checked locally.

| Rule | Status |
| --- | --- |
| `paseo-plugin.json` holds only `id`, `requirements`, `build` and `description`; any other key fails | Met |
| `id` is lowercase kebab-case and equals the registry filename | Met |
| `requirements.paseo` is a valid range for 0.8 or later | Met (`>=0.10.3 <0.12.0 \|\| >=0.11.0-beta.1 <0.12.0`; every branch's minimum is above 0.9.0-beta.1, so `description` is allowed) |
| No source file (`.ts`, `.tsx`, `.js`, `.jsx`), comments and tests included, contains the text of a synchronous process call, a shell `-c` invocation, or a command-line download tool | Met. The plugin starts processes with `execFile` only |
| Imports stay inside `client/`, `server/`, `shared/`; no Node modules in client or shared code | Met |
| No symlinks; at most 200 files and 2 MB | Met (57 files, 0.5 MB) |
| The npm tarball passes the same scan | Not run: the real scanner runs only after submission |

## 7. After it is listed

Paseo Cafe rescans npm every 15 minutes and Git every six hours. To release an update, follow
[RELEASING.md](RELEASING.md): a release pull request that bumps the version and dates the changelog,
then a tag `vX.Y.Z` on `main`, which publishes. No new submission is needed. Paseo Cafe wants the
npm version and the version in the repository's `package.json` to be the same, which is why `main`
keeps the released version between releases.

## Could not be determined

- Whether the real scanner passes: it runs on submission. The local pre-check covers its published rules only.
- How long review takes, and whether a human reviews beyond the automated checks. The site says listings are not reviewed or vouched for.
- Whether Paseo Cafe will accept `name`, `icon` and `media` in the manifest later. Its scanner rejected them on 2026-10-07.
- The official Paseo registry (<https://github.com/getpaseo/plugins>, `paseo plugin add owner/slug`) is a separate listing with its own rules, including a required `OVERVIEW.md` in the repository and in the npm package (so in `files`). It was not prepared here. Its ownership rule accepts a package with npm provenance from anyone, which the release workflow provides.
