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

### Key Responsibilities
- **Data Ingestion:** Receive and validate telemetry from PWA (`POST /api/telemetry`, `POST /api/telemetry/batch`)
- **Alerting:** Dispatch notifications when soil moisture drops below 40%
- **Visualization:** Live metric card + 24h trend chart + paginated history table
- **Offline Support:** Service Worker caching; "Sync History" ensures cloud has device data

---

## 📂 File Structure

```
.
├── pages/
│   └── index.vue                        # Main dashboard
├── components/
│   ├── BLEConnection.vue                # BLE state machine (connect, sync, mock mode)
│   ├── MetricCard.vue                   # Soil moisture display card
│   ├── TelemetryChart.vue               # Soil moisture trend (Chart.js)
│   └── TelemetryTable.vue               # History log table (recordedAt vs createdAt)
├── server/
│   ├── api/
│   │   ├── telemetry.post.ts            # POST /api/telemetry (single reading)
│   │   ├── telemetry.get.ts             # GET /api/telemetry?limit=N
│   │   ├── telemetry/
│   │   │   └── batch.post.ts            # POST /api/telemetry/batch (bulk sync)
│   │   ├── openapi.ts                   # OpenAPI spec (v2.0)
│   │   └── openapi.json.get.ts
│   └── utils/
│       ├── prisma.ts                    # Prisma Client singleton
│       └── alerts.ts                    # sendAlert() helper (auto-imported by Nitro)
├── prisma/
│   └── schema.prisma                    # Telemetry(id, soilMoisture, recordedAt?, createdAt)
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
| Device Name Filter | `GH-Sensor` (configurable via `NUXT_PUBLIC_BLE_DEVICE_NAME`) |

**Mock mode:** `?mockBle=1` query param skips BLE and uses synthetic data — works in any browser.

---

## 📊 API Endpoints

### `POST /api/telemetry`
Single soil moisture reading.

```json
{ "soilMoisture": 55.0, "recordedAt": "2026-06-25T10:00:00Z" }
```
→ `201 { "id": "12345", "message": "Telemetry recorded" }`

Alert fires if `soilMoisture < 40%`.

### `POST /api/telemetry/batch`
Bulk sync from ESP32 LittleFS. Max 500 readings.

```json
{ "readings": [{ "soilMoisture": 62.4, "recordedAt": "2026-06-25T08:00:00Z" }] }
```
→ `201 { "count": 24, "message": "Batch recorded" }`

### `GET /api/telemetry?limit=50`
→ `200 [{ "id": "string", "soilMoisture": 62.4, "recordedAt": "...|null", "createdAt": "..." }]`

---

## 🗄️ Database Schema

```prisma
model Telemetry {
  id           BigInt    @id @default(autoincrement())
  soilMoisture Float     @map("soil_moisture")
  recordedAt   DateTime? @map("recorded_at")   // ESP32 measurement time (null for live reads)
  createdAt    DateTime  @default(now()) @map("created_at")  // server receipt time
  @@map("telemetry")
}
```

- `recordedAt`: set when syncing ESP32 history (original sensor timestamp). Null for live readings.
- `createdAt`: always set by server.
- In the UI, rows with non-null `recordedAt` are marked **(synced)**.

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
| `pnpm simulate:once` | Send 50 individual test readings |
| `pnpm simulate:continuous` | Continuous test data stream |
| `npx tsx scripts/simulate-esp32.ts --batch` | Send 24h batch history (tests batch endpoint) |
| `docker-compose up -d` | Start local PostgreSQL |

---

**Last Updated:** 2026-06-25  
**Status:** Active Development
