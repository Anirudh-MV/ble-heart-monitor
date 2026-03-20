const appUI = document.querySelector(".ui");
const bpmTxt = document.querySelector(".bpm");
const stopBTN = document.querySelector(".stop");
const heartUI = document.querySelector(".heart");
const startBTN = document.querySelector(".start");
const errorTxt = document.querySelector(".error");
const exportBTN = document.querySelector(".export");
const connectBTN = document.querySelector(".connect");
const connectUI = document.querySelector(".connect-ui");
const lowerLimitSel = document.querySelector(".lower-limit");
const upperLimitSel = document.querySelector(".upper-limit");
const alertSecondsInput = document.querySelector(".alert-seconds");
const lowerAudio = document.querySelector(".audio-lower");
const upperAudio = document.querySelector(".audio-upper");
const withinAudio = document.querySelector(".audio-within");
const batteryTxt = document.querySelector(".battery-level");

let device;
let heartRate;

// Recording state
let isRecording = false;
let recordingData = [];

// IndexedDB name / store
const DB_NAME = "bthm-db";
const DB_VERSION = 1;
const STORE_SESSIONS = "sessions";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function closeDB(db) {
  try { db.close(); } catch (e) {}
}

// Alert state
let lowerBreachStart = null;
let upperBreachStart = null;
let lowerAlertFired = false;
let upperAlertFired = false;
let withinRangeStart = null;
let withinAlertFired = false;

// Populate BPM dropdowns (30–220, step 5)
for (let bpm = 30; bpm <= 220; bpm += 5) {
  const optLower = document.createElement("option");
  optLower.value = bpm;
  optLower.textContent = bpm;
  if (bpm === 120) optLower.selected = true;
  lowerLimitSel.appendChild(optLower);

  const optUpper = document.createElement("option");
  optUpper.value = bpm;
  optUpper.textContent = bpm;
  if (bpm === 145) optUpper.selected = true;
  upperLimitSel.appendChild(optUpper);
}

// Enforce whole numbers >= 0 on the seconds input
alertSecondsInput.addEventListener("input", () => {
  const raw = alertSecondsInput.value;
  // Strip anything that's not a digit
  const cleaned = raw.replace(/[^0-9]/g, "");
  const num = parseInt(cleaned, 10);
  alertSecondsInput.value = isNaN(num) ? "" : String(num);
});

function parseHeartRate(value) {
  let is16Bits = value.getUint8(0) & 0x1;
  if (is16Bits) return value.getUint16(1, true);
  return value.getUint8(1);
}

function getAlertSeconds() {
  const val = parseInt(alertSecondsInput.value, 10);
  // 0 means disabled; empty/invalid falls back to default of 5
  if (isNaN(val) || val < 0) return 5;
  return val;
}

function checkAlerts(bpm) {
  const lowerLimit = lowerLimitSel.value ? parseInt(lowerLimitSel.value, 10) : null;
  const upperLimit = upperLimitSel.value ? parseInt(upperLimitSel.value, 10) : null;
  const alertSeconds = getAlertSeconds();
  const thresholdMs = alertSeconds === 0 ? null : alertSeconds * 1000;

  const now = Date.now();

  // --- Lower limit check ---
  if (lowerLimit !== null && thresholdMs !== null && bpm < lowerLimit) {
    if (lowerBreachStart === null) {
      lowerBreachStart = now;
      lowerAlertFired = false;
    } else if (!lowerAlertFired && now - lowerBreachStart >= thresholdMs) {
      lowerAudio.currentTime = 0;
      lowerAudio.play();
      lowerAlertFired = true;
    }
  } else {
    lowerBreachStart = null;
    lowerAlertFired = false;
  }

  // --- Upper limit check ---
  if (upperLimit !== null && thresholdMs !== null && bpm > upperLimit) {
    if (upperBreachStart === null) {
      upperBreachStart = now;
      upperAlertFired = false;
    } else if (!upperAlertFired && now - upperBreachStart >= thresholdMs) {
      upperAudio.currentTime = 0;
      upperAudio.play();
      upperAlertFired = true;
    }
  } else {
    upperBreachStart = null;
    upperAlertFired = false;
  }

  // --- Within range check ---
  // "In range" means: not breaching lower limit AND not breaching upper limit
  // Only meaningful when at least one limit is configured
  const hasLimit = lowerLimit !== null || upperLimit !== null;
  const inRange =
    hasLimit &&
    (lowerLimit === null || bpm >= lowerLimit) &&
    (upperLimit === null || bpm <= upperLimit);

  if (inRange && thresholdMs !== null) {
    if (withinRangeStart === null) {
      withinRangeStart = now;
      withinAlertFired = false;
    } else if (!withinAlertFired && now - withinRangeStart >= thresholdMs) {
      withinAudio.currentTime = 0;
      withinAudio.play();
      withinAlertFired = true;
    }
  } else {
    withinRangeStart = null;
    withinAlertFired = false;
  }
}

