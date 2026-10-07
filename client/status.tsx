import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { OUTCOME_LABELS, relativeTime } from "../shared/format";
import {
  AUTO_UPDATE_LABEL,
  AUTO_UPDATE_OFF,
  AUTO_UPDATE_ON,
  AUTO_UPDATE_SAFETY,
  autoUpdateOn,
  updateSettings,
  withAutoUpdate,
} from "../shared/settings";
import { checkNow, dismissAttention, getStatus, type ClaudeProcess, type Status } from "../shared/status";
import { activityView, resultOf, runEnded, type Action, type RunResult } from "./activity";
import { publishStatus } from "./bus";

export const STATUS_QUERY_KEY = ["claude-update", "status"] as const;
const REFRESH_MS = 30_000;
/** While a check is running the page asks again this often, so it sees the run end. */
const BUSY_REFRESH_MS = 2_000;

function useStyles(theme: PluginTheme, compact: boolean) {
  return useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: compact ? 16 : 24, gap: 16 },
      heading: { color: theme.colors.foreground, fontSize: compact ? 20 : 24, fontWeight: "600" as const },
      card: {
        padding: 14,
        gap: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      cardTitle: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" as const },
      row: { flexDirection: compact ? ("column" as const) : ("row" as const), gap: compact ? 2 : 12 },
      label: { color: theme.colors.foregroundMuted, fontSize: 13, width: compact ? undefined : 150 },
      value: { color: theme.colors.foreground, fontSize: 13, flex: 1 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
      code: { color: theme.colors.foreground, fontSize: 13, fontFamily: "monospace" },
      actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 10 },
      button: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
      },
      buttonText: { color: theme.colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
      quietButton: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      quietButtonText: { color: theme.colors.foreground, fontSize: 13 },
      disabled: { opacity: 0.5 },
      progress: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      toggleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12 },
      toggleTitle: { color: theme.colors.foreground, fontSize: 16, fontWeight: "600" as const, flex: 1 },
      toggleState: { color: theme.colors.foregroundMuted, fontSize: 13, fontWeight: "600" as const },
      track: { width: 46, height: 28, borderRadius: 14, padding: 3, borderWidth: 1 },
      knob: { width: 20, height: 20, borderRadius: 10 },
    }),
    [theme, compact],
  );
}

type Styles = ReturnType<typeof useStyles>;

function Row({ styles, label, children }: { styles: Styles; label: string; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{children}</Text>
    </View>
  );
}

function outcomeColor(theme: PluginTheme, status: Status): string {
  if (status.lastOutcome === "failed") return theme.colors.statusDanger;
  if (status.lastOutcome === "updated" || status.lastOutcome === "up-to-date" || status.lastOutcome === "pinned") {
    return theme.colors.statusSuccess;
  }
  return theme.colors.statusWarning;
}

function processLabel(process: ClaudeProcess): string {
  if (process.kind === "agent") return process.title ?? `Agent ${process.agentId ?? ""}`.trim();
  if (process.kind === "daemon") return "Claude Code background daemon";
  return "Other Claude Code process";
}

function resultColor(theme: PluginTheme, result: RunResult): string {
  if (result.tone === "bad") return theme.colors.statusDanger;
  return result.tone === "good" ? theme.colors.statusSuccess : theme.colors.statusWarning;
}

/**
 * The "Auto-update Claude Code" switch, at the top of the page so it is one
 * click away. It is the same setting as the one on the settings screen.
 */
