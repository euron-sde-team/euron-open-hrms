import { it, expect } from "vitest";
/**
 * Verification spine: digest canonicalisation, signing, and the tamper cases.
 *
 * The DB-backed issue/verify round trip lives in tests/phases2-e2e.ts; this
 * file covers the crypto and disclosure logic hermetically.
 */
import { contentDigest, signature, verifyUrlFor, KIND_LABEL } from "../../src/security/verification";

/** Legacy section headers become a prefix on the test names that follow them. */
let current = "";
const section = (title: string) => {
  current = title;
};
const named = (name: string) => (current ? `${current} > ${name}` : name);

/** One test case per legacy check, so each assertion reports on its own. */
function check(name: string, cond: boolean, detail?: unknown) {
  it(named(name), () => {
    expect(cond, detail === undefined ? name : `${name} -> ${JSON.stringify(detail)?.slice(0, 400)}`).toBe(true);
  });
}

section("Content digest is canonical");
const a = contentDigest({ net: 50000, period: "July 2026", code: "E1" });
const b = contentDigest({ code: "E1", period: "July 2026", net: 50000 });
check("key order does not change the digest", a === b, { a, b });

check("numeric 1000 and string '1000' agree",
  contentDigest({ net: 1000 }) === contentDigest({ net: "1000" }));

check("a different amount changes the digest",
  contentDigest({ net: 50000 }) !== contentDigest({ net: 50001 }));

check("null and undefined are excluded, not stringified",
  contentDigest({ net: 1, x: null, y: undefined }) === contentDigest({ net: 1 }));

check("digest is a 64-char sha256 hex", /^[0-9a-f]{64}$/.test(a), a);

section("Signature binds code AND digest");
const code = "AB12-CD34-EF56";
const digest = contentDigest({ net: 50000 });
const sig = signature(code, digest);
check("signature is stable", signature(code, digest) === sig);
check("a different code yields a different signature", signature("ZZ99-ZZ99-ZZ99", digest) !== sig);
check("a different digest yields a different signature",
  signature(code, contentDigest({ net: 99999 })) !== sig);
check("signature is a 64-char hex", /^[0-9a-f]{64}$/.test(sig));

// The attack this defends against: lifting a real code onto a forged payslip
// that states a different salary. The digest on the forgery won't match.
section("Forgery scenario");
const realFacts = { period: "July 2026", net: 50000, employeeCode: "E1" };
const forgedFacts = { period: "July 2026", net: 500000, employeeCode: "E1" };
const realDigest = contentDigest(realFacts);
const forgedDigest = contentDigest(forgedFacts);
check("forged content produces a different digest", realDigest !== forgedDigest);
check("the real signature does not validate the forged digest",
  signature(code, realDigest) !== signature(code, forgedDigest));

section("URLs and labels");
const url = verifyUrlFor(code);
check("verify URL contains the code", url.includes(code), url);
check("verify URL has no trailing double slash", !/([^:])\/\//.test(url), url);
check("every kind has a human label",
  Object.values(KIND_LABEL).every((v) => typeof v === "string" && v.length > 2),
  KIND_LABEL);
check("payslip label reads naturally", KIND_LABEL.PAYSLIP === "Payslip");
