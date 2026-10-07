/**
 * Claude Code versions are plain `major.minor.patch`, optionally with a
 * prerelease or build suffix that this plugin never compares on.
 */

const VERSION = /\b(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?\b/;
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

/** Pulls the first version out of text such as `2.1.285 (Claude Code)`. */
export function extractVersion(text: string): string | null {
  const match = VERSION.exec(text);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

/** True for an exact `major.minor.patch`, the only form a pin accepts. */
export function isExactVersion(text: string): boolean {
  return EXACT_VERSION.test(text);
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
