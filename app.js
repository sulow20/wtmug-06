
"use strict";

const $ = id => document.getElementById(id);

const ATTENDANCE_KEY = "wtmug-attendance-v1";
const STUDENT_KEY = "wtmug-student-id";

let students = [];
let courses = [];
let attendance = readAttendance();

function readAttendance() {
  try {
    return JSON.parse(localStorage.getItem(ATTENDANCE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveAttendance() {
  localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(attendance));
}

async function loadData() {
  const [studentResponse, courseResponse] = await Promise.all([
    fetch("./students.json"),
    fetch("./courses.json")
  ]);

  if (!studentResponse.ok || !courseResponse.ok) {
    throw new Error("students.json veya courses.json yüklenemedi.");
  }

  students = await studentResponse.json();
  courses = await courseResponse.json();
}

function fillCourses(select) {
  if (!select) return;

  select.replaceChildren();

  for (const course of courses) {
    const option = document.createElement("option");
    option.value = course.id;
    option.textContent = `${course.id} — ${course.name}`;
    select.append(option);
  }
}

function fillWeeks(select) {
  if (!select) return;

  select.replaceChildren();

  for (let week = 1; week <= 14; week++) {
    const option = document.createElement("option");
    option.value = String(week);
    option.textContent = `${week}. Hafta`;
    select.append(option);
  }
}

function getStudent(id) {
  return students.find(student => String(student.id) === String(id));
}

function getCourse() {
  return courses.find(course => course.id === $("course")?.value);
}

function getWeek() {
  return Number($("week")?.value || 1);
}

function keyFor(courseId, week, studentId) {
  return `${courseId}|${week}|${studentId}`;
}

function showMessage(text, type = "") {
  const element = $("attendanceMessage");
  if (!element) return;

  element.textContent = text;
  element.className = type;
}

function showStudent(student) {
  const target = $("studentInfo");
  if (!target) return;

  target.replaceChildren();

  if (!student) {
    target.textContent = "Öğrenci bulunamadı.";
    return;
  }

  const fields = [
    ["Öğrenci numarası", student.id],
    ["Ad", student.firstName],
    ["Soyad", student.lastName],
    ["Bölüm", student.department],
    ["Program", student.program],
    ["Sınıf", student.class]
  ];

  for (const [label, value] of fields) {
    const p = document.createElement("p");
    const strong = document.createElement("strong");

    strong.textContent = label + ": ";
    p.append(strong, document.createTextNode(String(value)));
    target.append(p);
  }
}

// --------------------------------------------------
// HOCA: DTMF SES YAYINI
// --------------------------------------------------

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
let broadcastBusy = false;
let broadcastTimer = null;
let currentCode = "";
let broadcastStartedAt = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function generateCode() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

async function playDigit(digit) {
  const [lowFrequency, highFrequency] = DTMF[digit];
  const start = audioContext.currentTime;

  const gain = audioContext.createGain(); }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime (0.14, start + 0 )