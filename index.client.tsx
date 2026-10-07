import type { PluginClientContext } from "@getpaseo/plugin/client";

import { UpdateSettingsScreen } from "./client/settings";
import { StatusSurface } from "./client/status";
import { sidebarIcon, sidebarTitle } from "./shared/format";
import { checkNow, getStatus, type Status } from "./shared/status";

const SURFACE_ID = "status";
const SIDEBAR_REFRESH_MS = 60_000;

export default function contribute(client: PluginClientContext) {
  client.addSurface(SURFACE_ID, StatusSurface);
  client.addSettingsScreen({
    id: "settings",
    title: "Claude Code updates",
    icon: "RefreshCw",
    Component: UpdateSettingsScreen,
  });

  // The sidebar row is the one piece of the plugin that is always on screen,
  // so its title and icon carry the news: an update, a failure, a notice.
  let removeSidebarItem: (() => void | Promise<void>) | null = null;
  let shown = "";
  let swap: Promise<void> = Promise.resolve();
  function showSidebarItem(status: Status | null): void {
    const title = sidebarTitle(status);
    const icon = sidebarIcon(status);
    if (`${title}|${icon}` === shown) return;
    shown = `${title}|${icon}`;
    const add = () => {
      removeSidebarItem = client.addSidebarItem({ id: "status", title, icon, surface: SURFACE_ID });
    };
    // The first row is added while the entry runs. A later change waits for
    // the old row to be gone before adding the new one under the same id.
    if (removeSidebarItem === null) {
      add();
      return;
    }
    const remove = removeSidebarItem;
    swap = swap
      .then(async () => {
        await remove();
        if (!disposed) add();
      })
      .catch(() => undefined);
  }
  let disposed = false;
  showSidebarItem(null);

  async function refresh(): Promise<void> {
    try {
      const status = await client.rpc(getStatus, {});
      if (!disposed) showSidebarItem(status);
    } catch {
      // The host is away or the plugin is restarting; the next round tries again.
    }
  }
  void refresh();
  const timer = setInterval(() => void refresh(), SIDEBAR_REFRESH_MS);

  client.addCommandCenterItem({
    id: "open-status",
    title: "Claude Code updates: open status",
    icon: "RefreshCw",
    context: "global",
    keywords: ["claude", "update", "upgrade", "version"],
    onSelect({ openSurface }) {
      openSurface(SURFACE_ID);
    },
  });
  client.addCommandCenterItem({
    id: "check-now",
    title: "Claude Code updates: check now",
    icon: "RefreshCw",
    context: "global",
    keywords: ["claude", "update", "upgrade", "version"],
    async onSelect({ rpc, openSurface }) {
      openSurface(SURFACE_ID);
      showSidebarItem(await rpc(checkNow, { apply: false }));
    },
  });
  client.addCommandCenterItem({
    id: "open-settings",
    title: "Claude Code updates: settings",
    icon: "Settings",
    context: "global",
    keywords: ["claude", "update", "pin", "channel"],
    onSelect({ openSettings }) {
      openSettings("settings");
    },
  });

  return () => {
    disposed = true;
    clearInterval(timer);
  };
}
