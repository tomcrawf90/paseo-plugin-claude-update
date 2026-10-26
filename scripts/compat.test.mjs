import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { minimumVersion, newestVersion, paseoAdmits, verdict } from "./compat.mjs";

describe("paseoAdmits", () => {
  const range = ">=0.9.0";
  it("admits a release above the minimum, the next minors and majors included", () => {
    expect(paseoAdmits("0.13.1", range)).toBe(true);
    expect(paseoAdmits("0.14.0", range)).toBe(true);
    expect(paseoAdmits("1.0.0", range)).toBe(true);
  });
  it("admits a beta through its major.minor.patch, as Paseo does", () => {
    expect(paseoAdmits("0.14.0-beta.1", range)).toBe(true);
    expect(paseoAdmits("0.9.0-beta.1", range)).toBe(true);
  });
  it("refuses a version below the minimum, and nonsense", () => {
    expect(paseoAdmits("0.8.4", range)).toBe(false);
    expect(paseoAdmits("latest", range)).toBe(false);
  });
  it("refuses above a maximum when a range has one", () => {
    expect(paseoAdmits("0.14.0-beta.1", ">=0.10.3 <0.14.0")).toBe(false);
  });
});

describe("requirements.paseo in paseo-plugin.json", () => {
  const manifest = JSON.parse(readFileSync(new URL("../paseo-plugin.json", import.meta.url), "utf8"));
  it("admits every Paseo the plugin was run against (AGENTS.md)", () => {
    for (const version of ["0.9.0", "0.9.2", "0.10.0", "0.10.3", "0.11.4", "0.12.0", "0.13.0-beta.2", "0.13.1"]) expect(paseoAdmits(version, manifest.requirements.paseo), version).toBe(true);
  });
  it("has no maximum, so a new Paseo needs no release of the plugin (a missing API is caught at runtime, shared/host.ts)", () => {
    for (const version of ["0.14.0-beta.1", "0.14.0", "1.0.0", "2.3.4"]) expect(paseoAdmits(version, manifest.requirements.paseo), version).toBe(true);
  });
  it("refuses Paseo 0.8, which the plugin does not run on", () => {
    expect(paseoAdmits("0.8.0", manifest.requirements.paseo)).toBe(false);
  });
});

describe("newestVersion", () => {
  it("takes the highest version, a prerelease of the next minor included", () => {
    expect(newestVersion(["0.11.4", "0.12.0", "0.13.0-beta.1", "0.12.0-beta.3"])).toBe("0.13.0-beta.1");
  });
  it("prefers a release over its own betas", () => {
    expect(newestVersion(["0.12.0-beta.3", "0.12.0", "0.12.0-beta.1"])).toBe("0.12.0");
  });
  it("fails on an empty list", () => {
    expect(() => newestVersion([])).toThrow(/no versions/);
  });
});

describe("minimumVersion", () => {
  it("is the range's lowest version", () => {
    expect(minimumVersion(">=0.9.0")).toBe("0.9.0");
    expect(minimumVersion(">=0.10.3 <0.14.0")).toBe("0.10.3");
  });
});

describe("verdict", () => {
  it("calls a refused but working version a range problem, without asking for a release", () => {
    expect(verdict({ range: "fail", typecheck: "ok", daemon: "ok" })).toMatch(/requirements\.paseo refuses it/);
    expect(verdict({ range: "fail", typecheck: "ok", daemon: "ok" })).not.toMatch(/release/);
  });
  it("calls a failed load or typecheck broken, whatever the range says", () => {
    expect(verdict({ range: "fail", typecheck: "ok", daemon: "fail" })).toMatch(/broken/);
    expect(verdict({ range: "ok", typecheck: "fail", daemon: "skipped" })).toMatch(/broken/);
  });
  it("passes when nothing failed", () => {
    expect(verdict({ range: "ok", typecheck: "skipped", daemon: "ok" })).toBe("ok");
  });
});
