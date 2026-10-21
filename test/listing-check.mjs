// A local copy of the checks the two plugin listings make, so that a change
// that would be refused is caught here first. Passing here is not being
// listed; it catches the known ways to fail.
//
// Paseo Cafe (github.com/paseo-cafe/paseo-cafe, scripts/plugin-security/
// static-scan.ts and scripts/scan.ts, read 2026-10-21): the manifest keys, the
// budget of the modules reachable from the two entries, the images.
// The official Paseo registry (github.com/getpaseo/plugins, scripts/lib and
// REVIEW.md, read 2026-10-21): OVERVIEW.md in the package, one description,
// and a repository the listing's owner is taken from.
import { lstatSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const problems = [];
const read = (path) => readFileSync(join(root, path), "utf8");

// Process calls and download tools that Paseo Cafe's older text rule
// (.github/security/semgrep.yml) blocks in any source file, comments and tests
// included. No workflow there runs it on 2026-10-21, but the rule is still in
// the repository, so every source file here stays clear of it. The words are
// assembled so that this file passes too.
const banned = [["exec", "Sync"], ["spawn", "Sync"], ["bash", " -c"], ["sh", " -c"], ["curl", " "], ["wget", " "]].map((parts) => parts.join(""));
const SOURCE = /\.[cm]?[jt]sx?$/;
const SKIP = new Set(["node_modules", ".git"]);

function walk(directory) {
  for (const name of readdirSync(directory)) {
    if (SKIP.has(name)) continue;
    const path = join(directory, name);
    const meta = lstatSync(path);
    const shown = relative(root, path);
    if (meta.isSymbolicLink()) {
      problems.push(`${shown}: symlinks are rejected`);
    } else if (meta.isDirectory()) {
      walk(path);
    } else if (SOURCE.test(name)) {
      read(shown)
        .split("\n")
        .forEach((line, index) => {
          for (const word of banned) {
            if (line.includes(word)) problems.push(`${shown}:${index + 1}: contains "${word}", which Paseo Cafe's text rule blocks`);
          }
        });
    }
  }
}
walk(root);

// Paseo Cafe reads the manifest and the modules reachable from the entries,
// at most 200 files and 2 MB between them. Everything else is not counted.
const MAX_FILES = 200;
const MAX_BYTES = 2_000_000;
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;
const reachable = new Set(["paseo-plugin.json"]);
const queue = ["index.server.ts", "index.client.tsx"];
while (queue.length > 0) {
  const file = queue.pop();
  if (reachable.has(file)) continue;
  reachable.add(file);
  for (const match of read(file).matchAll(IMPORT)) {
    const base = join(dirname(file), match[1]);
    const found = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].map((suffix) => base + suffix).find((candidate) => existsSync(join(root, candidate)) && lstatSync(join(root, candidate)).isFile());
    if (found === undefined) problems.push(`${file}: cannot resolve the import "${match[1]}"`);
    else if (!/^(client|server|shared)\//.test(found)) problems.push(`${file}: imports ${found}, outside client/, server/ and shared/`);
    else queue.push(found);
  }
}
const bytes = [...reachable].reduce((total, file) => total + lstatSync(join(root, file)).size, 0);
if (reachable.size > MAX_FILES) problems.push(`${reachable.size} reachable files; Paseo Cafe stops at ${MAX_FILES}`);
if (bytes > MAX_BYTES) problems.push(`${bytes} reachable bytes; Paseo Cafe stops at ${MAX_BYTES}`);

// The manifest. Paseo Cafe allows `description` only when every minimum of the
// range is at least 0.9.0-beta.1, and `name`, `icon` and `media` only when
// every minimum is at least 0.11.0; Paseo 0.10 refuses those three outright.
const manifest = JSON.parse(read("paseo-plugin.json"));
const packageJson = JSON.parse(read("package.json"));
const range = manifest.requirements?.paseo;
const minimums = typeof range === "string" && semver.validRange(range) ? new semver.Range(range).set.map((comparators) => semver.minVersion(comparators.map(String).join(" "))) : null;
if (minimums === null) problems.push("paseo-plugin.json: requirements.paseo must be a valid semver range");
const everyMinimum = (floor) => minimums !== null && minimums.every((minimum) => minimum !== null && semver.gte(minimum, floor));
for (const key of Object.keys(manifest)) {
  if (["id", "requirements", "build"].includes(key)) continue;
  if (key === "description" && everyMinimum("0.9.0-beta.1")) continue;
  if (["name", "icon", "media"].includes(key) && everyMinimum("0.11.0")) continue;
  problems.push(`paseo-plugin.json: Paseo Cafe rejects the key "${key}" with this range`);
}
if (minimums !== null && !everyMinimum("0.8.0")) problems.push("paseo-plugin.json: requirements.paseo must not reach below Paseo 0.8");
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.id ?? "") || manifest.id.length < 2 || manifest.id.length > 64) problems.push("paseo-plugin.json: id must be lowercase kebab-case, 2 to 64 characters");
if (Object.keys(manifest.requirements ?? {}).some((key) => key !== "paseo")) problems.push("paseo-plugin.json: unknown requirement");

