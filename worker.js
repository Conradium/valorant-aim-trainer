// Origins allowed to call this API.
const ALLOWED_ORIGINS = [
  "https://aimku.xyz",
  "https://www.aimku.xyz",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    // Allow Vercel preview deploys (e.g. https://val-xxxx.vercel.app)
    return /\.vercel\.app$/.test(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * Validates that a deviceId matches the expected client-generated format.
 * Although all queries use prepared statements (preventing SQL injection),
 * this adds a data-integrity layer and rejects obviously invalid inputs early.
 * Format: "dev-" followed by 10–60 alphanumeric/hyphen characters.
 */
function isValidDeviceId(id) {
  return typeof id === 'string' && /^dev-[a-zA-Z0-9\-]{10,60}$/.test(id);
}

// --- Server-side validation bounds -----------------------------------------
// A session is a fixed 60 s round (see SESSION_SECONDS in the client). Each hit
// awards at most ~300 points, so even a flawless run lands far below MAX_SCORE.
// These ceilings reject obviously forged payloads (e.g. score: 999999999) while
// staying generous enough never to reject a legitimate elite run.
const MAX_NAME_LEN = 20;
const MAX_SCORE = 100000;   // generous ceiling; a real 60 s session caps well below this
const MAX_ACCURACY = 100;   // accuracy is a percentage
const MAX_SPLIT_MS = 60000; // a split/reaction can't exceed the 60 s session length

/**
 * Cleans a user-supplied display name before it is stored and later rendered on
 * the leaderboard. Strips control characters and angle brackets (defence in depth
 * against HTML/script injection), trims, and caps the length. Falls back to a
 * default so a blank/whitespace name never reaches the database.
 */
function sanitizeName(name) {
  const cleaned = String(name ?? '')
    .replace(/[\u0000-\u001F\u007F<>]/g, '') // strip control chars + angle brackets
    .trim()
    .slice(0, MAX_NAME_LEN);
  return cleaned || 'Agent';
}

/**
 * Validates the numeric gameplay stats against plausible bounds. Unlike the old
 * `Number(x) || 0` coercion (which silently accepted absurd values), this rejects
 * non-finite numbers and anything outside the achievable range.
 * @returns {{ ok: true, values: {score:number, accuracy:number, split:number} }
 *          | { ok: false, error: string }}
 */
function validateGameStats({ score, accuracy, split }) {
  const s = Number(score);
  const a = Number(accuracy);
  const sp = Number(split);

  if (!Number.isFinite(s) || s < 0 || s > MAX_SCORE) {
    return { ok: false, error: `Invalid score: must be a number between 0 and ${MAX_SCORE}` };
  }
  if (!Number.isFinite(a) || a < 0 || a > MAX_ACCURACY) {
    return { ok: false, error: `Invalid accuracy: must be a number between 0 and ${MAX_ACCURACY}` };
  }
  if (!Number.isFinite(sp) || sp < 0 || sp > MAX_SPLIT_MS) {
    return { ok: false, error: `Invalid split: must be a number between 0 and ${MAX_SPLIT_MS}` };
  }

  return { ok: true, values: { score: Math.round(s), accuracy: a, split: sp } };
}

/**
 * Per-request rate limiting for write endpoints, keyed by both client IP and
 * deviceId so neither a single device nor a single IP can flood the scores table.
 * Uses Cloudflare's native rate-limiting binding (configured in wrangler.toml).
 * Degrades gracefully — if the binding isn't present (e.g. local `wrangler dev`
 * without it), requests are allowed through rather than failing closed.
 * @returns {Promise<boolean>} true if the request is within limits.
 */
async function withinRateLimit(env, request, deviceId) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const checks = [];
  if (env.RATE_LIMITER) checks.push(env.RATE_LIMITER.limit({ key: `dev:${deviceId}` }));
  if (env.RATE_LIMITER_IP) checks.push(env.RATE_LIMITER_IP.limit({ key: `ip:${ip}` }));
  if (checks.length === 0) return true; // bindings not configured (e.g. local dev)
  const results = await Promise.all(checks);
  return results.every((r) => r.success);
}

function corsFor(request) {
  const origin = request.headers.get("Origin") || "";
  return {
    // Echo the origin when allowed; otherwise lock responses to the prod domain.
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "https://aimku.xyz",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = corsFor(request);

    // Handle CORS preflight request
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Check Cloudflare D1 Database binding
    if (!env.DB) {
      return new Response(
        JSON.stringify({ success: false, error: "Cloudflare D1 Database binding 'DB' not found" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // GET /api/profile?deviceId=...
    if (path === "/api/profile" && request.method === "GET") {
      const deviceId = url.searchParams.get("deviceId");
      if (!deviceId) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing required 'deviceId' parameter" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      if (!isValidDeviceId(deviceId)) {
        return new Response(
          JSON.stringify({ success: false, error: "Invalid deviceId format" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      try {
        const { results } = await env.DB.prepare(
          "SELECT name, score, accuracy, split FROM profiles WHERE device_id = ?"
        ).bind(deviceId).all();

        if (!results || results.length === 0) {
          // fallback if profile not saved in SQLite yet
          return new Response(
            JSON.stringify({
              success: true,
              exists: false,
              data: { name: "Agent", best: { score: 0, accuracy: 0, split: 0 } }
            }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        const row = results[0];
        const profileData = {
          name: row.name,
          best: {
            score: Number(row.score) || 0,
            accuracy: Number(row.accuracy) || 0,
            split: Number(row.split) || 0
          }
        };

        return new Response(
          JSON.stringify({ success: true, exists: true, data: profileData }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: "Database error fetching profile: " + err.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // POST /api/profile
    if (path === "/api/profile" && request.method === "POST") {
      try {
        const body = await request.json();
        const { deviceId, name, best } = body;

        if (!deviceId || !name || !best) {
          return new Response(
            JSON.stringify({ success: false, error: "Missing required fields: deviceId, name, best" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        if (!isValidDeviceId(deviceId)) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid deviceId format" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        const stats = validateGameStats(best);
        if (!stats.ok) {
          return new Response(
            JSON.stringify({ success: false, error: stats.error }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        if (!(await withinRateLimit(env, request, deviceId))) {
          return new Response(
            JSON.stringify({ success: false, error: "Too many requests. Please slow down." }),
            { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        const cleanName = sanitizeName(name);
        const { score, accuracy, split } = stats.values;
        const updatedAt = new Date().toISOString();

        // SQL Upsert statement
        await env.DB.prepare(`
          INSERT INTO profiles (device_id, name, score, accuracy, split, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(device_id) DO UPDATE SET
            name = excluded.name,
            score = excluded.score,
            accuracy = excluded.accuracy,
            split = excluded.split,
            updated_at = excluded.updated_at
        `).bind(deviceId, cleanName, score, accuracy, split, updatedAt).run();

        const profileData = {
          name: cleanName,
          best: { score, accuracy, split },
          updatedAt
        };

        return new Response(
          JSON.stringify({ success: true, data: profileData }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: "Database error saving profile: " + err.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // POST /api/score — log one finished session (feeds the weekly leaderboard)
    if (path === "/api/score" && request.method === "POST") {
      try {
        const body = await request.json();
        const { deviceId, name, score, accuracy, split } = body;

        if (!deviceId || !name || score == null) {
          return new Response(
            JSON.stringify({ success: false, error: "Missing required fields: deviceId, name, score" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        if (!isValidDeviceId(deviceId)) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid deviceId format" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        const stats = validateGameStats({ score, accuracy, split });
        if (!stats.ok) {
          return new Response(
            JSON.stringify({ success: false, error: stats.error }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        if (!(await withinRateLimit(env, request, deviceId))) {
          return new Response(
            JSON.stringify({ success: false, error: "Too many requests. Please slow down." }),
            { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        await env.DB.prepare(
          "INSERT INTO scores (device_id, name, score, accuracy, split, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(
          deviceId,
          sanitizeName(name),
          stats.values.score,
          stats.values.accuracy,
          stats.values.split,
          new Date().toISOString()
        ).run();

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: "Database error saving score: " + err.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // GET /api/leaderboard — top 10 scores achieved in the last 7 days.
    // SQLite "bare column" rule: with a single MAX(), the name/accuracy/split
    // columns are taken from the same row as that max score (one per device).
    if (path === "/api/leaderboard" && request.method === "GET") {
      try {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { results } = await env.DB.prepare(`
          SELECT s.device_id, COALESCE(p.name, s.name) AS name, MAX(s.score) AS score, s.accuracy, s.split
          FROM scores s
          LEFT JOIN profiles p ON s.device_id = p.device_id
          WHERE s.created_at >= ?
          GROUP BY s.device_id
          ORDER BY score DESC
          LIMIT 10
        `).bind(weekAgo).all();

        const data = (results || []).map((row) => ({
          deviceId: row.device_id,
          name: row.name,
          score: Number(row.score) || 0,
          accuracy: Number(row.accuracy) || 0,
          split: Number(row.split) || 0,
        }));

        return new Response(
          JSON.stringify({ success: true, data }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: "Database error fetching leaderboard: " + err.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};
