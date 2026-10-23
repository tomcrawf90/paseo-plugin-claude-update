import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps, SettingsState } from "@getpaseo/plugin/client";
import { openExternalUrl, useRpc, useSettings } from "@getpaseo/plugin/client";
import { ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import {
  lastCheckText,
  lastResult,
  lastUpdateText,
  moreItemsText,
  moreVersionsText,
  nextCheckText,
  notesSummary,
  OUTCOME_LABELS,
  outcomeTone,
  relativeTime,
  staleProcessesText,
} from "../shared/format";
import { RELEASE_NOTES_URL, type ReleaseNotes } from "../shared/notes";
import {
  AUTO_UPDATE_LABEL,
  AUTO_UPDATE_OFF,
  AUTO_UPDATE_ON,
  AUTO_UPDATE_SAFETY,
  autoUpdateOn,
  SIDEBAR_LABEL,
  SIDEBAR_OFF,
  SIDEBAR_ON,
  SIDEBAR_QUIET,
  updateSettings,
  withAutoUpdate,
} from "../shared/settings";
import { dismissAttention, type ClaudeProcess, type Status } from "../shared/status";
import { CHECK_NOW_HINT, type RunResult } from "./activity";
import { STATUS_QUERY_KEY, useCheck, useRefreshStatus } from "./check";
import { saveShowInSidebar } from "./sidebar";

/** The plugin's settings, read once for the page so both switches wait for each other's save. */
type Settings = SettingsState<typeof updateSettings.schema>;

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

function toneColor(theme: PluginTheme, tone: RunResult["tone"]): string {
  if (tone === "bad") return theme.colors.statusDanger;
  return tone === "good" ? theme.colors.statusSuccess : theme.colors.statusWarning;
}

function processLabel(process: ClaudeProcess): string {
  if (process.kind === "agent") return process.title ?? `Agent ${process.agentId ?? ""}`.trim();
  if (process.kind === "daemon") return "Claude Code background daemon";
  return "Other Claude Code process";
}

/** A titled on/off switch, as the cards on this page draw it. */
function Toggle({
  theme,
  styles,
  label,
  state,
  on,
  disabled,
  onPress,
}: {
  theme: PluginTheme;
  styles: Styles;
  label: string;
  state: string;
  on: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleTitle}>{label}</Text>
      <Text style={styles.toggleState}>{state}</Text>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked: on, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={[
          styles.track,
          {
            alignItems: on ? "flex-end" : "flex-start",
            backgroundColor: on ? theme.colors.accent : theme.colors.surface2,
            borderColor: on ? theme.colors.accent : theme.colors.border,
          },
          disabled ? styles.disabled : null,
        ]}
      >
        <View style={[styles.knob, { backgroundColor: on ? theme.colors.accentForeground : theme.colors.foregroundMuted }]} />
      </Pressable>
    </View>
  );
}

/**
 * The "Auto-update Claude Code" switch, on the status page so it is one
 * click away. It is the same setting as the one on the settings screen.
 */
function AutoUpdateCard({ theme, styles, settings }: { theme: PluginTheme; styles: Styles; settings: Settings }) {
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
      <Toggle
        theme={theme}
        styles={styles}
        label={AUTO_UPDATE_LABEL}
        state={!ready ? "…" : settings.saving ? "Saving…" : on ? "On" : "Off"}
        on={on}
        disabled={off}
        onPress={() => void flip()}
      />
      {ready ? <Text style={styles.value}>{on ? AUTO_UPDATE_ON : AUTO_UPDATE_OFF}</Text> : null}
      {ready && on && !settings.values.enabled ? (
        <Text style={{ color: theme.colors.statusWarning, fontSize: 13 }}>
          Scheduled checks are switched off in this plugin's settings, so nothing is installed by itself until they are back on.
        </Text>
      ) : null}
      {ready && settings.values.pinnedVersion !== "" ? (
        <Text style={{ color: theme.colors.statusWarning, fontSize: 13 }}>
          Pinned at {settings.values.pinnedVersion} in this plugin's settings, so newer versions are not installed.{" "}
          {on && settings.values.enabled
            ? "If another version is installed, the next scheduled check moves to the pinned one."
            : "If another version is installed, the next check tells you, and Update now moves to the pinned one."}
        </Text>
      ) : null}
      <Text style={styles.muted}>{AUTO_UPDATE_SAFETY}</Text>
    </View>
  );
}

