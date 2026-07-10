# Greenhouse Monitoring Dashboard — Project Guide

**Project:** Integrated Hybrid IoT Greenhouse Monitoring System (Melon greenhouse focus)  
**Version:** 2.0 | **Status:** Active Development  
**Tech Stack:** Nuxt 4 (Full-stack SSR), TypeScript 6, Tailwind CSS, Prisma 7, PostgreSQL

---

## 🌱 Project Overview

A real-time soil moisture monitoring dashboard for greenhouse operations, tracking **two physical
soil-moisture sensor units** (`sensorId` 1 and 2, see `runtimeConfig.public.soilSensors`). An
ESP32 measures soil moisture and communicates via **Bluetooth Low Energy (BLE)** to a mobile PWA,
and (once provisioned) directly over **WiFi**. The PWA shows live readings per sensor, syncs
stored history from the ESP32 to the cloud, pushes device configuration (schedules + settings)
back down to the ESP32, and can provision a new device's WiFi credentials — all over BLE.
**Note:** current firmware reports one reading per cycle with no sensor identifier yet — see the
gap noted in `API_INTEGRATION.md` §9. Full protocol detail is
in `API_INTEGRATION.md`.

### Architecture

```
ESP32 (BLE peripheral, WiFi client once provisioned)
  ├─ BLE GATT ──► Nuxt PWA (Web Bluetooth API — Android Chrome)
  │                 ├─ Realtime: live soil moisture from GATT notifications
  │                 ├─ History sync: streaming pull (WRITE 0x01 → NOTIFY×N → done → ack 0x02)
  │                 │    → POST /api/telemetry/batch
  │                 ├─ Config push: GET /api/config → framed BLE writes (settings + schedules)
  │                 ├─ Time sync: WRITE epoch-ms, first thing on every connect
  │                 └─ WiFi provisioning: WRITE {ssid,password,serverUrl} → NOTIFY status
  │                      └─ Vercel Serverless (Nitro) → Supabase PostgreSQL
  └─ WiFi (once provisioned) ──► POST /api/telemetry directly, no phone required
                                   (BLE stays available for config/history/re-provisioning)
```

### Three Modes
- **BLE Connected**: Live readings update the metric card directly; history syncs automatically
  on connect (and via the manual button); config pushes to the device.
- **WiFi Direct** (device provisioned, phone not needed): ESP32 posts telemetry straight to the
  cloud on its own measurement cadence; runs whatever schedule was last pushed to it over BLE.
- **Cloud Mode** (BLE disconnected, viewing only): Dashboard polls `GET /api/telemetry` every
  30s, shows cloud history regardless of how it got there.

### Time Range Selection
The dashboard includes a segmented time-range selector (1H / 6H / 24H / 7D / All, **default 24H**).
Clicking a range refetches the API with the new window; the chart and table automatically update.
Filtering is based on **effective time** (`recordedAt ?? createdAt`), so batch-synced old readings
are correctly excluded from narrow windows.

### Key Responsibilities
- **Data Ingestion:** Receive and validate telemetry from PWA (`POST /api/telemetry`, `POST /api/telemetry/batch`)
- **Alerting:** Dispatch notifications when soil moisture drops below 40%
- **Visualization:** Live metric card + time-range-filtered trend chart (1H / 6H / 24H / 7D / All) + paginated history table
- **Relay Control:** Manual + scheduled control of 3 water-pump relays with a single-active interlock (see below)
- **Offline Support:** Service Worker caching; "Sync History" ensures cloud has device data

### Water Pump Relay Control
Controls **3 water-pump relay channels** (default names Zone A/B/C), each toggleable manually or
on a recurring daily schedule. Control flows **app → ESP32 over BLE** via the Config WRITE
characteristic; the app also persists all state to the DB (works in cloud/mock mode — the pump
only physically actuates when BLE-connected, or autonomously via the on-device schedule runner
once WiFi is provisioned — see BLE Protocol below).
- **Single-active interlock:** only one relay should run at once (electrical load). Turning on a
  second relay shows a **bypassable warning** dialog — enforced in the UI only, not the server.
