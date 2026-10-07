import { describe, expect, it } from "vitest";

import { createSidebarRow, type SidebarRow } from "./sidebar";

const AVAILABLE: SidebarRow = { title: "Claude Code update available", icon: "CircleArrowUp" };
const UPDATED: SidebarRow = { title: "Claude Code updated", icon: "CircleCheck" };

/** A pretend sidebar: rows are added at once and removed a moment after being asked, as over a bridge. */
function sidebar() {
  const fake = {
    rows: [] as SidebarRow[],
    most: 0,
    adds: 0,
    failAdd: null as SidebarRow | null,
    failRemove: false,
    add(row: SidebarRow) {
      if (fake.failAdd !== null && row.title === fake.failAdd.title) throw new Error("add refused");
      fake.adds += 1;
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
  it("is not there to begin with, nor after being told there is nothing to say", async () => {
    const fake = sidebar();
    const row = createSidebarRow(fake.add);
    expect(fake.rows).toEqual([]);
    row.show(null);
    await row.settled();
    expect(fake.rows).toEqual([]);
    expect(fake.adds).toBe(0);
  });

  it("appears when there is news and goes when the news is dismissed", async () => {
    const fake = sidebar();
    const row = createSidebarRow(fake.add);
    row.show(AVAILABLE);
    await row.settled();
    expect(fake.rows).toEqual([AVAILABLE]);
    row.show(null);
    await row.settled();
    expect(fake.rows).toEqual([]);
    row.show(UPDATED);
    await row.settled();
    expect(fake.rows).toEqual([UPDATED]);
    expect(fake.most).toBe(1);
  });

  it("ends as one row after two changes close together", async () => {
    const fake = sidebar();
    const row = createSidebarRow(fake.add);
    row.show(AVAILABLE);
    row.show(UPDATED);
    await row.settled();
    expect(fake.rows).toEqual([UPDATED]);
    expect(fake.most).toBe(1);
  });

  it("ends with no row when shown and hidden close together", async () => {
    const fake = sidebar();
    const row = createSidebarRow(fake.add);
    row.show(AVAILABLE);
    await row.settled();
    row.show(UPDATED);
    row.show(null);
    row.show(AVAILABLE);
    row.show(null);
    await row.settled();
    expect(fake.rows).toEqual([]);
    expect(fake.most).toBe(1);
  });

  it("does nothing when asked for what it already shows", async () => {
    const fake = sidebar();
    const row = createSidebarRow(fake.add);
    row.show(AVAILABLE);
    row.show(AVAILABLE);
    await row.settled();
    row.show({ ...AVAILABLE });
    await row.settled();
    expect(fake.adds).toBe(1);
    expect(fake.rows).toEqual([AVAILABLE]);
  });

  it("has no row when the new one is refused, says so, and tries again at the next change", async () => {
    const fake = sidebar();
    const reports: string[] = [];
    const row = createSidebarRow(fake.add, (message) => reports.push(message));
    fake.failAdd = AVAILABLE;
    row.show(AVAILABLE);
    await row.settled();
    expect(fake.rows).toEqual([]);
    expect(reports).toHaveLength(1);
    fake.failAdd = null;
    row.show(AVAILABLE);
    await row.settled();
    expect(fake.rows).toEqual([AVAILABLE]);
  });

  it("leaves the old row alone when it cannot be removed, and tries again at the next change", async () => {
    const fake = sidebar();
    const reports: string[] = [];
    const row = createSidebarRow(fake.add, (message) => reports.push(message));
    row.show(AVAILABLE);
    await row.settled();
    fake.failRemove = true;
    row.show(UPDATED);
    await row.settled();
    row.show(null);
    await row.settled();
    expect(fake.rows).toEqual([AVAILABLE]);
    expect(fake.most).toBe(1);
    expect(reports).toHaveLength(2);
    fake.failRemove = false;
    row.show(null);
    await row.settled();
    expect(fake.rows).toEqual([]);
  });

  it("changes nothing once disposed", async () => {
    const fake = sidebar();
    const row = createSidebarRow(fake.add);
    row.show(AVAILABLE);
    await row.settled();
    row.dispose();
    row.show(null);
    row.show(UPDATED);
    await row.settled();
    expect(fake.rows).toEqual([AVAILABLE]);
  });
});
