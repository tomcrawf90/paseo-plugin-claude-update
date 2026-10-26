import type { PluginClientContext } from "@getpaseo/plugin/client";

import { onStatus, publishedCount, publishStatus } from "./client/bus";
import { UpdateSettingsScreen } from "./client/settings";
import { createSidebarRow } from "./client/sidebar";
import { StatusSurface } from "./client/status";
import { QUIET_ROW, sidebarRow } from "./shared/format";
import { requireHostApis } from "./shared/host";
import { checkNow, getStatus } from "./shared/status";

const SURFACE_ID = "status";
const SIDEBAR_REFRESH_MS = 60_000;

export default function contribute(client: PluginClientContext) {
  requireHostApis(client, ["addSurface", "addSettingsScreen", "addSidebarItem", "addCommandCenterItem", "rpc"], "app");
  client.addSurface(SURFACE_ID, StatusSurface);
  client.addSettingsScreen({
    id: "settings",
    title: "Claude Code updates",
    icon: "RefreshCw",
    Component: UpdateSettingsScreen,
  });

  // The sidebar row is the way in to the status page: it is added before the
  // first status read, so it is there with the host away too. It reads as the
  // news while a status has some, and goes back to its plain title when the
  // news is dismissed or resolved. With "Show in the sidebar" off it goes at
  // the first status read and comes back at the first one with it on; the
  // screens read the status again as soon as the switch is saved.
  let disposed = false;
  const row = createSidebarRow(({ title, icon }) => client.addSidebarItem({ id: "status", title, icon, surface: SURFACE_ID }));
  row.show(QUIET_ROW);
  const unsubscribe = onStatus((status) => {
    if (!disposed) row.show(status.showInSidebar ? (sidebarRow(status) ?? QUIET_ROW) : null);
  });

  async function refresh(): Promise<void> {
    try {
      const before = publishedCount();
      const status = await client.rpc(getStatus, {});
      // A screen or the Command Center published a status while this read was
      // out, perhaps one read after a switch was saved: this one may be older.
      if (publishedCount() === before) publishStatus(status);
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
      try {
        publishStatus(await rpc(checkNow, { apply: false }));
      } catch (error) {
        // A Command Center item has no toast; the page is open and shows
        // what the host reports, and the reason goes to the app's log.
        console.warn("[claude-update] the check could not be run:", error);
      }
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