function AutoUpdateCard({ theme, styles, nextCheck }: { theme: PluginTheme; styles: Styles; nextCheck: string | null }) {
  const settings = useSettings(updateSettings);
  const toast = useToast();

  if (settings.status === "error" || settings.status === "invalid") {
    return (
      <View style={[styles.card, { borderColor: theme.colors.statusDanger }]}>
        <Text style={styles.cardTitle}>{AUTO_UPDATE_LABEL}</Text>
        <Text style={styles.muted}>
          The settings could not be read, so nothing is checked or installed on a schedule: {settings.error} Open this plugin's
          settings to fix them.
        </Text>
      </View>
    );
  }

  const ready = settings.status === "ready";
  const on = ready && autoUpdateOn(settings.values);
  const off = !ready || settings.saving;
  async function flip(): Promise<void> {
    if (settings.status !== "ready") return;
    const saved = await settings.save(withAutoUpdate(settings.values, !on), settings.revision);
    if (!saved) toast.error("Could not save the setting.");
  }

  return (
    <View style={[styles.card, on ? { borderColor: theme.colors.accent } : null]}>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleTitle}>{AUTO_UPDATE_LABEL}</Text>
        <Text style={styles.toggleState}>{!ready ? "…" : settings.saving ? "Saving…" : on ? "On" : "Off"}</Text>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={AUTO_UPDATE_LABEL}
          accessibilityState={{ checked: on, disabled: off }}
          disabled={off}
          onPress={() => void flip()}
          style={[
            styles.track,
            {
              alignItems: on ? "flex-end" : "flex-start",
              backgroundColor: on ? theme.colors.accent : theme.colors.surface2,
              borderColor: on ? theme.colors.accent : theme.colors.border,
            },
            off ? styles.disabled : null,
          ]}
        >
          <View style={[styles.knob, { backgroundColor: on ? theme.colors.accentForeground : theme.colors.foregroundMuted }]} />
        </Pressable>
      </View>
      {ready ? <Text style={styles.value}>{on ? AUTO_UPDATE_ON : AUTO_UPDATE_OFF}</Text> : null}
      {ready && on && !settings.values.enabled ? (
        <Text style={{ color: theme.colors.statusWarning, fontSize: 13 }}>
          Scheduled checks are switched off in this plugin's settings, so nothing is installed by itself until they are back on.
        </Text>
      ) : null}
      {ready && settings.values.pinnedVersion !== "" ? (
        <Text style={{ color: theme.colors.statusWarning, fontSize: 13 }}>
          Pinned at {settings.values.pinnedVersion} in this plugin's settings: that version is held, and newer ones are not installed.
        </Text>
      ) : null}
      {ready && on && settings.values.enabled && nextCheck !== null ? <Text style={styles.muted}>Next scheduled check: {nextCheck}.</Text> : null}
      <Text style={styles.muted}>{AUTO_UPDATE_SAFETY}</Text>
    </View>
  );
}

