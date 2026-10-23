import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Status } from "../shared/status";

// The module's hooks need the host; nothing here calls them.
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => undefined }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ useToast: () => undefined }));

const { onStatus } = await import("./bus");
const { refreshStatus, STATUS_QUERY_KEY } = await import("./check");

const ON = { showInSidebar: true } as Status;

/** A query client with the status query watched, as it is while a screen is open. */
function screen(read: () => Promise<Status>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const observer = new QueryObserver(client, { queryKey: STATUS_QUERY_KEY, queryFn: read });
  const unsubscribe = observer.subscribe(() => {});
  return { client, stop: unsubscribe };
}

let stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
});

describe("reading the status again after a save", () => {
  it("publishes what it reads, even when it is the same as before", async () => {
    const { client, stop } = screen(async () => ({ ...ON }));
    const seen: Status[] = [];
    stops.push(stop, onStatus((status) => seen.push(status)));
    await client.fetchQuery({ queryKey: STATUS_QUERY_KEY, queryFn: async () => ({ ...ON }) });
    await refreshStatus(client);
    await refreshStatus(client);
    expect(seen).toHaveLength(2);
    expect(seen.every((status) => status.showInSidebar)).toBe(true);
  });

  it("publishes nothing when the read fails", async () => {
    let fail = false;
    const { client, stop } = screen(async () => {
      if (fail) throw new Error("the host is away");
      return { ...ON };
    });
    const seen: Status[] = [];
    stops.push(stop, onStatus((status) => seen.push(status)));
    await client.fetchQuery({ queryKey: STATUS_QUERY_KEY, queryFn: async () => ({ ...ON }) });
    fail = true;
    await refreshStatus(client);
    expect(seen).toEqual([]);
  });
});
