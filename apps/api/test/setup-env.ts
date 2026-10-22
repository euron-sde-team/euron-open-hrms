// Unit tests run with deterministic, offline settings: payroll and date maths assume
// UTC, mail is captured, files stay on local disk, and no AWS client is created.
process.env.TZ = "UTC";
process.env.NODE_ENV = "test";
process.env.MAIL_MODE = "outbox";
process.env.STORAGE = "local";
process.env.KMS_MODE = "local";
process.env.LOG_LEVEL = "silent";