- **Scheduling runs "both" ways:** schedules live in the DB (source of truth). On connect / change
  the app **pushes the full config bundle to the ESP32 over BLE** (`cfgbegin`/`sched`/`cfgend`
  frames — see BLE Protocol) so firmware can run schedules autonomously, **and** an in-app
  scheduler (`relayScheduleCheckInterval`) enacts due windows while the dashboard is open +
  connected. The in-app scheduler only "owns" (auto-offs) relays it turned on — it never turns off
  a relay the user switched on manually. Same rule applies on-device: a manual `{type:'relay'}`
  command overrides the schedule until that channel's due-state next changes.
- **BLE command payloads** (written to `ble.commandCharUuid`):
  `{ type:'relay', channel, on }` for manual toggles, and the framed
  `cfgbegin`/`sched`×N/`cfgend` sequence for the full config bundle (§5.5 of `API_INTEGRATION.md`).
  In mock mode (`?mockBle=1`) `sendCommand` just logs — the DB path still exercises the full flow.

---

## 📂 File Structure

```
.
├── pages/
│   └── index.vue                        # Main dashboard
├── components/
│   ├── BLEConnection.vue                # BLE state machine (connect, streaming sync, config
│   │                                     #   push, WiFi provisioning, mock)
│   ├── WifiProvisionPanel.vue            # WiFi Setup form (SSID/password/serverUrl over BLE)
│   ├── MetricCard.vue                   # Soil moisture display card
│   ├── TelemetryChart.vue               # Soil moisture trend (Chart.js)
│   ├── TelemetryTable.vue               # History log table (recordedAt vs createdAt)
│   ├── RelayControl.vue                 # 3 relay switches + interlock warning dialog
│   └── ScheduleEditor.vue               # Watering schedule CRUD UI
├── server/
│   ├── api/
│   │   ├── telemetry.post.ts            # POST /api/telemetry (single reading, dedup-safe)
│   │   ├── telemetry.get.ts             # GET /api/telemetry?range=&limit=
│   │   ├── telemetry/
│   │   │   └── batch.post.ts            # POST /api/telemetry/batch (bulk sync, skipDuplicates)
│   │   ├── relay.get.ts                 # GET /api/relay (seeds + lists relays)
│   │   ├── relay.post.ts               # POST /api/relay (set state + log)
│   │   ├── schedule.get.ts             # GET /api/schedule
│   │   ├── schedule.post.ts            # POST /api/schedule
│   │   ├── schedule/
│   │   │   ├── [id].patch.ts           # PATCH /api/schedule/:id
│   │   │   └── [id].delete.ts          # DELETE /api/schedule/:id
│   │   ├── config.get.ts               # GET /api/config (device settings + enabled schedules)
│   │   ├── config.patch.ts             # PATCH /api/config (settings only)
│   │   ├── actuation.get.ts            # GET /api/actuation (relay history)
│   │   ├── openapi.ts                   # OpenAPI spec (v2.0)
│   │   └── openapi.json.get.ts
│   └── utils/
│       ├── prisma.ts                    # Prisma Client singleton
│       ├── alerts.ts                    # sendAlert() helper (auto-imported by Nitro)
│       ├── schedule.ts                  # schedule validation + serialization helpers
│       └── deviceConfig.ts              # getDeviceConfigBundle() shared by config.get/patch
├── prisma/
│   └── schema.prisma                    # Telemetry (unique dedup), Relay, Schedule,
│                                         #   ActuationLog, DeviceConfig
├── layouts/
│   └── default.vue                      # Header with BLE status dot, footer
├── scripts/
│   └── simulate-esp32.ts               # Sensor data simulator (--batch flag for history)
├── nuxt.config.ts                       # Nuxt 4 config (PWA, Tailwind, BLE UUIDs)
├── package.json
└── docker-compose.yml                   # Local PostgreSQL + Adminer
```

---

## 🚀 Quick Start

### Prerequisites
- **pnpm** 10.33.0+ | **Node.js** 18+ | **Docker** (optional)

### Setup
```bash
pnpm install
docker-compose up -d          # Start local Postgres (or use Supabase)
pnpm db:push                  # Sync schema
pnpm dev                      # http://localhost:3000
```

