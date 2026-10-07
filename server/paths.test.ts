import { describe, expect, it } from "vitest";

import { dataDirectory, findClaude } from "./paths";

const find = (configured: string, present: string[], path = "/usr/local/bin:/opt/bin") =>
  findClaude({ configured, home: "/home/u", env: { PATH: path }, isExecutable: async (candidate) => present.includes(candidate) });

describe("findClaude", () => {
  it("prefers the native installer's launcher over PATH", async () => {
    expect(await find("", ["/home/u/.local/bin/claude", "/opt/bin/claude"])).toBe("/home/u/.local/bin/claude");
  });
  it("falls back to PATH in order", async () => {
    expect(await find("", ["/opt/bin/claude"])).toBe("/opt/bin/claude");
    expect(await find("", ["/usr/local/bin/claude", "/opt/bin/claude"])).toBe("/usr/local/bin/claude");
  });
  it("uses a configured path and nothing else", async () => {
    expect(await find(" /custom/claude ", ["/custom/claude"])).toBe("/custom/claude");
    expect(await find("/missing/claude", ["/home/u/.local/bin/claude"])).toBeNull();
  });
  it("is null when there is none", async () => {
    expect(await find("", [], "")).toBeNull();
  });
});

describe("dataDirectory", () => {
  it("is under PASEO_HOME's plugin-data", () => {
    expect(dataDirectory({ PASEO_HOME: "/srv/paseo" })).toBe("/srv/paseo/plugin-data/claude-update");
  });
});
