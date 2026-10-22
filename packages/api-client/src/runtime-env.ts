/**
 * Runtime configuration hand-off, server to browser.
 *
 * Next inlines NEXT_PUBLIC_* at build time, but one image ships to every
 * environment, so each app serves `/env.js` from its own environment at
 * request time and loads it before any client code. This is the shared
 * serialiser for that script.
 */

/**
 * Serialise config as a script that assigns `globalThis.__HRMS_ENV`.
 *
 * JSON.stringify alone is not safe inside a script: a value containing
 * `</script>` or `<!--` could break out of a tag that inlines it, and U+2028 /
 * U+2029 are line terminators in older JS engines. Escaping `<` and those two
 * code points makes any string value inert. globalThis rather than window so
 * the service worker can `importScripts("/env.js")` too (in a page,
 * globalThis IS window).
 */
export function envScript(env: object): string {
  const json = JSON.stringify(env)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `globalThis.__HRMS_ENV = Object.freeze(${json});\n`;
}

/** Response for an `/env.js` route handler: JavaScript, never cached. */
export function envScriptResponse(env: object): Response {
  return new Response(envScript(env), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // Config can change on redeploy without a new build, so never cache it.
      "cache-control": "no-store",
    },
  });
}

/** A trimmed non-empty string, or undefined. */
export const nonEmpty = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
