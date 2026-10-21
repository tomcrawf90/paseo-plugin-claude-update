// Checks the plugin against Paseo releases, to catch the next daemon before
// users do. For each Paseo version:
//
//   range      requirements.paseo admits it, by Paseo's own rule
//   typecheck  the plugin compiles against @getpaseo/plugin of that version
//   daemon     a throwaway daemon of that version (scripts/daemon.mjs) loads the
//              plugin, whose range is opened up for this, and answers status.get
//              and a look-only status.check without the CLI being asked to install
//
//   npm run check:compat                        # the minimum and the newest Paseo
//   npm run check:compat -- --paseo 0.12.0      # one version (repeatable)
//   npm run check:compat -- --paseo newest --skip-daemon
//
// "minimum" is the lowest version the range admits; "newest" is the highest
// version of @getpaseo/cli on npm, prereleases included, so a beta of the next
// minor is checked as soon as it is out. Network: npm, and the stand-in CLI's
// look reads Claude Code's release pointer.
import { execFile } from "node:child_process";
import { appendFile, cp, mkdtemp, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import semver from "semver";
import { copyPlugin, installPaseo, removeQuietly, repoRoot, startDaemon } from "./daemon.mjs";

const run = promisify(execFile);

/** Paseo's own test (assertPluginCompatibility): the version, or its major.minor.patch, satisfies the range. */
export function paseoAdmits(version, range) {
  const parsed = semver.parse(version);
  if (parsed === null) return false;
  return semver.satisfies(parsed, range) || semver.satisfies(`${parsed.major}.${parsed.minor}.${parsed.patch}`, range);
}

/** The highest version in an npm `versions` list, prereleases included. */
export function newestVersion(versions) {
  const valid = versions.filter((version) => semver.valid(version) !== null);
  if (valid.length === 0) throw new Error("npm listed no versions of @getpaseo/cli");
  return valid.sort(semver.rcompare)[0];
}

/** The lowest version the range admits. */
export function minimumVersion(range) {
  const minimum = semver.minVersion(range);
  if (minimum === null) throw new Error(`requirements.paseo admits no version: ${range}`);
  return minimum.version;
}

/** What a failed version means, for the summary. */
export function verdict(result) {
  if (result.daemon === "fail" || result.typecheck === "fail") return "broken: the plugin needs a fix for this Paseo";
  if (result.range === "fail") return "works, but requirements.paseo refuses it: raise the range and release";
  return "ok";
}

async function paseoVersions() {
  const { stdout } = await run("npm", ["view", "@getpaseo/cli", "versions", "--json"]);
  return JSON.parse(stdout);
}

/** Compiles a copy of the repository against @getpaseo/plugin@version. */
async function typecheck(version, work) {
  const copy = join(work, "typecheck");
  const skip = new Set(["node_modules", ".git"]);
  await cp(repoRoot, copy, { recursive: true, filter: (source) => !skip.has(source.split("/").pop()) });
  await run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: copy, maxBuffer: 64 * 1024 * 1024 });
  await run("npm", ["install", "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error", `@getpaseo/plugin@${version}`], { cwd: copy, maxBuffer: 64 * 1024 * 1024 });
  await run(join(copy, "node_modules", ".bin", "tsc"), ["--noEmit"], { cwd: copy, maxBuffer: 16 * 1024 * 1024 });
}

/** Loads the plugin in a throwaway daemon of `version` and calls its RPCs. */
async function daemonCheck(version, work) {
  const prefix = join(work, "paseo");
  const installed = await installPaseo(version, prefix);
  if (installed !== version) throw new Error(`npm installed @getpaseo/cli ${installed}, not ${version}`);
  await copyPlugin(join(work, "plugin"), "*");
  const daemon = await startDaemon({ prefix, work, pluginDir: join(work, "plugin") });
  try {
    const status = await daemon.rpc("status.get");
    if (typeof status !== "object" || status === null || !("autoInstall" in status)) throw new Error(`status.get answered ${JSON.stringify(status)}`);
    // Whether the look finds an update depends on the network; that it answers and installs nothing does not.
    const looked = await daemon.rpc("status.check", { apply: false });
    if (typeof looked !== "object" || looked === null || !("lastOutcome" in looked)) throw new Error(`status.check answered ${JSON.stringify(looked)}`);
    const calls = (await readFile(join(daemon.stubDir, "calls"), "utf8").catch(() => "")).split("\n").filter(Boolean);
    if (!calls.includes("--version")) throw new Error("the plugin never ran claude --version");
    const installs = calls.filter((call) => /^(update|install)\b/.test(call));
    if (installs.length > 0) throw new Error(`a look-only check ran: ${installs.join(", ")}`);
    return `status ${looked.lastOutcome ?? "none"}, installed ${looked.installedVersion}`;
  } finally {
    await daemon.stop();
  }
}

async function main(args) {
  const { values } = parseArgs({ args, options: { paseo: { type: "string", multiple: true }, "skip-daemon": { type: "boolean", default: false }, "skip-typecheck": { type: "boolean", default: false } } });
  const manifest = JSON.parse(await readFile(join(repoRoot, "paseo-plugin.json"), "utf8"));
  const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
  const range = manifest.requirements.paseo;
  const asked = values.paseo ?? ["minimum", "newest"];
  const versions = [];
  for (const name of asked) {
    const version = name === "newest" ? newestVersion(await paseoVersions()) : name === "minimum" ? minimumVersion(range) : name;
    if (!versions.includes(version)) versions.push(version);
  }

  const results = [];
  for (const version of versions) {
    const result = { version, range: paseoAdmits(version, range) ? "ok" : "fail", typecheck: "skipped", daemon: "skipped", notes: [] };
    console.log(`\nPaseo ${version}: requirements.paseo "${range}" ${result.range === "ok" ? "admits it" : "refuses it"}`);
    const work = await mkdtemp(join(tmpdir(), `claude-update-compat-${version}-`));
    try {
      // The repository's own devDependency is typechecked by npm run verify already.
      if (!values["skip-typecheck"] && version !== packageJson.devDependencies["@getpaseo/plugin"]) {
        try {
          await typecheck(version, work);
          result.typecheck = "ok";
        } catch (error) {
          result.typecheck = "fail";
          result.notes.push(`typecheck: ${String(error.stdout || error.message).trim().slice(0, 4000)}`);
        }
        console.log(`  typecheck against @getpaseo/plugin@${version}: ${result.typecheck}`);
      }
      if (!values["skip-daemon"]) {
        try {
          result.notes.push(`daemon: ${await daemonCheck(version, join(work, "daemon"))}`);
          result.daemon = "ok";
        } catch (error) {
          result.daemon = "fail";
          result.notes.push(`daemon: ${String(error.message).trim().slice(0, 4000)}`);
        }
        console.log(`  throwaway daemon: ${result.daemon}`);
      }
    } finally {
      await removeQuietly(work);
    }
    for (const note of result.notes) console.log(`  ${note}`);
    results.push(result);
  }

  console.log("\n| Paseo | range | typecheck | daemon | verdict |\n| --- | --- | --- | --- | --- |");
  for (const result of results) console.log(`| ${result.version} | ${result.range} | ${result.typecheck} | ${result.daemon} | ${verdict(result)} |`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = ["| Paseo | range | typecheck | daemon | verdict |", "| --- | --- | --- | --- | --- |", ...results.map((result) => `| ${result.version} | ${result.range} | ${result.typecheck} | ${result.daemon} | ${verdict(result)} |`)];
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  }
  if (results.some((result) => verdict(result) !== "ok")) process.exitCode = 1;
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