### Testing without BLE hardware
```bash
# Test individual readings
pnpm simulate:once

# Test batch sync (simulates 24h of ESP32 LittleFS history)
npx tsx scripts/simulate-esp32.ts --batch

# Test BLE UI flow in any browser (no Bluetooth needed)
# Open: http://localhost:3000?mockBle=1
```

---

## 🔵 BLE Protocol

The PWA uses the **Web Bluetooth API** (Android Chrome / Chromium only). Full protocol detail
(exact frame sequences, WiFi provisioning) lives in `API_INTEGRATION.md` §4–5; summary:

| Item | Value |
|------|-------|
| Service UUID | `4fafc201-1fb5-459e-8fcc-c5c9c331914b` |
| Realtime Characteristic | `beb5483e-36e1-4688-b7f5-ea07361b26a8` (NOTIFY, JSON `{"sensorId":1,"soilMoisture":62.4}` — `sensorId` optional, defaults to 1) |
| History Characteristic | `1c95d5e3-d8f7-413a-bf3d-7a2e5d7be87e` (WRITE `0x01`=dump/`0x02`=ack + NOTIFY stream, one JSON record per frame, ending `{"done":true,"total":N}`) |
| Config Characteristic | `a8261b36-3f5e-4a2c-9b1d-2e6f7c8a9b01` (WRITE, JSON: `{type:'relay'}` immediate toggle, or framed `cfgbegin`/`sched`×N/`cfgend` to push settings + schedules — see Relay Control) |
| Time-Sync Characteristic | `a1b2c3d4-e5f6-7890-abcd-ef0123456789` (WRITE, ASCII epoch-ms; written first on every connect) |
| Provision Characteristic | `c47d1b6a-9d1e-4f6b-8f2e-3a5c7d9e0f12` (WRITE `{ssid,password,serverUrl}` + NOTIFY `{"wifi":"connecting"\|"connected"\|"failed",...}` — WiFi setup for a new device) |
| Device Name Filter | `GH-Sensor` (configurable via `NUXT_PUBLIC_BLE_DEVICE_NAME`) |

`BLEConnection.vue` exposes `sendCommand(payload)`, `syncHistory()`, and `provisionWifi(creds)`
(via `defineExpose`); `pages/index.vue` calls them through a template ref. On connect, the
component writes Time-Sync, emits `ready`, and `pages/index.vue` responds by pushing the config
bundle (`GET /api/config` → framed BLE writes) and auto-running history sync.

**Mock mode:** `?mockBle=1` query param skips BLE and uses synthetic data (including a fake
WiFi-provision success) — works in any browser.

---

## 📊 API Endpoints

### `POST /api/telemetry`
Single soil moisture reading. `sensorId` identifies which of the **two soil-moisture sensor
units** took it (see `runtimeConfig.public.soilSensors`); optional, defaults to `1` so
single-sensor firmware payloads keep working unmodified. The `recordedAt` field defaults to the
current server time if not supplied. Duplicate `(sensorId, recordedAt, soilMoisture)` triples are
silently ignored (`200`), not an error — this lets the same reading arrive via WiFi direct-post
and a later BLE re-sync without creating two rows.

**Request (sensorId, recordedAt optional):**
```json
{ "soilMoisture": 55.0 }
```
or with sensor + explicit timestamp:
```json
{ "soilMoisture": 55.0, "sensorId": 2, "recordedAt": "2026-06-25T10:00:00Z" }
```

**Response (new reading):**
```json
{ "id": "12345", "message": "Telemetry recorded" }
```
**Response (duplicate):** `200 { "message": "Duplicate ignored" }`

Alert fires if `soilMoisture < 40%` (names the sensor if `sensorId` was given).

### `POST /api/telemetry/batch`
Bulk sync from ESP32 LittleFS via the BLE streaming History protocol. Max 500 readings per call.
Like single POST, items without `sensorId`/`recordedAt` default to sensor 1 / server time, and
duplicates (by `sensorId` + `recordedAt` + `soilMoisture`) are silently skipped — `count`
reflects only newly-inserted rows, so re-syncing the same device buffer twice is safe. Low-
moisture alerts fire once per sensor that has a critical reading in the batch.

