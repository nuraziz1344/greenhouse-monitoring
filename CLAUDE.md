# Greenhouse Monitoring Dashboard — Project Guide

**Project:** Integrated Hybrid IoT Greenhouse Monitoring System (Melon greenhouse focus)  
**Version:** 1.0 | **Status:** Active Development  
**Tech Stack:** Nuxt 4 (Full-stack SSR), TypeScript 6, Tailwind CSS, Prisma 7, PostgreSQL

---

## 🌱 Project Overview

A real-time environmental monitoring dashboard for greenhouse operations. The system ingests sensor telemetry from an ESP32 microcontroller (temperature, humidity, soil moisture) and displays live metrics, historical trends, and automated alerts via webhooks.

### Architecture
- **Hardware:** ESP32 + ADS1115 ADC + DHT22 + Capacitive soil sensor + OLED display
- **Backend:** Vercel Serverless Functions (Node.js/Nitro) — handles data ingestion, storage, alerting
- **Frontend:** Nuxt 3 PWA — offline-capable dashboard with auto-polling and real-time charts
- **Database:** Supabase (PostgreSQL) or local Docker Postgres

### Key Responsibilities
- **Data Ingestion:** Receive and validate telemetry from IoT devices (`POST /api/telemetry`)
- **Alerting:** Dispatch notifications when soil moisture drops below 40%
- **Visualization:** Display current readings and 24h trends with Chart.js
- **Offline Support:** Service Worker caching for field-worker accessibility

---

## 📂 File Structure

```
.
├── pages/
│   └── index.vue              # Main dashboard (metric cards, chart, table)
├── components/
│   ├── MetricCard.vue         # Single metric display (temp/humidity/moisture)
│   ├── TelemetryChart.vue     # 24h trend visualization (Chart.js)
│   └── TelemetryTable.vue     # Historical data table
├── server/
│   ├── api/
│   │   ├── telemetry.get.ts   # Fetch historical telemetry (query: ?limit=50)
│   │   ├── telemetry.post.ts  # Ingest sensor data + alert dispatch
│   │   ├── openapi.ts         # OpenAPI spec generation
│   │   └── openapi.json.get.ts
│   └── utils/
│       └── prisma.ts          # Prisma Client singleton (hot-reload safe)
├── prisma/
│   └── schema.prisma          # Single Telemetry model (id, temperature, humidity, soil_moisture, created_at)
├── layouts/
│   └── default.vue            # Header, footer, online status indicator
├── assets/
│   └── css/
│       └── main.css           # Tailwind + custom scrollbar
├── public/
│   └── icons/                 # PWA app icons (192x192, 512x512)
├── scripts/
│   └── simulate-esp32.ts      # Dummy sensor data generator for testing
├── nuxt.config.ts             # Nuxt 4 config (PWA, Tailwind, Vercel preset)
├── tsconfig.json              # TypeScript extends .nuxt/tsconfig.json
├── package.json               # pnpm workspaces, Prisma/Nitro deps
└── docker-compose.yml         # Local PostgreSQL + Adminer for dev
```

---

## 🚀 Quick Start

### Prerequisites
- **pnpm** 10.33.0+ (package manager)
- **Node.js** 18+ (for dev server and scripts)
- **Docker** (optional, for local PostgreSQL)
- **PostgreSQL** 16+ (via Docker or Supabase)

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Set Up Database
**Option A: Local PostgreSQL (Docker)**
```bash
docker-compose up -d          # Start postgres + adminer
pnpm db:push                   # Sync schema to local DB
```

**Option B: Supabase (Cloud)**
```bash
# Update .env with your Supabase URL
# DATABASE_URL="postgresql://user:pass@db.xxxxx.supabase.co:5432/postgres"
pnpm db:push
```

### 3. Configure Environment
```bash
cp .env.example .env.local
# Edit .env.local:
# - DATABASE_URL: Local or Supabase connection string
# - ALERT_WEBHOOK_URL: (Optional) Telegram/WhatsApp bot webhook
```

### 4. Start Dev Server
```bash
pnpm dev
# Opens http://localhost:3000
```

### 5. Generate Dummy Data (Testing)
In a separate terminal:
```bash
pnpm simulate:once          # Send 50 readings over 100 seconds
# OR
pnpm simulate:continuous   # Send data every 5 seconds indefinitely
```

The dashboard should populate within seconds.

---

## 🛠️ Development Workflow

### Running the Dev Server
```bash
pnpm dev
# Nuxt auto-loads pages/, server/, components/
# Hot-reload enabled for .vue, .ts files
```

### Database Management
```bash
pnpm db:push          # Sync schema changes to DB
pnpm db:generate      # Regenerate Prisma types
pnpm db:studio        # Open Prisma Studio UI (http://localhost:5555)
```

### API Documentation
- **Scalar UI:** http://localhost:3000/api/scalar
- **OpenAPI Spec:** http://localhost:3000/api/openapi.json

