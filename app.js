const API_BASE = "";
const FALLBACK_STORAGE_KEY = "speech-school-state-v2";

const text = {
  defaultStudent: "\u9673\u8a60\u6674",
  secondStudent: "\u674e\u4fca\u7199",
  thirdStudent: "\u9ec3\u51f1\u7433",
  student: "\u5b78\u751f",
  recording: "\u9304\u97f3",
  records: "\u9304\u97f3\u7d00\u9304",
  noRecordings: "\u5c1a\u672a\u6709\u9304\u97f3",
  notTranscribed: "\u5c1a\u672a\u8f49\u6210\u6587\u5b57",
  browserNoRecord: "\u6b64\u700f\u89bd\u5668\u4e0d\u652f\u63f4\u9304\u97f3\u3002",
  askMic: "\u672a\u53d6\u5f97\u9ea5\u514b\u98a8\u6b0a\u9650\uff0c\u8acb\u5141\u8a31\u700f\u89bd\u5668\u4f7f\u7528\u9ea5\u514b\u98a8\u3002",
  recordingNow: "\u9304\u97f3\u4e2d...",
  startRecording: "\u958b\u59cb\u9304\u97f3",
  stopRecording: "\u505c\u6b62\u9304\u97f3",
  done: "\u9304\u97f3\u5b8c\u6210\uff0c\u5df2\u5132\u5b58\u5230\u8001\u5e2b\u4ecb\u9762\u3002",
  doneLocal: "\u9304\u97f3\u5b8c\u6210\uff0c\u76ee\u524d\u4ee5\u672c\u6a5f\u6a21\u5f0f\u5132\u5b58\u3002",
  liveTranscript: "\u6b63\u5728\u8f49\u6587\u5b57\uff1a",
  speechUnavailable: "\u9304\u97f3\u4e2d\uff1b\u6b64\u700f\u89bd\u5668\u66ab\u6642\u672a\u80fd\u5373\u6642\u8f49\u6587\u5b57\u3002",
  teacherCodeWrong: "\u8001\u5e2b\u5bc6\u78bc\u4e0d\u6b63\u78ba\u3002",
  studentPasswordWrong: "\u5b78\u751f\u5bc6\u78bc\u4e0d\u6b63\u78ba\u3002",
  studentPasswordRequired: "\u8acb\u8f38\u5165\u5b78\u751f\u5bc6\u78bc\u3002",
  transcriptFallback: "\u6b64\u9304\u97f3\u5c1a\u672a\u6709\u8f49\u6587\u5b57\u7d50\u679c\u3002\u5982\u700f\u89bd\u5668\u652f\u63f4\u8a9e\u97f3\u8fa8\u8b58\uff0c\u5b78\u751f\u9304\u97f3\u6642\u6703\u81ea\u52d5\u5132\u5b58\u6587\u5b57\u3002",
  backendOffline: "\u5f8c\u7aef\u672a\u555f\u52d5\uff0c\u5df2\u4f7f\u7528\u672c\u6a5f\u66ab\u5b58\u6a21\u5f0f\u3002",
  demoTranscript: "\u5927\u5bb6\u597d\uff0c\u6211\u4eca\u5929\u6717\u8b80\u7684\u984c\u76ee\u662f\u6211\u7684\u6821\u5712\u751f\u6d3b\u3002\u6211\u6700\u559c\u6b61\u5c0f\u606f\u6642\u548c\u540c\u5b78\u4e00\u8d77\u7df4\u7fd2\u5ee3\u6771\u8a71\u3002",
};

const initialState = {
  students: [
    { id: "s-ada", name: text.defaultStudent },
    { id: "s-ben", name: text.secondStudent },
    { id: "s-cara", name: text.thirdStudent },
  ],
  recordings: [],
};

let state = structuredClone(initialState);
let backendOnline = false;
let selectedStudentId = null;
let activeStudentId = null;
let activeStudentPassword = "";
let activeTeacherPassword = "";
let mediaRecorder = null;
let audioChunks = [];
let speechRecognition = null;
let liveTranscript = "";

const studentSelect = document.querySelector("#studentSelect");
const studentList = document.querySelector("#studentList");
const recordingsList = document.querySelector("#recordingsList");
const selectedStudentName = document.querySelector("#selectedStudentName");
const selectedStudentMeta = document.querySelector("#selectedStudentMeta");
const studentNameLabel = document.querySelector("#studentNameLabel");
const recordButton = document.querySelector("#recordButton");
const recordStatus = document.querySelector("#recordStatus");
const recordOrb = document.querySelector("#recordOrb");

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json();
}

function loadLocalState() {
  const saved = localStorage.getItem(FALLBACK_STORAGE_KEY);
  if (!saved) return structuredClone(initialState);
  try {
    return JSON.parse(saved);
  } catch {
    return structuredClone(initialState);
  }
}

function saveLocalState() {
  const serializable = {
    students: state.students,
    recordings: state.recordings.map(({ audioUrl, audioDataUrl, ...recording }) => ({
      ...recording,
      audioDataUrl: audioDataUrl || null,
    })),
  };
  localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(serializable));
}

