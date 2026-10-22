/**
 * Asset Custody Form: the signed record of what somebody was handed and agreed to hold.
 *
 * Built with the PDF kit directly rather than through letter-templates.ts, deliberately. The
 * letter system renders prose from an editable template with token substitution, which is
 * right for an offer or a relieving letter. This is a schedule of items with serial numbers
 * and an acceptance block: the content is a table, not paragraphs, and there is nothing here
 * a tenant would want to reword that the letterhead does not already carry.
 *
 * Issued at APPROVAL, not when the form is filled in, because until HR approves, the declared
 * items are claims. What gets filed is what was accepted.
 */
import * as kit from "../pdf/kit";
import { brandForAsync } from "./brand";
import { docCategoryLabel } from "./documents";

export interface CustodyItem {
  category?: string;
  name?: string;
  serial?: string;
  condition?: string;
  receivedOn?: string | null;
  /** ACKNOWLEDGED = already on the register and confirmed; DECLARED = the person told us. */
  source: "ACKNOWLEDGED" | "DECLARED";
  note?: string;
}

const dateText = (d: any) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";

/**
 * Render the custody form for one person.
 *
 * Returns null when there is nothing to record. A custody form listing no assets is a piece
 * of paper that says nothing, and filing one against every joiner would bury the ones that
 * matter.
 */
export async function renderCustodyForm({ org, employee, items, signedAt, signedName }: {
  org: any;
  employee: any;
  items: CustodyItem[];
  signedAt?: string | null;
  signedName?: string | null;
}): Promise<{ buffer: Buffer; fileName: string } | null> {
  if (!items.length) return null;

  const brand = await brandForAsync(org);
  const name = `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
  const ctx = kit.createDocument(brand, `Asset Custody Form - ${name}`, "Asset Custody Form");

  kit.letterhead(ctx);
  // refLine renders the "Ref:" label itself; passing one in gives "Ref: Ref: ACME-1024".
  kit.refLine(ctx, employee.code || null, dateText(signedAt || new Date()));
  kit.title(ctx, "Asset Custody Form");
  kit.recipient(ctx, [
    name,
    employee.designation || null,
    employee.officialEmail || employee.email || null,
  ]);

  kit.flow(
    ctx,
    `The items listed below have been issued to or are held by ${name || "the employee"} in connection with their ` +
    `employment with ${org.name}. They remain the property of ${org.name} at all times and are to be returned in ` +
    `working order on or before the last working day, or earlier on request.`
  );

  for (const it of items) {
    kit.ensureSpace(ctx, 90);
    kit.heading(ctx, it.name || docCategoryLabel(it.category || "OTHER"));
    const pairs: [string, string][] = [
      ["Category", it.category ? docCategoryLabel(it.category) : "Other"],
      ["Serial number", it.serial || "Not recorded"],
      ["Condition", it.condition || "Good"],
      ["Received on", dateText(it.receivedOn) || "Not stated"],
      // Says where the line came from, which is the difference between "we issued this and
      // they confirmed it" and "they told us they have it and we accepted that".
      ["Record", it.source === "ACKNOWLEDGED" ? "Issued by the company, confirmed received" : "Declared by the employee, accepted by HR"],
    ];
    kit.detailGrid(ctx, pairs, 2);
    if (it.note) kit.flow(ctx, `Note: ${it.note}`, { size: kit.TYPE.small, color: kit.INK.muted });
  }

  kit.ensureSpace(ctx, 160);
  kit.heading(ctx, "Acknowledgement");
  kit.bullets(ctx, [
    "I confirm that I have received the items listed above and that the details are correct.",
    "I will take reasonable care of them and will not modify or dispose of them.",
    "I will return them on or before my last working day, or earlier if asked.",
    "I understand that unreturned or damaged items may be recovered through my final settlement.",
  ]);

  if (signedName) {
    kit.flow(
      ctx,
      `Accepted electronically by ${signedName}${signedAt ? ` on ${dateText(signedAt)}` : ""} as part of onboarding.`,
      { size: kit.TYPE.small, color: kit.INK.muted }
    );
  }
  kit.signature(ctx, { forLine: true });

  const fileName = `asset_custody_${org.slug}_${employee.code || employee.id}_${Date.now()}.pdf`;
  return kit.finalize(ctx, fileName);
}

/** The accepted items on a case, in the shape the form wants. */
export function custodyItemsFor(caseRow: any, issuedAssets: any[] = []): CustodyItem[] {
  const byId = new Map<string, any>(issuedAssets.map((a: any) => [a.id, a]));
  const out: CustodyItem[] = [];

  for (const a of caseRow.assets?.acknowledged || []) {
    if (a.received === false) continue; // they said they never got it; do not certify custody
    const asset = byId.get(a.assetId) || {};
    out.push({
      category: asset.category,
      name: asset.name,
      serial: a.serial || asset.serial,
      condition: a.condition || asset.condition,
      receivedOn: asset.assignedAt || null,
      source: "ACKNOWLEDGED",
      note: a.discrepancy ? `Serial confirmed as ${a.serial}, register holds ${asset.serial || "none"}.` : a.note,
    });
  }

  for (const a of caseRow.assets?.declared || []) {
    if (a.status !== "APPROVED") continue; // rejected claims are not custody
    out.push({
      category: a.category,
      name: a.name,
      serial: a.serial,
      condition: a.condition,
      receivedOn: a.receivedOn || null,
      source: "DECLARED",
      note: a.note,
    });
  }

  return out;
}
