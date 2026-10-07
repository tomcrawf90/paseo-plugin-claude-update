import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { checkRelease, isPublished, nextVersion, parseChangelog, prepareRelease, releaseNotes, stampChangelog } from "./release.mjs";

const run = promisify(execFile);
const script = fileURLToPath(new URL("./release.mjs", import.meta.url));

const DATED = `# Changelog

Intro.

## 0.2.1 - 2026-10-08

- Second.

## 0.2.0 - unreleased

- First.
`;
const PENDING = DATED.replace("2026-10-08", "unreleased");
const WITH_UNRELEASED = DATED.replace("## 0.2.1", "## Unreleased\n\n- Third.\n\n## 0.2.1");

describe("parseChangelog", () => {
  it("reads versions, dates and bodies, top first", () => {
    expect(parseChangelog(WITH_UNRELEASED).map(({ version, date, body }) => ({ version, date, body }))).toEqual([
      { version: null, date: "unreleased", body: "- Third." },
      { version: "0.2.1", date: "2026-10-08", body: "- Second." },
      { version: "0.2.0", date: "unreleased", body: "- First." },
    ]);
  });

  it("refuses a heading it does not know", () => {
    expect(() => parseChangelog("## [0.2.1] 2026-10-08\n")).toThrow(/line 1/);
  });
});

describe("checkRelease", () => {
  it("passes on a pull request while the entry is unreleased", () => {
    expect(checkRelease({ version: "0.2.1", changelog: PENDING })).toEqual([]);
  });

  it("passes with changes waiting under Unreleased", () => {
    expect(checkRelease({ version: "0.2.1", changelog: WITH_UNRELEASED })).toEqual([]);
  });

  it("passes for a tag that matches a dated entry", () => {
    expect(checkRelease({ version: "0.2.1", changelog: DATED, tag: "v0.2.1" })).toEqual([]);
  });

  it("fails when package.json is ahead of the changelog", () => {
    expect(checkRelease({ version: "0.2.2", changelog: DATED })).toEqual(["CHANGELOG.md: the top entry is 0.2.1 but package.json is at 0.2.2"]);
  });

  it("fails when the changelog is ahead of package.json", () => {
    expect(checkRelease({ version: "0.2.0", changelog: DATED })[0]).toMatch(/top entry is 0\.2\.1/);
  });

  it("fails for a tag that is not the package version", () => {
    for (const tag of ["v0.2.2", "0.2.1", "v0.2.1-rc.1", ""]) {
      expect(checkRelease({ version: "0.2.1", changelog: DATED, tag }), tag).toEqual([`tag "${tag}" does not match package.json, which is at 0.2.1 (expected "v0.2.1")`]);
    }
  });

  it("fails for a tag while the entry is still unreleased", () => {
    expect(checkRelease({ version: "0.2.1", changelog: PENDING, tag: "v0.2.1" })[0]).toMatch(/still marked unreleased/);
  });

  it("fails for a tag while changes wait under Unreleased", () => {
    expect(checkRelease({ version: "0.2.1", changelog: WITH_UNRELEASED, tag: "v0.2.1" })[0]).toMatch(/not in the tagged version/);
  });

  it("fails on an empty entry, a missing one, a bad date, a repeated version and a misplaced Unreleased", () => {
    expect(checkRelease({ version: "0.2.1", changelog: "## 0.2.1 - 2026-10-08\n\n## 0.2.0 - 2026-10-01\n\n- First.\n" })[0]).toMatch(/is empty/);
    expect(checkRelease({ version: "0.2.1", changelog: "# Changelog\n" })).toEqual(["CHANGELOG.md: no entry for 0.2.1"]);
    expect(checkRelease({ version: "0.2.1", changelog: DATED.replace("2026-10-08", "2026-13-40") })[0]).toMatch(/dated "2026-13-40"/);
    expect(checkRelease({ version: "0.2.1", changelog: DATED.replace("## 0.2.0", "## 0.2.1") })[0]).toMatch(/two entries/);
    expect(checkRelease({ version: "0.2.1", changelog: `${DATED}\n## Unreleased\n` })[0]).toMatch(/must be the first entry/);
  });

  it("fails on a version that is not a release", () => {
    for (const version of ["0.0.0", "1.2", "1.2.3-beta.1"]) expect(checkRelease({ version, changelog: DATED })[0], version).toMatch(/not a released semantic version/);
  });
});

