import type { Status } from "../shared/status";

type Listener = (status: Status) => void;

const listeners = new Set<Listener>();

/**
 * Passes each status the client reads to whoever wants it. The status page
 * and the Command Center items publish; the sidebar row listens, so it
 * appears and goes the moment a notice does instead of at its next poll.
 */
export function publishStatus(status: Status): void {
  for (const listener of [...listeners]) listener(status);
}

export function onStatus(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
