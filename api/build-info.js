/**
 * Vercel serverless adapter for GET /api/build-info.
 */
import { readBuildInfo } from "../apps/worldsfair-agent-trust/src/lib/buildInfo.js";

export function GET() {
  return new Response(JSON.stringify(readBuildInfo(), null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