/**
 * The "Show in the sidebar" switch, beside the auto-update one. It is the
 * same setting as the one on the settings screen. Once it is saved the status
 * is read again, so the row goes or comes back at once.
 */
function SidebarCard({ theme, styles, settings }: { theme: PluginTheme; styles: Styles; settings: Settings }) {
  const toast = useToast();
  const refreshStatus = useRefreshStatus();

  // A settings file that cannot be read is told by the auto-update card above.
  if (settings.status === "error" || settings.status === "invalid") return null;

  const ready = settings.status === "ready";
  const on = ready && settings.values.showInSidebar;
  const off = !ready || settings.saving;
  async function flip(): Promise<void> {
    if (settings.status !== "ready") return;
    const { revision } = settings;
    const saved = await saveShowInSidebar((values) => settings.save(values, revision), settings.values, !on, refreshStatus);
    if (!saved) toast.error("Could not save the setting.");
  }

  return (
    <View style={styles.card}>
      <Toggle
        theme={theme}
        styles={styles}
        label={SIDEBAR_LABEL}
        state={!ready ? "…" : settings.saving ? "Saving…" : on ? "On" : "Off"}
        on={on}
        disabled={off}
        onPress={() => void flip()}
      />
      {ready ? <Text style={styles.value}>{on ? SIDEBAR_ON : SIDEBAR_OFF}</Text> : null}
      {ready && !on && !settings.values.desktopNotifications ? (
        <Text style={{ color: theme.colors.statusWarning, fontSize: 13 }}>{SIDEBAR_QUIET}</Text>
      ) : null}
    </View>
  );
}

/**
 * The notes for the update that is waiting or the last one, cut to length,
 * and the way to the full notes. The link is there whether or not the notes
 * could be read.
 */
function ReleaseNotesCard({
  theme,
  styles,
  notes,
  installed,
}: {
  theme: PluginTheme;
  styles: Styles;
  notes: ReleaseNotes | null;
  installed: string | null;
}) {
  const toast = useToast();
  // Paseo 0.10.3 may not give plugins this; the address below can be copied either way.
  const canOpen = typeof openExternalUrl === "function";
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Release notes</Text>
      {notes === null ? (
        <Text style={styles.muted}>Not read yet. They are read right after a check.</Text>
      ) : (
        <>
          <Text style={styles.muted}>{notesSummary(notes, installed)}</Text>
          {notes.error !== null ? <Text style={{ color: theme.colors.statusWarning, fontSize: 13 }}>{notes.error}</Text> : null}
          {notes.versions.map((version) => (
            <View key={version.version} style={{ gap: 4 }}>
              <Text style={[styles.value, { fontWeight: "600" }]}>{version.version}</Text>
              {version.items.map((item, index) => (
                <Text key={index} style={styles.value}>
                  • {item}
                </Text>
              ))}
              {version.moreItems > 0 ? <Text style={styles.muted}>{moreItemsText(version.moreItems)}</Text> : null}
            </View>
          ))}
          {notes.moreVersions > 0 ? <Text style={styles.muted}>{moreVersionsText(notes.moreVersions)}</Text> : null}
        </>
      )}
      {canOpen ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Open the full Claude Code release notes"
            style={styles.quietButton}
            onPress={() =>
              void Promise.resolve()
                .then(() => openExternalUrl(RELEASE_NOTES_URL))
                .catch(() => toast.error("Could not open the release notes."))
            }
          >
            <Text style={styles.quietButtonText}>Full release notes</Text>
          </Pressable>
        </View>
      ) : null}
      <Text selectable style={styles.muted}>
        All releases: {RELEASE_NOTES_URL}
      </Text>
    </View>
  );
}