async function loadState() {
  try {
    state = await api("/api/state");
    backendOnline = true;
  } catch {
    state = loadLocalState();
    backendOnline = false;
    recordStatus.textContent = text.backendOffline;
  }

  selectedStudentId = selectedStudentId || state.students[0]?.id || null;
  activeStudentId = activeStudentId || state.students[0]?.id || null;
  renderAll();
}

async function loginTeacher(password) {
  if (backendOnline) {
    try {
      await api("/api/login/teacher", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

async function loginStudent(studentId, password) {
  if (backendOnline) {
    try {
      await api("/api/login/student", {
        method: "POST",
        body: JSON.stringify({ studentId, password }),
      });
      return true;
    } catch {
      return false;
    }
  }
  const student = state.students.find((item) => item.id === studentId);
  return Boolean(student?.password) && String(student.password) === password;
}

function updateRoute() {
  const route = window.location.hash.replace("#", "") || "home";
  const allowedRoutes = new Set(["home", "login", "student", "teacher"]);
  document.body.dataset.route = allowedRoutes.has(route) ? route : "home";
}

function renderAll() {
  updateRoute();
  renderStudentOptions();
  renderStudentList();
  renderTeacherRecordings();
  renderStudentLabel();
}

function renderStudentOptions() {
  studentSelect.innerHTML = "";
  state.students.forEach((student) => {
    const option = document.createElement("option");
    option.value = student.id;
    option.textContent = student.name;
    studentSelect.append(option);
  });
  studentSelect.value = activeStudentId || "";
}

function renderStudentList() {
  studentList.innerHTML = "";
  state.students.forEach((student) => {
    const count = state.recordings.filter((recording) => recording.studentId === student.id).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `student-item${student.id === selectedStudentId ? " is-active" : ""}`;
    button.innerHTML = `<span>${escapeHtml(student.name)}</span><span>${count}</span>`;
    button.addEventListener("click", () => {
      selectedStudentId = student.id;
      renderAll();
    });
    studentList.append(button);
  });
}

function renderTeacherRecordings() {
  const student = state.students.find((item) => item.id === selectedStudentId);
  selectedStudentName.textContent = student ? `${student.name} | ${text.records}` : text.records;

  const rows = state.recordings.filter((recording) => recording.studentId === selectedStudentId);
  selectedStudentMeta.textContent = `${rows.length} ${text.recording}`;
  recordingsList.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = text.noRecordings;
    recordingsList.append(empty);
    return;
  }

  rows.forEach((recording, index) => {
    const node = document.querySelector("#recordingTemplate").content.cloneNode(true);
    const row = node.querySelector(".recording-row");
    const title = node.querySelector("strong");
    const meta = node.querySelector("span");
    const audio = node.querySelector("audio");
    const button = node.querySelector(".transcript-button");
    const textarea = node.querySelector("textarea");

    title.textContent = `${text.recording} ${rows.length - index}`;
    meta.textContent = `${recording.createdAt} | ${formatDuration(recording.durationMs)}`;
    textarea.value = recording.transcript || text.notTranscribed;

    audio.src = recording.audioUrl || recording.audioDataUrl || "";
    if (!audio.src) {
      audio.replaceWith(unavailableAudioLabel());
    }

    button.addEventListener("click", async () => {
      const transcript = textarea.value.trim();
      const nextTranscript = transcript && transcript !== text.notTranscribed ? transcript : text.transcriptFallback;
      recording.transcript = nextTranscript;
      textarea.value = nextTranscript;
      await saveTranscript(recording.id, nextTranscript);
    });

    textarea.addEventListener("change", async () => {
      recording.transcript = textarea.value.trim();
      await saveTranscript(recording.id, recording.transcript);
    });

    recordingsList.append(row);
  });
}

function unavailableAudioLabel() {
  const label = document.createElement("p");
  label.className = "status-line";
  label.textContent = "Audio file unavailable.";
  return label;
}

function renderStudentLabel() {
  const student = state.students.find((item) => item.id === activeStudentId);
  studentNameLabel.textContent = student ? student.name : text.student;
}

function formatDuration(ms) {
  if (!ms) return "< 1 sec";
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `${seconds} sec`;
}

function setupQrCode() {
  const qrImage = document.querySelector("#qrImage");
  const loginUrl = new URL("#login", window.location.href).href;
  qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(loginUrl)}`;
  qrImage.addEventListener("error", () => {
    qrImage.hidden = true;
  });
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const recognition = new SpeechRecognition();
  recognition.lang = "zh-HK";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    liveTranscript = Array.from(event.results)
      .map((result) => result[0]?.transcript || "")
      .join("")
      .trim();
    if (liveTranscript) recordStatus.textContent = `${text.liveTranscript}${liveTranscript}`;
  };
  recognition.onerror = () => {
    recordStatus.textContent = text.speechUnavailable;
  };
  return recognition;
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) {
    recordStatus.textContent = text.browserNoRecord;
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    mediaRecorder = recorder;
    audioChunks = [];
    liveTranscript = "";
    const startedAt = Date.now();

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    });

    recorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((track) => track.stop());
      mediaRecorder = null;
      speechRecognition = null;

      const blob = new Blob(audioChunks, { type: recorder.mimeType || "audio/webm" });
      const durationMs = Date.now() - startedAt;
      const audioDataUrl = await blobToDataUrl(blob);
      const createdAt = new Intl.DateTimeFormat("zh-HK", { dateStyle: "medium", timeStyle: "short" }).format(new Date());

      const recording = await createRecording({
        studentId: activeStudentId,
        studentPassword: activeStudentPassword,
        createdAt,
        durationMs,
        transcript: liveTranscript,
        mimeType: blob.type,
        audioDataUrl,
      });

      selectedStudentId = activeStudentId;
      recordStatus.textContent = backendOnline ? text.done : text.doneLocal;
      if (recording) renderAll();
    });

    speechRecognition = setupSpeechRecognition();
    speechRecognition?.start();
    recorder.start();
    recordButton.textContent = text.stopRecording;
    recordOrb.classList.add("is-recording");
    recordStatus.textContent = text.recordingNow;
  } catch {
    recordStatus.textContent = text.askMic;
  }
}

function stopRecording() {
  try {
    speechRecognition?.stop();
  } catch {
    // Some browsers throw if recognition is already stopped.
  }
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
  recordButton.textContent = text.startRecording;
  recordOrb.classList.remove("is-recording");
}

async function createRecording(payload) {
  if (backendOnline) {
    try {
      const recording = await api("/api/recordings", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.recordings.unshift(recording);
      return recording;
    } catch {
      backendOnline = false;
    }
  }

  const localRecording = {
    id: crypto.randomUUID(),
    studentId: payload.studentId,
    createdAt: payload.createdAt,
    durationMs: payload.durationMs,
    transcript: payload.transcript,
    audioDataUrl: payload.audioDataUrl,
  };
  state.recordings.unshift(localRecording);
  saveLocalState();
  return localRecording;
}

async function saveTranscript(recordingId, transcript) {
  if (backendOnline) {
    try {
      await api(`/api/recordings/${recordingId}`, {
        method: "PATCH",
        body: JSON.stringify({ transcript, teacherPassword: activeTeacherPassword }),
      });
      return;
    } catch {
      backendOnline = false;
    }
  }
  saveLocalState();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.querySelector("#studentLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const studentId = studentSelect.value;
  const password = document.querySelector("#studentPassword").value.trim();
  if (!password) {
    alert(text.studentPasswordRequired);
    return;
  }
  const ok = await loginStudent(studentId, password);
  if (!ok) {
    alert(text.studentPasswordWrong);
    return;
  }
  activeStudentId = studentId;
  activeStudentPassword = password;
  window.location.hash = "student";
  renderStudentLabel();
});

document.querySelector("#teacherLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = document.querySelector("#teacherCode").value.trim();
  const ok = await loginTeacher(code);
  if (!ok) {
    alert(text.teacherCodeWrong);
    return;
  }
  activeTeacherPassword = code;
  window.location.hash = "teacher";
});

document.querySelector("#addStudentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#newStudentName");
  const passwordInput = document.querySelector("#newStudentPassword");
  const name = input.value.trim();
  const password = passwordInput.value.trim();
  if (!name || !password) return;

  let student;
  if (backendOnline) {
    try {
      student = await api("/api/students", {
        method: "POST",
        body: JSON.stringify({ name, password, teacherPassword: activeTeacherPassword }),
      });
    } catch {
      backendOnline = false;
    }
  }

  if (!student) {
    student = { id: crypto.randomUUID(), name, password };
    state.students.push(student);
    saveLocalState();
  } else {
    state.students.push(student);
  }

  selectedStudentId = student.id;
  activeStudentId = student.id;
  input.value = "";
  passwordInput.value = "";
  renderAll();
});

recordButton.addEventListener("click", () => {
  if (mediaRecorder?.state === "recording") stopRecording();
  else startRecording();
});

document.querySelector("#seedDemoButton").addEventListener("click", async () => {
  const demoStudent = state.students[0];
  const createdAt = new Intl.DateTimeFormat("zh-HK", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const recording = {
    studentId: demoStudent.id,
    studentPassword: "123456",
    createdAt,
    durationMs: 24000,
    transcript: text.demoTranscript,
    mimeType: "audio/webm",
    audioDataUrl: "",
  };

  if (backendOnline) {
    try {
      state.recordings.unshift(await api("/api/recordings", { method: "POST", body: JSON.stringify(recording) }));
    } catch {
      backendOnline = false;
    }
  }

  if (!backendOnline) {
    state.recordings.unshift({ ...recording, id: crypto.randomUUID() });
    saveLocalState();
  }

  selectedStudentId = demoStudent.id;
  renderAll();
  window.location.hash = "teacher";
});

document.querySelector("#refreshButton").addEventListener("click", loadState);
window.addEventListener("hashchange", updateRoute);

setupQrCode();
loadState();
