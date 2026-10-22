// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { THEME_PRESETS, applyBrandColor, normalizeHex } from "@/lib/brand-theme";

const root = () => document.documentElement.style;

afterEach(() => applyBrandColor(null));

describe("normalizeHex", () => {
  it("accepts six-digit hex with or without #, any case", () => {
    expect(normalizeHex("0F4C81")).toBe("#0f4c81");
    expect(normalizeHex(" #ABCDEF ")).toBe("#abcdef");
  });

  it("rejects everything else", () => {
    for (const bad of ["", "#fff", "red", "#12345g", "#1234567", null, undefined]) {
      expect(normalizeHex(bad)).toBeNull();
    }
  });
});

describe("applyBrandColor", () => {
  it("sets --primary and picks white text on a dark colour", () => {
    applyBrandColor("#0f4c81");
    expect(root().getPropertyValue("--primary")).toBe("#0f4c81");
    expect(root().getPropertyValue("--primary-foreground")).toBe("#ffffff");
  });

  it("picks near-black text on a light colour", () => {
    applyBrandColor("#ffd60a");
    expect(root().getPropertyValue("--primary-foreground")).toBe("#0a0a0a");
  });

  it("clears the override on an invalid or empty colour", () => {
    applyBrandColor("#0f4c81");
    applyBrandColor("not-a-colour");
    expect(root().getPropertyValue("--primary")).toBe("");
    expect(root().getPropertyValue("--primary-foreground")).toBe("");
  });

  it("gives every preset readable (white) text", () => {
    for (const p of THEME_PRESETS) {
      applyBrandColor(p.color);
      expect(root().getPropertyValue("--primary-foreground"), p.name).toBe("#ffffff");
    }
  });
});