export function StatusSurface({ theme, layout }: PluginSurfaceProps) {
  const styles = useStyles(theme, layout.compact);
  const toast = useToast();
  const queryClient = useQueryClient();
  const loadStatus = useRpc(getStatus);
  const runCheck = useRpc(checkNow);
  const dismiss = useRpc(dismissAttention);

  const status = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: () => loadStatus({}),
    refetchInterval: (query) => (query.state.data?.checking ? BUSY_REFRESH_MS : REFRESH_MS),
  });
  const [pressedAt, setPressedAt] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const check = useMutation({
    mutationFn: (action: Action) => runCheck({ apply: action === "update" }),
    onMutate() {
      setPressedAt(Date.now());
      setResult(null);
    },
    onSuccess(next) {
      queryClient.setQueryData(STATUS_QUERY_KEY, next);
      // The result is shown on this page, where it was asked for. Only a
      // change to the install, or a failure, is worth a toast as well.
      setResult(resultOf(next, Date.now()));
      const message = next.lastMessage ?? "Checked.";
      if (next.lastOutcome === "failed") toast.error(message);
      else if (next.lastOutcome === "updated" || next.lastOutcome === "pin-applied") toast.show(message, { variant: "success", durationMs: 5000 });
    },
    onError(error) {
      const message = error instanceof Error ? error.message : "The check could not be run.";
      setResult({ outcome: null, message, tone: "bad", at: Date.now() });
      toast.error(message);
    },
  });
  // A clock for the "12 s" on a running check and the "5 min ago" elsewhere.
  const [now, setNow] = useState(() => Date.now());
  const pending = check.isPending ? { action: check.variables, since: pressedAt } : null;
  const { busy, active, checkLabel, updateLabel, line } = activityView(status.data ?? null, pending, now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), busy ? 1000 : REFRESH_MS);
    return () => clearInterval(timer);
  }, [busy]);

  // The sidebar row follows what this page sees: dismissing a notice here
  // takes the row away at once. A run this page did not start (the schedule,
  // the Command Center, another window) shows its result here when it ends.
  const seen = useRef<Status | null>(null);
  useEffect(() => {
    const next = status.data;
    if (next === undefined) return;
    publishStatus(next);
    if (runEnded(seen.current, next) && !check.isPending) setResult(resultOf(next, Date.now()));
    seen.current = next;
  }, [status.data, check.isPending]);

  const clear = useMutation({
    mutationFn: () => dismiss({}),
    onSuccess(next) {
      queryClient.setQueryData(STATUS_QUERY_KEY, next);
    },
  });

  if (status.isPending) {
    return (
      <View style={[styles.screen, styles.content]}>
        <Text style={styles.muted}>Loading…</Text>
      </View>
    );
  }
  // A poll that fails while there is something to show leaves it showing; the next one tries again.
  if (status.data === undefined) {
    return (
      <View style={[styles.screen, styles.content]}>
        <Text style={styles.heading}>Claude Code updates</Text>
        <Text style={{ color: theme.colors.statusDanger }}>
          {status.error instanceof Error ? status.error.message : "Could not read the update status."}
        </Text>
      </View>
    );
  }

  const data = status.data;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Claude Code updates</Text>

      <AutoUpdateCard
        theme={theme}
        styles={styles}
        nextCheck={data.nextCheckAt === null ? null : relativeTime(data.nextCheckAt, now)}
      />

      {data.attention !== null ? (
        <View style={[styles.card, { borderColor: data.attention.kind === "failed" ? theme.colors.statusDanger : theme.colors.accent }]}>
          <Text style={styles.cardTitle}>{relativeTime(data.attention.at, now)}</Text>
          <Text style={styles.value}>{data.attention.message}</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss this notice"
              style={styles.quietButton}
              onPress={() => clear.mutate()}
            >
              <Text style={styles.quietButtonText}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.card}>
        <Row styles={styles} label="Installed">
          {data.installedVersion ?? "not checked yet"}
        </Row>
        <Row styles={styles} label="Target">
          {data.targetVersion ?? "not checked yet"}
        </Row>
        <Row styles={styles} label="Claude Code channel">
          {data.claudeChannel ?? "unreadable"}
        </Row>
        <Row styles={styles} label="Last check">
          {relativeTime(data.lastCheckAt, now)}
        </Row>
        <Row styles={styles} label="Next check">
          {data.nextCheckAt === null ? (data.lastCheckAt === null ? "shortly" : "off") : relativeTime(data.nextCheckAt, now)}
        </Row>
        <View style={styles.row}>
          <Text style={styles.label}>Last result</Text>
          <Text style={[styles.value, { color: outcomeColor(theme, data) }]}>
            {data.lastOutcome === null ? "none yet" : OUTCOME_LABELS[data.lastOutcome]}
            {data.consecutiveFailures > 1 ? ` (${data.consecutiveFailures} in a row)` : ""}
          </Text>
        </View>
        {line !== null ? (
          <View style={styles.progress} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <Text style={styles.value}>{line}</Text>
          </View>
        ) : result !== null ? (
          <Text style={[styles.value, { color: resultColor(theme, result) }]} accessibilityLiveRegion="polite">
            Finished {relativeTime(new Date(result.at).toISOString(), now)}: {result.message}
          </Text>
        ) : data.lastMessage !== null ? (
          <Text style={styles.muted}>{data.lastMessage}</Text>
        ) : null}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check for a Claude Code update now, without installing it"
            accessibilityState={{ disabled: busy, busy: active === "check" }}
            disabled={busy}
            style={[styles.button, busy && active !== "check" ? styles.disabled : null]}
            onPress={() => check.mutate("check")}
          >
            {active === "check" ? <ActivityIndicator size="small" color={theme.colors.accentForeground} /> : null}
            <Text style={styles.buttonText}>{checkLabel}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Install a Claude Code update now if one is available"
            accessibilityState={{ disabled: busy, busy: active === "update" }}
            disabled={busy}
            style={[styles.quietButton, busy && active !== "update" ? styles.disabled : null]}
            onPress={() => check.mutate("update")}
          >
            {active === "update" ? <ActivityIndicator size="small" color={theme.colors.foreground} /> : null}
            <Text style={styles.quietButtonText}>{updateLabel}</Text>
          </Pressable>
        </View>
      </View>

      {data.rollbackCommand !== null ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Roll back</Text>
          <Text style={styles.muted}>
            The last update replaced {data.previousVersion}. To return to it, pin it in this plugin's settings, or run this
            in a terminal (and pin it, or the next check updates again):
          </Text>
          <Text selectable style={styles.code}>
            {data.rollbackCommand}
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Still on an older version</Text>
        {!data.processListSupported ? (
          <Text style={styles.muted}>Listing running Claude Code processes is only supported on macOS.</Text>
        ) : data.staleProcesses.length === 0 ? (
          <Text style={styles.muted}>Every running Claude Code process is on the installed version.</Text>
        ) : (
          <>
            <Text style={styles.muted}>
              These keep the version they started with until they are restarted. Nothing is restarted for you.
            </Text>
            {data.staleProcesses.map((process) => (
              <Row key={process.pid} styles={styles} label={process.version ?? "unknown"}>
                {processLabel(process)} · pid {process.pid} · started {relativeTime(process.startedAt, now)}
              </Row>
            ))}
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>History</Text>
        {data.history.length === 0 ? (
          <Text style={styles.muted}>Nothing has happened yet. Checks that find nothing new are not listed.</Text>
        ) : (
          data.history.map((entry) => (
            <Row key={`${entry.at}-${entry.outcome}`} styles={styles} label={relativeTime(entry.at, now)}>
              {OUTCOME_LABELS[entry.outcome]}: {entry.message}
            </Row>
          ))
        )}
        <Text style={styles.muted}>Log files: {data.dataDirectory}</Text>
      </View>
    </ScrollView>
  );
}
