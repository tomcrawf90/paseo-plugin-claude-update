import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { OUTCOME_LABELS, relativeTime } from "../shared/format";
import { checkNow, dismissAttention, getStatus, type ClaudeProcess, type Status } from "../shared/status";

export const STATUS_QUERY_KEY = ["claude-update", "status"] as const;
const REFRESH_MS = 30_000;

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
      button: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, backgroundColor: theme.colors.accent },
      buttonText: { color: theme.colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
      quietButton: {
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      quietButtonText: { color: theme.colors.foreground, fontSize: 13 },
      disabled: { opacity: 0.5 },
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

export function StatusSurface({ theme, layout }: PluginSurfaceProps) {
  const styles = useStyles(theme, layout.compact);
  const toast = useToast();
  const queryClient = useQueryClient();
  const loadStatus = useRpc(getStatus);
  const runCheck = useRpc(checkNow);
  const dismiss = useRpc(dismissAttention);

  const status = useQuery({ queryKey: STATUS_QUERY_KEY, queryFn: () => loadStatus({}), refetchInterval: REFRESH_MS });
  const check = useMutation({
    mutationFn: (apply: boolean) => runCheck({ apply }),
    onSuccess(next) {
      queryClient.setQueryData(STATUS_QUERY_KEY, next);
      const message = next.lastMessage ?? "Checked.";
      if (next.lastOutcome === "failed") toast.error(message);
      else toast.show(message, { variant: next.lastOutcome === "updated" ? "success" : "info", durationMs: 5000 });
    },
    onError(error) {
      toast.error(error instanceof Error ? error.message : "The check could not be run.");
    },
  });
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
  if (status.isError || status.data === undefined) {
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
  const now = Date.now();
  const busy = check.isPending || data.checking;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Claude Code updates</Text>

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
        {data.lastMessage !== null ? <Text style={styles.muted}>{data.lastMessage}</Text> : null}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check for a Claude Code update now, without installing it"
            disabled={busy}
            style={[styles.button, busy ? styles.disabled : null]}
            onPress={() => check.mutate(false)}
          >
            <Text style={styles.buttonText}>{busy ? "Checking…" : "Check now"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Install a Claude Code update now if one is available"
            disabled={busy}
            style={[styles.quietButton, busy ? styles.disabled : null]}
            onPress={() => check.mutate(true)}
          >
            <Text style={styles.quietButtonText}>Update now</Text>
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
