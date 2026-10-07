# Releasing

A release is a version in `package.json`, a dated entry in `CHANGELOG.md`, a git tag `vX.Y.Z` on
`main`, a package on npm and a GitHub release. `package.json` is the one place the version is
written by hand; `npm run check:release` (part of `npm run verify` and of CI) fails when the
changelog disagrees with it, and the release workflow fails when the tag does.

Pushing the tag is the release. `.github/workflows/release.yml` does the rest.

State on 2026-10-07: nothing is published, no tag exists and the release workflow has never run.
0.2.1 is the first version to release.

## Once, around the first two releases

Every sibling plugin publishes with npm trusted publishing: no token, npm trusts this repository's
release workflow. But the trusted publisher is a setting on the package's own page, and npm's
`npm trust` documentation says "the package you're configuring must already exist on the npm
registry". So the first release is published with a token and the later ones without.

| # | When | Step | Where | Detail |
| --- | --- | --- | --- | --- |
| 1 | Before 0.2.1 | Have an npm account with two-factor authentication | <https://www.npmjs.com/signup> | The package name `paseo-plugin-claude-update` was free on 2026-10-07. |
| 2 | Before 0.2.1 | Create a granular access token | npmjs.com → your avatar → Access Tokens → Generate New Token | Expiration: as short as covers the first release (the default is 7 days). Tick "Bypass two-factor authentication". Packages and scopes: "Read and write (publish and stage)", not the stage-only choice, for all packages (the package does not exist yet, so it probably cannot be picked by name). Organizations: no access. |
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
| Allowed actions | Allow publishing directly with `npm publish`, which is what the workflow runs. Staged publishing alone is not enough. What the form selects by default was not seen. |

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
npm run verify && npm pack --dry-run
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

Which number: a fix is a patch, a new feature or setting is a minor, and a change that breaks an
installed plugin's settings or drops a supported Paseo version is a major. A published version is
never reused or moved; a bad release is followed by a new one.

## What the workflow does

Trigger: a pushed tag of the form `vX.Y.Z` (three numbers; a prerelease tag does not start it).

| Job | Step | Fails when |
| --- | --- | --- |
| Verify and pack | The tagged commit is on `main` | The tag was made on another branch |
| | `node scripts/release.mjs check --tag vX.Y.Z` | The tag is not `v` + the `package.json` version, the top changelog entry is another version, it is still `unreleased`, it is empty, or `## Unreleased` still holds changes |
| | `node scripts/release.mjs unpublished` | npm already has this version, or the registry did not give a clear answer |
| | `npm ci`, `npm run verify`, `npm pack --dry-run`, `npm pack` | Typecheck, tests, the Paseo Cafe pre-check or packing fails |
| Publish to npm | npm is 11.5.1 or newer; the version is still not on npm | A second run for the same version |
| | `npm publish <the packed tarball> --access public --provenance` | npm accepts neither the trusted publisher nor a token. The job fails with an error that says so; it never skips |
| GitHub release | `gh release create vX.Y.Z <tarball>` with the changelog entry and the install line as notes | The release cannot be created. An existing release is left alone |

The tarball attached to the GitHub release is the file that was published, packed once in the first
job. The publish job installs no dependencies and runs no package script. It is the only job with
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
| 2 | `npm publish` failed on credentials | Nothing was published. Fix the trusted publisher or the `NPM_TOKEN` secret (above), then "Re-run failed jobs". |
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
| The release workflow end to end | Never run: it starts only on a tag, and no tag has been pushed. Checked with `actionlint`; the checks it runs are tested in `scripts/release.test.mjs` and were run by hand against this repository. |
| Publishing with a token, then with a trusted publisher | Not done. That npm tries the trusted publisher first and falls back to the token was read in the npm CLI source (`lib/utils/oidc.js`), not seen. |
| The npm form and token screens | Taken from npm's documentation on 2026-10-07, not from the screens. That includes: a package must exist before it can name a trusted publisher, the 2-day expiry of an unused one, and the choices on the token form. |
| The ruleset and settings names | Written from GitHub's documentation, not clicked through on this repository. |
