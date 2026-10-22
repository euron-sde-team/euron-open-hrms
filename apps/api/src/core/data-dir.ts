/**
 * Local file-storage paths: uploads and generated PDFs when STORAGE=local, and the
 * email outbox when MAIL_MODE=outbox. Production uses S3 and real mail, so this is
 * a development convenience. DATA_DIR overrides the location (a mounted volume).
 */
import fs from "fs";
import path from "path";

export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), "data");

for (const d of [
  DATA_DIR,
  path.join(DATA_DIR, "uploads"),
  path.join(DATA_DIR, "payslips"),
  path.join(DATA_DIR, "letters"),
  path.join(DATA_DIR, "outbox"),
]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
