export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function readBody<T>(request: Request): Promise<T> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") throw new Error("not an object");
    return body as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "invalid id");
  return id;
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

function intParam(url: URL, name: string, def: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new HttpError(400, `invalid ${name}`);
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function dayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const CLIP_KEY = "(COALESCE(folder,'') || '/' || filename)";
const PLAN_COLS = "id, title, date, location, target_content, notes, status, created_at, updated_at";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SORTS: Record<string, string> = {
  score: "score DESC, date DESC, id",
  newest: "date DESC, score DESC, id",
  oldest: "date ASC, score DESC, id",
  longest: "duration DESC, id",
  name: "filename ASC, id",
};

async function browse(url: URL, env: Env): Promise<Response> {
  const p = url.searchParams;
  const where: string[] = [];
  const binds: unknown[] = [];

  if (p.get("show_hidden") !== "1") where.push("hidden = 0");

  const search = (p.get("search") || "").trim().slice(0, 100);
  if (search) {
    const like = "%" + likeEscape(search.toLowerCase()) + "%";
    const cols = ["filename", "folder", "trail_name", "nearest_town", "nearest_peak", "gps_region"];
    where.push("(" + cols.map((c) => `LOWER(COALESCE(${c},'')) LIKE ? ESCAPE '\\'`).join(" OR ") + ")");
    for (let i = 0; i < cols.length; i++) binds.push(like);
  }

  const region = p.get("region") || "";
  if (region === "no_gps") where.push("gps_region IS NULL");
  else if (region) { where.push("gps_region = ?"); binds.push(region); }

  const camera = p.get("camera_source") || "";
  if (camera) { where.push("COALESCE(camera_source,'unknown') = ?"); binds.push(camera); }

  const season = p.get("season") || "";
  if (season) { where.push("season = ?"); binds.push(season); }

  const minScore = intParam(url, "min_score", 0, 0, 1000);
  if (minScore > 0) { where.push("score >= ?"); binds.push(minScore); }

  const resolution = p.get("resolution") || "";
  const width = "CAST(substr(resolution,1,instr(resolution,'x')-1) AS INTEGER)";
  if (resolution === "4k") where.push(`resolution LIKE '%x%' AND ${width} >= 3840`);
  else if (resolution === "1080p") where.push(`resolution LIKE '%x%' AND ${width} >= 1920`);

  const durMin = p.get("duration_min");
  const durMax = p.get("duration_max");
  if (durMin && Number.isFinite(Number(durMin))) { where.push("duration >= ?"); binds.push(Number(durMin)); }
  if (durMax && Number.isFinite(Number(durMax))) { where.push("duration <= ?"); binds.push(Number(durMax)); }

  const audio = p.get("has_audio");
  if (audio === "yes") where.push("has_audio = 1");
  else if (audio === "no") where.push("has_audio = 0");

  const since = p.get("since") || "";
  if (since) {
    if (!DATE_RE.test(since)) throw new HttpError(400, "since must be YYYY-MM-DD");
    where.push("date >= ?"); binds.push(since);
  }

  if (p.get("ready") === "1") {
    where.push(
      `(SELECT a.action_type FROM clip_actions a WHERE a.clip_filename = ${CLIP_KEY} AND a.action_type IN ('ready','unready') ORDER BY a.id DESC LIMIT 1) = 'ready'`
    );
  }

  const perPage = intParam(url, "per_page", 60, 1, 60);
  const page = intParam(url, "page", 1, 1, 100000);
  const order = SORTS[p.get("sort") || "score"] || SORTS.score;
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const [countRes, rowsRes] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS c FROM clips ${whereSql}`).bind(...binds),
    env.DB.prepare(
      `SELECT ${CLIP_KEY} AS key, filename, folder, score, camera_source, duration, resolution, fps, codec, has_audio,
              gps_region, date, season, size_mb, trail_name, nearest_town, nearest_peak, elevation_ft, drone_mode, reasons
       FROM clips ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`
    ).bind(...binds, perPage, (page - 1) * perPage),
  ]);

  const total = (countRes.results[0] as { c: number }).c;
  const rows = rowsRes.results as Record<string, unknown>[];

  const state = new Map<string, { tags: Set<string>; rating: number | null; ready: boolean }>();
  if (rows.length) {
    const keys = rows.map((r) => r.key as string);
    const { results } = await env.DB.prepare(
      `SELECT clip_filename, action_type, value FROM clip_actions WHERE clip_filename IN (${keys.map(() => "?").join(",")}) ORDER BY id`
    ).bind(...keys).all<{ clip_filename: string; action_type: string; value: string | null }>();
    for (const a of results) {
      let s = state.get(a.clip_filename);
      if (!s) { s = { tags: new Set(), rating: null, ready: false }; state.set(a.clip_filename, s); }
      if (a.action_type === "tag" && a.value) s.tags.add(a.value);
      else if (a.action_type === "untag" && a.value) s.tags.delete(a.value);
      else if (a.action_type === "rate") s.rating = Number(a.value) || null;
      else if (a.action_type === "ready") s.ready = true;
      else if (a.action_type === "unready") s.ready = false;
    }
  }

  const clips = rows.map((r) => {
    const s = state.get(r.key as string);
    let reasons: string[] = [];
    try { reasons = JSON.parse((r.reasons as string) || "[]"); } catch { /* malformed reasons */ }
    return {
      ...r,
      reasons,
      has_audio: !!r.has_audio,
      tags: s ? [...s.tags] : [],
      rating: s ? s.rating : null,
      ready: s ? s.ready : false,
    };
  });

  return json({ clips, total, page, per_page: perPage, total_pages: Math.max(1, Math.ceil(total / perPage)) });
}

async function facets(env: Env): Promise<Response> {
  const width = "CAST(substr(resolution,1,instr(resolution,'x')-1) AS INTEGER)";
  const [totals, regions, cameras, seasons, towns] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS clips, COALESCE(SUM(duration),0) AS seconds, COALESCE(SUM(size_mb),0) AS size_mb,
              SUM(CASE WHEN resolution LIKE '%x%' AND ${width} >= 3840 THEN 1 ELSE 0 END) AS k4,
              SUM(CASE WHEN score >= 80 THEN 1 ELSE 0 END) AS strong, MAX(score) AS max_score,
              SUM(CASE WHEN gps_region IS NULL THEN 1 ELSE 0 END) AS no_gps, MAX(date) AS latest
       FROM clips WHERE hidden = 0`
    ),
    env.DB.prepare(
      `SELECT gps_region AS name, COUNT(*) AS clips, COALESCE(SUM(duration),0) AS seconds, COALESCE(SUM(size_mb),0) AS size_mb
       FROM clips WHERE hidden = 0 AND gps_region IS NOT NULL GROUP BY gps_region ORDER BY clips DESC`
    ),
    env.DB.prepare(`SELECT COALESCE(camera_source,'unknown') AS name, COUNT(*) AS clips FROM clips WHERE hidden = 0 GROUP BY 1 ORDER BY clips DESC`),
    env.DB.prepare(`SELECT season AS name, COUNT(*) AS clips FROM clips WHERE hidden = 0 AND season IS NOT NULL GROUP BY season ORDER BY clips DESC`),
    env.DB.prepare(
      `SELECT nearest_town AS name, COUNT(*) AS clips FROM clips WHERE hidden = 0 AND nearest_town IS NOT NULL GROUP BY nearest_town ORDER BY clips DESC LIMIT 12`
    ),
  ]);
  return json({
    totals: totals.results[0],
    regions: regions.results,
    cameras: cameras.results,
    seasons: seasons.results,
    towns: towns.results,
  });
}

