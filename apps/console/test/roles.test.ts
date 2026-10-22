import { describe, expect, it } from "vitest";
import { canChangeOperatorStatus, canOperate } from "@/lib/roles";

const op = (id: string, role: string) => ({ id, role });

describe("canOperate", () => {
  it("allows OPERATOR and nobody else", () => {
    expect(canOperate(op("1", "OPERATOR"))).toBe(true);
    expect(canOperate(op("1", "SUPPORT"))).toBe(false);
    expect(canOperate(op("1", "operator"))).toBe(false);
    expect(canOperate(null)).toBe(false);
  });
});

describe("canChangeOperatorStatus", () => {
  it("lets an OPERATOR change someone else", () => {
    expect(canChangeOperatorStatus(op("a", "OPERATOR"), { id: "b" })).toBe(true);
  });

  it("never lets anyone change themselves", () => {
    expect(canChangeOperatorStatus(op("a", "OPERATOR"), { id: "a" })).toBe(false);
  });

  it("never offers it to SUPPORT (the API would 403)", () => {
    expect(canChangeOperatorStatus(op("a", "SUPPORT"), { id: "b" })).toBe(false);
  });
});
