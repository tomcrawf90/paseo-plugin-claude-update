import { describe, expect, it, vi } from "vitest";

import type { PluginServerContext } from "@getpaseo/plugin/server";

const { default: contribute } = await import("../index.server");

// What the entry checks for (index.server.ts). The check comes first, so a
// host without one of these never starts the service or reads a file.
const HOST_APIS = ["registerSettings", "handle"];

describe("the plugin in the daemon", () => {
  it.each(HOST_APIS)("stops at start, naming it, on a daemon without %s", (name) => {
    const host: Record<string, unknown> = { registerSettings: vi.fn(), handle: vi.fn() };
    delete host[name];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => contribute(host as unknown as PluginServerContext)).toThrow(`this Paseo daemon has no ${name}.`);
    } finally {
      error.mockRestore();
    }
    for (const present of Object.values(host)) expect(present).not.toHaveBeenCalled();
  });

  it("stops at start when the settings it registers cannot be read, as on Paseo 0.8", () => {
    const host = { registerSettings: vi.fn(() => undefined), handle: vi.fn() };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => contribute(host as unknown as PluginServerContext)).toThrow("this Paseo daemon has no registerSettings().read.");
    } finally {
      error.mockRestore();
    }
    expect(host.handle).not.toHaveBeenCalled();
  });
});
