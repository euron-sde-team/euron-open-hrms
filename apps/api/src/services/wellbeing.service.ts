/** Employee health & mental well-being: pulse check-ins, aggregate, resources. */
import type { RequestContext } from "../core/context";
import { forbidden, round2, todayStr } from "../core/util";
import { isStaff } from "../middleware/auth";
import { fullName } from "../domain/person";

const RESOURCES = [
  {
    title: "24×7 Employee Assistance Programme (EAP)", category: "SUPPORT",
    desc: "Free, confidential counselling for you and your family. Call the helpline anytime.",
    actionLabel: "Call the EAP helpline", // EAP number is per-org (set by HR) -> filled in below
    content: "<p>The Employee Assistance Programme gives you and your immediate family free, confidential access to trained counsellors - any time, day or night.</p><p>Use it for stress, anxiety, relationship or family matters, financial worries, or anything affecting your wellbeing. Calls are private and are never shared with your employer.</p><p><b>What to expect:</b> a short intake conversation, then up to a few free counselling sessions, in person or over the phone.</p>",
  },
  {
    title: "Mental-health helpline", category: "CRISIS",
    desc: "If you're in distress, talk to a professional now. iCall: 9152987821 (Mon to Sat, 8am to 10pm).",
    action: "tel:9152987821", actionLabel: "Call iCall now",
    content: "<p>If you or a colleague are in distress, please reach out right away - you don't have to handle it alone.</p><p><b>iCall (TISS):</b> 9152987821, Monday to Saturday, 8am to 10pm.</p><p><b>Tele-MANAS (Govt. of India, 24×7):</b> 14416 or 1800-891-4416.</p><p>In an emergency, call your local emergency number immediately.</p>",
  },
  {
    title: "Guided meditation & breathing", category: "MINDFULNESS",
    desc: "Short daily sessions to reset focus and reduce stress.",
    actionLabel: "Try a 2-minute reset",
    content: "<p>A few minutes of focused breathing can lower stress and sharpen focus. Try one of these between meetings:</p><p><b>Box breathing (4-4-4-4):</b> breathe in for 4 seconds, hold 4, breathe out 4, hold 4. Repeat 4 rounds.</p><p><b>4-7-8 breathing:</b> inhale through the nose for 4, hold for 7, exhale slowly through the mouth for 8. Repeat 3-4 times.</p><p><b>Grounding (5-4-3-2-1):</b> name 5 things you can see, 4 you can feel, 3 you can hear, 2 you can smell, 1 you can taste.</p>",
  },
  {
    title: "Ergonomics & screen-break reminders", category: "PHYSICAL",
    desc: "Tips to protect your eyes, posture and wrists during long screen time.",
    actionLabel: "See the checklist",
    content: "<p>Small adjustments prevent eye strain and back pain over long screen days:</p><p><b>20-20-20 rule:</b> every 20 minutes, look at something 20 feet away for 20 seconds.</p><p><b>Posture:</b> top of the screen at eye level, feet flat, back supported, elbows around 90°.</p><p><b>Move:</b> stand, stretch or walk for a couple of minutes every hour.</p><p><b>Wrists:</b> keep them neutral (not bent up) and let them rest, not hover, while typing.</p>",
  },
  {
    title: "Manager check-in toolkit", category: "MANAGER",
    desc: "How to spot burnout in your team and have a supportive conversation.",
    actionLabel: "Open the toolkit",
    content: "<p><b>Signs of burnout to watch for:</b> persistent tiredness, cynicism or withdrawal, dropping quality, missed deadlines, working unusually long hours, or going quiet in meetings.</p><p><b>How to check in:</b></p><p>1. Pick a private, unhurried moment. 2. Lead with care: \"I've noticed you seem stretched lately - how are you really doing?\" 3. Listen more than you talk. 4. Agree one or two concrete changes (workload, priorities, time off). 5. Follow up the next week.</p><p>If someone may be at risk, point them to the EAP or the mental-health helpline above, and loop in HR.</p>",
  },
];