### Building for Production
```bash
pnpm build            # Generate .output/ for Vercel
pnpm preview          # Test production build locally
```

---

## 📊 API Endpoints

### `POST /api/telemetry`
Ingest sensor readings and trigger alerts.

**Request:**
```json
{
  "temperature": 28.5,
  "humidity": 65.2,
  "soilMoisture": 52.1
}
```

**Response:** `201 Created`
```json
{
  "id": "12345",
  "message": "Telemetry recorded"
}
```

**Alerts:** If `soilMoisture < 40%`, fires async POST to `ALERT_WEBHOOK_URL` (doesn't block response).

---

### `GET /api/telemetry`
Fetch historical telemetry data.

**Query Parameters:**
- `limit` (optional, default: 50, max: 1000) — number of records

**Response:** `200 OK`
```json
[
  {
    "id": "12345",
    "temperature": 28.5,
    "humidity": 65.2,
    "soilMoisture": 52.1,
    "createdAt": "2026-06-12T14:30:00Z"
  }
]
```

---

## 🔧 Important Patterns & Conventions

### Server-Side Rendering (SSR)
- ✅ All `useFetch` calls are non-blocking; Nuxt handles SSR hydration automatically
- ✅ Client-side intervals (polling, timers) **must** be wrapped in `onMounted()`
- ✅ Avoid `await useFetch()` at top level; use composable without await

### BigInt Handling
- **Database:** Prisma schema uses `BigInt @id` for telemetry records
- **API:** All BigInt values are converted to `string` before JSON serialization
- **Frontend:** Type interfaces expect `id: string` (not `number`)

### Status Indicators
- **Temperature:** 🟢 10–30°C (normal), 🟡 >30°C or <10°C (warning), 🔴 >35°C or <0°C (critical)
- **Humidity:** 🟢 30–75% (normal), 🟡 >75% or <30% (warning), 🔴 >85% or <20% (critical)
- **Soil Moisture:** 🟢 40–100% (normal), 🟡 <40% (warning, triggers alert), 🔴 <30% (critical)

### PWA Offline Support
- Service Worker caches static assets and HTML shell
- If offline, cached dashboard loads with "Offline" badge and cached data
- Auto-syncs when connection restored

---

## 🐛 Known Issues & Gotchas

### Prisma 7 Migration
- **BigInt serialization:** All database IDs must be converted to strings in API responses
- **Stricter type coercion:** No implicit type conversions in runtime values
- **Migrations:** Using `db push` (not `migrate dev` for serverless simplicity)

### TypeScript 6.0 Changes
- Stricter union type narrowing (should be transparent for current codebase)
- No JSDoc issues; straightforward compatibility

### Vite/Module Resolution
- Sometimes Vite cache gets stale; clear `.nuxt/` and restart dev server if imports fail
- `reka-ui` import issues: Only use exported components (Icon is not exported; use inline SVG)

### Docker Postgres
- Default credentials: `greenhouse` / `greenhouse_secret`
- Adminer UI available at http://localhost:8080 (if docker-compose running)
- Data persists in `pgdata` volume between restarts

---

## 🧪 Testing & Validation

### Manual Testing
1. **Data ingestion:** Use `pnpm simulate:once` to generate sensor readings
2. **Dashboard:** Verify metric cards, chart, and table update in real-time
3. **Alerts:** Lower soil moisture in simulator, check webhook logs
4. **Offline:** Disconnect network, dashboard should show "Offline" badge and cached data

### Type Checking
```bash
# TypeScript compilation (part of build)
pnpm build
```

### API Testing
```bash
# Using curl
curl -X POST http://localhost:3000/api/telemetry \
  -H "Content-Type: application/json" \
  -d '{"temperature": 25, "humidity": 60, "soilMoisture": 55}'

# Using Scalar UI
# http://localhost:3000/api/scalar
```

---

## 📝 Notes for Future Development

- **Multi-greenhouse support:** Add `greenhouseId` to Telemetry model if scaling to multiple locations
- **User authentication:** Implement Supabase Auth or similar for access control
- **Advanced alerting:** Configurable thresholds, multi-channel notifications (email, SMS)
- **Data export:** CSV/JSON export endpoint for analytics
- **Mobile optimization:** Further PWA tuning for field worker workflows
- **ESP32 firmware:** Companion firmware repo (not in this dashboard codebase)

---

## 🔗 Useful Commands Reference

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start dev server (http://localhost:3000) |
| `pnpm build` | Production build |
| `pnpm db:push` | Sync Prisma schema to database |
| `pnpm db:generate` | Regenerate Prisma types after manual schema edits |
| `pnpm db:studio` | Open Prisma Studio GUI |
| `pnpm simulate:once` | Send 50 test readings |
| `pnpm simulate:continuous` | Continuous test data stream |
| `docker-compose up -d` | Start local PostgreSQL |
| `docker-compose down` | Stop services |

---

**Last Updated:** 2026-06-12  
**Status:** Ready for development
