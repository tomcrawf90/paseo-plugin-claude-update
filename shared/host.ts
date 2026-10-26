// The plugin's range has a minimum and no maximum, so a future Paseo is let in
// before anyone has run the plugin on it. If that Paseo has removed or renamed
// a function the plugin calls, the entry stops here with a message that names
// it, in place of "x is not a function" from somewhere inside.

const ISSUES_URL = "https://github.com/tomcrawf90/paseo-plugin-claude-update/issues";

/** The names in `names` that are not functions on `host`. */
export function missingHostApis(host: object, names: readonly string[]): string[] {
  return names.filter((name) => typeof (host as Record<string, unknown>)[name] !== "function");
}

/** Throws, naming every missing function, unless `host` has all of `names`. */
export function requireHostApis(host: object, names: readonly string[], runtime: "app" | "daemon"): void {
  const missing = missingHostApis(host, names);
  if (missing.length === 0) return;
  const message = `Claude Code updates cannot start: this Paseo ${runtime} has no ${missing.join(", ")}. Paseo has changed a plugin API the plugin uses; update the plugin, or report it at ${ISSUES_URL}.`;
  console.error(`[claude-update] ${message}`);
  throw new Error(message);
}
