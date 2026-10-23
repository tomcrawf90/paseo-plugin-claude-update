import type { Status } from "../shared/status";

type Listener = (status: Status) => void;

const listeners = new Set<Listener>();
let published = 0;

/**
 * Passes each status the client reads to whoever wants it. The client entry
 * publishes what it reads every 60 s and what the Command Center's "check now"
 * returns, and both screens publish through `useCheck`; the sidebar row
 * listens, so it names a notice and drops it the moment one comes and goes,
 * not at its next poll.
 */
export function publishStatus(status: Status): void {
  published += 1;
  for (const listener of [...listeners]) listener(status);
}

/**
 * How many statuses have been published so far. A read that began before a
 * later one was published may hold settings from before a switch was saved,
 * so its reader can tell and drop it.
 */
export function publishedCount(): number {
  return published;
}

export function onStatus(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
