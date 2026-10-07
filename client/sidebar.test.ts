import { describe, expect, it } from "vitest";

import { createSidebarRow, type SidebarRow } from "./sidebar";

const BASE: SidebarRow = { title: "Claude Code updates", icon: "RefreshCw" };
const AVAILABLE: SidebarRow = { title: "Claude Code update available", icon: "CircleArrowUp" };
const UPDATED: SidebarRow = { title: "Claude Code updated", icon: "CircleCheck" };

/** A pretend sidebar: rows are added at once and removed a moment after being asked, as over a bridge. */
function sidebar() {
  const fake = {
    rows: [] as SidebarRow[],
    most: 0,
    failAdd: null as SidebarRow | null,
    failRemove: false,
    add(row: SidebarRow) {
      if (fake.failAdd !== null && row.title === fake.failAdd.title) throw new Error("add refused");
      fake.rows.push(row);
      fake.most = Math.max(fake.most, fake.rows.length);
      return async () => {
        await Promise.resolve();
        if (fake.failRemove) throw new Error("remove refused");
        fake.rows = fake.rows.filter((other) => other !== row);
      };
    },
  };
  return fake;
}

describe("the sidebar row", () => {
  it("is there from the start", () => {
    const fake = sidebar();
    createSidebarRow(fake.add, BASE);
    expect(fake.rows).toEqual([BASE]);
  });

  it("ends as one row after two changes close together", async () => {
    const fake = sidebar();
    const row = createSidebarRow(fake.add, BASE);
    row.show(AVAILABLE);
    row.show(UPDATED);
    await row.settled();
    expect(fake.rows).toEqual([UPDATED]);
    expect(fake.most).toBe(1);
  });

  it("does nothing when asked for what it already shows", async () => {
    const fake = sidebar();
    let adds = 0;
    const row = createSidebarRow((item) => {
      adds += 1;
      return fake.add(item);
    }, BASE);
    row.show(BASE);
    row.show(AVAILABLE);
    row.show(AVAILABLE);
    await row.settled();
    expect(adds).toBe(2);
    expect(fake.rows).toEqual([AVAILABLE]);
  });

  it("puts the plain row back and says so when a change fails, then tries again", async () => {
    const fake = sidebar();
    const reports: string[] = [];
    const row = createSidebarRow(fake.add, BASE, (message) => void reports.push(message));
    fake.failAdd = AVAILABLE;
    row.show(AVAILABLE);
    await row.settled();
    expect(fake.rows).toEqual([BASE]);
    expect(reports).toHaveLength(1);
    fake.failAdd = null;
    row.show(AVAILABLE);
    await row.settled();
    expect(fake.rows).toEqual([AVAILABLE]);
    expect(fake.most).toBe(1);
  });

  it("keeps working after a row could not be removed", async () => {
    const fake = sidebar();
    const reports: string[] = [];
    const row = createSidebarRow(fake.add, BASE, (message) => void reports.push(message));
    fake.failRemove = true;
    row.show(AVAILABLE);
    await row.settled();
    expect(reports).toHaveLength(1);
    // The old row is still there, alone: nothing was added beside it.
    expect(fake.rows).toEqual([BASE]);
    fake.failRemove = false;
    row.show(UPDATED);
    await row.settled();
    expect(fake.rows).toEqual([UPDATED]);
    expect(fake.most).toBe(1);
  });

  it("changes nothing once disposed", async () => {
    const fake = sidebar();
    const row = createSidebarRow(fake.add, BASE);
    row.dispose();
    row.show(UPDATED);
    await row.settled();
    expect(fake.rows).toEqual([BASE]);
  });
});
