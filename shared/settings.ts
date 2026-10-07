import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const CHANNELS = ["latest", "stable"] as const;
export type Channel = (typeof CHANNELS)[number];

export const MODES = ["auto", "notify"] as const;
export type Mode = (typeof MODES)[number];

export const MIN_INTERVAL_HOURS = 1;
export const MAX_INTERVAL_HOURS = 168;
export const DEFAULT_INTERVAL_HOURS = 4;

export const updateSettings = defineSettings({
  id: "update",
  scope: "host",
  version: 1,
  schema: z.object({
    /** The disable switch: off means no scheduled checks at all. */
    enabled: z.boolean().default(true),
    /** `auto` installs updates; `notify` only reports that one is available. */
    mode: z.enum(MODES).default("auto"),
    /** The release channel the installed version is compared against. */
    channel: z.enum(CHANNELS).default("latest"),
    intervalHours: z.number().min(MIN_INTERVAL_HOURS).max(MAX_INTERVAL_HOURS).default(DEFAULT_INTERVAL_HOURS),
    /** An exact version to hold the CLI at, or empty to follow the channel. */
    pinnedVersion: z
      .string()
      .regex(/^(\d+\.\d+\.\d+)?$/, "Use an exact version such as 2.1.285, or leave empty")
      .default(""),
    /** Absolute path to the `claude` launcher, or empty to find it. */
    claudePath: z.string().max(1024).default(""),
    /** Raise an operating-system notification for updates and repeated failures (macOS only). */
    desktopNotifications: z.boolean().default(true),
  }),
});

export type UpdateSettings = z.infer<typeof updateSettings.schema>;

export const DEFAULT_SETTINGS: UpdateSettings = updateSettings.schema.parse({});
