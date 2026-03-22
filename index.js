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
const voiceToggleBTN = document.querySelector(".voice-toggle");

// Voice (alert audio) enabled state — persisted in localStorage
let voiceEnabled = localStorage.getItem('bthm-voice') !== '0';

function setVoice(enabled) {
  voiceEnabled = enabled;
  localStorage.setItem('bthm-voice', enabled ? '1' : '0');
  if (voiceToggleBTN) voiceToggleBTN.textContent = enabled ? 'Voice On' : 'Voice Off';
}

if (voiceToggleBTN) {
  voiceToggleBTN.textContent = voiceEnabled ? 'Voice On' : 'Voice Off';
  voiceToggleBTN.addEventListener('click', () => setVoice(!voiceEnabled));
}

let device;
let heartRate;

// Recording state
let isRecording = false;
let recordingData = [];

// Wake lock
let wakeLock = null;

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) {
    console.debug('Wake lock failed:', e.message);
  }
}

async function releaseWakeLock() {
  if (wakeLock) {
    try { await wakeLock.release(); } catch (e) { /* ignore */ }
    wakeLock = null;
  }
}

// Re-acquire wake lock when the page becomes visible again (browser releases it on hide)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isRecording) acquireWakeLock();
});

// Post a background notification via the SW when the page is hidden
function notifyAlert(message) {
  if (!document.hidden) return; // app is visible — audio is enough
  if (!navigator.serviceWorker.controller) return;
  navigator.serviceWorker.controller.postMessage({ type: 'ALERT', message });
}

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
      if (voiceEnabled) lowerAudio.play();
      notifyAlert(`Heart rate ${bpm} BPM is below the lower limit of ${lowerLimit} BPM`);
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
      if (voiceEnabled) upperAudio.play();
      notifyAlert(`Heart rate ${bpm} BPM is above the upper limit of ${upperLimit} BPM`);
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
      if (voiceEnabled) withinAudio.play();
      notifyAlert(`Heart rate ${bpm} BPM is back within range`);
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
    checkAlerts(bpm);
  }
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
  heartUI.classList.add("recording");

  // Keep screen on while recording
  await acquireWakeLock();

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
  heartUI.classList.remove("recording");
  await releaseWakeLock();
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
  closePiP();
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

  // Request notification permission so background alerts can fire
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }

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

// Dark mode toggle (buttons exist on connect and monitor screens)
const darkToggleButtons = document.querySelectorAll('.dark-toggle');
function setDarkMode(enabled) {
  if (enabled) document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
  localStorage.setItem('bthm-dark', enabled ? '1' : '0');
  darkToggleButtons.forEach(b => b.textContent = enabled ? 'Light' : 'Dark');
}

darkToggleButtons.forEach(b => b.addEventListener('click', () => {
  const enabled = document.documentElement.classList.toggle('dark');
  setDarkMode(enabled);
}));

// Initialize theme from localStorage
(function(){
  const stored = localStorage.getItem('bthm-dark');
  if (stored === '1') setDarkMode(true);
})();

// Picture-in-Picture (Document PiP) for heart-only view
const pipToggle = document.querySelector('.pip-toggle');
const pipPlaceholder = document.querySelector('.pip-placeholder');
let pipWindow = null;

async function openPiP() {
  if (!('documentPictureInPicture' in window)) return;
  try {
    pipWindow = await window.documentPictureInPicture.requestWindow({ width: 340, height: 360 });

    // Copy styles from main document into PiP window
    const link = document.querySelector('link[rel="stylesheet"]');
    if (link) {
      const l2 = pipWindow.document.createElement('link');
      l2.rel = 'stylesheet';
      l2.href = link.href;
      pipWindow.document.head.appendChild(l2);
    }

    // Mirror dark mode
    if (document.documentElement.classList.contains('dark')) {
      pipWindow.document.documentElement.classList.add('dark');
    }

    // Style PiP body for a clean centred look
    pipWindow.document.body.style.cssText = 'margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#111;';

    // Show placeholder in main UI; clicking it exits PiP
    pipPlaceholder.classList.remove('hide');
    pipPlaceholder.style.cursor = 'pointer';

    // Move heart and battery into PiP
    pipWindow.document.body.appendChild(heartUI);
    if (batteryTxt) pipWindow.document.body.appendChild(batteryTxt);

    // Update button text
    if (pipToggle) pipToggle.textContent = 'Exit PiP';

    // Restore nodes when the PiP window is closed by the user
    pipWindow.addEventListener('pagehide', () => {
      // Only restore — don't call closePiP() fully as the window is already closing
      pipPlaceholder.classList.add('hide');
      const container = document.querySelector('.ui');
      container.insertBefore(heartUI, pipPlaceholder);
      if (batteryTxt) pipPlaceholder.after(batteryTxt);
      pipWindow = null;
      if (pipToggle) pipToggle.textContent = 'PiP';
    });
  } catch (e) {
    console.debug('PiP open failed', e && e.message);
    pipWindow = null;
  }
}

function closePiP() {
  if (!pipWindow) return;
  const closing = pipWindow;
  pipWindow = null;

  // Restore nodes into main UI first
  pipPlaceholder.classList.add('hide');
  const container = document.querySelector('.ui');
  container.insertBefore(heartUI, pipPlaceholder);
  if (batteryTxt) pipPlaceholder.after(batteryTxt);

  // Now close the window (this will fire pagehide, but pipWindow is already null so it's a no-op)
  try { closing.close(); } catch (e) {}

  if (pipToggle) pipToggle.textContent = 'PiP';
}

if (!('documentPictureInPicture' in window)) {
  // Hide PiP control if the API is unavailable
  if (pipToggle) pipToggle.style.display = 'none';
} else if (pipToggle) {
  pipToggle.addEventListener('click', () => {
    if (pipWindow) closePiP(); else openPiP();
  });
}

// Clicking the placeholder also exits PiP
if (pipPlaceholder) pipPlaceholder.addEventListener('click', () => closePiP());