function handleRateChange(event) {
  const bpm = parseHeartRate(event.target.value);
  bpmTxt.textContent = bpm;

  if (isRecording) {
    recordingData.push({ timestamp: Date.now(), bpm });
  }

  checkAlerts(bpm);
}

async function requestDevice() {
  //only works for devices advertising heart rate service
  const _options = { filters: [{ services: ["heart_rate"] }] };

  const options = {
    acceptAllDevices: true,
    // include battery_service so the app can read battery level if the device exposes it
    optionalServices: ["heart_rate", "battery_service"],
  };
  device = await navigator.bluetooth.requestDevice(options);
  device.addEventListener("gattserverdisconnected", connectDevice);
}

async function connectDevice() {
  if (device.gatt.connected) return;

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService("heart_rate");

  heartRate = await service.getCharacteristic("heart_rate_measurement");
  heartRate.addEventListener("characteristicvaluechanged", handleRateChange);
  console.log("connected");

  // Try to read battery level if the device exposes the Battery Service
  try {
    const batteryService = await server.getPrimaryService("battery_service");
    const batteryChar = await batteryService.getCharacteristic("battery_level");
    const v = await batteryChar.readValue();
    if (batteryTxt) batteryTxt.textContent = `Battery: ${v.getUint8(0)}%`;
    // Start notifications if supported so the UI stays up to date
    if (batteryChar.properties.notify) {
      batteryChar.addEventListener("characteristicvaluechanged", (ev) => {
        const val = ev.target.value.getUint8(0);
        if (batteryTxt) batteryTxt.textContent = `Battery: ${val}%`;
      });
      try { await batteryChar.startNotifications(); } catch (e) { /* ignore */ }
    }
  } catch (e) {
    // Battery service not available or not permitted — leave indicator as-is
    console.debug('Battery service unavailable', e && e.message);
  }
}

async function startMonitoring() {
  isRecording = true;
  recordingData = [];
  exportBTN.classList.add("hide");
  startBTN.disabled = true;
  stopBTN.disabled = false;

  // Reset alert state on new session
  lowerBreachStart = null;
  upperBreachStart = null;
  lowerAlertFired = false;
  upperAlertFired = false;
  withinRangeStart = null;
  withinAlertFired = false;

}

async function stopMonitoring() {
  isRecording = false;
  startBTN.disabled = false;
  stopBTN.disabled = true;
  // Save session to history if any data was recorded
  if (recordingData.length > 0) {
    saveSession(recordingData);
    exportBTN.classList.remove("hide");
  }
}

