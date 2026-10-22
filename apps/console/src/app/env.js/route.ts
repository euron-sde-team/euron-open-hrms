import { envScriptResponse } from "@open-hrms/api-client";
import { serverEnv } from "@/lib/runtime-env";

// Rendered per request from the container's environment, never at build time.
export const dynamic = "force-dynamic";

export function GET() {
  return envScriptResponse(serverEnv());
}