**Request (sensorId, recordedAt optional per item):**
```json
{
  "readings": [
    { "soilMoisture": 62.4, "sensorId": 1, "recordedAt": "2026-06-25T08:00:00Z" },
    { "soilMoisture": 58.1, "sensorId": 2 }
  ]
}
```

**Response:**
```json
{ "count": 2, "message": "Batch recorded" }
```

### `GET /api/telemetry?range=24h&limit=1000&sensorId=1`
Retrieve historical readings within a time window.

**Query params:**
- `range` (optional): one of `1h`, `6h`, `24h` (default), `7d`, `all`
- `limit` (optional): max records to return (default: 1000, max: 1000)
- `sensorId` (optional): filter to one sensor unit; omitted returns both sensors mixed together,
  each record tagged with its `sensorId`

**Response:**
```json
[
  { "id": "string", "sensorId": 1, "soilMoisture": 62.4, "recordedAt": "2026-06-25T10:00:00Z", "createdAt": "2026-06-25T10:00:05Z" }
]
```

**Filtering logic:**
Records are filtered and ordered by **effective time** = `recordedAt ?? createdAt`.
This matches the chart/table display and ensures batch-synced old readings are correctly
excluded from narrow time windows (e.g., a record measured 3 days ago is excluded from `range=1h`
even if it was uploaded recently).

### Relay & Schedule endpoints
- `GET /api/relay` — list relays; idempotently seeds one row per configured channel.
- `POST /api/relay` — `{ channel, isOn, source? }`; updates state + writes an `ActuationLog` row.
  Returns the full relay list. Permissive by design (interlock is UI-side).
- `GET /api/schedule?channel=` / `POST /api/schedule` — list / create schedules
  (`{ relayChannel, startTime:"HH:MM", durationMinutes, daysOfWeek?, enabled? }`).
- `PATCH /api/schedule/:id` — partial update (e.g. toggle `enabled`); `DELETE /api/schedule/:id`.
- `GET /api/actuation?channel=&limit=` — relay on/off history, newest first.
- `GET /api/config` — `{ settings: { measureIntervalMinutes, lowMoistureThreshold }, schedules: [...enabled only...], version }`.
  This is the bundle the PWA pushes to the ESP32 over BLE (Config characteristic, framed
  `cfgbegin`/`sched`/`cfgend`). Seeds the single `DeviceConfig` row on first call.
- `PATCH /api/config` — `{ measureIntervalMinutes?, lowMoistureThreshold? }`; updates settings only
  (schedules keep their own CRUD above). Returns the full bundle.

Shared validation/serialization lives in `server/utils/schedule.ts` and `server/utils/deviceConfig.ts`
(auto-imported by Nitro).

---

## 🗄️ Database Schema

```prisma
model Telemetry {
  id           BigInt    @id @default(autoincrement())
  sensorId     Int       @default(1) @map("sensor_id")  // physical sensor unit (1..N, see soilSensors)
  soilMoisture Float     @map("soil_moisture")
  recordedAt   DateTime  @map("recorded_at")   // measurement time (defaults to server time if not supplied)
  createdAt    DateTime  @default(now()) @map("created_at")  // server receipt time
  @@unique([sensorId, recordedAt, soilMoisture]) // dedup guard — see BLE sync / WiFi dual-path note below
  @@map("telemetry")
}

model DeviceConfig {              // single row (id=1): device-wide settings
  id                     Int      @id @default(1)
  measureIntervalMinutes Int      @default(15) @map("measure_interval_minutes")
  lowMoistureThreshold   Float    @default(40) @map("low_moisture_threshold")
  updatedAt              DateTime @updatedAt @map("updated_at")
  @@map("device_config")
}

model Relay {              // one row per physical relay channel (seeded from config)
  id        BigInt   @id @default(autoincrement())
  channel   Int      @unique                    // 1..3
  name      String                              // e.g. "Zone A"
  isOn      Boolean  @default(false) @map("is_on")
  updatedAt DateTime @updatedAt @map("updated_at")
  createdAt DateTime @default(now()) @map("created_at")
  @@map("relay")
}

model Schedule {           // recurring daily watering window per relay
  id              BigInt   @id @default(autoincrement())
  relayChannel    Int      @map("relay_channel")  // references Relay.channel
  startTime       String   @map("start_time")     // "HH:MM"
  durationMinutes Int      @map("duration_minutes")
  daysOfWeek      Int[]    @default([0,1,2,3,4,5,6]) @map("days_of_week")  // 0=Sun..6=Sat
  enabled         Boolean  @default(true)
  createdAt       DateTime @default(now()) @map("created_at")
  @@map("schedule")
}

model ActuationLog {       // append-only relay on/off history
  id           BigInt   @id @default(autoincrement())
  relayChannel Int      @map("relay_channel")
  action       String                            // "on" | "off"
  source       String                            // "manual" | "schedule" | "device"
  recordedAt   DateTime @default(now()) @map("recorded_at")
  @@map("actuation_log")
}
```

