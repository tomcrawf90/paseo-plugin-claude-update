// Takes the listing screenshots in images/ from Paseo's own web app, served by
// a throwaway daemon (scripts/daemon.mjs) with made-up data: the stand-in
// Claude CLI, a made-up process list and the host name "Demo Mac". Before each
// picture is saved, the page text is checked for this machine's name, the
// user name and local paths, and the script stops if one is there.
//
//   npm run screenshots                   # Paseo 0.12.0, Chrome from /Applications
//   CHROME_PATH=/path/to/chrome npm run screenshots -- --paseo 0.12.0
//
// The release notes on the status page are read live from Anthropic's
// changelog, so their text changes from run to run. Never run in CI.
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp } from "node:fs/promises";
import { hostname, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";
import puppeteer from "puppeteer-core";
import { copyPlugin, installPaseo, patchHostName, removeQuietly, repoRoot, startDaemon } from "./daemon.mjs";

const { values } = parseArgs({ options: { paseo: { type: "string", default: "0.12.0" }, keep: { type: "boolean", default: false } } });
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEMO_HOST = "Demo Mac";
const WIDTH = 1440;
const HEIGHT = 900;
const SCALE = 2;

const output = async (file, args) => (await promisify(execFile)(file, args).catch(() => ({ stdout: "" }))).stdout.trim() || null;
const macName = (kind) => (process.platform === "darwin" ? output("/usr/sbin/scutil", ["--get", kind]) : null);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Whole words, so that a short user name does not match inside "custom".
const forbidden = [
  hostname(),
  hostname().split(".")[0],
  await macName("ComputerName"),
  await macName("LocalHostName"),
  userInfo().username,
  await output("git", ["config", "user.name"]),
  await output("git", ["config", "user.email"]),
  "/Users/",
  "/home/",
  "/tmp/",
  "/private/",
  tmpdir(),
]
  // A generic short name such as "Mac" is part of the dummy one and says nothing.
  .filter((text) => text && text.length > 2 && !DEMO_HOST.includes(text))
  .map((text) => ({ text, pattern: new RegExp(/^\w/.test(text) ? `\\b${escape(text)}\\b` : escape(text), "i") }));

const work = await mkdtemp(join(tmpdir(), "claude-update-shots-"));
const prefix = join(work, "paseo");
const out = join(repoRoot, "images");
let daemon;
let browser;
try {
  // The plugin compares against the live release pointer, so the stand-in CLI
  // starts three versions behind it and updates to it: the pictures agree
  // with each other whatever the pointer says on the day.
  const latest = (await (await fetch("https://downloads.claude.ai/claude-code-releases/latest")).text()).trim();
  const [major, minor, patch] = latest.split(".").map(Number);
  if (![major, minor, patch].every(Number.isInteger) || patch < 3) throw new Error(`unexpected release pointer: ${latest}`);
  const installed = `${major}.${minor}.${patch - 3}`;
  const version = await installPaseo(values.paseo, prefix);
  await patchHostName(prefix, DEMO_HOST);
  await copyPlugin(join(work, "plugin"));
  daemon = await startDaemon({ prefix, work, pluginDir: join(work, "plugin"), claude: { version: installed, latest }, fakeProcesses: true, webUi: true });
  console.log(`Paseo ${version} at http://${daemon.host}/`);
  await daemon.rpc("status.check", { apply: false });

  browser = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: join(work, "chrome"), args: ["--no-first-run", "--no-default-browser-check"] });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.emulateTimezone("UTC");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const click = async (pattern, selector = '[role="button"], button, [role="menuitem"], a') => {
    for (const handle of await page.$$(selector)) {
      const label = await handle.evaluate((element) => (element.getAttribute("aria-label") || element.textContent || "").trim());
      if (pattern.test(label)) return handle.click();
    }
    throw new Error(`nothing to click matches ${pattern}`);
  };
  const waitForText = (text) => page.waitForFunction((wanted) => document.body.innerText.includes(wanted), { timeout: 60_000 }, text);
  // Only what is on screen counts: the page text below the fold never reaches the picture.
  const visibleText = () =>
    page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const parts = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const box = node.parentElement?.getBoundingClientRect();
        if (box && box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth) parts.push(node.textContent);
      }
      // Form fields hold their text outside the text nodes.
      for (const field of document.querySelectorAll("input, textarea")) {
        const box = field.getBoundingClientRect();
        if (box.bottom > 0 && box.top < window.innerHeight) parts.push(field.value, field.placeholder);
      }
      return parts.join("\n");
    });
  const shoot = async (name) => {
    const text = await visibleText();
    const leak = forbidden.find(({ pattern }) => pattern.test(text));
    if (leak !== undefined) throw new Error(`${name}: the page shows "${leak.text}"; not saved`);
    await page.screenshot({ path: join(work, name) });
    console.log(`took ${name}`);
  };

  await page.goto(`http://${daemon.host}/`, { waitUntil: "networkidle2" });
  await waitForText("Claude update ready");
  await click(/^Claude update ready$/);
  await waitForText("Release notes");
  await sleep(1500);
  await shoot("01-status-update-ready.png");

  await click(/^Install a Claude Code update now/);
  await waitForText(`${installed} → ${latest}`);
  // Paseo's bar above the page keeps the title the row had when the page was
  // opened, so open it again from the row, which now reads as usual.
  await click(/^Claude Code updates$/);
  await waitForText("Release notes");
  // Scroll until the History card starts at the bottom edge: the release
  // notes, the rollback command and the old processes are in view, and the
  // log path (a temporary directory) below them is not.
  const historyTop = () =>
    page.evaluate(() => {
      // The page's History card, not the sidebar's History link above it.
      const tops = [...document.querySelectorAll("div, span")]
        .filter((element) => element.childElementCount === 0 && element.textContent?.trim() === "History")
        .map((element) => element.getBoundingClientRect().top);
      return tops.length > 1 ? Math.max(...tops) : null;
    });
  await page.mouse.move(WIDTH * 0.6, HEIGHT * 0.6);
  for (let top = await historyTop(), turns = 0; top !== null && top > HEIGHT && turns < 50; top = await historyTop(), turns += 1) {
    await page.mouse.wheel({ deltaY: Math.min(400, top - HEIGHT + 4) });
    await sleep(150);
  }
  const top = await historyTop();
  if (top === null || top > HEIGHT) throw new Error(`could not scroll the History card to the bottom edge (${top})`);
  await sleep(1500);
  await shoot("02-status-after-update.png");

  await click(/^Settings$/);
  await sleep(1000);
  await click(/^Plugins$/);
  await sleep(1000);
  await click(/^Actions for claude-update$/);
  await sleep(500);
  await click(/^Claude Code updates$/, '[role="menuitem"]');
  await waitForText("Check on a schedule");
  await sleep(1500);
  await shoot("03-settings.png");

  await mkdir(out, { recursive: true });
  for (const name of ["01-status-update-ready.png", "02-status-after-update.png", "03-settings.png"]) await copyFile(join(work, name), join(out, name));
  console.log(`saved to ${out}`);
} finally {
  await browser?.close().catch(() => undefined);
  await daemon?.stop().catch(() => undefined);
  if (values.keep) console.log(`kept ${work}`);
  else await removeQuietly(work);
}