// One description: the official listing shows package.json's, Paseo Cafe the manifest's.
if (manifest.description !== packageJson.description) problems.push("package.json and paseo-plugin.json must have the same description");
// The official listing's owner comes from the repository; its id is the package name without "paseo-plugin-".
if (!/github\.com\/[^/]+\/[^/]+/.test(packageJson.repository?.url ?? "")) problems.push("package.json: repository must name the GitHub repository");
if (packageJson.name.replace(/^paseo-plugin-/, "") !== manifest.id) problems.push("package.json: the name without paseo-plugin- must equal the manifest id");
if (!/^\d+\.\d+\.\d+$/.test(packageJson.version) || packageJson.version === "0.0.0") problems.push("package.json: version must be a released semantic version");
for (const script of ["test", "typecheck"]) {
  if (typeof packageJson.scripts?.[script] !== "string") problems.push(`package.json: Paseo Cafe scores a "${script}" script`);
}
if (Object.keys(packageJson.dependencies ?? {}).length > 0) problems.push("package.json: runtime dependencies need an npm shrinkwrap for the official listing");

// OVERVIEW.md is the official listing's page. It ships in the package and,
// as its reviewers ask, names no install command.
const installWords = [["paseo plugin", " add"], ["paseo plugin", " install"], ["npm", ":paseo-plugin"], ["npm", " install"]].map((parts) => parts.join(""));
if (!existsSync(join(root, "OVERVIEW.md"))) {
  problems.push("OVERVIEW.md is missing");
} else {
  if (!(packageJson.files ?? []).includes("OVERVIEW.md")) problems.push("package.json: files must include OVERVIEW.md");
  const overview = read("OVERVIEW.md").toLowerCase();
  for (const word of installWords) if (overview.includes(word)) problems.push(`OVERVIEW.md: names "${word}"; the listing gives the install command`);
  if (/\bnpm i\b/.test(overview)) problems.push('OVERVIEW.md: names "npm i"; the listing gives the install command');
}

// Images: Paseo Cafe shows every file in images/ and then the README's images,
// at most eight, and removes only exact duplicate addresses; its images/
// addresses name a commit, so screenshots kept there and also shown in the
// README would appear twice. They live in docs/screenshots/ and the README
// shows them by absolute address, as npm's page needs. Links from the README
// to other files are absolute too: the npm page has no repository files.
const readme = read("README.md");
const SCREENSHOTS = "docs/screenshots";
const RAW = "https://raw.githubusercontent.com/tomcrawf90/paseo-plugin-claude-update/main/";
if (existsSync(join(root, "images"))) problems.push("images/: Paseo Cafe would show these next to the README's screenshots; keep screenshots in docs/screenshots/");
const images = existsSync(join(root, SCREENSHOTS)) ? readdirSync(join(root, SCREENSHOTS)) : [];
if (images.length === 0) problems.push(`${SCREENSHOTS}/: no screenshots`);
if (images.length > 8) problems.push(`${SCREENSHOTS}/: ${images.length} files; Paseo Cafe shows at most 8`);
for (const image of images) {
  if (!/\.(png|jpe?g|webp|gif)$/i.test(image)) problems.push(`${SCREENSHOTS}/${image}: not an image`);
  else if (!readme.includes(`](${RAW}${SCREENSHOTS}/${image})`)) problems.push(`${SCREENSHOTS}/${image}: not shown in README.md as ${RAW}${SCREENSHOTS}/${image}`);
}
for (const match of readme.matchAll(/\]\(([^)\s]+)\)/g)) {
  const target = match[1];
  if (target.startsWith("#")) continue;
  if (!/^https:\/\//.test(target)) problems.push(`README.md: links ${target}, which the npm page cannot resolve; use an https address`);
  else if (target.startsWith(RAW) && !existsSync(join(root, target.slice(RAW.length)))) problems.push(`README.md: shows ${target}, which is not in the repository`);
  else if (target.startsWith("https://github.com/tomcrawf90/paseo-plugin-claude-update/blob/main/") && !existsSync(join(root, target.split("/blob/main/")[1].split("#")[0]))) problems.push(`README.md: links ${target}, which is not in the repository`);
}
if (!/^##\s+(Install|Installation|Setup|Getting started)\s*$/im.test(readme)) problems.push("README.md: no Install section for Paseo Cafe to quote");
if (!/^##\s+(Limitations|Caveats|Known issues)\s*$/im.test(readme)) problems.push("README.md: no Limitations section for Paseo Cafe to quote");
if (!existsSync(join(root, "LICENSE"))) problems.push("LICENSE is missing");

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Listing pre-check passed: ${reachable.size} reachable files, ${bytes} bytes; ${images.length} images.`);
