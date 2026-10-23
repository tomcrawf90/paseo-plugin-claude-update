# Publishing and listing

One npm package, `paseo-plugin-claude-update`, is listed in two places:

| Listing | Where | Install line it gives | How it is listed |
| --- | --- | --- | --- |
| The official Paseo plugin directory | <https://plugins.paseo.sh>, from <https://github.com/getpaseo/plugins> | `paseo plugin add tomcrawf90/claude-update` (Paseo 0.11 or later) | An issue form; a reviewer approves it |
| Paseo Cafe | <https://paseo.cafe>, from <https://github.com/paseo-cafe/paseo-cafe> | `paseo plugin install npm:paseo-plugin-claude-update` | A form that opens an issue; a bot adds the entry |

Nothing has been submitted or published yet. Every outward step below is the owner's decision. How
a version is released is in [RELEASING.md](RELEASING.md).

Sources, read 2026-10-21: getpaseo/plugins at `702e140` (README, REVIEW.md, BOTS.md,
`.github/ISSUE_TEMPLATE/submit-plugin.yml`, `scripts/lib/`), <https://paseo.sh/docs/plugins/publishing.md>,
<https://plugins.paseo.sh/index.json> (341 plugins); paseo-cafe/paseo-cafe at `2e81844` (README,
`.github/ISSUE_TEMPLATE/plugin-submission.yml`, `src/lib/registry-schema.ts`, `src/lib/images.ts`,
`scripts/scan.ts`, `scripts/plugin-security/static-scan.ts`), <https://paseo.cafe/api/plugins> (246 plugins).

## 1. What each listing needs, and where it is

| Need | Official directory | Paseo Cafe | In this repository |
| --- | --- | --- | --- |
| npm package, public, released version | Yes; read from npm at the version given | Yes; its version must equal `package.json` in the repository | `paseo-plugin-claude-update`, from the release workflow |
| Public GitHub repository | Yes: the listing's owner (`tomcrawf90`) comes from npm provenance or `package.json` `repository`, which must agree | Yes | `package.json` `repository`; the release publishes with provenance |
| Listing id | The package name without `paseo-plugin-`: `claude-update` | The registry filename, equal to the manifest `id` | `claude-update` in `paseo-plugin.json` |
| Display name | The issue title | The id | "Claude Code updates" in the issue title |
| Description | `package.json` `description` | `paseo-plugin.json` `description` | The same sentence in both; `npm run lint:listings` fails if they differ |
| Manifest keys | Any; `name`, `icon` and `media` are read if present | Only `id`, `requirements`, `build`, `description`; `name`, `icon` and `media` only when every minimum of the range is 0.11.0 or later | `id`, `description`, `requirements` (see 2) |
| Overview page | `OVERVIEW.md` in the package, or one the reviewer writes. Must explain what the plugin installs, runs, reads and sends, and give the supported systems and Paseo versions; no install commands | Not used | `OVERVIEW.md`, in `files` |
| Screenshots | At least one image of a visual plugin's interface, PNG, JPG, WebP or GIF (no SVG); the first is the card thumbnail. From the manifest's `media`, or as image addresses given in the submission. No size or count rule | Optional. Every file in `images/`, then images in the README from GitHub hosts, at most 8, without exact duplicate addresses | `docs/screenshots/01-status-update-ready.png` (thumbnail), `02-status-after-update.png`, `03-settings.png`, 2880×1800, shown in the README by absolute address. Not in `images/`, whose addresses Paseo Cafe pins to a commit, so they would not match the README's and each screenshot would show twice |
| Runtime dependencies | Need an npm shrinkwrap | Counted in the scan | None |
| Code checks | A reviewer reads the package (REVIEW.md "Security review") | A static scan of the manifest and the modules reachable from the entries, at most 200 files and 2 MB, of the repository and of the npm package | `npm run lint:listings` runs the parts that can be run locally |
| Licence, README, tests | Licence shown | README "Install" and "Limitations" quoted; `test` and `typecheck` scripts scored | MIT; both sections; both scripts |

## 2. Decisions taken

| # | Decision | Chosen | Why |
| --- | --- | --- | --- |
| 1 | Plugin id and package name | `claude-update`, `paseo-plugin-claude-update` | Free on npm and in both listings on 2026-10-21. The official id is the package name without `paseo-plugin-`, so both listings use `claude-update`. |
| 2 | Supported Paseo versions | `>=0.10.3 <0.14.0` | Run against 0.10.3, 0.11.4, 0.12.0 and 0.13.0-beta.2. Betas pass because Paseo also tests a version's `major.minor.patch`. The cap means every new Paseo minor needs a release that raises it once the plugin has run on it; the daily compatibility check (RELEASING.md) says when, from the first beta. |
| 3 | Screenshots outside the manifest | No `name`, `icon` or `media` in `paseo-plugin.json` | Paseo 0.10 and the 0.11 betas refuse a manifest with them, and Paseo Cafe would reject them with a 0.10.3 minimum. The official directory takes image addresses in the submission instead and keeps them across versions. Move them into the manifest in the release that drops Paseo 0.10. |
| 4 | Categories | Official: Daemon management, Sidebar. Paseo Cafe: automation, monitoring | The closest of each listing's own lists. |
| 5 | First-run behaviour | Auto-update off | Installing a plugin should not change the host's CLI unasked. |

## 3. Publish

Publishing is done by the release workflow when a tag is pushed, never by hand. The npm setup and the
release steps are in [RELEASING.md](RELEASING.md).

