"use strict";

const $ = id => document.getElementById(id);

const ATTENDANCE_KEY = "wtmug-attendance-v2";
let students = [];
let courses = [];
let attendance = {};

try {
  attendance = JSON.parse(localStorage.getItem(ATTENDANCE_KEY) || "{}");
} catch (_) {
  attendance = {};
}

const DTMF = {
  "0": [941, 1336],
  "1": [697, 1209],
  "2": [697, 1336],
  "3": [697, 1477],
  "4": [770, 1209],
  "5": [770, 1336],
  "6": [770, 1477],
  "7": [852, 1209],
  "8": [852, 1336],
  "9": [852, 1477]
};

let audioContext = null;
let broadcastRunning = false;
let broadcastToken = 0;
let currentCode = "";

let cameraStream = null;
let cameraActive = false;
let scanFrame = 0;

let micStream = null;
let micContext = null;
let analyser = null;
let micSource = null;
let micFrame = 0;
let candidate = "";
let candidateStart = 0;
let candidateLastSeen = 0;
let partialCode = "";
let partialStarted = 0;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

async function loadData() {
  const [s, c] = await Promise.all([
    fetch("./students.json"),
    fetch("./courses.json")
  ]);

  if (!s.ok || !c.ok) throw new Error("JSON dosyaları okunamadı.");

  students = await s.json();
  courses = await c.json();
}

function fillCourses(element) {
  if (!element) return;

  element.replaceChildren();

  courses.forEach(course => {
    const option = document.createElement("option");
    option.value = course.id;
    option.textContent = course.id + " - " + course.name;
    element.append(option);
  });
}

function fillWeeks(element) {
  if (!element) return;

  element.replaceChildren();

  for (let i = 1; i <= 14; i++) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = i + ". Hafta";
    element.append(option);
  }
}

function getStudent(id) {
  return students.find(student => student.id === String(id));
}

function getCourse() {
  return courses.find(course => course.id === $("course")?.value);
}

function getWeek() {
  return Number($("week")?.value || 1);
}

function attendanceKey(course, week, student) {
  return `${course}|${week}|${student}`;
}

function saveAttendance() {
  localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(attendance));
}

// HOCA: SES YAYINI

function generateCode() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

async function playDigit(digit, token) {
  if (!audioContext || token !== broadcastToken) return;

  const ctx = audioContext;
  const frequencies = DTMF[digit];
  const start = ctx.currentTime;
  const gain = ctx.createGain();

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(0.15, start + 0.03);
  gain.gain.setValueAtTime(0.15, start + 0.58);
  gain.gain.linearRampToValueAtTime(0.0001, start + 0.65);
  gain.connect(ctx.destination);

  frequencies.forEach(frequency => {
    const oscillator = ctx.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start(start);
    oscillator.stop(start + 0.65);
  });

  await wait(650);
  try { gain.disconnect(); } catch (_) {}
  await wait(350);
}

async function publishCode(token) {
  if (!broadcastRunning || token !== broadcastToken) return;

  currentCode = generateCode();
  setText("liveCode", currentCode);
  setText("broadcastStatus", "Ses kodu yayınlanıyor.");

  for (const digit of currentCode) {
    if (!broadcastRunning || token !== broadcastToken) return;
    await playDigit(digit, token);
  }
}

async function startBroadcast() {
  if (broadcastRunning) return;

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error("Web Audio API desteklenmiyor.");

    audioContext = new AudioCtx();
    await audioContext.resume();

    broadcastRunning = true;
    const token = ++broadcastToken;

    $("startBroadcast").disabled = true;
    $("stopBroadcast").disabled = false;

    if ($("autoCamera").checked) {
      startCamera().catch(error => {
        setText("scanStatus", "Kamera hatası: " + error.message);
      });
    }

    while (broadcastRunning && token === broadcastToken) {
      const started = Date.now();

      await publishCode(token);

      if (!broadcastRunning || token !== broadcastToken) break;

      await wait(Math.max(0, 13500 - (Date.now() - started)));
    }
  } catch (error) {
    setText("broadcastStatus", "Yayın hatası: " + error.message);
    stopBroadcast();
  }
}

function stopBroadcast() {
  broadcastRunning = false;
  broadcastToken++;

  if ($("startBroadcast")) $("startBroadcast").disabled = false;
  if ($("stopBroadcast")) $("stopBroadcast").disabled = true;

  if (audioContext) {
    const ctx = audioContext;
    audioContext = null;
    ctx.close().catch(() => {});
  }

  setText("broadcastStatus", "Yayın durduruldu.");
}

// HOCA: KAMERA VE QR OKUMA

async function startCamera() {
  if (cameraActive) return;
  if (!window.jsQR) throw new Error("QR okuyucu kütüphanesi yüklenmedi.");

  cameraStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" } }
  });

  const video = $("camera");
  video.srcObject = cameraStream;
  await video.play();

  cameraActive = true;
  $("cameraToggle").textContent = "Kamerayı kapat";
  scanLoop();
}

