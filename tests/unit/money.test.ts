import { describe, it, expect } from "vitest";
import { formatMoney, formatUnitPrice, formatQty, formatPct, parseMoneyToMinor, lineTotalMinor } from "@/server/shared/money";

describe("money formatting (SPEC B.6, DESIGN §5.13)", () => {
  it("totals: 2 dp grouped", () => {
    expect(formatMoney({ minor: 674000, currency: "USD" })).toBe("$6,740.00");
    expect(formatMoney({ minor: 186000, currency: "USD" })).toBe("$1,860.00");
    expect(formatMoney({ minor: 54000, currency: "USD" })).toBe("$540.00");
    expect(formatMoney({ minor: -1250, currency: "USD" })).toBe("−$12.50");
    expect(formatMoney({ minor: 25400, currency: "CNY" })).toBe("¥254.00");
  });
  it("unit prices: 2 dp ≥ 1, up to 4 dp below with trailing zeros trimmed (never below 2)", () => {
    expect(formatUnitPrice({ minorE2: 539, currency: "USD", unit: "pcs" })).toBe("$0.0539 / pcs");
    expect(formatUnitPrice({ minorE2: 620, currency: "USD" })).toBe("$0.062");
    expect(formatUnitPrice({ minorE2: 2600, currency: "USD", unit: "pair" })).toBe("$0.26 / pair");
    expect(formatUnitPrice({ minorE2: 89000, currency: "USD", unit: "set" })).toBe("$8.90 / set");
    expect(formatUnitPrice({ minorE2: 500, currency: "USD" }, { decimals: 4 })).toBe("$0.0500");
    expect(formatUnitPrice({ minorE2: 599900, currency: "USD" })).toBe("$59.99");
    expect(formatUnitPrice({ minorE2: 1830000, currency: "USD" })).toBe("$183.00");
  });
  it("quantities, percentages, parsing, line totals", () => {
    expect(formatQty(100000, "pcs")).toBe("100,000 pcs");
    expect(formatPct(70)).toBe("70 %");
    expect(formatPct(4.2, { signed: true })).toBe("+4.2 %");
    expect(formatPct(-1.1)).toBe("−1.1 %");
    expect(parseMoneyToMinor("1234.56")).toBe(123456);
    expect(parseMoneyToMinor("1,234.56")).toBe(123456);
    expect(parseMoneyToMinor("abc")).toBeNull();
    expect(lineTotalMinor(100000, 620)).toBe(620000); // 100,000 × $0.062 = $6,200.00
    expect(lineTotalMinor(1000, 75200)).toBe(752000);
  });
});