- `recordedAt`: measurement time. Set from client payload if supplied (e.g., from ESP32 timestamp),
  otherwise defaults to server time at POST. Never null.
- `createdAt`: server receipt time (always set by database default).
- For batch-synced ESP32 history: `recordedAt` holds the original ESP32 measurement time;
  `createdAt` holds the upload time.
- **Telemetry dedup:** `@@unique([sensorId, recordedAt, soilMoisture])` + `createMany({
  skipDuplicates: true })` on the batch endpoint (and a caught `P2002` on the single endpoint)
  makes re-posting the same reading a no-op instead of a duplicate row — needed because a reading
  can legitimately arrive twice (WiFi direct-post + a later BLE re-sync of the same buffered
  record; a lost BLE sync ack). `sensorId` is part of the key so two sensors reporting the same
  value at the same instant aren't mistaken for duplicates of each other.
- **Soil sensors:** two physical units, identified by `Telemetry.sensorId` (default `1`, no
  separate table — see `runtimeConfig.public.soilSensors` for labels, `server/utils/sensors.ts`
  for validation/lookup helpers). `sensorId` is optional on every write endpoint for backward
  compatibility with firmware that only reports one reading per cycle (current firmware — see
  `API_INTEGRATION.md` §9 for this gap).
- **DeviceConfig** is a single-row (id=1) table seeded on first `GET /api/config` call, same
  create-if-missing pattern as `Relay`.
- **Relay/Schedule/ActuationLog** use `relayChannel Int` (not FK relations) to stay consistent
  with the relation-free schema. `Relay` rows are seeded idempotently by `GET /api/relay` from
  `runtimeConfig.public.relayChannels`. `Schedule.daysOfWeek` is a Postgres `Int[]` scalar list.

---

## 🔧 Important Patterns & Conventions

### BigInt Handling
Prisma `BigInt @id` → convert to string in all API responses: `id: record.id.toString()`

### BLE Component (`BLEConnection.vue`)
- **Client-only**: always wrapped in `<ClientOnly>` in `pages/index.vue`
- State machine: `idle → scanning → connecting → connected ↔ syncing → error`
- Uses `useState('esp32Status')` (shared with layout) to update header BLE dot
- `isSupported` check in `onMounted`: shows fallback if browser doesn't support Web Bluetooth

### Status Thresholds (Soil Moisture)
- 🟢 ≥ 40% — normal
- 🟡 30–39% — warning (alert fires)
- 🔴 < 30% — critical

### Alert Dispatch
`sendAlert()` is in `server/utils/alerts.ts` (Nitro auto-import). Fire-and-forget pattern to
avoid blocking the API response. Triggered by single POST and batch POST.

### SSR Patterns
- `useFetch` without `await` at top level (non-blocking, SSR hydration automatic)
- Client-side intervals in `onMounted()` / cleaned in `onUnmounted()`
- BLE wrapped in `<ClientOnly>` — Web Bluetooth is browser-only

### Prisma
- `db push` (not `migrate dev`) — simpler for serverless
- `PrismaPg` adapter in `server/utils/prisma.ts` (direct pg driver, no globalThis guard)
- After schema changes: `pnpm db:push` then `pnpm db:generate`

---

## 🐛 Known Issues & Gotchas

