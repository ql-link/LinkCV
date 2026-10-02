import { describe, expect, it } from "vitest";
import { describeOfferGap, formatOfferSalary } from "./offerCompare";

const offer = (salary: string | null, currency: string | null = "CNY", period: "hour" | "day" | "month" | "year" | null = "month") => ({
  offer_salary: salary,
  offer_salary_currency: currency,
  offer_salary_period: period,
});

describe("formatOfferSalary", () => {
  it("人民币过千显示为 K，并带计薪周期", () => {
    expect(formatOfferSalary(offer("32000"))).toBe("32K/月");
    expect(formatOfferSalary(offer("32500.00", "CNY", "year"))).toBe("32.5K/年");
  });

  it("人民币不足千与其他币种保留金额和符号", () => {
    expect(formatOfferSalary(offer("800", "CNY", "day"))).toBe("¥800/日");
    expect(formatOfferSalary(offer("120", "USD", "hour"))).toBe("$120/时");
    expect(formatOfferSalary(offer("50000", "CHF", "year"))).toBe("50000 CHF/年");
  });

  it("没有薪资时提示待填", () => {
    expect(formatOfferSalary(offer(null))).toBe("薪资待填");
    expect(formatOfferSalary(offer("0"))).toBe("薪资待填");
  });
});

describe("describeOfferGap", () => {
  it("币种和周期相同才比较，按较高者为基数取整", () => {
    expect(describeOfferGap([offer("32000"), offer("30000")])).toBe("薪资相差 6%");
    expect(describeOfferGap([offer("30000"), offer("30000")])).toBe("薪资持平");
  });

  it("币种、周期不同或缺薪资时不下结论", () => {
    expect(describeOfferGap([offer("32000"), offer("30000", "USD")])).toBeNull();
    expect(describeOfferGap([offer("32000"), offer("30000", "CNY", "year")])).toBeNull();
    expect(describeOfferGap([offer("32000"), offer(null)])).toBeNull();
    expect(describeOfferGap([offer("32000")])).toBeNull();
  });
});
