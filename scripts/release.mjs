#!/usr/bin/env node
// Release checks and the version bump. package.json holds the version; the
// changelog and the tag have to agree with it. Used by CI, by the release
// workflow and by hand (see RELEASING.md):
//
//   node scripts/release.mjs check              changelog agrees with package.json
//   node scripts/release.mjs check --tag v1.2.3 the same, for a release tag: the entry must be dated
//   node scripts/release.mjs notes              the GitHub release text: the changelog entry and the install line
//   node scripts/release.mjs prepare <patch|minor|major|x.y.z>   bump and date the changelog
//   node scripts/release.mjs unpublished        fails if npm already has this version
//
// Nothing here tags, pushes or publishes.
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNRELEASED = "unreleased";
// A version that was finished but never reached npm: kept in the changelog, never tagged.
const NOT_PUBLISHED = "not published";
const REGISTRY = "https://registry.npmjs.org";

/**
 * The `## ` entries of a changelog, top first. An entry is `## x.y.z - <date>`,
 * `## x.y.z - unreleased` while it is being worked on, `## x.y.z - not published`
 * for a version that was skipped, or `## Unreleased` for
 * changes that have no version yet.
 */
export function parseChangelog(text) {
  const lines = text.split("\n");
  const entries = [];
  lines.forEach((line, index) => {
    if (!line.startsWith("## ")) return;
    const heading = line.slice(3).trim();
    const match = /^(\d+\.\d+\.\d+) - (.+)$/.exec(heading);
    const entry = match
      ? { version: match[1], date: match[2], line: index }
      : heading.toLowerCase() === UNRELEASED
        ? { version: null, date: UNRELEASED, line: index }
        : null;
    if (entry === null) throw new Error(`CHANGELOG.md line ${index + 1}: expected "## x.y.z - YYYY-MM-DD", "## x.y.z - unreleased" or "## Unreleased", found "${line}"`);
    if (entries.length > 0) entries[entries.length - 1].end = index;
    entries.push(entry);
  });
  if (entries.length > 0) entries[entries.length - 1].end = lines.length;
  return entries.map((entry) => ({ ...entry, body: lines.slice(entry.line + 1, entry.end).join("\n").trim() }));
}

