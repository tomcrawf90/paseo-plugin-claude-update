import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { checkNow, getStatus, type Status } from "../shared/status";
import { activityView, resultOf, runEnded, type Action, type ActivityView, type RunResult } from "./activity";
import { publishStatus } from "./bus";

export const STATUS_QUERY_KEY = ["claude-update", "status"] as const;
const REFRESH_MS = 30_000;
/** While a check is running the screen asks again this often, so it sees the run end. */
const BUSY_REFRESH_MS = 2_000;

export interface Check {
  /** The last status read. Undefined before the first one, and when none has worked yet. */
  data: Status | undefined;
  /** The first read has not come back yet. */
  loading: boolean;
  /** Why the status could not be read, while there is nothing to show. */
  error: string | null;
  /** What the buttons and the progress line say. */
  view: ActivityView;
  /** How the last run seen from this screen ended. Null until one has. */
  result: RunResult | null;
  /** A clock for the "12 s" on a running check and the "5 min ago" elsewhere. */
  now: number;
  /** "Check now" (`check`, looks only) or "Update now" (`update`, installs). */
  run(action: Action): void;
}

/**
 * The status, kept fresh, and the two buttons. The status page and the
 * settings screen both use it; Paseo gives them one query client, so a check
 * started on one shows on the other.
 */
export function useCheck(): Check {
  const toast = useToast();
  const queryClient = useQueryClient();
  const loadStatus = useRpc(getStatus);
  const runCheck = useRpc(checkNow);

  const status = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: () => loadStatus({}),
    refetchInterval: (query) => (query.state.data?.checking ? BUSY_REFRESH_MS : REFRESH_MS),
  });
  const [pressedAt, setPressedAt] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const check = useMutation({
    mutationFn: (action: Action) => runCheck({ apply: action === "update" }),
    async onMutate() {
      setPressedAt(Date.now());
      setResult(null);
      // A status read that is under way would land after the answer and show the screen as it was.
      await queryClient.cancelQueries({ queryKey: STATUS_QUERY_KEY });
    },
    onSuccess(next) {
      queryClient.setQueryData(STATUS_QUERY_KEY, next);
      // The result is shown on the screen it was asked for on. Only a
      // failure is worth a toast as well.
      setResult(resultOf(next, Date.now()));
      if (next.lastOutcome === "failed") toast.error(next.lastMessage ?? "The check failed.");
    },
    onError(error) {
      const message = error instanceof Error ? error.message : "The check could not be run.";
      setResult({ outcome: null, message, tone: "bad", at: Date.now() });
      toast.error(message);
    },
  });
  const [now, setNow] = useState(() => Date.now());
  const pending = check.isPending ? { action: check.variables, since: pressedAt } : null;
  const view = activityView(status.data ?? null, pending, now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), view.busy ? 1000 : REFRESH_MS);
    return () => clearInterval(timer);
  }, [view.busy]);

  // The sidebar row follows what this screen sees: dismissing a notice here
  // changes the row at once. A run this screen did not start (the schedule,
  // the Command Center, another window) shows its result here when it ends.
  const seen = useRef<Status | null>(null);
  useEffect(() => {
    const next = status.data;
    if (next === undefined) return;
    publishStatus(next);
    if (runEnded(seen.current, next) && !check.isPending) setResult(resultOf(next, Date.now()));
    seen.current = next;
  }, [status.data, check.isPending]);

  return {
    data: status.data,
    loading: status.isPending,
    error: status.data !== undefined ? null : status.error instanceof Error ? status.error.message : status.isPending ? null : "Could not read the update status.",
    view,
    result,
    now,
    run: (action) => check.mutate(action),
  };
}
