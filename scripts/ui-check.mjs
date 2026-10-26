// Walks the plugin's screens in Paseo's own web app, served by a throwaway
// daemon of the chosen version (scripts/daemon.mjs), and reports each step as
// a table row. What the compatibility check (scripts/compat.mjs) cannot see:
//
//   schedule      the first scheduled check installs with auto-update on, and raises its notification
//   sidebar row   the row is there, opens the status page, and keeps its plain title after an update
//   status page   the auto-update switch saves; "Check now" looks and installs nothing; the row names the update
//   sidebar off   "Show in the sidebar" off takes the row away, also after a reload
//   command       the three Command Center items, from a host page; "check now" and "settings" run
//   settings      the settings screen's "Checks" section and its "Check now"; its sidebar switch brings the row back
//   daemon log    nothing from the plugin on stderr, and no warning or error about it
//
//   npm run check:ui -- --paseo 0.13.1            # macOS, Chrome; CHROME_PATH to use another
//
// The stand-in CLI starts three versions behind Claude Code's release pointer
// and "updates" to one behind it, so a look afterwards still finds an update.
// Notifications go to a file (test/stub/notify), never to the screen. Network:
// npm, the release pointer and the changelog. Never run in CI.
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import puppeteer from "puppeteer-core";
import { copyPlugin, installPaseo, removeQuietly, startDaemon } from "./daemon.mjs";

const { values } = parseArgs({ options: { paseo: { type: "string" }, keep: { type: "boolean", default: false } } });
if (values.paseo === undefined) throw new Error("usage: npm run check:ui -- --paseo <version>");
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ROW = "Claude Code updates";
const READY = "Claude update ready";
// Every title the row can have (shared/format.ts): with the switch off, none may be there.
const TITLES = [ROW, READY, "Claude update failed", "Claude pin mismatch", "Claude channel issue"];

const work = await mkdtemp(join(tmpdir(), `claude-update-ui-${values.paseo}-`));
const prefix = join(work, "paseo");
const results = [];
let daemon;
let browser;
let page;

async function step(name, body) {
  try {
    const detail = await body();
    results.push({ name, ok: true, detail: detail ?? "" });
    console.log(`ok    ${name}${detail ? `: ${detail}` : ""}`);
  } catch (error) {
    results.push({ name, ok: false, detail: String(error.message).split("\n")[0] });
    console.log(`FAIL  ${name}: ${error.message}`);
    if (values.keep && page) await page.screenshot({ path: join(work, `fail-${results.length}.png`) }).catch(() => undefined);
  }
}

async function until(what, test, timeoutMs = 30_000) {
  for (let waited = 0; ; waited += 500) {
    // A file half written while it is read counts as not yet.
    const value = await Promise.resolve().then(test).catch(() => null);
    if (value) return value;
    if (waited > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(500);
  }
}

const labels = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="button"], button, [role="menuitem"], [role="switch"], a')].map((element) =>
      (element.getAttribute("aria-label") || element.textContent || "").trim(),
    ),
  );
const hasRow = async (title) => (await labels()).includes(title);
const rowTitles = async () => (await labels()).filter((label) => TITLES.includes(label));
/**
 * Presses the one control on screen whose label matches. A screen left behind
 * stays mounted out of sight, so a control counts only when, scrolled into
 * view, it is the element found at its own centre; two such matches fail.
 */
async function click(pattern) {
  const seen = [];
  for (const handle of await page.$$('[role="button"], button, [role="menuitem"], [role="switch"], a')) {
    const label = await handle.evaluate((element) => (element.getAttribute("aria-label") || element.textContent || "").trim());
    if (!pattern.test(label)) continue;
    const onTop = await handle.evaluate((element) => {
      element.scrollIntoView({ block: "center" });
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return false;
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit !== null && (element === hit || element.contains(hit));
    });
    if (onTop) seen.push(handle);
  }
  if (seen.length === 0) throw new Error(`nothing on screen to click matches ${pattern}`);
  if (seen.length > 1) throw new Error(`${seen.length} controls on screen match ${pattern}`);
  await seen[0].click();
}
const text = () => page.evaluate(() => document.body.innerText);
const waitForText = (wanted, timeoutMs) => until(`"${wanted}"`, async () => (await text()).includes(wanted), timeoutMs);
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const calls = async () => (await readFile(join(daemon.stubDir, "calls"), "utf8").catch(() => "")).split("\n").filter(Boolean);
const installs = async () => (await calls()).filter((call) => /^(update|install)\b/.test(call));

