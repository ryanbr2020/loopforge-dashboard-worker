export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/notes" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT id, text, category, created_at FROM notes ORDER BY created_at DESC LIMIT 200"
      ).all();
      return json({ notes: results });
    }

    if (url.pathname === "/api/notes" && request.method === "POST") {
      const body = await request.json<{ text?: string; category?: string }>();
      const text = (body.text || "").trim();
      if (!text) return json({ error: "text is required" }, 400);
      const category = (body.category || "general").trim().slice(0, 40);
      const result = await env.DB.prepare(
        "INSERT INTO notes (text, category, created_at) VALUES (?, ?, ?) RETURNING id, text, category, created_at"
      )
        .bind(text.slice(0, 4000), category, new Date().toISOString())
        .first();
      return json({ note: result }, 201);
    }

    if (url.pathname.startsWith("/api/notes/") && request.method === "DELETE") {
      const id = url.pathname.split("/").pop();
      await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }

    if (url.pathname === "/api/plans" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT id, title, date, location, target_content, notes, status, created_at, updated_at FROM shoot_plans ORDER BY date ASC, created_at DESC"
      ).all();
      return json({ plans: results });
    }

    if (url.pathname === "/api/plans" && request.method === "POST") {
      const body = await request.json<{ title?: string; date?: string; location?: string; target_content?: string; notes?: string }>();
      const title = (body.title || "").trim().slice(0, 200);
      const date = (body.date || "").trim().slice(0, 10);
      const location = (body.location || "").trim().slice(0, 200);
      const target = (body.target_content || "").trim().slice(0, 200);
      const notes = (body.notes || "").trim().slice(0, 2000);

      if (!title || !date || !location) return json({ error: "title, date, location required" }, 400);

      const now = new Date().toISOString();
      const result = await env.DB.prepare(
        "INSERT INTO shoot_plans (title, date, location, target_content, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'planned', ?, ?) RETURNING id, title, date, location, target_content, notes, status, created_at, updated_at"
      )
        .bind(title, date, location, target, notes || null, now, now)
        .first();
      return json({ plan: result }, 201);
    }

    if (url.pathname.startsWith("/api/plans/") && request.method === "DELETE") {
      const id = url.pathname.split("/").pop();
      await env.DB.prepare("DELETE FROM shoot_plans WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }

    if (url.pathname.startsWith("/api/plans/") && request.method === "PUT") {
      const id = url.pathname.split("/").pop();
      const body = await request.json<{ status?: string; notes?: string }>();
      const status = (body.status || "").trim();
      const notes = body.notes !== undefined ? (body.notes || "").trim().slice(0, 2000) : null;
      const now = new Date().toISOString();

      if (status && !["planned", "scouted", "shot", "archived"].includes(status)) {
        return json({ error: "invalid status" }, 400);
      }

      const updates = [];
      const binds: unknown[] = [];
      if (status) { updates.push("status = ?"); binds.push(status); }
      if (notes !== null) { updates.push("notes = ?"); binds.push(notes); }
      updates.push("updated_at = ?");
      binds.push(now);
      binds.push(id);

      const result = await env.DB.prepare(
        `UPDATE shoot_plans SET ${updates.join(", ")} WHERE id = ? RETURNING id, title, date, location, target_content, notes, status, created_at, updated_at`
      ).bind(...binds).first();
      return json({ plan: result });
    }

    if (url.pathname === "/api/projects" && request.method === "GET") {
      try {
        const { results } = await env.DB.prepare(
          "SELECT id, name, location, duration, loop_score, loop_grade, file_path, created_at, updated_at FROM projects ORDER BY updated_at DESC LIMIT 100"
        ).all();
        return json({ projects: results || [] });
      } catch (e) {
        // Projects table may not exist yet or migration hasn't run
        // Return empty array to show "No projects yet" message
        return json({ projects: [], note: "Projects table not yet available. Upload videos via localhost:5000 to populate." });
      }
    }

    if (url.pathname === "/health") {
      return json({ status: "ok" });
    }

    // Serve static assets (dashboard UI, docs, etc.)
    // Worker handles ONLY dashboard routes (READ-ONLY for research):
    // - / → research/planning dashboard
    // - /api/plans/* → shoot planning
    // - /api/notes/* → research notes
    // - /api/projects → video library (read-only, no upload/processing)
    // - /docs/* → documentation
    //
    // All PROCESSING routes (upload, export, analyze) are on the
    // Flask app running on the local machine (localhost:5000 only).
    // This dashboard is strictly for review and research, not processing.
    return env.ASSETS.fetch(request);
  },
};