/** Resources with the org's configured EAP number merged into the EAP card. */
function resourcesFor(org) {
  const eap = (org && org.eapPhone) ? String(org.eapPhone).trim() : "";
  return RESOURCES.map((r) => {
    if (r.category !== "SUPPORT") return r;
    return {
      ...r,
      eapPhone: eap || null,
      action: eap ? "tel:" + eap.replace(/\s+/g, "") : null,
      content: r.content + (eap ? "" : "<p class=\"muted\">Your HR team hasn't added the EAP number yet.</p>"),
    };
  });
}

/** Everyone (EAP number per-org). */
export async function listResources(ctx: RequestContext) {
  const org = await ctx.data.organizations.byId(ctx.orgId);
  return resourcesFor(org);
}

/** HR sets the EAP helpline number. */
export async function setSupport(ctx: RequestContext, input: { eapPhone?: unknown } | undefined) {
  if (!isStaff(ctx.user)) throw forbidden("Staff access required");
  const eapPhone = String((input && input.eapPhone) || "").trim().slice(0, 40);
  await ctx.data.organizations.update(ctx.orgId, { eapPhone });
  await ctx.data.auditLog.create({ action: "WELLBEING_EAP_SET", userId: ctx.user.id, meta: { eapPhone } });
  return { ok: true, eapPhone };
}

/** My recent check-ins + today's. */
export async function myCheckins(ctx: RequestContext) {
  if (!ctx.user.employeeId) throw forbidden("Employees only");
  const list = (await ctx.data.wellbeing.forEmployee(ctx.user.employeeId)).sort((a, b) => (a.date < b.date ? 1 : -1));
  return { today: list.find((w) => w.date === todayStr()) || null, recent: list.slice(0, 30) };
}

/** Today's check-in: { mood, stress, workload, note, anonymous } (1 to 5 scales). Checking in again updates it. */
export async function checkIn(ctx: RequestContext, input: Record<string, any>) {
  if (!ctx.user.employeeId) throw forbidden("Employees only");
  const clamp = (v) => Math.max(1, Math.min(5, Number(v) || 3));
  const date = todayStr();
  const data = { mood: clamp(input.mood), stress: clamp(input.stress), workload: clamp(input.workload), note: input.note || "", anonymous: input.anonymous !== false };
  const existing = await ctx.data.wellbeing.forDay(ctx.user.employeeId, date);
  return existing
    ? ctx.data.wellbeing.update(existing.id, data)
    : ctx.data.wellbeing.create({ employeeId: ctx.user.employeeId, date, ...data });
}

/**
 * Anonymised org well-being pulse for HR (last 14 days by default):
 * average mood/stress/workload, participation, and any non-anonymous flags.
 */
export async function pulse(ctx: RequestContext, fromInput?: any) {
  if (!isStaff(ctx.user)) throw forbidden("Staff access required");
  const from = fromInput || new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10);
  const list = await ctx.data.wellbeing.since(from);
  const n = list.length;
  const avg = (k) => (n ? round2(list.reduce((s, w) => s + (w[k] || 0), 0) / n) : 0);
  const participants = new Set(list.map((w) => w.employeeId)).size;
  const empName = async (id) => {
    const e = await ctx.data.employees.byId(id);
    return e ? fullName(e) : "Anonymous";
  };
  const flagged = list.filter((w) => !w.anonymous && (w.stress >= 4 || w.mood <= 2));
  const flags = await Promise.all(
    flagged.map(async (w) => ({ name: await empName(w.employeeId), date: w.date, stress: w.stress, mood: w.mood, note: w.note }))
  );
  return {
    from,
    checkins: n,
    participants,
    avgMood: avg("mood"),
    avgStress: avg("stress"),
    avgWorkload: avg("workload"),
    // Only surface identity when the employee opted out of anonymity AND flagged high stress.
    flags,
  };
}