async function commandCenter(query) {
  await page.keyboard.down(process.platform === "darwin" ? "Meta" : "Control");
  await page.keyboard.press("k");
  await page.keyboard.up(process.platform === "darwin" ? "Meta" : "Control");
  await sleep(800);
  await page.keyboard.type(query);
  await sleep(800);
}

try {
  const pointer = (await (await fetch("https://downloads.claude.ai/claude-code-releases/latest", { signal: AbortSignal.timeout(20_000) })).text()).trim();
  const [major, minor, patch] = pointer.split(".").map(Number);
  if (![major, minor, patch].every(Number.isInteger) || patch < 3) throw new Error(`unexpected release pointer: ${pointer}`);
  const claude = { version: `${major}.${minor}.${patch - 3}`, latest: `${major}.${minor}.${patch - 1}` };
  const version = await installPaseo(values.paseo, prefix);
  if (version !== values.paseo) throw new Error(`npm installed @getpaseo/cli ${version}, not ${values.paseo}`);
  // The range is left as it is: the daemon refusing it is a result too.
  await copyPlugin(join(work, "plugin"));
  daemon = await startDaemon({ prefix, work, pluginDir: join(work, "plugin"), claude, fakeProcesses: true, recordNotifications: true, settings: { mode: "auto" }, webUi: true });
  const pluginData = join(daemon.home, ".paseo", "plugin-data", "claude-update");
  const settingsFile = join(daemon.home, ".paseo", "plugin-settings", "claude-update", "update.json");
  const settings = async () => (await readJson(settingsFile)).values;
  console.log(`Paseo ${version} at http://${daemon.host}/ (Claude Code pointer ${pointer})`);

  await step("schedule: the first scheduled check installs", async () => {
    const state = await until("the scheduled check", () => readJson(join(pluginData, "state.json")).catch(() => null), 90_000);
    if (state.lastOutcome !== "updated") throw new Error(`last outcome ${state.lastOutcome}: ${state.lastMessage}`);
    const ran = await installs();
    if (ran.join() !== "update") throw new Error(`the CLI was asked: ${ran.join(", ")}`);
    return `${state.previousVersion} → ${state.installedVersion} by "claude update"`;
  });
  await step("schedule: its notification is raised", async () => {
    // The state is written before the notification is raised.
    const read = () => readFile(join(daemon.stubDir, "notifications"), "utf8").catch(() => "");
    const notifications = await until("the notification", async () => /display notification "Updated Claude Code/.test(await read()) && read(), 15_000).catch(async () => {
      throw new Error(`notifications: ${JSON.stringify(await read())}`);
    });
    return notifications.match(/with title "([^"]+)"/)?.[1] ?? "";
  });

  browser = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: join(work, "chrome"), args: ["--no-first-run", "--no-default-browser-check"] });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`http://${daemon.host}/`, { waitUntil: "networkidle2" });

  await step("sidebar row: there, and opens the status page", async () => {
    await until(`the "${ROW}" row`, () => hasRow(ROW), 60_000);
    await click(new RegExp(`^${ROW}$`));
    await waitForText("Next scheduled check");
    await waitForText("Updated");
    return new URL(page.url()).pathname.replace(/\/h\/[^/]+/, "/h/<host>");
  });
  await step("sidebar row: keeps its plain title after an update", async () => {
    // The row is added with this title before the first status read; the page
    // above has read the status, and the row's own read follows within moments.
    await sleep(5000);
    const titles = await rowTitles();
    if (titles.join() !== ROW) throw new Error(`the row reads ${titles.join(", ") || "nothing"}`);
  });
  await step("status page: the auto-update switch saves", async () => {
    await click(/^Auto-update Claude Code$/);
    await until("mode notify in the settings file", async () => (await settings()).mode === "notify");
    await waitForText("Off: you are only told");
  });
  await step("status page: Check now looks, installs nothing, and the row names the update", async () => {
    const before = (await installs()).length;
    await click(/^Check for a Claude Code update now/);
    await waitForText(`Claude Code ${pointer} is available (${claude.latest} is installed)`);
    await until(`the "${READY}" row`, () => hasRow(READY));
    if ((await installs()).length !== before) throw new Error("Check now ran the installer");
    return `${pointer} available, ${claude.latest} installed`;
  });
  await step("sidebar off: the switch takes the row away", async () => {
    await click(/^Show in the sidebar$/);
    await until("showInSidebar false in the settings file", async () => (await settings()).showInSidebar === false);
    await until("the row to go", async () => (await rowTitles()).length === 0);
  });
  await step("sidebar off: the row stays away after a reload", async () => {
    await page.reload({ waitUntil: "networkidle2" });
    await waitForText("Next scheduled check", 60_000);
    // The row is added before the first status read and taken away by it.
    await until("the row to go after the first status read", async () => (await rowTitles()).length === 0, 30_000);
    await sleep(5000);
    if ((await rowTitles()).length > 0) throw new Error(`the row came back: ${(await rowTitles()).join(", ")}`);
  });
  await step("command center: the three items, from the status page", async () => {
    await commandCenter("claude code updates");
    const shown = (await labels()).filter((label) => label.startsWith(`${ROW}:`));
    const wanted = [`${ROW}: open status`, `${ROW}: check now`, `${ROW}: settings`];
    const missing = wanted.filter((label) => !shown.includes(label));
    if (missing.length > 0) throw new Error(`missing ${missing.join(", ")}; shown: ${shown.join(", ") || "none"}`);
    return shown.length === 3 ? "open status, check now, settings" : shown.join(", ");
  });
  await step("command center: check now runs a look", async () => {
    const before = (await readJson(join(pluginData, "state.json"))).lastCheckAt;
    const installed = (await installs()).length;
    await click(new RegExp(`^${ROW}: check now$`));
    await until("a newer last check", async () => (await readJson(join(pluginData, "state.json"))).lastCheckAt !== before);
    if ((await installs()).length !== installed) throw new Error("the look ran the installer");
  });
  await step("command center: settings opens the settings screen", async () => {
    await commandCenter("claude code updates");
    await click(new RegExp(`^${ROW}: settings$`));
    await waitForText("Check on a schedule");
    await waitForText("Last checked");
  });
  await step("settings screen: Check now", async () => {
    const before = (await readJson(join(pluginData, "state.json"))).lastCheckAt;
    await click(/^Check now$/);
    await until("a newer last check", async () => (await readJson(join(pluginData, "state.json"))).lastCheckAt !== before);
    // "Finished:" with its colon is the settings screen's line; the status page says "Finished 2 min ago".
    await waitForText("Finished:");
  });
  await step("settings screen: the sidebar switch brings the row back", async () => {
    await click(/^Show in the sidebar$/);
    await until("showInSidebar true in the settings file", async () => (await settings()).showInSidebar === true);
    // Settings has its own navigation in place of the app sidebar: go back to the app.
    await page.goto(`http://${daemon.host}/`, { waitUntil: "networkidle2" });
    await until(`the "${READY}" row`, () => hasRow(READY), 60_000);
  });
  await step("no install apart from the scheduled one", async () => {
    const ran = await installs();
    if (ran.join() !== "update") throw new Error(`the CLI was asked: ${ran.join(", ")}`);
  });
  await step("daemon log: nothing from the plugin on stderr, no warning or error", async () => {
    // Paseo logs what a plugin writes, stderr included, as "Plugin output" at
    // level 30, with the stream named; its own complaints about a plugin are 40 and up.
    const lines = (await readFile(join(work, "daemon.log"), "utf8")).split("\n").filter((line) => line.includes('"pluginId":"claude-update"'));
    if (!lines.some((line) => line.includes("[claude-update] started"))) throw new Error("no line from the plugin in the daemon log: has its format changed?");
    const bad = lines.filter((line) => line.includes('"stream":"stderr"') || /"level":(4\d|5\d|6\d)/.test(line));
    if (bad.length > 0) throw new Error(`${bad.length} lines, the first: ${bad[0].slice(0, 300)}`);
    return `${lines.length} lines from the plugin, none on stderr`;
  });

  console.log(`\nPaseo ${version}\n\n| Step | Result | Detail |\n| --- | --- | --- |`);
  for (const result of results) console.log(`| ${result.name} | ${result.ok ? "ok" : "FAIL"} | ${result.detail.replaceAll("|", "\\|")} |`);
  if (results.some((result) => !result.ok)) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  await daemon?.stop().catch(() => undefined);
  if (values.keep) console.log(`kept ${work}`);
  else await removeQuietly(work);
}
