# Releasing

A release is a version in `package.json`, a dated entry in `CHANGELOG.md`, a git tag `vX.Y.Z` on
`main`, a package on npm and a GitHub release. `package.json` is the one place the version is
written by hand; `npm run check:release` (part of `npm run verify` and of CI) fails when the
changelog disagrees with it, and the release workflow fails when the tag does.

Pushing the tag is the release. `.github/workflows/release.yml` does the rest.

As of 2026-10-27: 0.2.1 and 0.3.0 are on npm, each published by this workflow with a provenance
statement. npm names the owner's account as the publisher of both, not GitHub Actions, and the
`NPM_TOKEN` secret is still set, so 0.3.0 most likely went out with the token rather than the trusted
publisher. Step 5 below is not done, and steps 6 to 8 are not confirmed. (0.2.1's first tag run, on 71e405b, stopped at "Publish
to npm" with `E403 ... You may not perform that action with these credentials`; a second tag run
published it.)

## Once, around the first two releases

Every sibling plugin publishes with npm trusted publishing: no token, npm trusts this repository's
release workflow. But the trusted publisher is a setting on the package's own page, and npm's
`npm trust` documentation says "the package you're configuring must already exist on the npm
registry". So the first release is published with a token and the later ones without.

| # | When | Step | Where | Detail |
| --- | --- | --- | --- | --- |
| 1 | Before 0.2.1 | Have an npm account with two-factor authentication | <https://www.npmjs.com/signup> | The package name `paseo-plugin-claude-update` was free on 2026-10-07. |
| 2 | Before 0.2.1 | Create a granular access token | npmjs.com → your avatar → Access Tokens → Generate New Token | Expiration: as short as covers the first release (npm's changelog gives 7 days as the default and 90 as the most for a token that can publish). Tick "Bypass two-factor authentication". Packages and scopes: "Read and write (publish and stage)", not the stage-only choice, for all packages (the package does not exist yet, so it probably cannot be picked by name). Organizations: no access. |
| 3 | Before 0.2.1 | Store it as the repository secret `NPM_TOKEN` | GitHub → Settings → Secrets and variables → Actions → New repository secret, or `gh secret set NPM_TOKEN --repo tomcrawf90/paseo-plugin-claude-update` (it asks for the value) | Never paste it anywhere else. |
| 4 | | Release 0.2.1 | "Each release" below | The workflow publishes with the token. The package gets a provenance statement either way. |
| 5 | Right after 0.2.1 | Delete the `NPM_TOKEN` secret and revoke the token, unless the next release is days away | GitHub secrets; npmjs.com → Access Tokens | An all-packages token should not outlive its one use. |
| 6 | Within two days before the next release | Name the trusted publisher | npmjs.com → Packages → the package → Settings → Trusted publishing → GitHub Actions | The form fields are in the table below. npm's documentation says a new trusted publisher that has not published within 2 days expires, which is why this waits for the next release. |
| 7 | | Release the next version | "Each release" below | Published through the trusted publisher. If npm refuses, nothing is published: fix the form and re-run the failed job. |
| 8 | After that release | Close the token route | npmjs.com → the package → Settings → Publishing access → "Require two-factor authentication and disallow tokens" | Trusted publishing still works; a leaked token can no longer publish. |

Trusted publisher form (case-sensitive, exact):

| Field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `tomcrawf90` |
| Repository | `paseo-plugin-claude-update` |
| Workflow filename | `release.yml` (the file name only, with its extension) |
| Environment name | leave empty |
| Allowed actions | Allow publishing directly with `npm publish`, which is what the workflow runs. npm's documentation says a trusted publisher created after 2026-09-03 allows only `npm stage publish` until direct publishing is chosen as well, so tick it. Staged publishing alone is not enough. |

With both a trusted publisher and `NPM_TOKEN` present, npm uses the trusted publisher. npm's
documentation also says that publishing directly with a granular token will be removed in January
2027, so the token is for the first release only.

## Each release

Between releases, changes are written under `## Unreleased` at the top of `CHANGELOG.md` and
`package.json` stays at the version that is on npm. Paseo Cafe compares the two, so `main` should
not carry a version npm does not have for longer than a release takes. (0.2.1 was developed under
its own heading, `## 0.2.1 - unreleased`, which the script also accepts.)

```bash
# 1. On a branch from an up-to-date main
git switch -c release/0.2.2 origin/main

# 2. Bump package.json and package-lock.json and date the changelog entry.
#    patch, minor, major, or an exact version. For the first release: -- 0.2.1
npm run release:prepare -- patch

# 3. Check, commit, open the pull request
npm run verify && npm run check:compat && npm pack --dry-run
git commit -am "Release 0.2.2"
git push -u origin release/0.2.2
gh pr create --fill

# 4. After the pull request is merged and CI on main is green: tag main and push the tag
git switch main && git pull --ff-only
git tag -a v0.2.2 -m "0.2.2"
git push origin v0.2.2
```

`release:prepare` only edits the three files. It does not commit, tag or publish, and it refuses a
version that already has a dated entry, an empty entry and a version lower than the current one.

Before step 3, if a screen changed, run `npm run screenshots` (macOS with Chrome; it starts its own
throwaway daemon) and commit the new `docs/screenshots/`. Both listings are covered in
[SUBMISSION.md](SUBMISSION.md): after a release, the official directory opens its own update pull
request and Paseo Cafe rescans npm, so nothing is submitted again. The official listing's images
stay pinned to the commit they were given for until its `listing.media` is changed by a pull request
to getpaseo/plugins.

Which number: a fix is a patch, a new feature or setting is a minor, and a change that breaks an
installed plugin's settings or drops a supported Paseo version is a major. A published version is
never reused or moved; a bad release is followed by a new one.

## When Paseo changes

`.github/workflows/compat.yml` runs `npm run check:compat` every day, and on pull requests and pushes that
touch the plugin's code, the range or the check: against the lowest Paseo the range admits and the
newest Paseo on npm (published as both `@getpaseo/cli` and `@getpaseo/plugin`), betas included. For each it reports whether `requirements.paseo` admits the version (by Paseo's
own test), whether the plugin typechecks against that `@getpaseo/plugin`, and whether a throwaway
daemon of that version loads the plugin and answers its RPCs. A failed run on main opens an issue (or
comments on the open one).

| The summary says | Do |
| --- | --- |
| works, but `requirements.paseo` refuses it (below its minimum) | Only for a version asked for with `--paseo` below the minimum: expected. Lower or raise the minimum only on purpose (AGENTS.md). |
| broken | The plugin needs a change for that Paseo. Fix it in a pull request; `npm run check:compat -- --paseo <version>` repeats the check locally, and `npm run check:ui -- --paseo <version>` walks the screens in that Paseo's own web app, which the daily check does not. |

`requirements.paseo` has a minimum and no upper bound, so a new Paseo needs no release of the plugin:
nothing in the release steps changes when Paseo does. Raise the minimum only when the plugin starts
using an API an older Paseo lacks (with the `@getpaseo/plugin` devDependency, see AGENTS.md). Add an
upper bound only for a Paseo the plugin is known to break on and cannot be fixed for in time; drop it in
the release that fixes it. A beta of the next minor is worth one `npm run check:ui` when it comes out:
Paseo's app can drop a deprecated plugin function that a typecheck against its SDK would not notice.

One move has a date, whatever the range: Paseo removes `addSurface`, `addSidebarItem` and `openSurface` after
2027-03-29 and the `@getpaseo/plugin/client/react-native` entry after 2027-04-20 (AGENTS.md, "Four things
the plugin uses are deprecated"). A release before 2027-03-29 has to stop using them.

GitHub switches a scheduled workflow off after 60 days without a commit to the repository. A merged
Dependabot pull request counts; if the Actions page shows the workflow disabled, switch it on there.

## What the workflow does

Trigger: a pushed tag of the form `vX.Y.Z` (three numbers; a prerelease tag does not start it).

| Job | Step | Fails when |
| --- | --- | --- |
| Verify and pack | The tagged commit is on `main` | The tag was made on another branch |
| | `node scripts/release.mjs check --tag vX.Y.Z` | The tag is not `v` + the `package.json` version, the top changelog entry is another version, it is still `unreleased`, it is empty, or `## Unreleased` still holds changes |
| | `node scripts/release.mjs unpublished` | npm already has this version, or the registry did not give a clear answer |
| | `npm ci --ignore-scripts`, `npm run verify`, `npm pack --dry-run`, `npm pack` | Typecheck, tests, the listing pre-check or packing fails |
| Publish to npm | npm is 11.5.1 or newer; the version is still not on npm | A second run for the same version |
| | `npm publish <the packed tarball> --access public --provenance` | npm accepts neither the trusted publisher nor a token. The job fails with an error that says so; it never skips |
| GitHub release | `gh release create vX.Y.Z <tarball>` with the changelog entry and the install line as notes | The release cannot be created. An existing release is left alone |

The tarball attached to the GitHub release is the file that was published, packed once in the first
job, after an install that runs no dependency's install script, so none can change what is packed.
The publish job installs no dependencies and runs no package script. It is the only job with
`id-token: write`; only the last job has `contents: write`.

A version cannot be published twice: the workflow checks the registry before publishing, releases
never run side by side, and npm itself refuses a version it has had.

Push one release tag at a time and let its run finish. GitHub keeps only one waiting run per
concurrency group, so a third tag pushed while the first is still running cancels the second one's
run; it would have to be started again from the Actions page.

## When a release fails

| # | What happened | What to do |
| --- | --- | --- |
| 1 | Published to npm, GitHub release failed | Actions → the run → "Re-run failed jobs". Only the release job runs again. Do not re-run all jobs: the first one would stop at "already on npm". |
| 2 | `npm publish` failed on credentials | Nothing was published. Fix the trusted publisher or the `NPM_TOKEN` secret (above), then "Re-run failed jobs". If `main` has changed since the tag, a re-run would publish the old commit: follow 4 instead. A token npm refuses gives `E403 ... You may not perform that action with these credentials` (seen 2026-10-21); check that it is "Read and write" (not stage only) for all packages and has not expired. |
| 3 | The publish job is red but npm has the version (the upload went through and the answer was lost) | Check with `npm view paseo-plugin-claude-update versions`. Re-running stops at "already on npm", so make the GitHub release by hand: download the `release` artifact from the run (kept 7 days; it holds the tarball and `notes.md`) and run `gh release create vX.Y.Z <tarball> --verify-tag --title vX.Y.Z --notes-file notes.md`. |
| 4 | A check failed before publishing (tag, changelog, tests) | Nothing was published. Fix it on `main` through a pull request. If the tag now points at the wrong commit, delete it (`git push origin :refs/tags/vX.Y.Z`, `git tag -d vX.Y.Z`) and tag the fixed commit. Only ever do this for a version that never reached npm. |
| 5 | A bad version reached npm | Release a fixed patch version. `npm deprecate paseo-plugin-claude-update@X.Y.Z "reason"` warns people off the bad one. Do not unpublish and do not move the tag. |

`publishConfig.provenance` is `true`, so a plain `npm publish` from a laptop fails: provenance can
only be made in CI. That is on purpose. If a release ever has to be published by hand, it is
`npm publish --provenance=false`, and the package then has no provenance statement.

## Repository settings to switch on

None of these are set by the code in this repository. Most useful first.

| # | Setting | Where | Value |
| --- | --- | --- | --- |
| 1 | Protect `main` | Settings → Rules → Rulesets → New branch ruleset, target the default branch | Require a pull request before merging, with 0 required approvals (one maintainer cannot approve their own); require the status check `CI passed`; block force pushes; restrict deletions. No bypass, so the rule holds for the owner too. |
| 2 | Protect release tags | Settings → Rules → Rulesets → New tag ruleset, target `v*` | Restrict updates and restrict deletions, with an empty bypass list, so that nobody, the owner included, can move or delete a pushed release tag. Creating tags stays open to whoever can push, which is the owner alone. A bypass list applies to the whole ruleset, so adding the admin role to it would undo the rule for the owner. Recovery 4 above needs the ruleset switched off for a moment. |
| 3 | Secret scanning and push protection | Settings → Advanced Security | On. Free for a public repository. |
| 4 | Private vulnerability reporting | Settings → Advanced Security | On. `SECURITY.md` sends reports there. |
| 5 | Dependabot alerts and security updates | Settings → Advanced Security | On. `.github/dependabot.yml` already asks for weekly version updates. |
| 6 | Actions permissions | Settings → Actions → General | Allow GitHub-owned actions only (the workflows use nothing else); workflow permissions "Read repository contents and packages permissions"; leave "Allow GitHub Actions to create and approve pull requests" off; require approval for workflows from all outside collaborators. |
| 7 | Immutable releases | Settings → General → Releases | On, optional. A published release and its tag can then not be changed. Not tried with this workflow. |
| 8 | Delete head branches after merge | Settings → General → Pull Requests | On. |

## Not verified

| Point | State |
| --- | --- |
| The release workflow end to end | Seen working for `v0.2.1` (its second run, 2026-10-21) and `v0.3.0` (2026-10-23): tag checks, verify, publish with provenance and the GitHub release. The first `v0.2.1` run stopped at publishing, npm refusing the token (E403). |
| Publishing with a token, then with a trusted publisher | Publishing with the token is seen to work. Publishing through the trusted publisher is not confirmed: npm names the owner's account, not GitHub Actions, as publisher of 0.3.0. That npm tries the trusted publisher first and falls back to the token was read in the npm CLI source (`lib/utils/oidc.js`), not seen. |
| The npm form and token screens | Taken from npm's documentation on 2026-10-07 and read again on 2026-10-20, not from the screens. That includes: a package must exist before it can name a trusted publisher, the 2-day expiry of an unused one, and the choices on the token form. |
| The ruleset and settings names | Written from GitHub's documentation, not clicked through on this repository. |
