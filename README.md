# 🌱 Greenhouse Monitoring Dashboard

A real-time soil moisture monitoring PWA (Progressive Web App) for greenhouse operations. 
The system connects to an ESP32 sensor via **Bluetooth Low Energy (BLE)** to display live readings 
and sync stored sensor history to the cloud.

**Live Demo:** https://greenhouse-monitoring-opal.vercel.app/

---

## ✨ Features

- **Real-time BLE Monitoring**: Connect to ESP32 via Web Bluetooth (Android Chrome) for instant soil moisture readings
- **Offline-First**: Service Worker caching enables offline viewing of cached data
- **Batch History Sync**: Upload stored ESP32 sensor readings from LittleFS to cloud in one operation
- **Cloud Fallback**: When BLE disconnected, view historical data from cloud (updated every 30s)
- **Time Range Filtering**: View data from the last 1H / 6H / 24H / 7 days, or all historical data
- **Water Pump Relay Control**: Manually toggle 3 pump relays or run them on recurring daily schedules, with a bypassable single-active interlock to limit electrical load
- **Visual Alerts**: Dashboard highlights soil moisture levels (critical < 30%, warning 30–40%, normal ≥ 40%)
- **Mobile-Optimized**: Responsive design works on phones and tablets
- **PWA Installation**: Install on home screen like a native app

---

## 📋 Prerequisites

- **Node.js** 18+ and **pnpm** 10.33.0+
- **PostgreSQL** database (local via Docker or Supabase cloud)
- **Android device** with Chrome (for BLE connectivity) *or* any modern browser (for cloud mode)

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
cd greenhouse-monitoring/dashboard
pnpm install
```

### 2. Set Up Database

**Option A: Local PostgreSQL (Docker)**
```bash
docker-compose up -d
```

**Option B: Supabase Cloud**
Create a `.env.local` file:
```env
DATABASE_URL=postgresql://user:password@host:port/dbname
```

### 3. Sync Database Schema & Start Dev Server

```bash
pnpm db:push              # First time: creates telemetry table
pnpm dev                  # Starts on http://localhost:3000
```

### 4. Test Without Hardware

Generate test data without BLE hardware:

```bash
# Send 10 individual readings
pnpm simulate:once

# Send 24-hour batch (simulates ESP32 history sync)
npx tsx scripts/simulate-esp32.ts --batch

