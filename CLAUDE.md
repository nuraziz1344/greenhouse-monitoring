# Greenhouse Monitoring Dashboard — Project Guide

**Project:** Integrated Hybrid IoT Greenhouse Monitoring System (Melon greenhouse focus)  
**Version:** 2.0 | **Status:** Active Development  
**Tech Stack:** Nuxt 4 (Full-stack SSR), TypeScript 6, Tailwind CSS, Prisma 7, PostgreSQL

---

## 🌱 Project Overview

A real-time soil moisture monitoring dashboard for greenhouse operations. An ESP32 sensor
measures soil moisture and communicates via **Bluetooth Low Energy (BLE)** to a mobile PWA.
The PWA shows live readings and syncs stored history from the ESP32 to the cloud.

### Architecture

```
ESP32 (BLE peripheral)
  └─ BLE GATT ──► Nuxt PWA (Web Bluetooth API — Android Chrome)
                    ├─ Realtime: live soil moisture from GATT notifications
                    ├─ Sync: bulk upload ESP32 LittleFS history → POST /api/telemetry/batch
                    └─ Offline: GET /api/telemetry from cloud when BLE disconnected
                         └─ Vercel Serverless (Nitro) → Supabase PostgreSQL
```

### Two Modes
- **BLE Connected**: Live readings update the metric card directly; "Sync History" uploads ESP32 LittleFS data
- **Cloud Mode** (BLE disconnected): Dashboard polls `GET /api/telemetry` every 30s, shows cloud history

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
on a recurring daily schedule. Because the ESP32 is BLE-only (no cloud→device link), all control
flows **app → ESP32 over BLE** via a new WRITE command characteristic; the app also persists all
state to the DB (works in cloud/mock mode — the pump only physically actuates when BLE-connected).
- **Single-active interlock:** only one relay should run at once (electrical load). Turning on a
  second relay shows a **bypassable warning** dialog — enforced in the UI only, not the server.
- **Scheduling runs "both" ways:** schedules live in the DB (source of truth). On connect / change
  the app **pushes them to the ESP32 over BLE** (`{ type:'schedule', ... }`) so firmware can run
  them autonomously, **and** an in-app scheduler (`relayScheduleCheckInterval`) enacts due windows
  while the dashboard is open + connected. The in-app scheduler only "owns" (auto-offs) relays it
  turned on — it never turns off a relay the user switched on manually.
- **BLE command payloads** (written to `ble.commandCharUuid`):
  `{ type:'relay', channel, on }` and
  `{ type:'schedule', schedules:[{ channel, startTime, durationMinutes, daysOfWeek, enabled }] }`.
  In mock mode (`?mockBle=1`) `sendCommand` just logs — the DB path still exercises the full flow.

---

## 📂 File Structure

