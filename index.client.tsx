import type { PluginClientContext } from "@getpaseo/plugin/client";

import { onStatus, publishStatus } from "./client/bus";
import { UpdateSettingsScreen } from "./client/settings";
import { createSidebarRow } from "./client/sidebar";
import { StatusSurface } from "./client/status";
import { QUIET_ROW, sidebarRow } from "./shared/format";
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

  // The sidebar row is always there, as the way in to the status page: it
  // is added before the first status read, so it is there with the host away
  // too. It reads as the news while a status has some, and goes back to its
  // plain title when the news is dismissed or resolved.
  let disposed = false;
  const row = createSidebarRow(({ title, icon }) => client.addSidebarItem({ id: "status", title, icon, surface: SURFACE_ID }));
  row.show(QUIET_ROW);
  const unsubscribe = onStatus((status) => {
    if (!disposed) row.show(sidebarRow(status) ?? QUIET_ROW);
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
