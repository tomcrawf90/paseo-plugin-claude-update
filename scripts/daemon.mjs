// A throwaway Paseo daemon with this plugin installed, for the compatibility
// check and the screenshots. Everything lives under one temporary directory:
// the Paseo CLI of the chosen version, the daemon's home, a home directory
// with the stand-in CLI (test/stub/claude) as `claude`, and its state. The
// real Claude Code install, ~/.paseo and the running daemon are never used.
import { execFile, spawn } from "node:child_process";
import { chmod, copyFile, cp, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
export const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A free local port. */
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Installs `@getpaseo/cli@<version>` into `prefix` and returns the version npm resolved. */
export async function installPaseo(version, prefix) {
  await mkdir(prefix, { recursive: true });
  await writeFile(join(prefix, "package.json"), '{ "private": true }\n');
  await run("npm", ["install", "--prefix", prefix, "--no-audit", "--no-fund", "--loglevel=error", `@getpaseo/cli@${version}`], { maxBuffer: 64 * 1024 * 1024 });
  const installed = JSON.parse(await readFile(join(prefix, "node_modules", "@getpaseo", "cli", "package.json"), "utf8"));
  return installed.version;
}

/**
 * Replaces the daemon's host name, which on macOS is the Mac's own name, with
 * `name`, in the throwaway install only. For screenshots. Fails loudly when
 * the module is not where Paseo 0.12 keeps it, so a moved file cannot leak
 * the real name into a picture.
 */
export async function patchHostName(prefix, name) {
  const file = join(prefix, "node_modules", "@getpaseo", "server", "dist", "server", "server", "host-name.js");
  const text = await readFile(file, "utf8").catch(() => {
    throw new Error(`patchHostName: ${file} does not exist in this Paseo version; find where the host name comes from before taking screenshots`);
  });
  if (!text.includes("export function getHostName")) throw new Error(`patchHostName: ${file} no longer exports getHostName`);
  await writeFile(file, `export function getHostName() {\n    return ${JSON.stringify(name)};\n}\n`);
}

/** A copy of the plugin's published files (no tests, no node_modules), with `requirements.paseo` replaced when `range` is given. */
export async function copyPlugin(target, range) {
  const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
  await mkdir(target, { recursive: true });
  for (const entry of [...packageJson.files.filter((name) => !name.startsWith("!")), "package.json"]) {
    await cp(join(repoRoot, entry), join(target, entry), { recursive: true, filter: (source) => !source.endsWith(".test.ts") });
  }
  if (range !== undefined) {
    const manifest = JSON.parse(await readFile(join(target, "paseo-plugin.json"), "utf8"));
    manifest.requirements = { ...manifest.requirements, paseo: range };
    await writeFile(join(target, "paseo-plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

/**
 * Starts a daemon from the Paseo CLI installed in `prefix`, with its home under
 * `work`, and installs the plugin from `pluginDir`. Options:
 *   claude: { version, latest }   the stand-in CLI's installed and newest version
 *   fakeProcesses: true           put test/stub/fake-ps first on PATH (made-up process list)
 *   webUi: true                   serve Paseo's web app on the daemon's port
 */
export async function startDaemon({ prefix, work, pluginDir, claude = { version: "2.1.303", latest: "2.1.306" }, fakeProcesses = false, webUi = false }) {
  const port = await freePort();
  const host = `127.0.0.1:${port}`;
  const home = join(work, "home");
  const paseoHome = join(home, ".paseo");
  const stubDir = join(work, "stub-claude");
  await mkdir(join(home, ".local", "bin"), { recursive: true });
  await mkdir(join(paseoHome, "plugin-settings", "claude-update"), { recursive: true });
  await mkdir(stubDir, { recursive: true });
  await copyFile(join(repoRoot, "test", "stub", "claude"), join(home, ".local", "bin", "claude"));
  await chmod(join(home, ".local", "bin", "claude"), 0o755);
  await writeFile(join(stubDir, "version"), `${claude.version}\n`);
  await writeFile(join(stubDir, "latest"), `${claude.latest}\n`);
  const config = { version: 1, daemon: { listen: host, relay: { enabled: false } }, pluginsEnabled: true };
  if (webUi) config.features = { webUi: { enabled: true } };
  await writeFile(join(paseoHome, "config.json"), `${JSON.stringify(config)}\n`);
  // No desktop notification from a throwaway daemon.
  await writeFile(join(paseoHome, "plugin-settings", "claude-update", "update.json"), '{"version":1,"values":{"desktopNotifications":false}}\n');

  const paseoBin = join(prefix, "node_modules", ".bin", "paseo");
  const path = [fakeProcesses ? join(repoRoot, "test", "stub", "fake-ps") : null, join(process.execPath, ".."), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].filter(Boolean).join(":");
  const env = { HOME: home, PATH: path, USER: "demo", STUB_CLAUDE_DIR: stubDir, TZ: process.env.TZ ?? "UTC" };
  // The made-up processes run the version the stand-in CLI starts on.
  if (fakeProcesses) env.FAKE_PS_VERSION = claude.version;
  const log = await open(join(work, "daemon.log"), "w");
  const child = spawn(paseoBin, ["daemon", "run", "--home", paseoHome], { env, stdio: ["ignore", log.fd, log.fd] });
  let exited = null;
  const gone = new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      exited = code ?? signal;
      resolve();
    });
    child.on("error", (error) => {
      exited = error.message;
      resolve();
    });
  });

  const paseo = async (...args) => (await run(paseoBin, ["--host", host, ...args], { env, maxBuffer: 16 * 1024 * 1024 })).stdout;
  const daemonLog = async () => (await readFile(join(work, "daemon.log"), "utf8")).split("\n").slice(-30).join("\n");
  const plugins = async () => JSON.parse(await paseo("plugin", "ls", "--json"));
  const stop = async () => {
    await run(paseoBin, ["daemon", "stop", "--home", paseoHome], { env }).catch(() => undefined);
    if (exited === null) child.kill("SIGTERM");
    const killed = setTimeout(() => child.kill("SIGKILL"), 10_000);
    await gone;
    clearTimeout(killed);
    await log.close().catch(() => undefined);
  };

  try {
    for (let waited = 0; ; waited += 1000) {
      if (exited !== null) throw new Error(`the daemon exited with ${exited}:\n${await daemonLog()}`);
      if (await plugins().then(() => true, () => false)) break;
      if (waited > 120_000) throw new Error(`the daemon did not answer within 2 minutes:\n${await daemonLog()}`);
      await sleep(1000);
    }
    await paseo("plugin", "install", pluginDir);
    let plugin;
    for (let waited = 0; ; waited += 1000) {
      plugin = (await plugins()).find((entry) => entry.id === "claude-update");
      if (plugin?.status === "running") break;
      if (plugin?.status === "error") throw new Error(`the plugin failed to start: ${plugin.error}\n${await daemonLog()}`);
      if (waited > 60_000) throw new Error(`the plugin did not start: ${JSON.stringify(plugin)}\n${await daemonLog()}`);
      await sleep(1000);
    }
  } catch (error) {
    await stop();
    throw error;
  }

  /** Calls one of the plugin's RPCs through the client library of the same Paseo version. */
  const rpc = async (method, input = {}) => {
    const require = createRequire(join(prefix, "package.json"));
    let clientPath;
    try {
      clientPath = require.resolve("@getpaseo/client/internal/daemon-client", { paths: [join(prefix, "node_modules", "@getpaseo", "cli")] });
    } catch {
      clientPath = require.resolve("@getpaseo/client/internal/daemon-client");
    }
    const { DaemonClient } = await import(pathToFileURL(clientPath).href);
    const client = new DaemonClient({ url: `ws://${host}/ws`, clientId: "claude-update-check", webSocketFactory: (url) => new WebSocket(url) });
    await client.connect();
    try {
      return await client.invokePluginRpc("claude-update", method, input);
    } finally {
      await client.close();
    }
  };

  return { host, port, home, stubDir, paseo, plugins, rpc, stop, daemonLog };
}

export async function removeQuietly(path) {
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}
