import type { Runner } from "./run";

/** An AppleScript string literal. */
function quote(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const MAX_MESSAGE = 300;

/**
 * A notification from the operating system, for when no Paseo window is open
 * to show anything: Paseo gives plugin server code no notification of its
 * own. macOS only, through `osascript`; elsewhere this does nothing. A
 * notification that cannot be shown is not an error worth failing a check for.
 */
export function createNotifier(run: Runner, platform: NodeJS.Platform) {
  return async function notify(title: string, message: string): Promise<void> {
    if (platform !== "darwin") return;
    const body = message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE - 1)}…` : message;
    try {
      await run("osascript", ["-e", `display notification ${quote(body)} with title ${quote(title)}`], {
        timeoutMs: 10_000,
      });
    } catch {
      // Best effort.
    }
  };
}

export const notificationScript = (title: string, message: string): string =>
  `display notification ${quote(message)} with title ${quote(title)}`;
