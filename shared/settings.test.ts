import { describe, expect, it } from "vitest";

import { autoUpdateOn, DEFAULT_SETTINGS, updateSettings, withAutoUpdate } from "./settings";

/** The values of a settings file written by 0.1.0, when the switch was a choice of two. */
const STORED_NOTIFY = {
  enabled: true,
  mode: "notify",
  channel: "latest",
  intervalHours: 4,
  pinnedVersion: "",
  claudePath: "",
  desktopNotifications: true,
};

describe("the auto-update switch", () => {
  it("is off on a fresh install", () => {
    expect(autoUpdateOn(DEFAULT_SETTINGS)).toBe(false);
  });

  it("reads a 0.1.0 settings file as the choice it held, with nothing else changed", () => {
    expect(updateSettings.version).toBe(1);
    expect(updateSettings.migrate).toBeUndefined();
    const notify = updateSettings.schema.parse(STORED_NOTIFY);
    // Only the sidebar switch is added, at its default.
    expect(notify).toEqual({ ...STORED_NOTIFY, showInSidebar: true });
    expect(autoUpdateOn(notify)).toBe(false);
    const auto = updateSettings.schema.parse({ ...STORED_NOTIFY, mode: "auto" });
    expect(auto).toEqual({ ...STORED_NOTIFY, mode: "auto", showInSidebar: true });
    expect(autoUpdateOn(auto)).toBe(true);
  });

  it("moves only the one value when flipped", () => {
    const settings = { ...DEFAULT_SETTINGS, intervalHours: 12, pinnedVersion: "2.1.285" };
    expect(withAutoUpdate(settings, true)).toEqual({ ...settings, mode: "auto" });
    expect(withAutoUpdate(withAutoUpdate(settings, true), false)).toEqual(settings);
  });
});

describe("the sidebar switch", () => {
  it("is on on a fresh install", () => {
    expect(DEFAULT_SETTINGS.showInSidebar).toBe(true);
  });

  it("is on for a settings file written before it existed, and keeps a choice once made", () => {
    expect(updateSettings.schema.parse(STORED_NOTIFY).showInSidebar).toBe(true);
    expect(updateSettings.schema.parse({ ...STORED_NOTIFY, showInSidebar: false }).showInSidebar).toBe(false);
  });
});