- **Web Bluetooth**: Chrome/Chromium on Android only. Non-Chrome browsers see a fallback banner.
- **reka-ui**: `Icon` not exported — use inline SVG everywhere.
- **TypeScript 6**: `@types/web-bluetooth` is a devDep and wired into `nuxt.config.ts` →
  `typescript.tsConfig.compilerOptions.types`; without that config entry `navigator.bluetooth` and
  `BluetoothRemoteGATTCharacteristic` don't resolve even with the package installed.
- **Prisma import**: `server/utils/prisma.ts` must import from `../../prisma/generated/client`, NOT `"@prisma/client"` — the main package is CJS-only and breaks Nuxt's ESM dev server.
- **Vite cache**: clear `.nuxt/` and restart if imports break after schema changes.
- **`recordedAt` timezone**: ESP32 firmware must emit UTC ISO 8601 strings.
- **Telemetry unique index**: adding/changing a `@@unique(...)` on `Telemetry` on a DB with
  existing duplicate rows makes `db push` fail with a data-loss warning. Dedupe first (query for
  `count(*) - count(DISTINCT (sensor_id, recorded_at, soil_moisture))` before pushing) — this only
  matters once, when a migration touching that index first lands on an existing database.
- **Firmware doesn't send `sensorId` yet**: current ESP32 firmware reports one reading per cycle
  with no sensor identifier. The API/dashboard both default omitted `sensorId` to `1`, so Sensor
  2's card/series legitimately stays empty until firmware is updated to sample and label both
  physical units — see `API_INTEGRATION.md` §9 for the open item. Not a bug to chase in the
  dashboard code.

---

## 🔗 Commands Reference

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start dev server (http://localhost:3000) |
| `pnpm build` | Production build |
| `pnpm db:push` | Sync Prisma schema to database |
| `pnpm db:generate` | Regenerate Prisma types |
| `pnpm db:studio` | Open Prisma Studio GUI |
| `pnpm simulate:once` | Send 10 individual test readings |
| `pnpm simulate:continuous` | Continuous test data stream |
| `npx tsx scripts/simulate-esp32.ts --batch` | Send 24h batch history (tests batch endpoint) |
| `docker-compose up -d` | Start local PostgreSQL |

---

## ⚙️ Configuration

### Runtime config (nuxt.config.ts → runtimeConfig.public)
```ts
telemetryDefaultRange: '24h',       // 1h | 6h | 24h | 7d | all — default time window
soilSensors: [                      // physical sensor units — drives dashboard cards/chart
  { sensorId: 1, name: 'Sensor 1' }, // series and validates the optional sensorId on ingestion
  { sensorId: 2, name: 'Sensor 2' },
],
ble: {
  // ...serviceUuid / realtimeCharUuid
  historyCharUuid: '1c95d5e3-...',   // WRITE 0x01/0x02 + NOTIFY stream (history sync)
  commandCharUuid: 'a8261b36-...',   // WRITE: relay toggle + framed config push
  timeSyncCharUuid: 'a1b2c3d4-...',  // WRITE: epoch-ms ASCII, written first on connect
  provisionCharUuid: 'c47d1b6a-...', // WRITE creds + NOTIFY status — WiFi setup
},
relayChannels: [                    // seeds Relay rows + labels the UI
  { channel: 1, name: 'Zone A' },
  { channel: 2, name: 'Zone B' },
  { channel: 3, name: 'Zone C' },
],
relayScheduleCheckInterval: 60_000, // in-app scheduler tick (ms)
deviceOnlineThreshold: 20 * 60_000, // header badge: newest reading fresher than this ⇒ "Connected" via WiFi
                                    // (env: NUXT_PUBLIC_DEVICE_ONLINE_THRESHOLD, ms)
```
- `telemetryDefaultRange` — default time window on dashboard load.
- `soilSensors` — number/names of soil-moisture sensor units; no DB seeding needed (unlike
  relays, they have no mutable state), just labels + valid `sensorId` values for the API.
- `relayChannels` — number/names of relays; drives both DB seeding and the control UI.
- All `ble.*CharUuid` values must match `esp32-monitoring-old/src/config.h` exactly — see
  `API_INTEGRATION.md` §4 for the authoritative table and full protocol.

---

**Last Updated:** 2026-07-09  
**Status:** Active Development
