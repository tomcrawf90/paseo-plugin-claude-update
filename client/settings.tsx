import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
  type SettingsInputHandle,
} from "@getpaseo/plugin/client/ui";
import { useRef, useState } from "react";

import {
  AUTO_UPDATE_LABEL,
  AUTO_UPDATE_OFF,
  AUTO_UPDATE_ON,
  AUTO_UPDATE_SAFETY,
  autoUpdateOn,
  MAX_INTERVAL_HOURS,
  MIN_INTERVAL_HOURS,
  updateSettings,
  withAutoUpdate,
  type Channel,
  type UpdateSettings,
} from "../shared/settings";
import { isExactVersion } from "../shared/version";

const CHANNEL_OPTIONS: readonly { label: string; value: Channel }[] = [
  { label: "latest", value: "latest" },
  { label: "stable", value: "stable" },
];

export function UpdateSettingsScreen(_props: PluginSurfaceProps) {
  const settings = useSettings(updateSettings);
  const toast = useToast();
  const intervalRef = useRef<SettingsInputHandle>(null);
  const pinRef = useRef<SettingsInputHandle>(null);
  const pathRef = useRef<SettingsInputHandle>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  if (settings.status === "loading") return null;
  if (settings.status === "error" || settings.status === "invalid") {
    return (
      <SettingsSection title="Claude Code updates">
        <SettingsCard>
          <SettingsRow label="Settings could not be read" error={settings.error} />
          <SettingsAction label="Try again" actionLabel="Reload" onPress={() => void settings.reload()} />
          {settings.status === "invalid" ? (
            <SettingsAction label="Restore the defaults" actionLabel="Reset" onPress={() => void settings.reset()} />
          ) : null}
        </SettingsCard>
      </SettingsSection>
    );
  }

  const { values, revision, saving, saveError, save } = settings;

  async function apply(patch: Partial<UpdateSettings>): Promise<void> {
    const ok = await save({ ...values, ...patch }, revision);
    if (!ok) toast.error("Could not save the settings.");
  }

  async function saveText(): Promise<void> {
    const hours = Number((intervalRef.current?.getText() ?? "").trim());
    const pin = (pinRef.current?.getText() ?? "").trim();
    const path = (pathRef.current?.getText() ?? "").trim();
    if (!Number.isFinite(hours) || hours < MIN_INTERVAL_HOURS || hours > MAX_INTERVAL_HOURS) {
      setDraftError(`Check every ${MIN_INTERVAL_HOURS} to ${MAX_INTERVAL_HOURS} hours.`);
      return;
    }
    if (pin !== "" && !isExactVersion(pin)) {
      setDraftError("A pinned version is exact, such as 2.1.285, or empty.");
      return;
    }
    setDraftError(null);
    const ok = await save({ ...values, intervalHours: hours, pinnedVersion: pin, claudePath: path }, revision);
    if (ok) toast.show("Settings saved.", { variant: "success" });
    else toast.error("Could not save the settings.");
  }

  return (
    <>
      <SettingsSection
        title="Claude Code updates"
        info="Claude Code only updates itself from its terminal interface. Paseo runs it without one, so this plugin runs the CLI's own updater on a schedule. It stays out of the sidebar until there is something to act on; open its status page from the Command Center with “Claude Code updates: open status”."
      >
        <SettingsCard>
          <SettingsSwitch
            label={AUTO_UPDATE_LABEL}
            hint={`${autoUpdateOn(values) ? AUTO_UPDATE_ON : AUTO_UPDATE_OFF} ${AUTO_UPDATE_SAFETY}`}
            value={autoUpdateOn(values)}
            disabled={saving}
            onValueChange={(on) => void apply(withAutoUpdate(values, on))}
          />
          <SettingsSwitch
            label="Check on a schedule"
            hint="Off stops every scheduled check, so nothing is found or installed by itself. Check now and Update now still work."
            value={values.enabled}
            disabled={saving}
            onValueChange={(enabled) => void apply({ enabled })}
          />
          <SettingsSelect
            label="Channel"
            hint="Must match Claude Code's own autoUpdatesChannel (latest unless you changed it), which is what “claude update” follows."
            value={values.channel}
            options={CHANNEL_OPTIONS}
            disabled={saving}
            onValueChange={(channel) => void apply({ channel })}
          />
          <SettingsSwitch
            label="Desktop notifications"
            hint="A macOS notification after an update, after an update that failed, and after three failed checks in a row."
            value={values.desktopNotifications}
            disabled={saving}
            onValueChange={(desktopNotifications) => void apply({ desktopNotifications })}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Schedule, pin and path">
        <SettingsCard>
          <SettingsInput
            ref={intervalRef}
            label="Check every (hours)"
            hint={`${MIN_INTERVAL_HOURS} to ${MAX_INTERVAL_HOURS}.`}
            initialValue={String(values.intervalHours)}
            onChangeText={() => setDraftError(null)}
          />
          <SettingsInput
            ref={pinRef}
            label="Pinned version"
            hint="Hold the CLI at one exact version with “claude install <version>”. Empty follows the channel."
            initialValue={values.pinnedVersion}
            placeholder="none"
            onChangeText={() => setDraftError(null)}
          />
          <SettingsInput
            ref={pathRef}
            label="Path to claude"
            hint="Empty looks in ~/.local/bin, then on PATH."
            initialValue={values.claudePath}
            placeholder="found automatically"
            onChangeText={() => setDraftError(null)}
          />
          <SettingsAction
            label="Save schedule, pin and path"
            error={draftError ?? saveError}
            actionLabel={saving ? "Saving…" : "Save"}
            disabled={saving}
            onPress={() => void saveText()}
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
