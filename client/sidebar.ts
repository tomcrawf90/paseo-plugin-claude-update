export interface SidebarRow {
  title: string;
  icon: string;
}

/** What Paseo hands back for a registered row: call it to take the row away. */
type Remover = () => void | Promise<void>;

export interface SidebarRowController {
  /** Asks for the row to read like this. Returns at once; the change is made in order. */
  show(row: SidebarRow): void;
  /** Resolves when every change asked for so far has been made. */
  settled(): Promise<void>;
  /** Stops making changes. The row itself is Paseo's to remove when the plugin stops. */
  dispose(): void;
}

const key = (row: SidebarRow): string => `${row.title}|${row.icon}`;

/**
 * Keeps one sidebar row and changes its title and icon by taking the row away
 * and adding it again under the same id. Changes run one at a time, each
 * waiting for the old row to be gone, so two changes close together can never
 * leave two rows. If the old row cannot be removed it stays as it is; if the
 * new one cannot be added the plain row is put back. Either way the failure
 * is reported and the next `show` tries again.
 */
export function createSidebarRow(
  add: (row: SidebarRow) => Remover,
  base: SidebarRow,
  report: (message: string, error: unknown) => void = (message, error) => console.error(message, error),
): SidebarRowController {
  let remove: Remover | null = null;
  let shown: string | null = null;
  let wanted = base;
  let queue: Promise<void> = Promise.resolve();
  let disposed = false;

  function put(row: SidebarRow): void {
    remove = add(row);
    shown = key(row);
  }

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
    if (disposed) return;
    try {
      put(target);
    } catch (error) {
      // The old row is gone and the new one was refused: put the plain one back.
      report("[claude-update] could not change the sidebar row:", error);
      try {
        put(base);
      } catch (again) {
        report("[claude-update] could not restore the sidebar row:", again);
      }
    }
  }

  // The first row is added while the plugin's entry runs.
  try {
    put(base);
  } catch (error) {
    report("[claude-update] could not add the sidebar row:", error);
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