function realDate(text) {
  if (!DATE.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/**
 * Problems that stop a release, as a list of sentences; empty when there are
 * none. Without a tag (a pull request, or main between releases) the top
 * versioned entry has to be the package version and may still be unreleased.
 * With a tag, the tag has to be `v<version>` and the entry dated.
 */
export function checkRelease({ version, changelog, tag }) {
  const problems = [];
  if (!VERSION.test(version) || version === "0.0.0") {
    problems.push(`package.json: version "${version}" is not a released semantic version (x.y.z)`);
    return problems;
  }
  let entries;
  try {
    entries = parseChangelog(changelog);
  } catch (error) {
    return [error.message];
  }
  const versioned = entries.filter((entry) => entry.version !== null);
  const top = versioned[0];
  if (entries.some((entry, index) => entry.version === null && index > 0)) problems.push('CHANGELOG.md: "## Unreleased" must be the first entry, and there is only one');
  const seen = new Set();
  for (const entry of versioned) {
    if (seen.has(entry.version)) problems.push(`CHANGELOG.md: ${entry.version} has two entries`);
    seen.add(entry.version);
    if (![UNRELEASED, NOT_PUBLISHED].includes(entry.date) && !realDate(entry.date)) problems.push(`CHANGELOG.md: ${entry.version} is dated "${entry.date}"; use YYYY-MM-DD, "unreleased" or "not published"`);
  }
  if (top === undefined) {
    problems.push(`CHANGELOG.md: no entry for ${version}`);
  } else if (top.version !== version) {
    problems.push(`CHANGELOG.md: the top entry is ${top.version} but package.json is at ${version}`);
  } else if (top.body === "") {
    problems.push(`CHANGELOG.md: the entry for ${version} is empty`);
  }
  if (tag !== undefined) {
    if (tag !== `v${version}`) problems.push(`tag "${tag}" does not match package.json, which is at ${version} (expected "v${version}")`);
    if (top?.version === version && [UNRELEASED, NOT_PUBLISHED].includes(top.date)) problems.push(`CHANGELOG.md: ${version} is still marked ${top.date}; date it before tagging (npm run release:prepare -- ${version})`);
    const pending = entries.find((entry) => entry.version === null);
    if (pending !== undefined && pending.body !== "") problems.push('CHANGELOG.md: "## Unreleased" has changes that are not in the tagged version');
  }
  return problems;
}

/** The text of one version's changelog entry, for the GitHub release. */
export function releaseNotes({ version, changelog }) {
  const entry = parseChangelog(changelog).find((candidate) => candidate.version === version);
  if (entry === undefined || entry.body === "") throw new Error(`CHANGELOG.md: no entry for ${version}`);
  return entry.body;
}

/** `patch`, `minor`, `major` or an exact version, applied to the current one. */
export function nextVersion(current, bump) {
  const now = VERSION.exec(current);
  if (now === null) throw new Error(`package.json: version "${current}" is not x.y.z`);
  const [major, minor, patch] = now.slice(1).map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  const wanted = VERSION.exec(bump ?? "");
  if (wanted === null) throw new Error(`expected patch, minor, major or a version such as 1.2.3, got "${bump ?? ""}"`);
  const order = wanted.slice(1).map(Number).map((part, index) => part - [major, minor, patch][index]).find((difference) => difference !== 0) ?? 0;
  if (order < 0) throw new Error(`${bump} is lower than the current version ${current}`);
  return wanted.slice(1).map(Number).join(".");
}

/**
 * The changelog with the entry for `version` dated. The entry is the pending
 * one: `## Unreleased`, or `## <version> - unreleased`. A version that already
 * has a dated entry, or a release with nothing written for it, is an error.
 */
export function stampChangelog({ changelog, version, date }) {
  if (!realDate(date)) throw new Error(`"${date}" is not a date (YYYY-MM-DD)`);
  const entries = parseChangelog(changelog);
  const existing = entries.find((entry) => entry.version === version);
  if (existing !== undefined && existing.date !== UNRELEASED) throw new Error(`CHANGELOG.md: ${version} is already marked ${existing.date}; a version is never reused`);
  const pending = entries.find((entry) => entry.version === null);
  if (existing !== undefined && pending !== undefined && pending.body !== "") throw new Error(`CHANGELOG.md: both "## Unreleased" and "## ${version} - unreleased" have changes; merge them into one entry`);
  const target = existing ?? pending;
  if (target === undefined) throw new Error(`CHANGELOG.md: nothing to release; add the changes under "## Unreleased" first`);
  if (target !== entries[0] && !(existing !== undefined && pending === entries[0] && entries[1] === existing)) throw new Error(`CHANGELOG.md: the entry for ${version} must be at the top`);
  if (target.body === "") throw new Error(`CHANGELOG.md: the entry to release is empty; write what changed first`);
  const lines = changelog.split("\n");
  lines[target.line] = `## ${version} - ${date}`;
  if (existing !== undefined && pending !== undefined) lines.splice(pending.line, existing.line - pending.line);
  return lines.join("\n");
}

function setVersion(text, version, paths) {
  const data = JSON.parse(text);
  for (const path of paths) {
    let holder = data;
    for (const key of path.slice(0, -1)) holder = holder?.[key];
    if (holder === undefined || holder === null) throw new Error(`no ${path.join(".")} to set`);
    holder[path[path.length - 1]] = version;
  }
  return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * Bumps package.json and package-lock.json and dates the changelog entry, in
 * the directory given. Writes nothing unless every step can be done. Passing
 * the current version dates the changelog without changing the version, for a
 * version that was developed under its own number.
 */
export function prepareRelease({ root, bump, date }) {
  const files = { package: join(root, "package.json"), lock: join(root, "package-lock.json"), changelog: join(root, "CHANGELOG.md") };
  const packageText = readFileSync(files.package, "utf8");
  const current = JSON.parse(packageText).version;
  const version = nextVersion(current, bump);
  const changelog = stampChangelog({ changelog: readFileSync(files.changelog, "utf8"), version, date });
  const nextPackage = setVersion(packageText, version, [["version"]]);
  const nextLock = setVersion(readFileSync(files.lock, "utf8"), version, [["version"], ["packages", "", "version"]]);
  const problems = checkRelease({ version, changelog, tag: `v${version}` });
  if (problems.length > 0) throw new Error(problems.join("\n"));
  writeFileSync(files.package, nextPackage);
  writeFileSync(files.lock, nextLock);
  writeFileSync(files.changelog, changelog);
  return { previous: current, version };
}

/**
 * Whether the registry already has this version. Anything but a clear yes or
 * no is an error, so that a registry outage cannot read as "not published".
 */
export async function isPublished({ name, version, fetch: request = fetch, registry = REGISTRY }) {
  const response = await request(`${registry}/${name.replace("/", "%2f")}/${version}`, { headers: { accept: "application/json" } });
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  throw new Error(`the npm registry answered ${response.status} for ${name}@${version}`);
}

async function main([command, ...rest]) {
  const root = join(fileURLToPath(import.meta.url), "..", "..");
  const read = (name) => readFileSync(join(root, name), "utf8");
  const manifest = () => JSON.parse(read("package.json"));
  if (command === "check") {
    // Anything but nothing or "--tag <tag>" is refused, so that a mistyped
    // flag cannot pass as the looser check.
    if (rest.length > 0 && (rest[0] !== "--tag" || rest.length > 2)) throw new Error(`check takes nothing or "--tag vX.Y.Z", got "${rest.join(" ")}"`);
    const tag = rest.length === 0 ? undefined : (rest[1] ?? "");
    const { version } = manifest();
    const problems = checkRelease({ version, changelog: read("CHANGELOG.md"), tag });
    if (problems.length > 0) throw new Error(problems.join("\n"));
    console.log(tag === undefined ? `release check: package.json and CHANGELOG.md agree on ${version}` : `release check: ${tag} matches package.json and a dated CHANGELOG.md entry`);
  } else if (command === "notes") {
    const { name, version } = manifest();
    console.log(`${releaseNotes({ version, changelog: read("CHANGELOG.md") })}\n\n\`\`\`bash\npaseo plugin install npm:${name}@${version}\n\`\`\``);
  } else if (command === "prepare") {
    const { previous, version } = prepareRelease({ root, bump: rest[0], date: new Date().toISOString().slice(0, 10) });
    console.log(`${previous} -> ${version}: package.json, package-lock.json and CHANGELOG.md updated. Nothing was committed or tagged.`);
  } else if (command === "unpublished") {
    const { name, version } = manifest();
    if (await isPublished({ name, version })) throw new Error(`${name}@${version} is already on npm. A version is published once; release a new one instead.`);
    console.log(`${name}@${version} is not on npm yet`);
  } else {
    throw new Error("usage: release.mjs check [--tag vX.Y.Z] | notes | prepare <patch|minor|major|x.y.z> | unpublished");
  }
}

// Compared as real paths: a temporary directory is often behind a symlink.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    for (const line of error.message.split("\n")) console.error(`error: ${line}`);
    process.exitCode = 1;
  });
}