async function route(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/notes" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, text, category, created_at FROM notes ORDER BY created_at DESC LIMIT 200"
    ).all();
    return json({ notes: results });
  }
  if (path === "/api/notes" && method === "POST") {
    const body = await readBody<{ text?: string; category?: string }>(request);
    const text = String(body.text ?? "").trim();
    if (!text) return json({ error: "text is required" }, 400);
    const category = String(body.category || "general").trim().slice(0, 40);
    const result = await env.DB.prepare(
      "INSERT INTO notes (text, category, created_at) VALUES (?, ?, ?) RETURNING id, text, category, created_at"
    ).bind(text.slice(0, 4000), category, new Date().toISOString()).first();
    return json({ note: result }, 201);
  }
  if (path.startsWith("/api/notes/") && method === "DELETE") {
    const id = parseId(path.split("/").pop());
    const r = await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
    if (!r.meta.changes) return json({ error: "not found" }, 404);
    return json({ ok: true });
  }

  if (path === "/api/plans" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT ${PLAN_COLS} FROM shoot_plans ORDER BY date ASC, created_at DESC`
    ).all();
    return json({ plans: results });
  }
  if (path === "/api/plans" && method === "POST") {
    const body = await readBody<Record<string, unknown>>(request);
    const title = String(body.title ?? "").trim().slice(0, 200);
    const date = String(body.date ?? "").trim().slice(0, 10);
    const location = String(body.location ?? "").trim().slice(0, 200);
    const target = String(body.target_content ?? "").trim().slice(0, 200);
    const notes = String(body.notes ?? "").trim().slice(0, 2000);
    if (!title || !date || !location) return json({ error: "title, date, location required" }, 400);
    if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) return json({ error: "date must be YYYY-MM-DD" }, 400);
    const now = new Date().toISOString();
    const result = await env.DB.prepare(
      `INSERT INTO shoot_plans (title, date, location, target_content, notes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'planned', ?, ?) RETURNING ${PLAN_COLS}`
    ).bind(title, date, location, target, notes || null, now, now).first();
    return json({ plan: result }, 201);
  }
  if (path.startsWith("/api/plans/") && method === "DELETE") {
    const id = parseId(path.split("/").pop());
    const r = await env.DB.prepare("DELETE FROM shoot_plans WHERE id = ?").bind(id).run();
    if (!r.meta.changes) return json({ error: "not found" }, 404);
    return json({ ok: true });
  }
  if (path.startsWith("/api/plans/") && method === "PUT") {
    const id = parseId(path.split("/").pop());
    const body = await readBody<{ status?: string; notes?: string }>(request);
    const status = String(body.status ?? "").trim();
    if (status && !["planned", "scouted", "shot", "archived"].includes(status)) {
      return json({ error: "invalid status" }, 400);
    }
    const updates: string[] = [];
    const binds: unknown[] = [];
    if (status) { updates.push("status = ?"); binds.push(status); }
    if (body.notes !== undefined) { updates.push("notes = ?"); binds.push(String(body.notes ?? "").trim().slice(0, 2000) || null); }
    if (!updates.length) return json({ error: "nothing to update" }, 400);
    updates.push("updated_at = ?");
    binds.push(new Date().toISOString(), id);
    const result = await env.DB.prepare(
      `UPDATE shoot_plans SET ${updates.join(", ")} WHERE id = ? RETURNING ${PLAN_COLS}`
    ).bind(...binds).first();
    if (!result) return json({ error: "not found" }, 404);
    return json({ plan: result });
  }

  if (path === "/api/browse" && method === "GET") return browse(url, env);
  if (path === "/api/browse/facets" && method === "GET") return facets(env);

  if (path === "/api/clip-actions" && method === "POST") {
    const body = await readBody<{ clip_key?: string; action_type?: string; value?: unknown }>(request);
    const key = String(body.clip_key ?? "").trim().slice(0, 400);
    const type = String(body.action_type ?? "").trim();
    let value = String(body.value ?? "").trim();
    if (!key || !["tag", "untag", "rate", "ready", "unready"].includes(type)) {
      return json({ error: "clip_key and valid action_type (tag/untag/rate/ready/unready) required" }, 400);
    }
    if (type === "rate") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 5) return json({ error: "rating must be 1-5" }, 400);
      value = String(n);
    } else if (type === "tag" || type === "untag") {
      value = value.toLowerCase().replace(/\s+/g, "-").slice(0, 40);
      if (!value) return json({ error: "tag is required" }, 400);
    } else {
      value = "";
    }
    const exists = await env.DB.prepare(`SELECT 1 AS x FROM clips WHERE ${CLIP_KEY} = ? LIMIT 1`).bind(key).first();
    if (!exists) return json({ error: "clip not found" }, 404);
    await env.DB.prepare(
      "INSERT INTO clip_actions (clip_filename, action_type, value, created_at) VALUES (?, ?, ?, ?)"
    ).bind(key, type, value || null, new Date().toISOString()).run();
    return json({ ok: true, clip_key: key, action_type: type, value });
  }

  if (path === "/api/stats" && method === "GET") {
    let tz = url.searchParams.get("tz") || "UTC";
    try { dayKey(new Date(), tz); } catch { tz = "UTC"; }
    const cutoff = new Date(Date.now() - 400 * 86400000).toISOString();
    const [total, recent] = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS c FROM clip_actions"),
      env.DB.prepare("SELECT created_at FROM clip_actions WHERE created_at >= ? ORDER BY created_at DESC LIMIT 20000").bind(cutoff),
    ]);
    const days = new Map<string, number>();
    for (const r of recent.results as { created_at: string }[]) {
      const k = dayKey(new Date(r.created_at), tz);
      days.set(k, (days.get(k) || 0) + 1);
    }
    const todayKey = dayKey(new Date(), tz);
    let streak = 0;
    let t = Date.now();
    if (!days.has(todayKey)) t -= 86400000; // streak stays alive until today ends
    while (days.has(dayKey(new Date(t), tz))) { streak++; t -= 86400000; }
    return json({
      today_count: days.get(todayKey) || 0,
      total_count: (total.results[0] as { c: number }).c,
      streak_days: streak,
    });
  }

  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") return json({ status: "ok" });

    if (url.pathname.startsWith("/api/")) {
      try {
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
          const origin = request.headers.get("Origin");
          if (origin && new URL(origin).host !== url.host) return json({ error: "cross-origin write blocked" }, 403);
        }
        const res = await route(request, env, url);
        return res ?? json({ error: "not found" }, 404);
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status);
        console.error("api error", e);
        return json({ error: "internal error" }, 500);
      }
    }

    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set("X-Content-Type-Options", "nosniff");
    out.headers.set("Referrer-Policy", "same-origin");
    out.headers.set("X-Frame-Options", "DENY");
    return out;
  },
};