```
.
├── pages/
│   └── index.vue                        # Main dashboard
├── components/
│   ├── BLEConnection.vue                # BLE state machine (connect, sync, sendCommand, mock)
│   ├── MetricCard.vue                   # Soil moisture display card
│   ├── TelemetryChart.vue               # Soil moisture trend (Chart.js)
│   ├── TelemetryTable.vue               # History log table (recordedAt vs createdAt)
│   ├── RelayControl.vue                 # 3 relay switches + interlock warning dialog
│   └── ScheduleEditor.vue               # Watering schedule CRUD UI
├── server/
│   ├── api/
│   │   ├── telemetry.post.ts            # POST /api/telemetry (single reading)
│   │   ├── telemetry.get.ts             # GET /api/telemetry?range=&limit=
│   │   ├── telemetry/
│   │   │   └── batch.post.ts            # POST /api/telemetry/batch (bulk sync)
│   │   ├── relay.get.ts                 # GET /api/relay (seeds + lists relays)
│   │   ├── relay.post.ts               # POST /api/relay (set state + log)
│   │   ├── schedule.get.ts             # GET /api/schedule
│   │   ├── schedule.post.ts            # POST /api/schedule
│   │   ├── schedule/
│   │   │   ├── [id].patch.ts           # PATCH /api/schedule/:id
│   │   │   └── [id].delete.ts          # DELETE /api/schedule/:id
│   │   ├── actuation.get.ts            # GET /api/actuation (relay history)
│   │   ├── openapi.ts                   # OpenAPI spec (v2.0)
│   │   └── openapi.json.get.ts
│   └── utils/
│       ├── prisma.ts                    # Prisma Client singleton
│       ├── alerts.ts                    # sendAlert() helper (auto-imported by Nitro)
│       └── schedule.ts                  # schedule validation + serialization helpers
├── prisma/
│   └── schema.prisma                    # Telemetry, Relay, Schedule, ActuationLog
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

The PWA uses the **Web Bluetooth API** (Android Chrome / Chromium only).

| Item | Value |
|------|-------|
| Service UUID | `4fafc201-1fb5-459e-8fcc-c5c9c331914b` |
| Realtime Characteristic | `beb5483e-36e1-4688-b7f5-ea07361b26a8` (NOTIFY, JSON `{"soilMoisture":62.4}`) |
| History Characteristic | `1c95d5e3-d8f7-413a-bf3d-7a2e5d7be87e` (READ, JSON array `[{soilMoisture, recordedAt}]`) |
| Command Characteristic | `a8261b36-3f5e-4a2c-9b1d-2e6f7c8a9b01` (WRITE, JSON relay/schedule commands — see Relay Control) |
| Device Name Filter | `GH-Sensor` (configurable via `NUXT_PUBLIC_BLE_DEVICE_NAME`) |

`BLEConnection.vue` exposes `sendCommand(payload)` (via `defineExpose`) which writes JSON to the
command characteristic (`writeValueWithResponse`); `pages/index.vue` calls it through a template ref.

**Mock mode:** `?mockBle=1` query param skips BLE and uses synthetic data — works in any browser.

---

## 📊 API Endpoints

### `POST /api/telemetry`
Single soil moisture reading. The `recordedAt` field defaults to the current server time if not supplied.

**Request (recordedAt optional):**
```json
{ "soilMoisture": 55.0 }
```
or with explicit timestamp:
```json
{ "soilMoisture": 55.0, "recordedAt": "2026-06-25T10:00:00Z" }
```

**Response:**
```json
{ "id": "12345", "message": "Telemetry recorded" }
```

Alert fires if `soilMoisture < 40%`.

### `POST /api/telemetry/batch`
Bulk sync from ESP32 LittleFS. Max 500 readings. Like single POST, items without `recordedAt` default
to server time.

**Request (recordedAt optional per item):**
```json
{
  "readings": [
    { "soilMoisture": 62.4, "recordedAt": "2026-06-25T08:00:00Z" },
    { "soilMoisture": 58.1 }
  ]
}
```

**Response:**
```json
{ "count": 2, "message": "Batch recorded" }
```

### `GET /api/telemetry?range=24h&limit=1000`
Retrieve historical readings within a time window.

**Query params:**
- `range` (optional): one of `1h`, `6h`, `24h` (default), `7d`, `all`
- `limit` (optional): max records to return (default: 1000, max: 1000)

**Response:**
```json
[
  { "id": "string", "soilMoisture": 62.4, "recordedAt": "2026-06-25T10:00:00Z", "createdAt": "2026-06-25T10:00:05Z" }
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

Shared validation/serialization lives in `server/utils/schedule.ts` (auto-imported by Nitro).

---

## 🗄️ Database Schema

```prisma
model Telemetry {
  id           BigInt    @id @default(autoincrement())
  soilMoisture Float     @map("soil_moisture")
  recordedAt   DateTime  @map("recorded_at")   // measurement time (defaults to server time if not supplied)
  createdAt    DateTime  @default(now()) @map("created_at")  // server receipt time
  @@map("telemetry")
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
- **TypeScript 6**: If `BluetoothRemoteGATTCharacteristic` errors, add `@types/web-bluetooth` devDep.
- **Prisma import**: `server/utils/prisma.ts` must import from `../../prisma/generated/client`, NOT `"@prisma/client"` — the main package is CJS-only and breaks Nuxt's ESM dev server.
- **Vite cache**: clear `.nuxt/` and restart if imports break after schema changes.
- **`recordedAt` timezone**: ESP32 firmware must emit UTC ISO 8601 strings.

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
ble: {
  // ...serviceUuid / realtimeCharUuid / historyCharUuid
  commandCharUuid: 'a8261b36-...',  // WRITE characteristic for relay/schedule commands
},
relayChannels: [                    // seeds Relay rows + labels the UI
  { channel: 1, name: 'Zone A' },
  { channel: 2, name: 'Zone B' },
  { channel: 3, name: 'Zone C' },
],
relayScheduleCheckInterval: 60_000, // in-app scheduler tick (ms)
```
- `telemetryDefaultRange` — default time window on dashboard load.
- `relayChannels` — number/names of relays; drives both DB seeding and the control UI.
- `commandCharUuid` — placeholder UUID; finalize with the firmware author.

---

**Last Updated:** 2026-07-06  
**Status:** Active Development