describe("releaseNotes", () => {
  it("returns one entry's text", () => {
    expect(releaseNotes({ version: "0.2.1", changelog: WITH_UNRELEASED })).toBe("- Second.");
  });

  it("fails without an entry", () => {
    expect(() => releaseNotes({ version: "0.3.0", changelog: DATED })).toThrow(/no entry for 0\.3\.0/);
  });
});

describe("nextVersion", () => {
  it("bumps each part", () => {
    expect(nextVersion("0.2.1", "patch")).toBe("0.2.2");
    expect(nextVersion("0.2.1", "minor")).toBe("0.3.0");
    expect(nextVersion("0.2.1", "major")).toBe("1.0.0");
  });

  it("takes an exact version that is not lower", () => {
    expect(nextVersion("0.2.1", "0.2.1")).toBe("0.2.1");
    expect(nextVersion("0.2.1", "0.10.0")).toBe("0.10.0");
    expect(() => nextVersion("0.2.1", "0.2.0")).toThrow(/lower than/);
    expect(() => nextVersion("0.10.0", "0.9.9")).toThrow(/lower than/);
  });

  it("refuses anything else", () => {
    for (const bump of [undefined, "", "prerelease", "v1.2.3", "1.2"]) expect(() => nextVersion("0.2.1", bump), String(bump)).toThrow(/expected patch, minor, major/);
  });
});

describe("stampChangelog", () => {
  it("dates an entry kept under its own version", () => {
    expect(stampChangelog({ changelog: PENDING, version: "0.2.1", date: "2026-10-08" })).toBe(DATED);
  });

  it("turns Unreleased into the version", () => {
    const stamped = stampChangelog({ changelog: WITH_UNRELEASED, version: "0.3.0", date: "2026-11-01" });
    expect(stamped).toContain("## 0.3.0 - 2026-11-01\n\n- Third.\n\n## 0.2.1 - 2026-10-08");
    expect(stamped).not.toContain("Unreleased");
  });

  it("drops an empty Unreleased above the entry", () => {
    expect(stampChangelog({ changelog: PENDING.replace("## 0.2.1", "## Unreleased\n\n## 0.2.1"), version: "0.2.1", date: "2026-10-08" })).toBe(DATED);
  });

  it("refuses a version that was already released", () => {
    expect(() => stampChangelog({ changelog: DATED, version: "0.2.1", date: "2026-10-09" })).toThrow(/already dated 2026-10-08/);
  });

  it("refuses when there is nothing to release", () => {
    expect(() => stampChangelog({ changelog: DATED, version: "0.2.2", date: "2026-10-09" })).toThrow(/nothing to release/);
    expect(() => stampChangelog({ changelog: DATED.replace("## 0.2.1", "## Unreleased\n\n## 0.2.1"), version: "0.2.2", date: "2026-10-09" })).toThrow(/is empty/);
  });

  it("refuses two pending entries and an entry that is not at the top", () => {
    expect(() => stampChangelog({ changelog: WITH_UNRELEASED.replace("2026-10-08", "unreleased"), version: "0.2.1", date: "2026-10-09" })).toThrow(/merge them/);
    expect(() => stampChangelog({ changelog: DATED, version: "0.2.0", date: "2026-10-09" })).toThrow(/must be at the top/);
  });

  it("refuses a date that is not one", () => {
    expect(() => stampChangelog({ changelog: PENDING, version: "0.2.1", date: "today" })).toThrow(/not a date/);
  });
});