| # | Step | Done |
| --- | --- | --- |
| 1 | GitHub repository, public | yes |
| 2 | Release pull request for 0.2.1, merged | yes (#10, 2026-10-21) |
| 3 | npm credentials for the first release (`NPM_TOKEN`, RELEASING.md) | set, but npm refused them (E403, 2026-10-21) |
| 4 | Tag `v0.2.1` pushed from `main`; the Release workflow ended green | pushed on 71e405b; the run failed at publishing, to be tagged again |
| 5 | `npm view paseo-plugin-claude-update@0.2.1` answers, and the package installs in a throwaway daemon | no |

`npm pack --dry-run` on 2026-10-21: 29 files, 40.5 kB packed. The manifest, the two entries,
`client/`, `server/`, `shared/` without tests, `OVERVIEW.md`, `README.md`, `CHANGELOG.md`, `LICENSE`,
`package.json`. Tests, stubs, scripts, images, CI and these notes are not published.

## 4. The official Paseo plugin directory

After 0.2.1 is on npm. You need to be signed in to GitHub.

1. Open <https://github.com/getpaseo/plugins/issues/new?template=submit-plugin.yml> and fill in:

   | Field | Value |
   | --- | --- |
   | Title | `Claude Code updates` (it becomes the listing's name) |
   | Source | `npm:paseo-plugin-claude-update@0.2.1` |
   | Categories | Daemon management (first, so it is the main one), Sidebar |

2. The form has no field for images. Once the issue is open, edit its description (or add a
   comment) and add the three screenshots, pinned to the released commit:

   ```bash
   C=$(git rev-list -n1 v0.2.1)
   for f in 01-status-update-ready 02-status-after-update 03-settings; do
     echo "https://raw.githubusercontent.com/tomcrawf90/paseo-plugin-claude-update/$C/docs/screenshots/$f.png"
   done
   ```

   Check that each address answers 200 with `content-type: image/png` before pasting them, under a
   heading such as "Screenshots (the first is the card image)".

3. A bot opens a "Review" pull request in getpaseo/plugins that adds
   `plugins/tomcrawf90/claude-update.json`; the reviewer may ask questions there. Once it is merged
   the plugin installs with `paseo plugin add tomcrawf90/claude-update`.

After that, each new npm version reaches the directory through its own update pull requests (twice a
day). Those keep the listing's name, categories and images; new screenshots need a pull request to
getpaseo/plugins that changes `listing.media`.

## 5. Paseo Cafe

After 0.2.1 is on npm. Submission is the form at <https://paseo.cafe/submit>, which opens a
prefilled issue in paseo-cafe/paseo-cafe; a bot turns it into a pull request that adds
`registry/claude-update.json`.

| Form field | Value to enter | Notes |
| --- | --- | --- |
| Registry id | `claude-update` | Must equal `id` in `paseo-plugin.json`. |
| GitHub repository | `tomcrawf90/paseo-plugin-claude-update` | `owner/repo`, not a URL. |
| Plugin subpath | leave empty | The repository is the plugin. |
| npm package | `paseo-plugin-claude-update` | |
| Categories | `automation`, `monitoring` | Allowed: automation, browser, code-review, git, github, monitoring, orchestration, productivity, provider, theme, other. |
| Platforms | leave empty | The form asks for platforms only when a plugin works on nothing else. Updating works wherever Claude Code's native installer does; only the process list and notifications are macOS only, which the third caveat says. |
| Caveats | the six lines below | One per line, up to 6, each one sentence of at most 140 characters. |
| Confirmation 1 | tick | "`paseo-plugin.json.id` in my repo matches the registry filename". True. |
| Confirmation 2 | tick | "The npm package is public, contains the same plugin ID, and has a released semantic version rather than `0.0.0`". True once 0.2.1 is on npm. |

Caveats to paste (each is under 140 characters):

```text
Only reports updates until you turn on "Auto-update Claude Code"; then it runs claude update on a schedule.
Supports Claude Code's native installer only, not Homebrew, WinGet or npm-based installs.
Tested on macOS only; listing old processes and desktop notifications are macOS only.
Running agents keep their old Claude Code version until you restart them; nothing is restarted for you.
Follows Claude Code's own autoUpdatesChannel; set that to stable yourself to follow the stable channel.
Reads process environments on the host to match processes to agents; only the Paseo agent id is used.
```

Paseo Cafe rescans npm every 15 minutes and the repository every six hours; a new npm version needs
no new submission, but `package.json` on `main` must name the version npm has.

## 6. Rules `npm run lint:listings` checks

| Rule | Listing |
| --- | --- |
| Manifest keys allowed for the range; `id` lowercase kebab-case, 2 to 64 characters; `requirements.paseo` a valid range that does not reach below 0.8 | Paseo Cafe |
| The modules reachable from `index.server.ts` and `index.client.tsx` stay inside `client/`, `server/` and `shared/`, at most 200 files and 2 MB with the manifest | Paseo Cafe |
| No symlinks, and no source file containing a synchronous process call, a shell `-c` or a command-line download tool (an older Paseo Cafe text rule, still in its repository) | Paseo Cafe |
| `package.json` and the manifest have the same description; `repository` names the GitHub repository; the package name without `paseo-plugin-` is the manifest `id`; no runtime dependencies | Official directory |
| `OVERVIEW.md` exists, is in `files`, and names no install command | Official directory |
| No `images/` folder; `docs/screenshots/` holds only images, at most 8, each shown in the README by its absolute address; every README link is an https address; README has "Install" and "Limitations" sections; `LICENSE` exists; a released version; `test` and `typecheck` scripts | Both |

## Could not be determined

- Whether either listing's checks pass in full: they run on submission. The local check covers their published rules only.
- How long review takes. The official directory's reviewer is partly a bot run every 30 minutes; Paseo Cafe says listings are not reviewed or vouched for.
- Whether the Paseo app's directory browser offers a plugin to a Paseo version its range excludes. Nothing in the app was found to filter on it; an excluded version shows an error at install.
