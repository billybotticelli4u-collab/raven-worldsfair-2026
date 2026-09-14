/**
 * Vercel serverless adapter for GET /api/demo (bundle of Day-2 paths).
 */
import { runDemoBundle } from "../apps/worldsfair-agent-trust/src/lib/runSlice.js";

export async function GET() {
  try {
    const results = await runDemoBundle();
    return new Response(JSON.stringify({ results }, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "server_error", message }, null, 2),
      {
        status: 500,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }
}
