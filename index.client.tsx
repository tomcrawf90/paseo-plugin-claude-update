import type { PluginClientContext } from "@getpaseo/plugin/client";

import { onStatus, publishStatus } from "./client/bus";
import { UpdateSettingsScreen } from "./client/settings";
import { createSidebarRow } from "./client/sidebar";
import { StatusSurface } from "./client/status";
import { sidebarRow } from "./shared/format";
import { checkNow, getStatus } from "./shared/status";

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

  // No sidebar row while there is nothing to act on: it is added when a
  // status has news and taken away when the news is dismissed or resolved.
  // The status page stays reachable from the Command Center items below.
  let disposed = false;
  const row = createSidebarRow(({ title, icon }) => client.addSidebarItem({ id: "status", title, icon, surface: SURFACE_ID }));
  const unsubscribe = onStatus((status) => {
    if (!disposed) row.show(sidebarRow(status));
  });

  async function refresh(): Promise<void> {
    try {
      publishStatus(await client.rpc(getStatus, {}));
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
      // The page that opens shows the check running and then its result.
      openSurface(SURFACE_ID);
      publishStatus(await rpc(checkNow, { apply: false }));
    },
  });
  client.addCommandCenterItem({
    id: "open-settings",
    title: "Claude Code updates: settings",
    icon: "Settings",
    context: "global",
    keywords: ["claude", "update", "auto", "pin", "channel"],
    onSelect({ openSettings }) {
      openSettings("settings");
    },
  });

  return () => {
    disposed = true;
    unsubscribe();
    row.dispose();
    clearInterval(timer);
  };
}
