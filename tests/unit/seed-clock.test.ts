import { describe, it, expect } from "vitest";
import { seedShiftDays, shiftDay, seedClockIso, SEED_BASE_DAY } from "@/db/seed-clock";

describe("today-relative seed clock", () => {
  it("SEED_SHIFT_DAYS wins over the clock", () => {
    expect(seedShiftDays({ SEED_SHIFT_DAYS: "0" }, new Date("2027-03-01T12:00:00Z"))).toBe(0);
    expect(seedShiftDays({ SEED_SHIFT_DAYS: " 35 " }, new Date("2020-01-01T00:00:00Z"))).toBe(35);
    expect(seedShiftDays({ SEED_SHIFT_DAYS: "-7" })).toBe(-7);
    expect(() => seedShiftDays({ SEED_SHIFT_DAYS: "1.5" })).toThrow(/whole number/);
  });

  it("unset → whole UTC days from 28 Sep 2026 to the wall clock (time of day ignored)", () => {
    expect(seedShiftDays({}, new Date("2026-09-28T00:00:00Z"))).toBe(0);
    expect(seedShiftDays({}, new Date("2026-09-28T23:59:59Z"))).toBe(0);
    expect(seedShiftDays({}, new Date("2026-09-29T00:00:01Z"))).toBe(1);
    expect(seedShiftDays({}, new Date("2027-09-28T09:00:00Z"))).toBe(365);
  });

  it("a pinned SEED_CLOCK is the reference day when no shift is given", () => {
    expect(seedShiftDays({ SEED_CLOCK: "2026-10-05T15:00:00Z" }, new Date("2030-01-01"))).toBe(7);
    expect(seedShiftDays({ SEED_CLOCK: "not a date" }, new Date("2026-09-30T08:00:00Z"))).toBe(2);
  });

  it("shiftDay is calendar arithmetic across months, years and DST", () => {
    expect(shiftDay("2026-09-25", 0)).toBe("2026-09-25");
    expect(shiftDay("2026-10-24", 2)).toBe("2026-10-26"); // EU DST ends 25 Oct
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2028-03-01", -1)).toBe("2028-02-29");
    expect(() => shiftDay("25 Sep 2026", 1)).toThrow();
  });

  it("the seed's now is 09:00 UTC on the shifted base day", () => {
    expect(seedClockIso(0)).toBe(`${SEED_BASE_DAY}T09:00:00Z`);
    expect(seedClockIso(7)).toBe("2026-10-05T09:00:00Z");
  });
});
