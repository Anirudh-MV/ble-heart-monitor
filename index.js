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

let device;
let heartRate;

// Recording state
let isRecording = false;
let recordingData = [];

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
  lowerLimitSel.appendChild(optLower);

  const optUpper = document.createElement("option");
  optUpper.value = bpm;
  optUpper.textContent = bpm;
  upperLimitSel.appendChild(optUpper);
}

// Enforce natural numbers only on the seconds input
alertSecondsInput.addEventListener("input", () => {
  const raw = alertSecondsInput.value;
  // Strip anything that's not a digit
  const cleaned = raw.replace(/[^0-9]/g, "");
  // Remove leading zeros, enforce minimum of 1
  const num = parseInt(cleaned, 10);
  alertSecondsInput.value = isNaN(num) || num < 1 ? "" : String(num);
});

function parseHeartRate(value) {
  let is16Bits = value.getUint8(0) & 0x1;
  if (is16Bits) return value.getUint16(1, true);
  return value.getUint8(1);
}

function getAlertSeconds() {
  const val = parseInt(alertSecondsInput.value, 10);
  return isNaN(val) || val < 1 ? null : val;
}

function checkAlerts(bpm) {
  const lowerLimit = lowerLimitSel.value ? parseInt(lowerLimitSel.value, 10) : null;
  const upperLimit = upperLimitSel.value ? parseInt(upperLimitSel.value, 10) : null;
  const thresholdMs = getAlertSeconds() !== null ? getAlertSeconds() * 1000 : null;

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
    optionalServices: ["heart_rate"],
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
}

async function startMonitoring() {
  isRecording = true;
  recordingData = [];
  exportBTN.classList.add("hide");
  startBTN.disabled = true;

  // Reset alert state on new session
  lowerBreachStart = null;
  upperBreachStart = null;
  lowerAlertFired = false;
  upperAlertFired = false;
  withinRangeStart = null;
  withinAlertFired = false;

  await heartRate.startNotifications();
}

async function stopMonitoring() {
  isRecording = false;
  startBTN.disabled = false;
  await heartRate.stopNotifications();
  heartUI.classList.add("pause-animation");

  if (recordingData.length > 0) {
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

async function init() {
  if (!navigator.bluetooth) return errorTxt.classList.remove("hide");
  if (!device) await requestDevice();

  connectBTN.textContent = "connecting...";
  await connectDevice();

  appUI.classList.remove("hide");
  connectUI.classList.add("hide");
  await startMonitoring();
}

connectBTN.addEventListener("click", init);
stopBTN.addEventListener("click", stopMonitoring);
startBTN.addEventListener("click", startMonitoring);
exportBTN.addEventListener("click", exportCSV);
