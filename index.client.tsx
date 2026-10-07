import type { PluginClientContext } from "@getpaseo/plugin/client";

import { UpdateSettingsScreen } from "./client/settings";
import { createSidebarRow } from "./client/sidebar";
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
  let disposed = false;
  const sidebarRow = createSidebarRow(
    ({ title, icon }) => client.addSidebarItem({ id: "status", title, icon, surface: SURFACE_ID }),
    { title: sidebarTitle(null), icon: sidebarIcon(null) },
  );
  function showSidebarItem(status: Status | null): void {
    sidebarRow.show({ title: sidebarTitle(status), icon: sidebarIcon(status) });
  }

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
    sidebarRow.dispose();
    clearInterval(timer);
  };
}
