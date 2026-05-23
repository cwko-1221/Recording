const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "db.json");

const defaultDb = {
  students: [
    { id: "s-ada", name: "\u9673\u8a60\u6674", password: "123456" },
    { id: "s-ben", name: "\u674e\u4fca\u7199", password: "123456" },
    { id: "s-cara", name: "\u9ec3\u51f1\u7433", password: "123456" },
  ],
  recordings: [],
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
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
  let changed = false;
  const defaultNames = new Map(defaultDb.students.map((student) => [student.id, student.name]));
  db.students = (db.students || []).map((student) => {
    const nextStudent = { ...student };
    if (!nextStudent.password) {
      nextStudent.password = "123456";
      changed = true;
    }
    if (defaultNames.has(nextStudent.id) && (!nextStudent.name || nextStudent.name.includes("?"))) {
      nextStudent.name = defaultNames.get(nextStudent.id);
      changed = true;
    }
    return nextStudent;
  });
  db.recordings ||= [];
  if (changed) await writeDb(db);
  return db;
}

async function writeDb(db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function publicRecording(recording) {
  return {
    ...recording,
    audioUrl: recording.audioFile ? `/uploads/${recording.audioFile}` : "",
  };
}

function publicStudent(student) {
  return {
    id: student.id,
    name: student.name,
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

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/state") {
    const db = await readDb();
    sendJson(res, 200, {
      students: db.students.map(publicStudent),
      recordings: db.recordings.map(publicRecording),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login/teacher") {
    const body = await readJson(req);
    if (String(body.password || "") !== "123456") return sendError(res, 401, "Invalid teacher password");
    sendJson(res, 200, { ok: true, role: "teacher" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login/student") {
    const body = await readJson(req);
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
    const body = await readJson(req);
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
    const body = await readJson(req);
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
      mimeType: String(body.mimeType || "audio/webm"),
    };

    db.recordings.unshift(recording);
    await writeDb(db);
    sendJson(res, 201, publicRecording(recording));
    return;
  }

  const patchMatch = /^\/api\/recordings\/([^/]+)$/.exec(url.pathname);
  if (req.method === "PATCH" && patchMatch) {
    const body = await readJson(req);
    const db = await readDb();
    const recording = db.recordings.find((item) => item.id === patchMatch[1]);
    if (!recording) return sendError(res, 404, "Recording not found");

    recording.transcript = String(body.transcript || "");
    await writeDb(db);
    sendJson(res, 200, publicRecording(recording));
    return;
  }

  sendError(res, 404, "Not found");
}

async function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(ROOT, requestedPath));
  if (!filePath.startsWith(ROOT)) return sendError(res, 403, "Forbidden");

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  } catch {
    sendError(res, 404, "File not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    sendError(res, 500, error.message || "Server error");
  }
});

ensureStorage().then(() => {
  server.listen(PORT, () => {
    console.log(`Recording transcription app: http://localhost:${PORT}`);
  });
});
