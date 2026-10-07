import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";

import type { PluginServerContext } from "@getpaseo/plugin/server";

import { createNotifier } from "./server/notify";
import { dataDirectory } from "./server/paths";
import { listClaudeProcesses, staleProcesses } from "./server/processes";
import { runCommand } from "./server/run";
import { startService } from "./server/service";
import { createFileStore } from "./server/store";
import type { UpdaterDependencies } from "./server/updater";
import { updateSettings } from "./shared/settings";
import { checkNow, dismissAttention, getStatus } from "./shared/status";

const FETCH_TIMEOUT_MS = 20_000;

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(updateSettings);
  const deps: UpdaterDependencies = {
    run: runCommand,
    fetchText,
    now: () => new Date(),
    readFile: readTextFile,
    isExecutable,
    env: process.env,
    home: homedir(),
    store: createFileStore(dataDirectory()),
    notify: createNotifier(runCommand, process.platform),
    async countStale(installed) {
      const listed = await listClaudeProcesses(runCommand, process.platform);
      return listed.supported ? staleProcesses(listed.processes, installed).length : null;
    },
  };

  const service = startService(deps, async () => {
    const current = await settings.read();
    if (current.status === "ready") return current.values;
    console.error(`[claude-update] settings are invalid, so nothing is checked: ${current.error}`);
    return null;
  });

  server.handle(getStatus, (_input, { paseo }) => service.status(paseo));
  server.handle(checkNow, async ({ apply }, { paseo }) => {
    await service.check("manual", apply);
    return service.status(paseo);
  });
  server.handle(dismissAttention, async (_input, { paseo }) => {
    await service.dismiss();
    return service.status(paseo);
  });

  console.log(`[claude-update] started; state and logs are in ${deps.store.directory}`);
  return () => service.stop();
}
