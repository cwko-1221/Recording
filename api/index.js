const SUPABASE_URL = "https://mxjriwxtrwpwhukdidte.supabase.co";
const SUPABASE_KEY =
  "sb_publishable_wnBv7MoUpq5GLQoEMlQ2tQ_ebYSkFxI";

async function getBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function rpc(name, payload = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || data?.hint || `Supabase RPC ${response.status}`;
    throw new Error(message);
  }
  return data;
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, await rpc("recording_app_state"));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login/teacher") {
      const body = await getBody(req);
      if (String(body.password || "") !== "123456") return sendError(res, 401, "Invalid teacher password");
      sendJson(res, 200, { ok: true, role: "teacher" });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login/student") {
      const body = await getBody(req);
      sendJson(
        res,
        200,
        await rpc("recording_app_login_student", {
          input_student_id: body.studentId,
          input_password: String(body.password || "")
        })
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/students") {
      const body = await getBody(req);
      const name = String(body.name || "").trim();
      const password = String(body.password || "").trim();
      if (!name) return sendError(res, 400, "Student name is required");
      if (!password) return sendError(res, 400, "Student password is required");

      sendJson(
        res,
        201,
        await rpc("recording_app_create_student", {
          input_name: name,
          input_password: password,
          teacher_password: String(body.teacherPassword || "")
        })
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/recordings") {
      const body = await getBody(req);
      if (!body.studentId) return sendError(res, 400, "studentId is required");

      sendJson(
        res,
        201,
        await rpc("recording_app_create_recording", {
          input_student_id: body.studentId,
          input_student_password: String(body.studentPassword || ""),
          input_created_at: new Date().toISOString(),
          input_duration_ms: Number(body.durationMs || 0),
          input_transcript: String(body.transcript || ""),
          input_mime_type: String(body.mimeType || "audio/webm"),
          input_audio_data_url: String(body.audioDataUrl || "")
        })
      );
      return;
    }

    const patchMatch = /^\/api\/recordings\/([^/]+)$/.exec(url.pathname);
    if (req.method === "PATCH" && patchMatch) {
      const body = await getBody(req);
      sendJson(
        res,
        200,
        await rpc("recording_app_update_transcript", {
          input_recording_id: patchMatch[1],
          input_transcript: String(body.transcript || ""),
          teacher_password: String(body.teacherPassword || "")
        })
      );
      return;
    }

    sendError(res, 404, "Not found");
  } catch (error) {
    const message = error.message || "Server error";
    const status = /password|invalid/i.test(message) ? 401 : 500;
    sendError(res, status, message);
  }
};