describe("in a copy of a repository", () => {
  const made = [];
  afterEach(() => {
    for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function repository({ version = "0.2.1", changelog = PENDING } = {}) {
    const root = mkdtempSync(join(tmpdir(), "pcu-release-"));
    made.push(root);
    mkdirSync(join(root, "scripts"));
    cpSync(script, join(root, "scripts", "release.mjs"));
    writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "paseo-plugin-claude-update", version, type: "module" }, null, 2)}\n`);
    writeFileSync(join(root, "package-lock.json"), `${JSON.stringify({ name: "paseo-plugin-claude-update", version, lockfileVersion: 3, packages: { "": { name: "paseo-plugin-claude-update", version }, "node_modules/zod": { version: "4.4.3" } } }, null, 2)}\n`);
    writeFileSync(join(root, "CHANGELOG.md"), changelog);
    const cli = (...args) => run(process.execPath, [join(root, "scripts", "release.mjs"), ...args]).then(
      ({ stdout }) => ({ code: 0, stdout, stderr: "" }),
      (error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }),
    );
    const json = (name) => JSON.parse(readFileSync(join(root, name), "utf8"));
    return { root, cli, json, changelog: () => readFileSync(join(root, "CHANGELOG.md"), "utf8") };
  }

  it("prepare with the current version dates the entry and leaves the number", () => {
    const repo = repository();
    expect(prepareRelease({ root: repo.root, bump: "0.2.1", date: "2026-10-08" })).toEqual({ previous: "0.2.1", version: "0.2.1" });
    expect(repo.changelog()).toBe(DATED);
    expect(repo.json("package.json").version).toBe("0.2.1");
  });

  it("prepare bumps package.json and the lockfile and leaves other packages alone", () => {
    const repo = repository({ changelog: WITH_UNRELEASED });
    expect(prepareRelease({ root: repo.root, bump: "minor", date: "2026-11-01" })).toEqual({ previous: "0.2.1", version: "0.3.0" });
    expect(repo.json("package.json")).toEqual({ name: "paseo-plugin-claude-update", version: "0.3.0", type: "module" });
    const lock = repo.json("package-lock.json");
    expect([lock.version, lock.packages[""].version, lock.packages["node_modules/zod"].version]).toEqual(["0.3.0", "0.3.0", "4.4.3"]);
    expect(repo.changelog()).toContain("## 0.3.0 - 2026-11-01");
    expect(readFileSync(join(repo.root, "package.json"), "utf8").endsWith("}\n")).toBe(true);
  });

  it("prepare writes nothing when it cannot finish", () => {
    const repo = repository({ changelog: DATED });
    expect(() => prepareRelease({ root: repo.root, bump: "patch", date: "2026-10-09" })).toThrow(/nothing to release/);
    expect(repo.json("package.json").version).toBe("0.2.1");
    expect(repo.json("package-lock.json").version).toBe("0.2.1");
    expect(repo.changelog()).toBe(DATED);
  });

  it("the command passes a pull request and fails the same tree as a tag", async () => {
    const repo = repository();
    expect(await repo.cli("check")).toMatchObject({ code: 0, stdout: expect.stringContaining("agree on 0.2.1") });
    const tagged = await repo.cli("check", "--tag", "v0.2.1");
    expect(tagged.code).toBe(1);
    expect(tagged.stderr).toContain("error: CHANGELOG.md: 0.2.1 is still marked unreleased");
  });

  it("the command prepares, then passes the tag and prints its notes", async () => {
    const repo = repository();
    expect(await repo.cli("prepare", "0.2.1")).toMatchObject({ code: 0, stdout: expect.stringContaining("Nothing was committed or tagged") });
    expect(await repo.cli("check", "--tag", "v0.2.1")).toMatchObject({ code: 0 });
    expect(await repo.cli("check", "--tag", "v0.2.2")).toMatchObject({ code: 1, stderr: expect.stringContaining('expected "v0.2.1"') });
    expect(await repo.cli("check", "--tag")).toMatchObject({ code: 1 });
    expect((await repo.cli("notes")).stdout).toBe("- Second.\n\n```bash\npaseo plugin install npm:paseo-plugin-claude-update@0.2.1\n```\n");
  });

  it("the command fails on a mismatch and on an unknown command", async () => {
    const repo = repository({ version: "0.2.2" });
    expect(await repo.cli("check")).toMatchObject({ code: 1, stderr: expect.stringContaining("top entry is 0.2.1 but package.json is at 0.2.2") });
    expect(await repo.cli("publish")).toMatchObject({ code: 1, stderr: expect.stringContaining("usage:") });
    expect(await repo.cli()).toMatchObject({ code: 1 });
  });
});

describe("isPublished", () => {
  const answering = (status) => {
    const calls = [];
    return { calls, fetch: async (url) => (calls.push(url), { status }) };
  };

  it("is true for a version the registry has, false for one it does not", async () => {
    const found = answering(200);
    expect(await isPublished({ name: "paseo-plugin-claude-update", version: "0.2.1", fetch: found.fetch })).toBe(true);
    expect(found.calls).toEqual(["https://registry.npmjs.org/paseo-plugin-claude-update/0.2.1"]);
    expect(await isPublished({ name: "@scope/name", version: "1.0.0", fetch: answering(404).fetch })).toBe(false);
  });

  it("escapes a scoped name", async () => {
    const scoped = answering(404);
    await isPublished({ name: "@scope/name", version: "1.0.0", fetch: scoped.fetch });
    expect(scoped.calls).toEqual(["https://registry.npmjs.org/@scope%2fname/1.0.0"]);
  });

  it("fails on any other answer, so an outage is not read as unpublished", async () => {
    for (const status of [401, 429, 500, 503]) await expect(isPublished({ name: "x", version: "1.0.0", fetch: answering(status).fetch }), String(status)).rejects.toThrow(String(status));
  });
});
