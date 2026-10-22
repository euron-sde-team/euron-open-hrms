/**
 * File storage abstraction. Two backends, selected by env (like the mailer):
 *   - "s3" (DEFAULT): objects in an S3 bucket (key = "<prefix>/<filename>"). Works with
 *     AWS, a local emulator (Floci) or any S3-compatible store via S3_ENDPOINT.
 *   - "local": files under data/<prefix>/ on disk. Development convenience only.
 *
 * S3 is the default deliberately. Deployed containers are ephemeral, so "local" means every
 * issued letter, payslip and uploaded document disappears on the next deploy, and the
 * failure is silent: the database rows survive and only 404 later when somebody tries to
 * download one. Anything that must outlive a container belongs in the bucket.
 *
 * Opting out is therefore explicit: set STORAGE=local. There is no automatic fall back to
 * disk when S3 is misconfigured, because a silent downgrade is exactly the failure this
 * default exists to prevent. Misconfiguration is reported loudly at boot instead.
 *
 * Prefixes map to the original on-disk folders: "uploads" | "payslips" | "letters".
 */
import fsp from "fs/promises";
import path from "path";
import { DATA_DIR } from "../core/data-dir";
import { awsClientConfig, awsRegion } from "../core/aws";

const MODE = (process.env.STORAGE || "s3").toLowerCase();
const isS3 = MODE === "s3";

// An unrecognised value used to mean "local" by accident, because the only test was
// `MODE === "s3"`. A real config had STORAGE=ses (a paste from MAIL_MODE), which quietly
// wrote every document to container-local disk while looking configured. Say so loudly:
// this is the silent downgrade the s3 default exists to prevent.
if (MODE !== "s3" && MODE !== "local") {
  const msg = `STORAGE="${process.env.STORAGE}" is not a valid backend. Use "s3" or "local". Falling back to local disk, which does NOT survive a redeploy.`;
  console.error(`\n  ${msg}\n`);
}

let s3: any = null, S3: any = null, presign: any = null;
if (isS3) {
  // The S3 SDK loads only when STORAGE=s3.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  S3 = require("@aws-sdk/client-s3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  presign = require("@aws-sdk/s3-request-presigner");
  const cfg = awsClientConfig("s3");
  s3 = new S3.S3Client({
    ...cfg,
    // Emulators and S3-compatible stores are addressed path-style (endpoint/bucket/key).
    forcePathStyle: !!cfg.endpoint,
  });
}
const BUCKET = process.env.S3_BUCKET || "";
const key = (prefix, filename) => `${prefix}/${filename}`;
const localPathFor = (prefix, filename) => path.join(DATA_DIR, prefix, filename);

async function ensureLocalDir(prefix) {
  const d = path.join(DATA_DIR, prefix);
  await fsp.mkdir(d, { recursive: true }); // recursive mkdir is a no-op if it exists
  return d;
}

/** True if a local file exists (async, non-blocking). */
async function fileExists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

/** Store a buffer. Returns the storage key (the filename is the caller's choice). */
async function putBuffer(prefix, filename, buffer, contentType) {
  if (isS3) {
    await s3.send(new S3.PutObjectCommand({ Bucket: BUCKET, Key: key(prefix, filename), Body: buffer, ContentType: contentType || "application/octet-stream" }));
  } else {
    await ensureLocalDir(prefix);
    await fsp.writeFile(localPathFor(prefix, filename), buffer);
  }
  return filename;
}


async function exists(prefix, filename) {
  if (isS3) {
    try { await s3.send(new S3.HeadObjectCommand({ Bucket: BUCKET, Key: key(prefix, filename) })); return true; }
    catch { return false; }
  }
  return fileExists(localPathFor(prefix, filename));
}

async function getBuffer(prefix, filename) {
  if (isS3) {
    const r = await s3.send(new S3.GetObjectCommand({ Bucket: BUCKET, Key: key(prefix, filename) }));
    const chunks: Buffer[] = []; for await (const c of r.Body) chunks.push(c); return Buffer.concat(chunks);
  }
  return fsp.readFile(localPathFor(prefix, filename));
}

/**
 * Send a stored object as a download, straight from storage to the response.
 *
 * Replaces the old `toLocalPath` + `res.download` pair, which under S3 wrote the object to
 * `os.tmpdir()` on every single download and never cleaned it up. Nothing touches disk now.
 */
async function sendDownload(res, prefix, filename, downloadName, contentType = "application/pdf") {
  const buf = await getBuffer(prefix, filename);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", String(buf.length));
  // Quoted and stripped of characters that would break the header or path-traverse.
  const safe = String(downloadName || filename).replace(/[^\w.\- ]+/g, "_");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  // Lets a browser XHR/blob download read the filename instead of falling back to the id.
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  res.send(buf);
}

async function remove(prefix, filename) {
  if (isS3) { try { await s3.send(new S3.DeleteObjectCommand({ Bucket: BUCKET, Key: key(prefix, filename) })); } catch { /* ignore */ } }
  else { try { await fsp.unlink(localPathFor(prefix, filename)); } catch { /* missing -> nothing to remove */ } }
}

/** A time-limited download URL (S3 presigned; local backend returns null). */
async function signedUrl(prefix, filename, seconds = 300) {
  if (!isS3) return null;
  return presign.getSignedUrl(s3, new S3.GetObjectCommand({ Bucket: BUCKET, Key: key(prefix, filename) }), { expiresIn: seconds });
}

/** Create the bucket if missing (S3 only), convenient for local MinIO/dev. */
async function ensureBucket() {
  if (!isS3 || !BUCKET) return;
  try { await s3.send(new S3.HeadBucketCommand({ Bucket: BUCKET })); }
  catch { try { await s3.send(new S3.CreateBucketCommand({ Bucket: BUCKET })); } catch (_e) { /* may already exist / race */ } }
}

/**
 * Prove at boot that the configured backend actually works, and say so plainly.
 *
 * S3 problems otherwise surface hours later as a failed download of a letter issued long
 * ago, by which time the cause looks like a data bug rather than a credentials one. This
 * does NOT fall back to disk: the whole point of defaulting to S3 is that a silent
 * downgrade loses documents on the next deploy.
 */
async function checkReachable(): Promise<{ ok: boolean; detail: string }> {
  if (!isS3) return { ok: true, detail: `local disk at ${DATA_DIR}` };
  if (!BUCKET) return { ok: false, detail: "STORAGE=s3 but no S3_BUCKET is set" };
  try {
    await s3.send(new S3.HeadBucketCommand({ Bucket: BUCKET }));
    return { ok: true, detail: `s3://${BUCKET} (${awsRegion("s3")})` };
  } catch (e: any) {
    const name = e?.name || "Error";
    const hint =
      name === "AccessDenied" || name === "Forbidden"
        ? "the credentials cannot reach this bucket. The task role (or AWS_ACCESS_KEY_ID) needs s3:GetObject, s3:PutObject, s3:DeleteObject and s3:ListBucket on it"
        : name === "PermanentRedirect"
          ? "wrong region for this bucket. Set S3_REGION to the bucket's actual region"
          : name === "NotFound" || name === "NoSuchBucket"
            ? "the bucket does not exist"
            : String(e?.message || name).slice(0, 120);
    return { ok: false, detail: `s3://${BUCKET} unreachable: ${name}, ${hint}` };
  }
}

export { MODE, isS3, putBuffer, exists, getBuffer, sendDownload, remove, signedUrl, ensureBucket, checkReachable, localPathFor };
export default { MODE, isS3, putBuffer, exists, getBuffer, sendDownload, remove, signedUrl, ensureBucket, checkReachable, localPathFor };