# Continuous stream (every 5 seconds)
pnpm simulate:continuous
```

Visit **http://localhost:3000?mockBle=1** to test the BLE UI in any browser (mock mode).

---

## 📱 Usage Guide

### Connecting to ESP32 (BLE)

1. Open the dashboard on **Android Chrome**
2. Click **"Connect to ESP32"** in the BLE panel
3. Select **GH-Sensor** from the Bluetooth picker
4. The dashboard shows live soil moisture readings
5. Click **"Sync History"** to upload stored ESP32 data to the cloud

### Viewing Data in Cloud Mode

When BLE is disconnected:
- The dashboard polls cloud data every 30 seconds
- Select a time range (1H / 6H / 24H / 7D / All) to filter the chart and table
- Data automatically refreshes based on the selected window

### Manual Refresh

Click the **"Refresh"** button in the header to immediately fetch the latest data.

### Controlling the Water Pumps

The **Water Pump Relays** panel lists 3 relay channels (Zone A/B/C by default):

- **Manual:** flip a switch to turn a relay on/off. State is saved to the cloud immediately; when
  the ESP32 is BLE-connected, the command is also sent to the device to actuate the pump.
- **Single-active interlock:** turning on a second relay while another is running pops a warning
  ("Running two pumps increases the electrical load. Turn on anyway?"). Confirm to override.
- **Schedules:** in the **Watering Schedules** panel, add a recurring window (relay, start time,
  duration, days of week). Schedules are stored in the cloud, pushed to the ESP32 over BLE for
  autonomous execution, and also enacted by the app while the dashboard is open + connected.

> Relay state and schedules persist in the database, so the UI is fully usable in cloud/mock mode
> without hardware — the physical pump only moves when the ESP32 is connected over BLE.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│ ESP32 Sensor (BLE Peripheral)           │
│ ├─ Soil moisture: 0-100%                │
│ ├─ LittleFS storage: ~100 readings      │
│ └─ GATT Service with 2 characteristics  │
└──────────────────┬──────────────────────┘
                   │
        ┌──────────┴──────────┐
        │ BLE (GATT)          │
        │ Realtime NOTIFY     │
        │ History READ        │
        └──────────┬──────────┘
                   │
┌──────────────────▼──────────────────────┐
│ Nuxt 4 PWA (Web Bluetooth API)          │
│ ├─ BLEConnection.vue: state machine    │
│ ├─ TelemetryChart.vue: trend chart     │
│ ├─ TelemetryTable.vue: history log     │
│ └─ Service Worker: offline caching     │
└──────────────────┬──────────────────────┘
                   │
        ┌──────────┴──────────┐
        │ HTTP REST API       │
        │ POST /api/telemetry │
        │ GET  /api/telemetry │
        └──────────┬──────────┘
                   │
┌──────────────────▼──────────────────────┐
│ Vercel Serverless (Nitro)               │
│ ├─ Data validation & ingestion         │
│ ├─ Alert dispatch (< 40% threshold)    │
│ └─ Time-range filtering                │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│ PostgreSQL (Supabase)                   │
│ telemetry(                              │
│   id, soilMoisture, recordedAt, ...     │
│ )                                       │
└─────────────────────────────────────────┘
```

---

## 📊 API Reference

### POST /api/telemetry
Submit a soil moisture reading (single or from BLE realtime notification).

```bash
curl -X POST http://localhost:3000/api/telemetry \
  -H 'Content-Type: application/json' \
  -d '{"soilMoisture": 55.2}'
```

**Response:** `{ "id": "123", "message": "Telemetry recorded" }`

### POST /api/telemetry/batch
Bulk upload ESP32 history (from LittleFS sync).

```bash
curl -X POST http://localhost:3000/api/telemetry/batch \
  -H 'Content-Type: application/json' \
  -d '{
    "readings": [
      {"soilMoisture": 62.4, "recordedAt": "2026-06-25T08:00:00Z"},
      {"soilMoisture": 58.1, "recordedAt": "2026-06-25T08:15:00Z"}
    ]
  }'
```

**Response:** `{ "count": 2, "message": "Batch recorded" }`

### GET /api/telemetry
Retrieve historical data with optional time-window filtering.

```bash
# Last 24 hours (default)
curl http://localhost:3000/api/telemetry?range=24h

# Last 7 days, max 500 records
curl http://localhost:3000/api/telemetry?range=7d&limit=500

# All data
curl http://localhost:3000/api/telemetry?range=all
```

**Query Params:**
- `range` ∈ {`1h`, `6h`, `24h`, `7d`, `all`} — default: `24h`
- `limit` ∈ [1, 1000] — default: 1000

**Response:**
```json
[
  {
    "id": "54",
    "soilMoisture": 62.3,
    "recordedAt": "2026-06-25T10:00:00Z",
    "createdAt": "2026-06-25T10:00:05Z"
  }
]
```

### Relay & Schedule Endpoints

```bash
# List relays (seeds 3 channels on first call)
curl http://localhost:3000/api/relay

# Turn relay 1 on / off
curl -X POST http://localhost:3000/api/relay \
  -H 'Content-Type: application/json' -d '{"channel":1,"isOn":true}'

# Create a schedule (relay 2, 06:30 for 15 min, Mon/Wed/Fri)
curl -X POST http://localhost:3000/api/schedule \
  -H 'Content-Type: application/json' \
  -d '{"relayChannel":2,"startTime":"06:30","durationMinutes":15,"daysOfWeek":[1,3,5]}'

# List / toggle / delete schedules
curl http://localhost:3000/api/schedule
curl -X PATCH  http://localhost:3000/api/schedule/1 -d '{"enabled":false}'
curl -X DELETE http://localhost:3000/api/schedule/1

# Relay actuation history
curl http://localhost:3000/api/actuation
```

