import { describe, expect, it } from "vitest";
import { splitEmailList } from "@/lib/email-list";

describe("splitEmailList", () => {
  it("splits on commas, semicolons and whitespace", () => {
    expect(splitEmailList("a@example.com, b@example.com;c@example.com\nd@example.com")).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
      "d@example.com",
    ]);
  });

  it("drops blanks and case-insensitive duplicates", () => {
    expect(splitEmailList(" , A@Example.com ,, a@example.com ")).toEqual(["a@example.com"]);
    expect(splitEmailList("")).toEqual([]);
  });
});
