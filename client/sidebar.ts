import type { UpdateSettings } from "../shared/settings";

export interface SidebarRow {
  title: string;
  icon: string;
}

/** What Paseo hands back for a registered row: call it to take the row away. */
type Remover = () => void | Promise<void>;

export interface SidebarRowController {
  /** Asks for the row to read like this, or with `null` for no row at all. Returns at once; the change is made in order. */
  show(row: SidebarRow | null): void;
  /** Resolves when every change asked for so far has been made. */
  settled(): Promise<void>;
  /** Stops making changes. The row itself is Paseo's to remove when the plugin stops. */
  dispose(): void;
}

const key = (row: SidebarRow | null): string | null => (row === null ? null : `${row.title}|${row.icon}`);

/**
 * Keeps at most one sidebar row. There is none until the first `show`; the
 * entry asks for one at once and keeps it, and `show(null)` takes it away. Its
 * title and icon change by taking the row away and adding it again under the
 * same id. Changes run one at a time, each waiting for the old row to be
 * gone, so two changes close together can never leave two rows. If the old
 * row cannot be removed it stays as it is and nothing is added beside it; if
 * the new one cannot be added there is no row. Either way the failure is
 * reported and the next `show` tries again.
 */
export function createSidebarRow(
  add: (row: SidebarRow) => Remover,
  report: (message: string, error: unknown) => void = (message, error) => console.error(message, error),
): SidebarRowController {
  let remove: Remover | null = null;
  let shown: string | null = null;
  let wanted: SidebarRow | null = null;
  let queue: Promise<void> = Promise.resolve();
  let disposed = false;

  async function swap(): Promise<void> {
    if (disposed || key(wanted) === shown) return;
    // Read here, not when the change was asked for: an earlier change in the
    // queue may have replaced the row since.
    const target = wanted;
    const old = remove;
    if (old !== null) {
      try {
        await old();
      } catch (error) {
        // The old row is still there: add nothing beside it. Its remover is
        // kept, so the next `show` tries the removal again.
        report("[claude-update] could not remove the sidebar row:", error);
        return;
      }
    }
    remove = null;
    shown = null;
    if (disposed || target === null) return;
    try {
      remove = add(target);
      shown = key(target);
    } catch (error) {
      // The old row is gone and the new one was refused: no row until the next change.
      report("[claude-update] could not add the sidebar row:", error);
    }
  }

  return {
    show(row) {
      wanted = row;
      queue = queue.then(swap);
    },
    settled: () => queue,
    dispose() {
      disposed = true;
    },
  };
}

/**
 * Saves the "Show in the sidebar" switch, nothing else changed, and once it
 * is saved has the status read again: the row follows the status, so it goes
 * or comes back at once rather than at the next read. A save that fails
 * changes nothing and reads nothing.
 */
export async function saveShowInSidebar(
  save: (values: UpdateSettings) => Promise<boolean>,
  values: UpdateSettings,
  on: boolean,
  refreshStatus: () => void,
): Promise<boolean> {
  const saved = await save({ ...values, showInSidebar: on });
  if (saved) refreshStatus();
  return saved;
}
