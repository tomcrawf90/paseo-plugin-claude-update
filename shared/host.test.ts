import { afterEach, describe, expect, it, vi } from "vitest";

import { missingHostApis, requireHostApis } from "./host";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("missingHostApis", () => {
  it("lists the names that are absent or not functions, in the order asked", () => {
    const host = { handle: () => undefined, registerSettings: "not a function" };
    expect(missingHostApis(host, ["registerSettings", "handle", "addScreen"])).toEqual(["registerSettings", "addScreen"]);
  });
  it("finds nothing missing on a host that has them all", () => {
    expect(missingHostApis({ handle() {}, registerSettings() {} }, ["handle", "registerSettings"])).toEqual([]);
  });
});

describe("requireHostApis", () => {
  it("passes quietly when everything is there", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => requireHostApis({ handle() {} }, ["handle"], "daemon")).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });
  it("names every missing function and the runtime, logs it and throws it", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => requireHostApis({}, ["registerSettings", "handle"], "daemon")).toThrow(
      "Claude Code updates cannot start: this Paseo daemon has no registerSettings, handle. Paseo has changed a plugin API the plugin uses; update the plugin, or report it at https://github.com/tomcrawf90/paseo-plugin-claude-update/issues.",
    );
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^\[claude-update\] .*this Paseo daemon has no registerSettings, handle\./));
  });
  it("names a function on something the host returned, and takes nothing returned as missing everything", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => requireHostApis(undefined, ["read"], "daemon", "registerSettings().")).toThrow("this Paseo daemon has no registerSettings().read.");
    expect(() => requireHostApis({ read() {} }, ["read"], "daemon", "registerSettings().")).not.toThrow();
  });
});
