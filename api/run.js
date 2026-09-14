/**
 * Vercel serverless adapter for POST /api/run.
 * Preserves Day-2 runVerticalSlice semantics — no policy/verify changes.
 */
import { runVerticalSlice } from "../apps/worldsfair-agent-trust/src/lib/runSlice.js";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const pathId = body?.path || "path_a_verified";
  try {
    const result = await runVerticalSlice(pathId);
    return new Response(JSON.stringify(result, null, 2), {
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