`daysOfWeek` uses `0=Sun … 6=Sat`. `POST /api/relay` accepts an optional `source`
(`manual` | `schedule` | `device`, default `manual`) recorded in the actuation log.

For full API documentation, see [CLAUDE.md](./CLAUDE.md).

---

## 🔧 Development

### Project Structure

```
├── pages/                    # Nuxt pages
│   └── index.vue             # Main dashboard
├── components/               # Vue components
│   ├── BLEConnection.vue     # BLE state machine (+ sendCommand)
│   ├── MetricCard.vue        # Soil moisture metric
│   ├── TelemetryChart.vue    # Trend chart
│   ├── TelemetryTable.vue    # History table
│   ├── RelayControl.vue      # Relay switches + interlock dialog
│   └── ScheduleEditor.vue    # Watering schedule CRUD
├── server/api/               # API endpoints
│   ├── telemetry.post.ts     # Single reading
│   ├── telemetry.get.ts      # Historical data
│   ├── telemetry/batch.post.ts  # Bulk upload
│   ├── relay.get.ts / relay.post.ts       # Relay list / control
│   ├── schedule.get.ts / schedule.post.ts # Schedule list / create
│   ├── schedule/[id].patch.ts / [id].delete.ts
│   └── actuation.get.ts      # Relay actuation history
├── prisma/
│   └── schema.prisma         # Database schema
├── nuxt.config.ts            # Nuxt configuration
└── README.md                 # This file
```

### Environment Variables

Create `.env.local`:

```env
# Database connection (required)
DATABASE_URL=postgresql://user:password@localhost:5432/greenhouse

# Optional: override time range default
NUXT_PUBLIC_TELEMETRY_DEFAULT_RANGE=24h

# Optional: BLE device name filter
NUXT_PUBLIC_BLE_DEVICE_NAME=GH-Sensor
```

### Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start dev server (http://localhost:3000) |
| `pnpm build` | Production build |
| `pnpm preview` | Preview production build locally |
| `pnpm db:push` | Sync Prisma schema to DB (destructive) |
| `pnpm db:generate` | Regenerate Prisma types after schema change |
| `pnpm db:studio` | Open Prisma Studio GUI |
| `pnpm simulate:once` | Send 10 test readings |
| `pnpm simulate:continuous` | Continuous test stream |
| `npx tsx scripts/simulate-esp32.ts --batch` | Send 24h batch history |
| `docker-compose up -d` | Start local PostgreSQL + Adminer |
| `docker-compose down` | Stop containers |

### Type Safety

The project uses **TypeScript 6** with strict mode. All API responses are typed; UI components
are checked against prop interfaces.

After schema changes, always regenerate types:
```bash
pnpm db:generate
```

### Database Migrations

This project uses **`db push`** (not `migrate dev`) for simpler serverless workflows:

```bash
# Edit prisma/schema.prisma
pnpm db:push              # Apply changes (may be destructive)
pnpm db:generate          # Regenerate types
```

---

## 🌍 Deployment

### Vercel (Recommended)

1. Push code to GitHub
2. Connect repository to Vercel
3. Set environment variables in Vercel Dashboard:
   - `DATABASE_URL` → Supabase PostgreSQL connection string
4. Deploy (Vercel builds & deploys automatically)

### Manual Deployment

```bash
# Build production bundle
pnpm build

# Start production server
pnpm preview
```

