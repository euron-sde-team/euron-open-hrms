/** Express application: middleware, routers and the error handler. No side effects; index.ts boots it. */
import express from "express";
import cors from "cors";

import { assertConnection } from "./db/kysely";
import { HttpError } from "./core/util";
import { authRequired } from "./middleware/auth";

import authRoutes from "./routes/auth.routes";
import orgRoutes from "./routes/org.routes";
import deptRoutes from "./routes/departments.routes";
import employeeRoutes from "./routes/employees.routes";
import leaveRoutes from "./routes/leave.routes";
import documentRoutes from "./routes/documents.routes";
import attendanceRoutes from "./routes/attendance.routes";
import salaryRoutes from "./routes/salary.routes";
import letterRoutes from "./routes/letters.routes";
import letterTemplateRoutes from "./routes/letter-templates.routes";
import reportRoutes from "./routes/reports.routes";
import onboardingRoutes from "./routes/onboarding.routes";
import onboardingTemplateRoutes from "./routes/onboarding-templates.routes";
import onboardingCaseRoutes from "./routes/onboarding-cases.routes";
import onboardingCampaignRoutes from "./routes/onboarding-campaigns.routes";
import onboardingPublicRoutes from "./routes/onboarding.public.routes";
import verifyPublicRoutes from "./routes/verify.public.routes";
import reimbursementRoutes from "./routes/reimbursements.routes";
import hrContentRoutes from "./routes/content.routes";
import separationRoutes from "./routes/separation.routes";
import directoryRoutes from "./routes/directory.routes";
import announcementRoutes from "./routes/announcements.routes";
import vendorRoutes from "./routes/vendors.routes";
import performanceRoutes from "./routes/performance.routes";
import worklogRoutes from "./routes/worklog.routes";
import assetRoutes from "./routes/assets.routes";
import aiTokenRoutes from "./routes/aitokens.routes";
import perkRoutes from "./routes/perks.routes";
import wellbeingRoutes from "./routes/wellbeing.routes";
import viewsRoutes from "./routes/views.routes";
import reminderRoutes from "./routes/reminders.routes";
import signupRoutes from "./routes/signup.routes";
import usersRoutes from "./routes/users.routes";
import notificationRoutes from "./routes/notifications.routes";
import pushRoutes from "./routes/push.routes";
import auditRoutes from "./routes/audit.routes";
import rolesRoutes from "./routes/roles.routes";
import mfaRoutes from "./routes/mfa.routes";
import emailDomainRoutes from "./routes/email-domain.routes";
import platformRoutes from "./routes/platform.routes";

import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { logger, captureError, redactUrl } from "./core/logger";