function exportCSV() {
  const rows = ["timestamp,bpm"];
  for (const entry of recordingData) {
    const iso = new Date(entry.timestamp).toISOString();
    rows.push(`${iso},${entry.bpm}`);
  }
  const csv = rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const date = new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-");
  const a = document.createElement("a");
  a.href = url;
  a.download = `heartrate-${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Persist a completed session to localStorage
async function saveSession(readings) {
  const db = await openDB();
  const tx = db.transaction(STORE_SESSIONS, "readwrite");
  const store = tx.objectStore(STORE_SESSIONS);
  const id = new Date().toISOString();
  const label = new Date(id).toLocaleString();
  const record = { id, label, readings: readings.map(r => ({ timestamp: new Date(r.timestamp).toISOString(), bpm: r.bpm })) };
  store.add(record);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { closeDB(db); resolve(record); };
    tx.onerror = (e) => { closeDB(db); reject(e.target.error); };
  });
}

async function getAllSessions() {
  const db = await openDB();
  const tx = db.transaction(STORE_SESSIONS, "readonly");
  const store = tx.objectStore(STORE_SESSIONS);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => { closeDB(db); resolve(req.result); };
    req.onerror = (e) => { closeDB(db); reject(e.target.error); };
  });
}

async function getSessionById(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_SESSIONS, "readonly");
  const store = tx.objectStore(STORE_SESSIONS);
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => { closeDB(db); resolve(req.result); };
    req.onerror = (e) => { closeDB(db); reject(e.target.error); };
  });
}

async function deleteSessionById(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_SESSIONS, "readwrite");
  const store = tx.objectStore(STORE_SESSIONS);
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    tx.oncomplete = () => { closeDB(db); resolve(); };
    tx.onerror = (e) => { closeDB(db); reject(e.target.error); };
  });
}

// Export a historic session by id
async function exportHistoricSession(sessionId) {
  const s = await getSessionById(sessionId);
  if (!s) return alert("Session not found");
  const rows = ["timestamp,bpm"];
  for (const entry of s.readings) rows.push(`${entry.timestamp},${entry.bpm}`);
  const csv = rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `heartrate-${s.id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// UI: Export history via native select picker
const sessionPicker = document.querySelector(".session-picker");

document.querySelectorAll(".export-history").forEach(btn =>
  btn.addEventListener("click", openHistoryPicker)
);
sessionPicker.addEventListener("change", () => {
  const id = sessionPicker.value;
  sessionPicker.value = "";
  if (id) exportHistoricSession(id);
});

async function openHistoryPicker() {
  const sessions = await getAllSessions();
  sessionPicker.innerHTML = '<option value="" disabled selected>Select a session</option>';
  if (!sessions || sessions.length === 0) {
    sessionPicker.innerHTML = '<option value="" disabled selected>No saved sessions</option>';
  } else {
    for (const s of sessions.slice().reverse()) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.label;
      sessionPicker.appendChild(opt);
    }
  }
  sessionPicker.showPicker();
}

async function disconnect() {
  if (isRecording) await stopMonitoring();
  if (device && device.gatt.connected) device.gatt.disconnect();
  bpmTxt.textContent = "--";
  appUI.classList.add("hide");
  connectUI.classList.remove("hide");
  connectBTN.textContent = "connect";
  device = null;
  heartRate = null;
}

async function init() {
  if (!navigator.bluetooth) return errorTxt.classList.remove("hide");
  if (!device) await requestDevice();

  connectBTN.textContent = "connecting...";
  await connectDevice();

  appUI.classList.remove("hide");
  connectUI.classList.add("hide");
  // Start receiving live heart rate notifications so the BPM is visible
  // Recording will only start when the user presses Start
  if (heartRate) {
    await heartRate.startNotifications();
  }
}

const disconnectBTN = document.querySelector(".disconnect");

connectBTN.addEventListener("click", init);
disconnectBTN.addEventListener("click", disconnect);
stopBTN.addEventListener("click", stopMonitoring);
startBTN.addEventListener("click", startMonitoring);
exportBTN.addEventListener("click", exportCSV);

// Toggle simple view when heart is tapped: hide everything except heart and BPM
heartUI.addEventListener("click", () => {
  document.body.classList.toggle("simple-view");
});