The app uses **Nitro** (Nuxt's server engine) which adapts to Vercel's serverless runtime automatically.

---

## 🔌 BLE Hardware Integration

To connect a real ESP32:

1. **Configure GATT Service** in ESP32 firmware with these UUIDs:
   - Service UUID: `4fafc201-1fb5-459e-8fcc-c5c9c331914b`
   - Realtime Characteristic (NOTIFY): `beb5483e-36e1-4688-b7f5-ea07361b26a8`
   - History Characteristic (READ): `1c95d5e3-d8f7-413a-bf3d-7a2e5d7be87e`
   - Command Characteristic (WRITE): `a8261b36-3f5e-4a2c-9b1d-2e6f7c8a9b01` *(placeholder — finalize with firmware)*

2. **Sensor payload** (JSON via BLE notifications):
   ```json
   {"soilMoisture": 62.3, "recordedAt": "2026-06-25T10:00:00Z"}
   ```

3. **Command payloads** (JSON written by the app to the command characteristic):
   ```json
   {"type": "relay", "channel": 1, "on": true}
   {"type": "schedule", "schedules": [
     {"channel": 2, "startTime": "06:30", "durationMinutes": 15, "daysOfWeek": [1,3,5], "enabled": true}
   ]}
   ```
   Firmware should switch the relay(s) and store the schedule set to run watering autonomously.

4. **Device Name**: Advertise as `GH-Sensor` (configurable via `NUXT_PUBLIC_BLE_DEVICE_NAME`)

See [API_BLE.md](../API_BLE.md) for detailed protocol specification.

---

## 🐛 Troubleshooting

### BLE Not Working

- **Symptom**: "Open in Android Chrome" message appears
- **Solution**: BLE only works on Android Chrome. Try `?mockBle=1` to test UI without hardware.

### No Data Appears

- **Symptom**: Dashboard loads but chart/table are empty
- **Solution**:
  1. Check database connection: `pnpm db:studio` to open Prisma Studio
  2. Send test data: `pnpm simulate:once`
  3. Check browser console (F12) for errors

### API Errors (400 / 500)

- **400 Bad Request**: Validate payload format
  - `soilMoisture` must be a number 0–100
  - `recordedAt` (optional) must be ISO 8601 string
  
- **500 Server Error**: Check Nitro logs in terminal

### Build Fails

- **Error**: `Cannot find module '@prisma/client'`
- **Solution**: Prisma must import from the generated path:
  ```ts
  // ❌ Wrong
  import { PrismaClient } from "@prisma/client"
  
  // ✅ Correct
  import { PrismaClient } from "../../prisma/generated/client"
  ```

---

## 📚 Documentation

- **[CLAUDE.md](./CLAUDE.md)** — Detailed architecture, patterns, and conventions
- **[API_BLE.md](../API_BLE.md)** — BLE GATT protocol specification
- **[API_RELAY_CONTROL.md](../API_RELAY_CONTROL.md)** — Water-pump relay + schedule integration contract (for the IoT/firmware team)
- **[API_WIFI.md](../API_WIFI.md)** — WiFi direct integration (alternative architecture)
- **[API_COMPARISON.md](../API_COMPARISON.md)** — WiFi vs BLE trade-offs

---

## 🤝 Contributing

This is an active development project for a KKN (community service) program.

**To contribute:**
1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make changes and test: `pnpm dev` and `pnpm build`
3. Submit a pull request with a clear description

**Current focus areas:**
- Real ESP32 BLE firmware implementation
- Data export & CSV download
- User authentication & multi-greenhouse support
- Mobile-specific UI optimizations

---

## 📄 License

This project is part of a KKN program at UGM. See LICENSE for details.

---

## 📧 Support

For questions or issues:
- Check [CLAUDE.md](./CLAUDE.md) for architecture details
- Review [Troubleshooting](#-troubleshooting) section above
- Contact the development team: nuraziz@mail.ugm.ac.id

---

**Last Updated:** 2026-07-06  
**Status:** Active Development
