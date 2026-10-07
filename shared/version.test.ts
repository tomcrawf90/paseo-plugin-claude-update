import { describe, expect, it } from "vitest";

import { compareVersions, extractVersion, isExactVersion } from "./version";

describe("extractVersion", () => {
  it("reads the version the CLI prints", () => {
    expect(extractVersion("2.1.285 (Claude Code)\n")).toBe("2.1.285");
  });
  it("reads a bare release pointer", () => {
    expect(extractVersion("2.1.292")).toBe("2.1.292");
  });
  it("drops a prerelease suffix", () => {
    expect(extractVersion("3.0.0-rc.1 (Claude Code)")).toBe("3.0.0");
  });
  it("returns null when there is no version", () => {
    expect(extractVersion("command not found")).toBeNull();
    expect(extractVersion("<html>502</html>")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("2.1.99", "2.1.285")).toBeLessThan(0);
    expect(compareVersions("2.10.0", "2.9.9")).toBeGreaterThan(0);
    expect(compareVersions("2.1.285", "2.1.285")).toBe(0);
    expect(compareVersions("3.0.0", "2.99.99")).toBeGreaterThan(0);
  });
});

describe("isExactVersion", () => {
  it("accepts only major.minor.patch", () => {
    expect(isExactVersion("2.1.285")).toBe(true);
    expect(isExactVersion("latest")).toBe(false);
    expect(isExactVersion("2.1")).toBe(false);
    expect(isExactVersion("2.1.285 ")).toBe(false);
  });
});