export function StatusSurface({ theme, layout }: PluginSurfaceProps) {
  const styles = useStyles(theme, layout.compact);
  const queryClient = useQueryClient();
  const dismiss = useRpc(dismissAttention);
  const check = useCheck();
  const settings = useSettings(updateSettings);
  const { busy, active, checkLabel, updateLabel, line } = check.view;
  const { result, now } = check;

  const clear = useMutation({
    mutationFn: () => dismiss({}),
    onMutate: () => queryClient.cancelQueries({ queryKey: STATUS_QUERY_KEY }),
    onSuccess(next) {
      queryClient.setQueryData(STATUS_QUERY_KEY, next);
    },
  });

  if (check.loading) {
    return (
      <View style={[styles.screen, styles.content]}>
        <Text style={styles.muted}>Loading…</Text>
      </View>
    );
  }
  // A poll that fails while there is something to show leaves it showing; the next one tries again.
  if (check.data === undefined) {
    return (
      <View style={[styles.screen, styles.content]}>
        <Text style={styles.heading}>Claude Code updates</Text>
        <Text style={{ color: theme.colors.statusDanger }}>{check.error ?? "Could not read the update status."}</Text>
      </View>
    );
  }

  const data = check.data;
  const last = lastResult(data);
  const staleText = staleProcessesText(data);
  const lastUpdate = lastUpdateText(data, now);
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

      {/* First on the page, under a notice if there is one: whether the plugin is working, and the button to find out now. */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Checks</Text>
        <Row styles={styles} label="Last checked">
          {lastCheckText(data, now)}
        </Row>
        <View style={styles.row}>
          <Text style={styles.label}>Last result</Text>
          <Text style={[styles.value, { color: toneColor(theme, outcomeTone(data.lastOutcome)) }]}>{last.label}</Text>
        </View>
        {line !== null ? (
          <View style={styles.progress} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <Text style={styles.value}>{line}</Text>
          </View>
        ) : result !== null ? (
          <Text style={[styles.value, { color: toneColor(theme, result.tone) }]} accessibilityLiveRegion="polite">
            Finished {relativeTime(new Date(result.at).toISOString(), now)}: {result.message}
          </Text>
        ) : last.detail !== null ? (
          <Text style={styles.muted}>{last.detail}</Text>
        ) : null}
        <Row styles={styles} label="Last update">
          {lastUpdate ?? "none yet"}
        </Row>
        <Row styles={styles} label="Next scheduled check">
          {nextCheckText(data, now)}
        </Row>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check for a Claude Code update now, without installing it"
            accessibilityState={{ disabled: busy, busy: active === "check" }}
            disabled={busy}
            style={[styles.button, busy && active !== "check" ? styles.disabled : null]}
            onPress={() => check.run("check")}
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
            onPress={() => check.run("update")}
          >
            {active === "update" ? <ActivityIndicator size="small" color={theme.colors.foreground} /> : null}
            <Text style={styles.quietButtonText}>{updateLabel}</Text>
          </Pressable>
        </View>
        <Text style={styles.muted}>{CHECK_NOW_HINT}</Text>
      </View>

      <AutoUpdateCard theme={theme} styles={styles} settings={settings} />
      <SidebarCard theme={theme} styles={styles} settings={settings} />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Versions</Text>
        <Row styles={styles} label="Installed">
          {data.installedVersion ?? "not checked yet"}
        </Row>
        <Row styles={styles} label="Target">
          {data.targetVersion ?? "not checked yet"}
        </Row>
        <Row styles={styles} label="Claude Code channel">
          {data.claudeChannel ?? "unreadable"}
        </Row>
      </View>

      <ReleaseNotesCard theme={theme} styles={styles} notes={data.releaseNotes} installed={data.installedVersion} />

      {data.rollbackCommand !== null ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Roll back</Text>
          <Text style={styles.muted}>
            The last update replaced {data.previousVersion}. To return to it, pin it in this plugin's settings and press Update
            now, or run this in a terminal{data.autoInstall ? " (and pin it, or the next scheduled check updates again)" : ""}:
          </Text>
          <Text selectable style={styles.code}>
            {data.rollbackCommand}
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Still on an older version</Text>
        {staleText !== null ? (
          <Text style={styles.muted}>{staleText}</Text>
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
