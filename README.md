# ble-heart-monitor
A web client for Bluetooth heart monitoring devices, built with the Web Bluetooth API.

## Demo

A live demo of the application is available [here](https://hr.anirudhmv.in).

## Features

- **Live BPM display** — reads heart rate data in real time from any Bluetooth device advertising the standard `heart_rate` GATT service
- **Limit alerts** — set a lower and/or upper BPM threshold; if the heart rate stays outside the limit for a configured number of seconds, an audio alert plays
- **Within-range alert** — a separate audio cue plays when the heart rate returns to the normal range and stays there for the configured number of seconds
- **Session recording** — pressing Start records every BPM reading with a timestamp; pressing Stop ends the session and offers a CSV export
- **Offline / PWA** — the app can be installed natively on Android and works offline after the first load

## Audio files

The speech audio files were generated using [Luvvoice](https://luvvoice.com).

| File | Plays when |
|---|---|
| `audio/lower-limit-crossed.mp3` | BPM has been **below** the lower limit for N consecutive seconds |
| `audio/upper-limit-crossed.mp3` | BPM has been **above** the upper limit for N consecutive seconds |
| `audio/within-range.mp3` | BPM has been **within** range for N consecutive seconds |

## Local project set up

This project has zero dependencies and is easy to set up. A static file server like Python's `http.server` can be used to serve the assets.

> **Note:** The Web Bluetooth API and PWA install both require a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). This means the app must be served over **HTTPS** or from **localhost**. Plain HTTP on a non-localhost address will not work.

```sh
git clone https://github.com/Anirudh-MV/bt-heart-monitor
cd bt-heart-monitor/
python3 -m http.server 3000
```

Then visit [http://localhost:3000/](http://localhost:3000/) in a [supported browser](https://caniuse.com/web-bluetooth).

## Installing on Android

Because the app ships a Web App Manifest and a service worker, Chrome on Android will offer an **"Add to Home Screen"** prompt automatically when you visit it over HTTPS. Tap the prompt (or use the browser menu → *Add to Home Screen*) to install it as a standalone app.

## Using the app

1. Open the app and tap **connect** to pair your heart rate device
2. Once connected, monitoring starts automatically
3. Optionally configure alerts:
   - **Lower limit / Upper limit** — select a BPM threshold from the dropdowns (or leave as *None* to disable)
   - **Alert after (seconds)** — enter a whole number; alerts fire only after the heart rate has been continuously outside/inside the limit for this many seconds
4. Tap **stop** to end the session. If any data was recorded, an **export csv** button appears
5. The exported CSV contains two columns: `timestamp` (ISO 8601) and `bpm`

## Set up a heart monitor emulator

If you don't have a Bluetooth-enabled device with heart monitoring capabilities (e.g. a smartwatch or fitness tracker), you can emulate one using a smartphone.

1. Install the **nRF Connect** app — available for [Android and iOS](https://www.nordicsemi.com/Products/Development-tools/nrf-connect-for-mobile)

2. Allow the required permissions (device location, nearby devices)

3. From the app menu, go to `Configure GATT server`, click on the dropdown at the top and select `Sample configuration`
<img src="https://github.com/megaconfidence/bt-heart-monitor/assets/17744578/96ef67e2-415f-460d-a00b-fda9351f1338" width="150">

4. Using the app menu, head back to `Devices` and switch to the `Advertiser` tab

5. Click the **+** button to create a new advertising packet. Give it a display name

6. Click `Add Record` → `Complete Local Name` — this makes your device visible by its Bluetooth name

7. Click `Add Record` again → `Service UUID` — search for and select `Heart Rate`

8. Under `Options`, check `Connectable` (`Scannable` will be auto-checked)
<img src="https://github.com/megaconfidence/bt-heart-monitor/assets/17744578/1fb60c2e-713a-413b-ab84-2bc5e9e6ca1b" width="150">

9. Click `Ok`

10. Click the switch beside the packet name to turn it **ON**. A one-time popup may appear to configure the advertisement duration — the defaults are fine; check `Remember for this packet` if prompted
<img src="https://github.com/megaconfidence/bt-heart-monitor/assets/17744578/98e71143-9568-4651-9b4e-cafb8285f81f" width="150">

11. Click `Ok` — the emulator is now running. You can turn it off at any time by disabling the packet and turning off the GATT server from step 3