function stopCamera() {
  cameraActive = false;
  cancelAnimationFrame(scanFrame);

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  if ($("camera")) $("camera").srcObject = null;
  if ($("cameraToggle")) $("cameraToggle").textContent = "Kamerayı aç";
  setText("scanStatus", "Kamera kapalı.");
}

function scanLoop() {
  if (!cameraActive) return;

  const video = $("camera");

  if (video.readyState >= 2 && video.videoWidth > 0) {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0);

    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = window.jsQR(frame.data, frame.width, frame.height);

    if (result) verifyQR(result.data);
  }

  if (cameraActive) scanFrame = requestAnimationFrame(scanLoop);
}

function showStudent(student) {
  const target = $("studentInfo");
  target.replaceChildren();

  [
    ["Numara", student.id],
    ["Ad", student.firstName],
    ["Soyad", student.lastName],
    ["Bölüm", student.department],
    ["Program", student.program],
    ["Sınıf", student.class]
  ].forEach(([label, value]) => {
    const p = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = label + ": ";
    p.append(strong, document.createTextNode(String(value)));
    target.append(p);
  });
}

function verifyQR(raw) {
  let data;

  try {
    data = JSON.parse(raw);
  } catch (_) {
    setText("attendanceMessage", "Geçersiz QR kodu.");
    return;
  }

  const student = getStudent(data.studentId);
  const course = getCourse();
  const code = String(data.code || "");

  if (!broadcastRunning || !/^\d{4}$/.test(code) || code !== currentCode) {
    setText("attendanceMessage", "QR kodundaki kod güncel değil.");
    return;
  }

  if (!student) {
    setText("attendanceMessage", "Öğrenci bulunamadı.");
    return;
  }

  if (!course || !course.students.includes(student.id)) {
    setText("attendanceMessage", "Öğrenci bu derse kayıtlı değil.");
    return;
  }

  const key = attendanceKey(course.id, getWeek(), student.id);

  if (attendance[key]) {
    setText("attendanceMessage", "Öğrenci bu hafta zaten yoklamaya katıldı.");
    return;
  }

  attendance[key] = {
    courseId: course.id,
    week: getWeek(),
    studentId: student.id,
    timestamp: new Date().toISOString()
  };

  try {
    saveAttendance();
  } catch (error) {
    delete attendance[key];
    setText("attendanceMessage", "Kayıt hatası: " + error.message);
    return;
  }

  showStudent(student);
  setText("attendanceMessage", "Yoklama başarılı.");

  if ($("autoCamera").checked) stopCamera();
}

// ÖĞRENCİ: MİKROFON DİNLEME

const ROWS = [697, 770, 852, 941];
const COLS = [1209, 1336, 1477];
const GRID = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"]
];

function peakNear(data, rate, size, frequency) {
  const bin = Math.round(frequency * size / rate);
  let peak = -Infinity;

  for (let i = Math.max(0, bin - 1);
       i <= Math.min(data.length - 1, bin + 1); i++) {
    peak = Math.max(peak, data[i]);
  }

  return peak;
}

function detectDigit(data) {
  const lows = ROWS.map(f => peakNear(
    data, micContext.sampleRate, analyser.fftSize, f
  ));

  const highs = COLS.map(f => peakNear(
    data, micContext.sampleRate, analyser.fftSize, f
  ));

  const lv = Math.max(...lows);
  const hv = Math.max(...highs);

  if (lv < -48 || hv < -48) return "";

  const li = lows.indexOf(lv);
  const hi = highs.indexOf(hv);

  const secondLow = Math.max(...lows.filter((_, i) => i !== li));
  const secondHigh = Math.max(...highs.filter((_, i) => i !== hi));

  if (lv - secondLow < 3 || hv - secondHigh < 3) return "";
  return GRID[li][hi];
}

function resetPartial() {
  candidate = "";
  candidateStart = 0;
  candidateLastSeen = 0;
  partialCode = "";
  partialStarted = 0;
}

function acceptDigit(digit, time) {
  if (!digit || digit === "*" || digit === "#") {
    resetPartial();
    return;
  }

  if (partialCode && time - partialStarted > 6000) {
    partialCode = "";
  }

  if (!partialCode) partialStarted = time;
  partialCode += digit;

  setText("codeStatus", `Kod algılanıyor: ${partialCode.length}/4`);

  if (partialCode.length === 4) {
    const code = partialCode;
    resetPartial();

    if ($("manualCode")) $("manualCode").value = code;

    // Öğrenci sayfasındaki bağımsız QR üreticisini kullan.
    $("testQR")?.click();
  }
}

