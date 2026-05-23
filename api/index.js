const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const DATA_DIR = process.env.VERCEL ? path.join("/tmp", "recording-app") : path.join(__dirname, "..", "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "db.json");

const defaultDb = {
  students: [
    { id: "s-ada", name: "\u9673\u8a60\u6674", password: "123456" },
    { id: "s-ben", name: "\u674e\u4fca\u7199", password: "123456" },
    { id: "s-cara", name: "\u9ec3\u51f1\u7433", password: "123456" }
  ],
  recordings: []
};

const mimeTypes = {
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav"
};

async function ensureStorage() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch {
    await writeDb(defaultDb);
  }
}

async function readDb() {
  await ensureStorage();
  const raw = await fs.readFile(DB_PATH, "utf8");
  const db = JSON.parse(raw);
  db.students ||= [];
  db.recordings ||= [];
  return db;
}

async function writeDb(db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
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

function publicStudent(student) {
  return {
    id: student.id,
    name: student.name
  };
}

function publicRecording(recording) {
  return {
    ...recording,
    audioUrl: recording.audioFile ? `/api/uploads/${recording.audioFile}` : ""
  };
}

function audioExtension(mimeType = "") {
  if (mimeType.includes("ogg")) return ".ogg";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return ".mp3";
  if (mimeType.includes("wav")) return ".wav";
  return ".webm";
}

async function saveAudioDataUrl(dataUrl, mimeType) {
  if (!dataUrl) return "";
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid audio data");

  const resolvedMimeType = mimeType || match[1];
  const buffer = Buffer.from(match[2], "base64");
  const filename = `${crypto.randomUUID()}${audioExtension(resolvedMimeType)}`;
  await fs.writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return filename;
}

async function getBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveUpload(res, filename) {
  const safeName = path.basename(filename);
  const filePath = path.join(UPLOAD_DIR, safeName);
  const content = await fs.readFile(filePath);
  res.statusCode = 200;
  res.setHeader("Content-Type", mimeTypes[path.extname(safeName).toLowerCase()] || "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  res.end(content);
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/state") {
      const db = await readDb();
      sendJson(res, 200, {
        students: db.students.map(publicStudent),
        recordings: db.recordings.map(publicRecording)
      });
      return;
    }

    const uploadMatch = /^\/api\/uploads\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && uploadMatch) {
      await serveUpload(res, uploadMatch[1]);
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
      const db = await readDb();
      const student = db.students.find((item) => item.id === body.studentId);
      if (!student) return sendError(res, 404, "Student not found");
      if (String(body.password || "") !== String(student.password || "")) {
        return sendError(res, 401, "Invalid student password");
      }
      sendJson(res, 200, { ok: true, role: "student", student: publicStudent(student) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/students") {
      const body = await getBody(req);
      const name = String(body.name || "").trim();
      const password = String(body.password || "").trim();
      if (!name) return sendError(res, 400, "Student name is required");
      if (!password) return sendError(res, 400, "Student password is required");

      const db = await readDb();
      const student = { id: crypto.randomUUID(), name, password };
      db.students.push(student);
      await writeDb(db);
      sendJson(res, 201, publicStudent(student));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/recordings") {
      const body = await getBody(req);
      if (!body.studentId) return sendError(res, 400, "studentId is required");

      const db = await readDb();
      const studentExists = db.students.some((student) => student.id === body.studentId);
      if (!studentExists) return sendError(res, 404, "Student not found");

      const audioFile = await saveAudioDataUrl(body.audioDataUrl || "", body.mimeType || "");
      const recording = {
        id: crypto.randomUUID(),
        studentId: body.studentId,
        createdAt: body.createdAt || new Date().toISOString(),
        durationMs: Number(body.durationMs || 0),
        transcript: String(body.transcript || ""),
        audioFile,
        mimeType: String(body.mimeType || "audio/webm")
      };

      db.recordings.unshift(recording);
      await writeDb(db);
      sendJson(res, 201, publicRecording(recording));
      return;
    }

    const patchMatch = /^\/api\/recordings\/([^/]+)$/.exec(url.pathname);
    if (req.method === "PATCH" && patchMatch) {
      const body = await getBody(req);
      const db = await readDb();
      const recording = db.recordings.find((item) => item.id === patchMatch[1]);
      if (!recording) return sendError(res, 404, "Recording not found");

      recording.transcript = String(body.transcript || "");
      await writeDb(db);
      sendJson(res, 200, publicRecording(recording));
      return;
    }

    sendError(res, 404, "Not found");
  } catch (error) {
    sendError(res, 500, error.message || "Server error");
  }
};
