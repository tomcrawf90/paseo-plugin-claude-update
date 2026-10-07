import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const OUTCOMES = [
  "up-to-date",
  "updated",
  "update-available",
  "pinned",
  "pin-applied",
  "pin-mismatch",
  "channel-mismatch",
  "failed",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Something the user has not seen yet; cleared when they dismiss it. */
export const attentionSchema = z.object({
  kind: z.enum(["updated", "update-available", "failed", "pin-mismatch", "channel-mismatch"]),
  message: z.string(),
  at: z.string(),
});
export type Attention = z.infer<typeof attentionSchema>;

export const historyEntrySchema = z.object({
  at: z.string(),
  trigger: z.enum(["schedule", "manual"]),
  outcome: z.enum(OUTCOMES),
  from: z.string().nullable(),
  to: z.string().nullable(),
  target: z.string().nullable(),
  message: z.string(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const processSchema = z.object({
  pid: z.number(),
  version: z.string().nullable(),
  /** `agent` is a Paseo agent; `daemon` is Claude's own background daemon; `other` is anything else. */
  kind: z.enum(["agent", "daemon", "other"]),
  agentId: z.string().nullable(),
  title: z.string().nullable(),
  startedAt: z.string().nullable(),
});
export type ClaudeProcess = z.infer<typeof processSchema>;

export const statusSchema = z.object({
  claudePath: z.string().nullable(),
  installedVersion: z.string().nullable(),
  targetVersion: z.string().nullable(),
  /** Claude Code's own `autoUpdatesChannel`, which decides what `claude update` installs. */
  claudeChannel: z.string().nullable(),
  lastCheckAt: z.string().nullable(),
  nextCheckAt: z.string().nullable(),
  lastOutcome: z.enum(OUTCOMES).nullable(),
  lastMessage: z.string().nullable(),
  consecutiveFailures: z.number(),
  /** The version before the last successful update, for `claude install <version>`. */
  previousVersion: z.string().nullable(),
  rollbackCommand: z.string().nullable(),
  attention: attentionSchema.nullable(),
  checking: z.boolean(),
  staleProcesses: z.array(processSchema),
  processListSupported: z.boolean(),
  history: z.array(historyEntrySchema),
  dataDirectory: z.string(),
});
export type Status = z.infer<typeof statusSchema>;

export const getStatus = defineRpc({
  name: "status.get",
  input: z.object({}),
  output: statusSchema,
});

/** Checks now, ignoring the schedule and any failure backoff. `apply` installs even in notify mode. */
export const checkNow = defineRpc({
  name: "status.check",
  input: z.object({ apply: z.boolean().default(false) }),
  output: statusSchema,
});

export const dismissAttention = defineRpc({
  name: "status.dismiss",
  input: z.object({}),
  output: statusSchema,
});