function analyseMic() {
  if (!analyser || !micContext) return;

  const data = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(data);

  const now = performance.now();
  const digit = detectDigit(data);

  if (digit) {
    if (digit !== candidate) {
      if (candidate && now - candidateStart >= 100) {
        acceptDigit(candidate, candidateStart);
      }

      candidate = digit;
      candidateStart = now;
    }

    candidateLastSeen = now;
  } else if (candidate && now - candidateLastSeen > 140) {
    if (now - candidateStart >= 100) {
      acceptDigit(candidate, candidateStart);
    }

    candidate = "";
    candidateStart = 0;
    candidateLastSeen = 0;
  }

  if (partialCode && now - partialStarted > 6000) {
    resetPartial();
    setText("codeStatus", "Eksik kod silindi. Yeni kod bekleniyor.");
  }

  micFrame = requestAnimationFrame(analyseMic);
}

async function startListening() {
  if (!$("studentId").value.trim()) {
    setText("listenStatus", "Öğrenci numaranı gir.");
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    micContext = new AudioCtx();
    await micContext.resume();

    micSource = micContext.createMediaStreamSource(micStream);
    analyser = micContext.createAnalyser();
    analyser.fftSize = 8192;
    micSource.connect(analyser);

    resetPartial();
    $("startListening").disabled = true;
    $("stopListening").disabled = false;

    setText("listenStatus", "Mikrofon açık.");
    analyseMic();
  } catch (error) {
    stopListening();
    setText("listenStatus", "Mikrofon hatası: " + error.message);
  }
}

function stopListening() {
  cancelAnimationFrame(micFrame);

  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }

  if (micSource) {
    try { micSource.disconnect(); } catch (_) {}
    micSource = null;
  }

  if (micContext) {
    const ctx = micContext;
    micContext = null;
    ctx.close().catch(() => {});
  }

  analyser = null;
  resetPartial();

  if ($("startListening")) $("startListening").disabled = false;
  if ($("stopListening")) $("stopListening").disabled = true;
  setText("listenStatus", "Dinleme durduruldu.");
}

// RAPOR

function renderReport() {
  const course = courses.find(c => c.id === $("reportCourse")?.value);
  if (!course) return;

  const head = $("reportHead");
  const body = $("reportBody");
  head.replaceChildren();
  body.replaceChildren();

  const hr = document.createElement("tr");

  ["Öğrenci", ...Array.from({ length: 14 }, (_, i) => `${i + 1}. Hafta`), "Toplam"]
    .forEach(label => {
      const th = document.createElement("th");
      th.textContent = label;
      hr.append(th);
    });

  head.append(hr);

  let grandTotal = 0;

  course.students.forEach(id => {
    const student = getStudent(id);
    if (!student) return;

    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = `${student.id} - ${student.firstName} ${student.lastName}`;
    row.append(name);

    let total = 0;

    for (let week = 1; week <= 14; week++) {
      const present = Boolean(attendance[attendanceKey(course.id, week, id)]);
      const td = document.createElement("td");
      td.textContent = present ? "✓" : "✗";
      if (present) total++;
      row.append(td);
    }

    const td = document.createElement("td");
    td.textContent = String(total);
    row.append(td);

    grandTotal += total;
    body.append(row);
  });

  setText("reportSummary", `Toplam imza: ${grandTotal}`);
}

// SAYFA BAŞLATMA

async function init() {
  const page = document.body.dataset.page;

  // Öğrenci sayfası QR üretimi için JSON yüklenmesine bağlı değildir.
  if (page === "student") {
    $("studentId").value = localStorage.getItem("wtmug-student-id") || "";

    $("startListening").addEventListener("click", startListening);
    $("stopListening").addEventListener("click", stopListening);

    $("studentId").addEventListener("change", () => {
      localStorage.setItem("wtmug-student-id", $("studentId").value.trim());
    });
  }

  if (page !== "teacher" && page !== "report") return;

  try {
    await loadData();
  } catch (error) {
    setText("attendanceMessage", "Veri yükleme hatası: " + error.message);
    setText("reportSummary", "JSON dosyaları yüklenemedi.");
    return;
  }

  if (page === "teacher") {
    fillCourses($("course"));
    fillWeeks($("week"));

    $("startBroadcast").addEventListener("click", startBroadcast);
    $("stopBroadcast").addEventListener("click", stopBroadcast);

    $("cameraToggle").addEventListener("click", async () => {
      try {
        if (cameraActive) stopCamera();
        else await startCamera();
      } catch (error) {
        setText("scanStatus", "Kamera hatası: " + error.message);
      }
    });
  }

  if (page === "report") {
    fillCourses($("reportCourse"));
    $("reportCourse").addEventListener("change", renderReport);
    $("refreshReport").addEventListener("click", renderReport);
    renderReport();
  }
}

document.addEventListener("DOMContentLoaded", init);