export function createApp() {
  const app = express();
  // Behind a load balancer / reverse proxy: honor X-Forwarded-For so req.ip is the
  // real client (correct per-IP rate limiting and audit logging), not the proxy.
  // `1` = trust exactly one proxy hop; override with TRUST_PROXY for deeper chains.
  app.set("trust proxy", process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : 1);
  // Liveness probe for the load balancer. Kept before all middleware, auth and rate
  // limiting so health polls are never throttled or gated. Readiness is /api/ready.
  app.get("/up", (_req, res) => res.status(200).send("OK"));
  app.use(helmet());
  // CORS: CORS_ORIGINS is a comma-separated allowlist of browser origins (the web app
  // and the operator console). Production refuses to boot without it (config.ts);
  // unset is a local-development convenience only.
  const corsAllowlist = (process.env.CORS_ORIGINS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (corsAllowlist.length) {
    app.use(cors({
      origin(origin, cb) {
        // Allow same-origin / non-browser callers (curl, server-to-server) that send no Origin.
        if (!origin || corsAllowlist.includes(origin)) return cb(null, true);
        return cb(new HttpError(403, "Origin not allowed", "CORS_ORIGIN_DENIED"));
      },
      credentials: true,
    }));
  } else {
    app.use(cors());
  }
  // Structured request logging with a per-request id (quiet for health checks).
  app.use(pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === "/up" || req.url === "/api/ready" },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: redactUrl(req.url), remoteAddress: req.remoteAddress }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }));
  app.use(express.json({ limit: "5mb" }));

  // Throttle credential endpoints (login / signup / reset) per IP.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.AUTH_RATE_MAX || 300),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Please try again later." },
  });

  // Operator / SaaS console API (its own auth plane, separate JWT audience).
  app.use("/api/platform/auth", authLimiter);
  app.use("/api/platform", platformRoutes);

  // API
  app.use("/api/auth", authLimiter, authRoutes);
  // Public (no auth): company self-signup + self-onboarding via invite token
  app.use("/api/signup", authLimiter, signupRoutes);
  app.use("/api/onboarding/public", onboardingPublicRoutes);
  // Public, unauthenticated: anyone holding a document can check it is genuine.
  app.use("/api/verify", verifyPublicRoutes);
  app.use("/api/users", authRequired, usersRoutes);
  app.use("/api/roles", authRequired, rolesRoutes);
  app.use("/api/mfa", authRequired, mfaRoutes);
  app.use("/api/email-domain", authRequired, emailDomainRoutes);
  app.use("/api/notifications", authRequired, notificationRoutes);
  app.use("/api/push", authRequired, pushRoutes);
  app.use("/api/audit", authRequired, auditRoutes);
  app.use("/api/org", authRequired, orgRoutes);
  app.use("/api/departments", authRequired, deptRoutes);
  app.use("/api/employees", authRequired, employeeRoutes);
  app.use("/api/leave", authRequired, leaveRoutes);
  app.use("/api/documents", authRequired, documentRoutes);
  app.use("/api/attendance", authRequired, attendanceRoutes);
  app.use("/api/salary", authRequired, salaryRoutes);
  app.use("/api/letters", authRequired, letterRoutes);
  app.use("/api/letter-templates", authRequired, letterTemplateRoutes);
  app.use("/api/onboarding", authRequired, onboardingRoutes);
  app.use("/api/onboarding-templates", authRequired, onboardingTemplateRoutes);
  app.use("/api/onboarding-cases", authRequired, onboardingCaseRoutes);
  app.use("/api/onboarding-campaigns", authRequired, onboardingCampaignRoutes);
  app.use("/api/reimbursements", authRequired, reimbursementRoutes);
  app.use("/api/content", authRequired, hrContentRoutes);
  app.use("/api/separation", authRequired, separationRoutes);
  app.use("/api/directory", authRequired, directoryRoutes);
  app.use("/api/announcements", authRequired, announcementRoutes);
  app.use("/api/vendors", authRequired, vendorRoutes);
  app.use("/api/performance", authRequired, performanceRoutes);
  app.use("/api/worklogs", authRequired, worklogRoutes);
  app.use("/api/assets", authRequired, assetRoutes);
  app.use("/api/ai-tokens", authRequired, aiTokenRoutes);
  app.use("/api/perks", authRequired, perkRoutes);
  app.use("/api/wellbeing", authRequired, wellbeingRoutes);
  app.use("/api/reports", authRequired, reportRoutes);
  app.use("/api/views", authRequired, viewsRoutes);
  app.use("/api/reminders", authRequired, reminderRoutes);

  // Readiness probe: verifies the app can actually reach PostgreSQL (for load balancers / k8s).
  app.get("/api/ready", async (_req, res) => {
    try { await assertConnection(); res.json({ ready: true, ts: new Date().toISOString() }); }
    catch { res.status(503).json({ ready: false, error: "database unreachable" }); }
  });
  app.get("/", (_req, res) => res.json({ service: "open-hrms-api", ok: true }));

  // Errors
   
  app.use((err, req, res, _next) => {
    // body-parser and multer errors carry a 4xx `status` of their own (malformed JSON,
    // payload too large, too many files); they are client errors, not server faults.
    const clientStatus = Number(err && (err.status || err.statusCode));
    const status = err instanceof HttpError ? err.status
      : clientStatus >= 400 && clientStatus < 500 ? clientStatus
      : err && err.name === "MulterError" ? 400
      : 500;
    if (status === 500) captureError(err, { reqId: req.id, method: req.method, url: req.originalUrl, userId: req.user && req.user.id });
    const code = err instanceof HttpError && err.code ? { code: err.code } : {};
    // Never echo an unexpected error's message: it can carry SQL, paths or hostnames.
    res.status(status).json({ error: status === 500 ? "Server error" : err.message || "Request failed", ...code, ...(status === 500 && req.id ? { requestId: String(req.id) } : {}) });
  });
  return app;
  }
