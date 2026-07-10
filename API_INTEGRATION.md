# ESP32 ↔ Cloud Integration Spec (WiFi + BLE)

**Audience:** Firmware / IoT team integrating the ESP32 greenhouse node with the
Greenhouse Monitoring backend and PWA.

**Cloud base URL:** `https://greenhouse-monitoring-opal.vercel.app`

This document merges the former `API_BLE.md` and `API_WIFI.md` into a single contract and
adds the new **water-pump relay control + scheduling** feature. The ESP32 is expected to
support **both** transport approaches:

- **Approach A — WiFi Direct:** ESP32 posts readings straight to the cloud REST API and polls
  for relay/schedule commands. No phone required.
- **Approach B — BLE via PWA gateway:** ESP32 exposes data/commands over Bluetooth GATT; the
  mobile PWA relays them to the same cloud REST API.

Both approaches speak to the **same cloud API** and the **same database**, so a device may use
either (or fall back from WiFi → BLE) without any backend change.

> ⚠️ **Accuracy note.** This spec is written against the **currently deployed backend**, the
> **current PWA source**, and the **current firmware** (`esp32-monitoring-old/`) — not the older
> aspirational drafts. As of this revision, BLE history sync streams (not a single READ), the
> Time-Sync characteristic is wired end-to-end, config (settings + schedules) pushes over BLE in
> a framed multi-write protocol, WiFi provisioning happens over BLE, and firmware WiFi Direct
> mode is implemented (NVS-persisted credentials, NTP, direct `POST /api/telemetry`). Remaining
> gaps are collected in **[§9 Implementation Status & Open Items](#9-implementation-status--open-items)**.
>
> **New this revision: two soil-moisture sensor units.** The cloud API and PWA now identify
> readings by a `sensorId` (see §2.1a). **Firmware has not been updated for this yet** — it still
> takes one physical measurement per cycle with no sensor identifier — so this is flagged again
> as an explicit gap in §9. The field is optional and defaults to `sensorId: 1` server-side
> specifically so today's single-sensor firmware keeps working unmodified until it's updated.

---

## Table of Contents

1. [Integration modes at a glance](#1-integration-modes-at-a-glance)
2. [Shared cloud API contract](#2-shared-cloud-api-contract)
3. [Approach A — WiFi Direct](#3-approach-a--wifi-direct)
4. [Approach B — BLE via PWA gateway](#4-approach-b--ble-via-pwa-gateway)
5. [Water-pump relay control & scheduling](#5-water-pump-relay-control--scheduling)
6. [Dual-mode firmware guidance](#6-dual-mode-firmware-guidance)
7. [Timestamps & time sync](#7-timestamps--time-sync)
8. [Field specs, validation & status codes](#8-field-specs-validation--status-codes)
9. [Implementation status & open items](#9-implementation-status--open-items)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Integration modes at a glance

```
                          ┌────────────────────────────────────┐
                          │   Cloud backend (Nuxt/Nitro on      │
                          │   Vercel) + PostgreSQL (Supabase)   │
                          │   REST: /api/telemetry, /api/relay… │
                          └───────────────▲───────────▲─────────┘
                                          │           │
             Approach A: WiFi Direct      │           │   Approach B: BLE via PWA
             (ESP32 has internet)         │           │   (no ESP32 internet)
                                          │           │
   ┌───────────────┐   HTTPS POST/GET     │           │   HTTPS   ┌──────────────────┐
   │     ESP32     │──────────────────────┘           └───────────│  Mobile PWA      │
   │  (soil + 3    │                                              │ (Web Bluetooth)  │
   │   relays)     │◄─────────── BLE GATT ────────────────────────│  Android Chrome  │
   └───────────────┘   NOTIFY / READ / WRITE                      └──────────────────┘
```

| | **Approach A — WiFi Direct** | **Approach B — BLE via PWA** |
|---|---|---|
| ESP32 internet | Required (WiFi) | Not required |
| Data upload | ESP32 → `POST /api/telemetry[/batch]` | ESP32 → BLE → PWA → `POST /api/telemetry/batch` |
| Live readings persisted | Every reading | Only on **Sync History** (BLE realtime is display-only) |
| Time source | NTP on ESP32 | Phone time sync **or** on-board RTC (see §7) |
| Relay commands reach device | ESP32 **polls** `GET /api/relay` + `GET /api/schedule` | PWA **writes** command characteristic when connected |
| Works when phone absent | Yes | No (needs the phone in range) |
| Best for | Greenhouses with WiFi/4G | Sites with no connectivity; worker walks by with phone |

A device can run **both**: prefer WiFi when available, advertise BLE as a fallback/local channel.
This is exactly what current firmware does — BLE always advertises; WiFi (once provisioned) runs
alongside it, posting telemetry directly while BLE remains the sync/config channel.

**Getting a fresh device onto WiFi is itself a BLE operation** — see §4.7 WiFi Provisioning. A
technician connects the PWA over BLE once, sends the site's WiFi credentials + the server URL,
and the device takes it from there (auto-reconnect from NVS on every subsequent boot, no phone
required again unless credentials change).

---

## 2. Shared cloud API contract

Everything below is served by the deployed backend and is identical regardless of transport.

### Conventions

- **Content-Type:** `application/json` (UTF-8).
- **IDs:** returned as **strings** (the DB uses 64-bit integers, serialized as decimal strings).
- **Timestamps:** ISO 8601 UTC, e.g. `"2026-06-25T10:00:00Z"` (accepted) / `"2026-06-25T10:00:00.000Z"` (returned).
- **Auth:** **None enforced today.** An `Authorization` header is accepted but ignored. Do not
  rely on 401s. (Adding a device API key is an open item — see §9.)
- **Success codes:** `201 Created` for writes that insert; `200 OK` for reads, relay/schedule
  updates, and **duplicate telemetry** (see below).
- **Errors:** `{ "statusCode": 400, "message": "…" }` with a `4xx` status. There is currently
  **no** `429` rate-limit and **no** timestamp-skew rejection.
- **Dedup:** `Telemetry` has a unique constraint on `(sensorId, recordedAt, soilMoisture)`.
  Re-posting an identical reading (e.g. after a lost BLE ack, or the same reading arriving via
  both WiFi direct and a later BLE re-sync) is **silently ignored**, not an error — `POST
  /api/telemetry` returns `200 { message: "Duplicate ignored" }`, and `POST
  /api/telemetry/batch`'s `count` reflects only newly-inserted rows. Devices do **not** need to
  track "already acked" state precisely; a redundant re-send is harmless. `sensorId` is part of
  the key specifically so two sensors reporting the same value at the same instant are never
  mistaken for duplicates of each other.

### 2.1 Soil sensor units

The greenhouse has **two physical soil-moisture sensor units**. Every telemetry reading carries
an optional `sensorId` identifying which one took it:

| `sensorId` | Default label |
|---|---|
| `1` | Sensor 1 |
| `2` | Sensor 2 |

Configured in the dashboard via `runtimeConfig.public.soilSensors` (an array of
`{ sensorId, name }`, mirroring the existing `relayChannels` pattern) — labels are editable there
without a schema change. `sensorId` is **optional on every write endpoint and defaults to `1`**
when omitted, so a device that only ever reports one reading per cycle (today's firmware) keeps
working unmodified; an explicit value not in the configured list is rejected with `400`.
`GET /api/telemetry` accepts `sensorId` as an optional filter (§2.3) — omitted, it returns both
sensors' readings mixed together, each tagged with its `sensorId`.

> Sensors are otherwise independent — there is no relay/zone pairing implied by sensor number
> (3 relay channels, 2 sensors; no forced 1:1 mapping). Low-moisture alerts (§2.1a below) and the
> dashboard's cards/chart/table all key off `sensorId` individually.

### 2.1a `POST /api/telemetry` — single reading

Ingest one soil-moisture reading (used by WiFi direct realtime, or any single insert).

**Request**
```json
{ "soilMoisture": 62.3, "sensorId": 1, "recordedAt": "2026-06-25T10:00:00Z" }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `soilMoisture` | number 0–100 | **Yes** | Percentage, 1 decimal recommended |
| `sensorId` | integer | No | Which sensor unit (§2.1). Omitted → defaults to `1`. Invalid (not a configured sensor) → `400`. |
| `recordedAt` | ISO 8601 string | No | Measurement time. **If omitted or invalid, the server uses its own clock** (= receipt time). Send it explicitly in WiFi mode. |

> Fields from the old WiFi draft — `timestamp` (epoch ms) and `deviceId` — are **not consumed**
> by the current backend. Send measurement time as `recordedAt` (ISO 8601). See §9.

**Response `201`**
```json
{ "id": "12345", "message": "Telemetry recorded" }
```

**Errors:** `400` if `soilMoisture` is missing/NaN or outside 0–100, or `sensorId` doesn't match a
configured sensor.
Side effect: if `soilMoisture < 40`, the server fires a low-moisture alert naming the sensor
(fire-and-forget).

### 2.2 `POST /api/telemetry/batch` — bulk upload

Used by the **PWA after a BLE history sync**, and by **WiFi recovery** after an outage.

**Request** (max **500** items per call)
```json
{
  "readings": [
    { "soilMoisture": 62.3, "sensorId": 1, "recordedAt": "2026-06-25T10:00:00Z" },
    { "soilMoisture": 58.1, "sensorId": 2, "recordedAt": "2026-06-25T10:15:00Z" },
    { "soilMoisture": 55.7 }
  ]
}
```

Each item follows the same field rules as §2.1a (`sensorId` and `recordedAt` optional per item;
`sensorId` defaults to `1`, `recordedAt` defaults to server time).

**Response `201`**
```json
{ "count": 3, "message": "Batch recorded" }
```
`count` is the number of **newly inserted** rows — duplicates (same `sensorId` + `recordedAt` +
`soilMoisture` as an existing row) are silently skipped and not counted, so re-syncing the same
ESP32 buffer twice is safe and idempotent. Low-moisture alerts are grouped and fired **once per
sensor** that has any critical reading in the batch, citing that sensor's lowest value.

**Errors:** `400` if `readings` is missing/empty, exceeds 500 items, or any item's
`soilMoisture`/`sensorId` is invalid. **No per-item partial success** — the whole batch inserts
(minus duplicates) or the request 400s on the first structurally-bad item.

### 2.3 `GET /api/telemetry` — history read (mainly for the PWA)

```
GET /api/telemetry?range=24h&limit=1000&sensorId=1
```
| Query | Values | Default |
|---|---|---|
| `range` | `1h` `6h` `24h` `7d` `all` | `24h` |
| `limit` | 1–1000 | `1000` |
| `sensorId` | one of the configured sensors (§2.1) | omitted = all sensors |

Omitting `sensorId` returns **both** sensors' readings merged into one list, each item tagged
with its `sensorId` — this is the shape the PWA's combined chart/table consume. The dashboard's
per-sensor metric cards instead call this endpoint once per sensor with an explicit `sensorId`.

**Response `200`** — newest first (by effective time `recordedAt ?? createdAt`):
```json
[
  { "id": "54", "sensorId": 1, "soilMoisture": 62.3,
    "recordedAt": "2026-06-25T10:00:00.000Z",
    "createdAt":  "2026-06-25T10:00:05.000Z" }
]
```

### 2.4 Relay & schedule endpoints

Full details in **[§5](#5-water-pump-relay-control--scheduling)**. Summary:

| Method & path | Purpose |
|---|---|
| `GET /api/relay` | List relays + current `isOn` (seeds channels on first call) |
| `POST /api/relay` | Set a relay `{ channel, isOn, source? }`; logs an actuation |
| `GET /api/schedule?channel=` | List watering schedules |
| `POST /api/schedule` | Create a schedule |
| `PATCH /api/schedule/{id}` | Update / enable-disable a schedule |
| `DELETE /api/schedule/{id}` | Delete a schedule |
| `GET /api/actuation?channel=&limit=` | Relay on/off history |

### 2.5 `GET`/`PATCH /api/config` — device configuration bundle

The single payload the PWA fetches from the cloud and pushes to the ESP32 over BLE (§5.5).
Bundles device-wide settings with all **enabled** schedules so the device gets everything it
needs in one request.

**`GET /api/config`** → `200`:
```json
{
  "settings": { "measureIntervalMinutes": 15, "lowMoistureThreshold": 40 },
  "schedules": [
    { "channel": 2, "startTime": "06:30", "durationMinutes": 15, "daysOfWeek": [1,3,5], "enabled": true }
  ],
  "version": "2026-07-09T08:00:00.000Z"
}
```
Disabled schedules are omitted — the device only ever needs to know about windows that will fire.
`version` is a debug aid (max of settings/schedule update times); not required for correctness.

**`PATCH /api/config`** — update settings only (schedules keep their own CRUD, §5.2):
```json
// request
{ "measureIntervalMinutes": 5 }
```
`measureIntervalMinutes` (int, 1–1440) and/or `lowMoistureThreshold` (number, 0–100). Returns the
full bundle (same shape as GET), `200`. `400` if neither field is present or a value is out of range.

---

## 3. Approach A — WiFi Direct

The ESP32 has its own internet connection and talks to the cloud REST API directly.

### 3.1 Telemetry upload

- Every measurement interval (default **15 min**): read sensor(s) → `POST /api/telemetry` with
  `soilMoisture`, `sensorId` (§2.1 — **not yet implemented in current firmware**, which reports
  one reading with no sensor identifier; see §9), and an ISO-8601 `recordedAt` derived from NTP
  time (see §7).
- On success (`201`) continue. On failure, buffer locally and retry (see §3.2).

### 3.2 Offline buffering & retry

```
POST fails ─► store reading in local ring buffer (recommended ≥100 records)
           ─► retry with backoff: 5s → 30s → 1m → 5m → 30m (cap ~2h)

WiFi restored ─► drain buffer via POST /api/telemetry/batch (≤500 per call, page if more)
              ─► on 201, clear the drained records
```

The backend dedups by `(sensorId,recordedAt,soilMoisture)` (§2), so clearing local records only
after a `201`/counted success is a safety-net habit, not strictly required for correctness — a
re-sent record just gets silently skipped. Keep batches ≤ 500 either way.

### 3.3 Relay/schedule control in WiFi mode

There is **no cloud→device polling loop in current firmware** for relay/schedule state — this
was deliberately left out of scope (see §9.3). Instead, the on-device schedule runner
(`RELAY_ENABLED` build) executes whatever config was last pushed to it **over BLE** (§5.5),
independent of whether WiFi is up. In practice: provision the device and push its schedule set
once via a BLE-connected phone, and it keeps running that schedule over WiFi indefinitely without
the phone coming back — until a schedule actually changes, at which point a phone needs to
reconnect over BLE to push the update (BLE always advertises, even while WiFi is active, so this
is a short local visit, not a re-provisioning).

If a project needs schedule changes to propagate without ever revisiting the device physically,
the polling loop described in the (now-historical) draft below is the shape to build:
```
Every POLL_INTERVAL (recommend 10–30 s):
  GET /api/relay      → for each channel, apply isOn to the physical relay
  GET /api/config      → cache settings + schedules; run them locally against the NTP clock
```
- Apply the single-active interlock locally if desired (the app treats it as a soft warning; a
  WiFi-only device may enforce it strictly to protect the load).
- **Optional confirmation:** after actuating, the device may `POST /api/relay` with
  `{ channel, isOn, source: "device" }` to record the *actual* state in the actuation log.

### 3.4 Network budget

- Single POST ≈ 150 B; batch of 10 ≈ 800 B; relay/schedule polls ≈ a few hundred bytes each.
- ~450 KB/month/device for telemetry at 15-min cadence, plus polling overhead.

---

## 4. Approach B — BLE via PWA gateway

The ESP32 exposes a GATT service; the **mobile PWA** (Android Chrome, Web Bluetooth) relays data
to and from the cloud. Realtime BLE readings are **display-only**; persistence happens when the
user taps **Sync History** (a batch upload).

### 4.1 GATT service & characteristics

**Service UUID:** `4fafc201-1fb5-459e-8fcc-c5c9c331914b`
**Advertised name:** `GH-Sensor` (the PWA filters on exact name; configurable via
`NUXT_PUBLIC_BLE_DEVICE_NAME`).

| # | Characteristic | UUID | Props | Payload |
|---|---|---|---|---|
| 1 | Realtime | `beb5483e-36e1-4688-b7f5-ea07361b26a8` | NOTIFY | `{"sensorId":1,"soilMoisture":62.3}` — `sensorId` optional, defaults to `1` (§2.1) |
| 2 | History | `1c95d5e3-d8f7-413a-bf3d-7a2e5d7be87e` | WRITE + NOTIFY | write `0x01`=request dump, `0x02`=ack (clear buffer); notifies one record per frame (each optionally tagged `sensorId`), then `{"done":true,"total":N}` |
| 3 | Config | `a8261b36-3f5e-4a2c-9b1d-2e6f7c8a9b01` | WRITE | JSON frames: `{type:"relay"}` \| `{type:"cfgbegin"}` \| `{type:"sched"}` \| `{type:"cfgend"}` (§5.5) |
| 4 | Time Sync | `a1b2c3d4-e5f6-7890-abcd-ef0123456789` | WRITE | epoch-ms ASCII string (see §7) |
| 5 | Provision | `c47d1b6a-9d1e-4f6b-8f2e-3a5c7d9e0f12` | WRITE + NOTIFY | write `{ssid,password,serverUrl}`; notifies `{"wifi":"connecting"}` → `{"wifi":"connected","ip","rssi"}` \| `{"wifi":"failed","reason"}` (§4.7) |

> **Superseded from earlier drafts:** the single-byte relay characteristic (`6e400001-…`) is
> gone — relay commands are JSON frames on the Config characteristic. The old single-`READ`
> History characteristic is gone too — History is now WRITE+NOTIFY streaming (this section),
> which is what both current firmware and the current PWA implement.

### 4.2 Realtime characteristic (NOTIFY)

While a phone is connected, the ESP32 notifies the latest reading. The PWA parses `soilMoisture`
and an optional `sensorId`:

```json
{ "sensorId": 1, "soilMoisture": 62.3 }
```
`sensorId` identifies which of the two sensor units this reading is from (§2.1); omit it and the
PWA treats it as sensor `1`. **Current firmware only reports one physical measurement per cycle
with no `sensorId` field** — sending real readings from both sensor units (interleaved or however
the hardware samples them) with the correct `sensorId` on each is an open item, see §9. You may
include `recordedAt` too (harmless; ignored by the realtime handler). Suggested cadence: every 15
min, or faster while connected for a live feel. **These are not persisted** — they only update
the on-screen metric.

### 4.3 History characteristic (WRITE + NOTIFY streaming)

On **Sync History** (automatic on connect, and via the manual button), the PWA subscribes to
History notifications, then writes `0x01` to request a dump:

```
Phone: subscribe History notifications
Phone: write 0x01 to History               // request dump
ESP32: NOTIFY {"sensorId":1,"soilMoisture":62.3,"recordedAt":"2026-06-25T10:00:00Z"}   // one per record
ESP32: NOTIFY {"sensorId":2,"soilMoisture":58.1,"recordedAt":"2026-06-25T10:15:00Z"}
ESP32: NOTIFY {"done":true,"total":96}                                                 // end marker
Phone: POST /api/telemetry/batch (paged ≤500 readings per call)
Phone: write 0x02 to History               // ack — ESP32 clears its ring buffer
```

Each notification is one JSON record, well under the 512-byte GATT value limit regardless of
buffer size — this replaces the old single-`READ`-of-an-array approach, which capped at ~9
records. `sensorId` is optional per record (omitted → PWA/server default to `1`) but should be
set once firmware buffers readings from both units, so history sync attributes each stored
reading to the correct sensor. `recordedAt` is included whenever the device knows the time (BLE
time-sync or NTP); otherwise the record is sent as `{"soilMoisture":...}` and the server stamps
it with upload time.

**The ack (`0x02`) matters:** only write it after all batch pages have returned `201`/`200`. It
tells the firmware to `Storage::clear()` its LittleFS ring buffer. If the ack is lost (app closed
mid-sync, disconnect), the same records simply get re-streamed and re-posted next sync — the
server's dedup (§2) makes this a no-op rather than a duplicate-row problem. A reading taken in
the few seconds between the dump completing and the ack being written is not covered by the
current buffer snapshot and — if the ack does land — is dropped along with the rest of the
cleared buffer; acceptable given the default 15-minute measurement cadence.

### 4.4 Config characteristic (WRITE) — relay + schedule/settings push

See **§5.5** for the full framed protocol and payload shapes.

### 4.5 Time Sync characteristic (WRITE)

Written first, immediately after connecting, before config push or history sync — see §7.

### 4.6 Connection & sync flow (current PWA + firmware)

```
Phone (PWA)                                  ESP32
  ├─ requestDevice({name:'GH-Sensor'})
  ├─ gatt.connect()
  ├─ getPrimaryService(4fafc201…)
  ├─ Realtime: startNotifications() ───────► (subscribe)
  ├─ Provision: startNotifications()  ─────► (subscribe, for WiFi setup)
  ├─ Time Sync: write epoch-ms ─────────────► device now has wall-clock time
  │
  ├─ Config: write cfgbegin{settings,count} ►
  │   Config: write sched{...} × N          ► staged
  │   Config: write cfgend{count}           ► committed + persisted atomically
  │
  ├─ History: subscribe + write 0x01 ───────► streaming dump begins
  │      ◄──────── NOTIFY record × N, then {"done":true,"total":N}
  │   POST /api/telemetry/batch (chunked) ──► cloud
  │   History: write 0x02 ──────────────────► device clears its buffer
  │
  ├─ (ongoing) Realtime NOTIFY {"sensorId":…,"soilMoisture":…}     (live display only)
  │
  ├─ (user toggles a relay / edits a schedule)
  │   Config: write {type:'relay',...}      ► ESP32 actuates immediately
  │   POST /api/relay  or  /api/schedule  ──► cloud (desired state persisted)
  │
  ├─ (user runs WiFi Setup)
  │   Provision: write {ssid,password,serverUrl} ►
  │      ◄──────── NOTIFY {"wifi":"connecting"} → {"wifi":"connected",ip,rssi} | {"wifi":"failed",reason}
```

### 4.7 WiFi Provisioning (Provision characteristic)

For a new device at a new site: connect the PWA over BLE once (the device always advertises BLE,
regardless of WiFi state), open **WiFi Setup** in the dashboard, and send the site's network.

**Request** (written to the Provision characteristic):
```json
{ "ssid": "Greenhouse-WiFi", "password": "••••••••", "serverUrl": "https://greenhouse-monitoring-opal.vercel.app" }
```
`serverUrl` is required because the firmware has no compiled-in cloud URL — it's the target for
subsequent `POST /api/telemetry` calls. Trailing slash is stripped by the PWA before sending.

**Status notifications** (device → phone, on the same characteristic):
```json
{ "wifi": "connecting" }
{ "wifi": "connected", "ip": "192.168.1.50", "rssi": -58 }
{ "wifi": "failed", "reason": "connect timeout" }
```

**Firmware behavior:**
- Credentials + server URL are saved to NVS (`Preferences`, namespace `"wifi"`) — persists across
  reboot and power loss.
- On every boot, if creds are present, the device attempts to connect automatically — no phone
  needed after the first provisioning.
- Connect attempts time out after `WIFI_CONNECT_TIMEOUT_MS` (15 s default); on failure the device
  backs off (30 s, doubling, capped at 10 min) and retries indefinitely. BLE stays fully
  functional throughout — a failed/absent WiFi connection never blocks BLE sync.
- On successful connect: `configTime()` (NTP) runs, and once system time is confirmed the device
  starts `POST`-ing telemetry directly to `{serverUrl}/api/telemetry` on every measurement,
  **in addition to** buffering locally for BLE sync. Both paths can deliver the same reading —
  the server's unique-constraint dedup (§2) makes this safe by design, not a bug to work around.
- `https://` URLs use `WiFiClientSecure` with `setInsecure()` (no certificate pinning) — a
  pragmatic choice for a single-device student project; revisit before any production deployment
  with sensitive data.

### 4.8 Reference PWA logic (informative)

```javascript
// Time sync, first thing after connecting
await timeSyncChar.writeValueWithResponse(new TextEncoder().encode(String(Date.now())))

// History sync (streaming)
await historyChar.startNotifications()
historyChar.addEventListener('characteristicvaluechanged', onHistoryFrame)  // accumulate until {done:true}
await historyChar.writeValueWithResponse(Uint8Array.of(0x01))
// ...await the done marker...
await fetch('/api/telemetry/batch', { method: 'POST', body: JSON.stringify({ readings }) })
await historyChar.writeValueWithResponse(Uint8Array.of(0x02))  // ack

// Config push (framed)
await configChar.writeValueWithResponse(enc(JSON.stringify({ type: 'cfgbegin', settings, count })))
for (const s of schedules) {
  await configChar.writeValueWithResponse(enc(JSON.stringify({ type: 'sched', ...s })))
}
await configChar.writeValueWithResponse(enc(JSON.stringify({ type: 'cfgend', count })))

// WiFi provisioning
await provisionChar.writeValueWithResponse(enc(JSON.stringify({ ssid, password, serverUrl })))
```

---

## 5. Water-pump relay control & scheduling

The node drives **3 water-pump relays** (channels `1..3`, default names Zone A/B/C). Desired
state and schedules live in the **cloud DB** (source of truth). They reach the device via BLE
(push) or WiFi (poll), and the device executes them.

### 5.1 Cloud model

- **Relay:** `{ channel, name, isOn }` — one row per channel.
- **Schedule:** recurring daily window per relay.
- **ActuationLog:** append-only on/off history with a `source`.
- **Single-active interlock:** the *app* only warns (bypassable) when a second relay is switched
  on; it is **not enforced server-side**. A WiFi-only device may choose to enforce it in firmware.

### 5.2 REST endpoints

**`GET /api/relay`** → seeds + lists relays:
```json
[ { "id":"3", "channel":1, "name":"Zone A", "isOn":false, "updatedAt":"2026-07-06T08:33:30.624Z" } ]
```

**`POST /api/relay`** — set desired state (logs an actuation):
```json
// request
{ "channel": 1, "isOn": true, "source": "manual" }
```
`source` ∈ `manual` | `schedule` | `device` (default `manual`). Response is the full relay list
(`200`). `400` if `channel` is not a configured channel or `isOn` is not boolean.

**`GET /api/schedule?channel=2`** / **`POST /api/schedule`**:
```json
// create request
{ "relayChannel": 2, "startTime": "06:30", "durationMinutes": 15, "daysOfWeek": [1,3,5], "enabled": true }
// response 201
{ "id":"1", "relayChannel":2, "startTime":"06:30", "durationMinutes":15,
  "daysOfWeek":[1,3,5], "enabled":true, "createdAt":"2026-07-06T08:33:43.980Z" }
```
| Field | Type | Required | Notes |
|---|---|---|---|
| `relayChannel` | int | Yes | Must be a configured channel (1–3) |
| `startTime` | `"HH:MM"` 24h | Yes | Local time |
| `durationMinutes` | int 1–1440 | Yes | Window length |
| `daysOfWeek` | int[] 0–6 | No | 0=Sun … 6=Sat; default every day |
| `enabled` | bool | No | Default `true` |

**`PATCH /api/schedule/{id}`** — any subset of the above (commonly `{ "enabled": false }`).
**`DELETE /api/schedule/{id}`** → `{ "id":"1", "message":"Schedule deleted" }`.
**`GET /api/actuation`** → `[{ id, relayChannel, action:"on"|"off", source, recordedAt }]`.

### 5.3 BLE command payloads (Config characteristic)

The PWA writes these JSON objects when connected:

```json
// Manual relay toggle — applied immediately, marks the channel manually-overridden
// until its schedule window's due-state next changes (see 5.5)
{ "type": "relay", "channel": 1, "on": true }
```

Full config (settings + schedules) uses the **framed** protocol in §5.5, not a single write —
see that section for why.

### 5.4 How commands reach the device per transport

| | Manual toggle | Schedule set |
|---|---|---|
| **BLE** | PWA writes `{type:"relay",…}` to Config char | PWA pushes the full config bundle (§5.5) on connect & on change |
| **WiFi** | Device polls `GET /api/relay`, applies each `isOn` | Device runs the last config pushed to it over BLE — WiFi mode does not currently push schedules; provision over BLE at least once so the device has a schedule set, then WiFi keeps it running without a phone |

In **both** cases the cloud DB is authoritative for *desired* state. The in-app scheduler in the
PWA also enacts due windows while it is open+connected (belt-and-suspenders); the on-device
schedule runner (compiled in behind `RELAY_ENABLED`) is the reliable path when no phone is
present, once it has a config to run.

### 5.5 Config push protocol (settings + schedules, framed)

`GET /api/config` (§2.5) returns the bundle; the PWA relays it to the device as a short sequence
of small writes rather than one large payload — see §8 for why (GATT write size).

```
Config: write {"type":"cfgbegin","settings":{"measureIntervalMinutes":15,"lowMoistureThreshold":40},"count":2}
Config: write {"type":"sched","c":1,"s":"06:00","d":15,"w":127,"e":true}     // one per schedule
Config: write {"type":"sched","c":2,"s":"06:30","d":15,"w":42,"e":true}
Config: write {"type":"cfgend","count":2}
```

| Field | Meaning |
|---|---|
| `c` | relay channel (matches §5.2 `relayChannel`) |
| `s` | `"HH:MM"` local start time |
| `d` | duration in minutes |
| `w` | `daysOfWeek` packed as a bitmask, **bit 0 = Sunday … bit 6 = Saturday** (e.g. `127` = every day, `42` = Mon/Wed/Fri) |
| `e` | enabled |

**Firmware contract:** `cfgbegin` opens a staging area (settings + the schedule count the phone
is about to send) and clears any previous staged-but-uncommitted frames. Each `sched` frame
appends to staging (dropped with a serial log line if `count` would exceed `MAX_SCHEDULES`).
`cfgend` verifies the number of staged schedules matches its declared `count`; on match, the
staged set atomically replaces the live config and is persisted to `/config.json` on LittleFS
(survives reboot). On mismatch, the commit is rejected and the previous config is kept — so a
partial/interrupted push (e.g. BLE drops mid-sequence) can't leave the device with a half-written
schedule set.

---

## 6. Dual-mode firmware guidance

Recommended behavior for a node that supports both transports:

```
boot
 ├─ start sensor sampling + local ring buffer (always)
 ├─ start BLE advertising as "GH-Sensor" (always, cheap local channel)
 ├─ load saved config (/config.json) + WiFi creds (NVS) if present
 └─ if WiFi creds present:
       try WiFi connect (backoff + retry indefinitely if it fails)
       ┌── WiFi up ──────────────────────────────────────────────┐
       │  • NTP sync (configTime)                                  │
       │  • POST /api/telemetry each reading, in addition to the   │
       │    local buffer append (BLE remains the sync/config path) │
       │  • run the last-pushed schedule set locally (no polling — │
       │    schedules only arrive via BLE Config push, §5.5)       │
       └──────────────────────────────────────────────────────────┘
       ┌── WiFi down / not (yet) configured ───────────────────────┐
       │  • keep buffering readings locally                        │
       │  • serve realtime NOTIFY + streaming History to the PWA   │
       │  • accept relay/config via Config characteristic           │
       │  • get time via phone Time-Sync characteristic             │
       │  • accept WiFi credentials via Provision characteristic    │
       └──────────────────────────────────────────────────────────┘
```

This is what current firmware does: WiFi credentials (once provisioned) are tried on every boot
regardless of whether a phone is present; BLE advertises unconditionally either way, so a
technician can always reach the device to re-provision or re-push config even once it's on WiFi.

Notes:
- BLE and WiFi are active simultaneously once provisioned — telemetry can arrive at the server via
  both paths for the same reading; the server's dedup (§2) collapses that to one row, so this is
  by design rather than a race to avoid.
- There is currently **no cloud→device push for relay/schedule changes over WiFi** — the device
  only learns new schedules via a BLE Config push (§5.5). A WiFi-only device (phone never in
  range again after provisioning) keeps running whatever schedule set it last received. If you
  need schedule changes to reach a phone-less device, that's an open item (§9.3: WiFi polling of
  `GET /api/config`, deliberately not built to keep scope small for this project).
- Deep-sleep strategies must account for BLE advertising, WiFi reconnect, and NTP re-sync cadence.

---

## 7. Timestamps & time sync

The backend needs a correct `recordedAt` per reading to place it on the timeline (batch uploads
of old data rely on it; missing `recordedAt` defaults to **upload time**, which is wrong for
history).

**WiFi mode:** `configTime()` (NTP) runs once WiFi connects; the firmware's `time(nullptr)` then
returns real epoch seconds directly — used both for `recordedAt` on direct posts and for the
on-device schedule runner's local-time comparisons.

**BLE mode:** the PWA writes epoch-ms to the **Time-Sync characteristic** (#4) as the very first
thing it does after connecting (§4.6):
```
Write ASCII "1751234567890"   // String(Date.now())
ESP32: epochOffset = epochMs - millis()
```
Either source (NTP or BLE) is enough to mark the clock "synced"; NTP takes priority if both are
available (a WiFi-connected device re-syncs continuously, so it's the more reliable source).

**Storage format:** once the clock is synced, new readings are stored as **absolute epoch
seconds** (not `millis()`) directly in the record, sidestepping the classic "`millis()` resets on
reboot" problem for everything measured after that point. Readings taken before the first sync
this boot are still stored as raw `millis()` and are back-converted at history-dump time using
whichever BLE offset (if any) was recorded this session; if only NTP has ever synced this boot,
those pre-sync legacy records are sent without `recordedAt` (server defaults to upload time) since
there's no offset to reconstruct them with. Re-syncing (BLE writes Time-Sync on every connect,
NTP re-syncs continuously on WiFi) keeps this window small in practice.

---

## 8. Field specs, validation & status codes

### Field reference

| Field | Type | Where | Rules |
|---|---|---|---|
| `soilMoisture` | number | telemetry | Required; `0 ≤ v ≤ 100`; else `400` |
| `sensorId` | int | telemetry | Optional, default `1`; must be a configured sensor (§2.1) or `400` |
| `recordedAt` | ISO 8601 string | telemetry | Optional; invalid → server clock; UTC `"…Z"` |
| `channel` | int | relay | Must be a configured channel (1–3) |
| `isOn` | bool | relay | Required boolean |
| `source` | enum | relay | `manual`\|`schedule`\|`device`; default `manual` |
| `startTime` | `"HH:MM"` | schedule | 24-hour, `00:00`–`23:59` |
| `durationMinutes` | int | schedule | `1`–`1440` |
| `daysOfWeek` | int[] | schedule | values `0`–`6`, non-empty |

### Status codes (actual backend)

| Code | When | Device action |
|---|---|---|
| `200` | GET / relay / schedule / config update ok, **or** duplicate telemetry (§2) | Continue |
| `201` | telemetry / batch insert ok (new rows), schedule insert ok | Clear buffered records that were acked |
| `400` | Invalid payload (bad number, bad range, empty/oversized batch, bad id) | Log, fix payload, **don't blind-retry** |
| `404` | Schedule id not found (PATCH/DELETE) | Refresh schedule list |
| `5xx` | Server/DB error | Retry with backoff |

> **Not implemented today:** `401` (no auth), `429` (no rate limiting — still be a good citizen
> and keep cadence ≥ ~1 req/s). See §9. Dedup (`(recordedAt,soilMoisture)` unique constraint) *is*
> implemented, but surfaces as `200`/reduced `count`, not `409` — there's nothing to branch on,
> just don't expect every posted reading to increment the row count.

---

## 9. Implementation status & open items

What the live system does today vs. what the older drafts assumed. Align these with the web team.

### 9.1 Status matrix

| Capability | Status | Notes |
|---|---|---|
| `POST /api/telemetry` (single) | ✅ Live | Returns `{id,message}` `201`, or `200 {message:"Duplicate ignored"}` |
| `POST /api/telemetry/batch` | ✅ Live | ≤500/req; returns `{count,message}` `201`; `count` excludes duplicates |
| `GET /api/telemetry` | ✅ Live | `range`/`limit` params |
| `GET`/`PATCH /api/config` | ✅ Live | §2.5 — settings + enabled schedules bundle |
| Relay + schedule + actuation APIs | ✅ Live | §5 |
| Telemetry dedup | ✅ Live | Unique `(sensorId,recordedAt,soilMoisture)` + `skipDuplicates` — surfaces as `200`/reduced `count`, not `409` |
| Two-sensor model (`sensorId`, §2.1) | ✅ Live (API + dashboard) — ❌ **not sent by firmware** | Server defaults omitted `sensorId` to `1`; dashboard shows two cards/chart-series regardless. Firmware still reports one reading/cycle with no `sensorId` — sending real dual-sensor data is unbuilt, see §9.3 |
| BLE Realtime NOTIFY | ✅ Live (PWA + firmware) | Display-only; not persisted. `sensorId` field defined but firmware doesn't populate it yet (see row above) |
| BLE History transfer | ✅ Live — **streaming** (WRITE 0x01 → NOTIFY×N → done marker → WRITE 0x02 ack) | No practical size limit; see §4.3 |
| BLE Config char (relay + framed schedule/settings push) | ✅ Live (PWA + firmware) | `a8261b36-…`, protocol in §5.5 |
| BLE Time-Sync char | ✅ Live (PWA + firmware) | Written first on every connect (§4.5, §7) |
| BLE Provision char (WiFi setup) | ✅ Live (PWA + firmware) | `c47d1b6a-…`, protocol in §4.7 |
| WiFi Direct mode | ✅ Live (firmware) | NVS-persisted creds, auto-reconnect + backoff, NTP, direct `POST /api/telemetry` |
| Auth / API key | ❌ None | Header ignored; add for production |
| Rate limiting (`429`) | ❌ None | Self-throttle |
| Timestamp-skew rejection | ❌ None | Bad clocks are accepted as-is |
| WiFi schedule delivery | ❌ Not built | Device runs the last BLE-pushed schedule set; no `GET /api/config` polling loop in firmware (see §9.3) |
| Device actuation confirmation | ⚙️ Optional | `POST /api/relay {source:"device"}` — not wired in firmware today |
| TLS cert pinning (WiFi HTTPS) | ❌ None | `WiFiClientSecure::setInsecure()` — acceptable for this project's scope, not for production |

Legend: ✅ implemented · ⚠️ implemented with a caveat · ⚙️ pattern using existing endpoints, not wired · ❌ not present.

### 9.2 Historical note: what changed from the previous revision

The previous revision of this doc described BLE History as a single 512-byte `READ` (~9-record
cap) and Time-Sync/Config-framing/WiFi-provisioning as unimplemented open items. All of that is
now built (§4, §5.5, §4.7) — this section is kept only as a pointer for anyone diffing against
an older copy; there is no remaining "v2 migration" to plan.

### 9.3 Recommended hardening (track separately, out of scope for this pass)

- Device API key on `POST` routes.
- Rate limiting → `429`.
- Optional `deviceId` column for multi-node support (current schema assumes one device).
- WiFi-side `GET /api/config` polling so a phone-less, WiFi-connected device can pick up schedule
  changes without ever being re-visited over BLE.
- Certificate pinning (or at least CA validation) for the WiFi HTTPS POST path, replacing
  `setInsecure()`.
- **Firmware: report `sensorId` on real readings.** Sample both physical sensor units per
  measurement cycle and send two `POST /api/telemetry` (or two entries per `/batch`/History-dump
  record) with `sensorId: 1` / `sensorId: 2` respectively, instead of the current single
  unlabeled reading. Until this ships, both dashboard sensor cards/series show identical data
  sourced from the same physical probe (whatever the firmware currently reads), since every
  reading defaults to `sensorId: 1` and `sensorId: 2` never receives real data.

---

## 10. Troubleshooting

**WiFi — POST times out / data not arriving**
- Verify reachability: `curl -X POST https://greenhouse-monitoring-opal.vercel.app/api/telemetry -H 'Content-Type: application/json' -d '{"soilMoisture":50,"sensorId":1}'` → expect `201 {id,message}`.
- Check serial for the HTTP status; `400` means payload shape (send `soilMoisture` number, optional `sensorId` matching a configured sensor, `recordedAt` ISO 8601).

**WiFi — relays not following the app**
- Confirm the poll loop calls `GET /api/relay` and applies each `isOn`.
- Remember there's no push; latency ≈ your poll interval.

**BLE — no notifications**
- PWA must be on Android Chrome; device must advertise exact name `GH-Sensor`.
- Confirm the phone subscribed to the Realtime characteristic and the link is stable.

**BLE — history sync stalls / never completes**
- The PWA times out a stream after 30s of inactivity (no new record notification). Check the
  device is still `connected` and that `dumpHistory()` isn't looping forever — it should always
  end with a `{"done":true,"total":N}` notify even for `N=0`.
- If sync repeatedly re-uploads the same records, the `0x02` ack write may not be reaching the
  device (check `[storage] cleared` in the serial log after each sync) — harmless (server dedup
  absorbs it) but worth fixing to keep the on-device buffer from filling up.

**WiFi Provisioning fails or times out**
- Firmware backs off and retries indefinitely rather than giving up after one attempt — a
  `{"wifi":"failed"}` notification only means *this* 15s attempt timed out, not that it stopped
  trying. Re-open WiFi Setup and re-provision if the SSID/password was wrong.
- Confirm `serverUrl` has no trailing slash issues and is reachable from the site's network (not
  just from the phone's — the ESP32 needs its own path to it, which may differ if the dashboard
  is only reachable via a VPN or local network the phone is bridging).

**Timestamps wrong in dashboard**
- WiFi mode self-corrects once NTP lands (usually within a few seconds of connecting). BLE mode:
  confirm the PWA is writing Time-Sync *before* triggering history sync (§4.6 order matters).
  Readings taken before the first sync this boot, with no BLE offset ever recorded this session,
  upload without `recordedAt` and get stamped at upload time — re-sync sooner after boot to
  shrink this window.

**Duplicates in database**
- Shouldn't happen — `(sensorId,recordedAt,soilMoisture)` is unique and inserts silently skip
  duplicates (§2). If you're seeing genuine duplicate rows, check whether the two readings
  actually differ by even a fractional degree of precision or a few seconds of `recordedAt` —
  those are treated as distinct readings, not duplicates, which usually means the real problem is
  clock drift between the BLE-derived and NTP-derived timestamp for the same physical
  measurement.

**Sensor 2's card is empty ("—") while Sensor 1 has data**
- Expected until firmware sends `sensorId` (§9.1, §9.3) — every real reading currently defaults
  to `sensorId: 1`, so `GET /api/telemetry?sensorId=2` legitimately returns `[]` and that card has
  nothing to show. Not a dashboard bug. (`?mockBle=1` mock mode simulates independent data for
  both sensors, so this only shows up against real hardware or `GET /api/telemetry` directly.)

---

**Supersedes:** `API_BLE.md`, `API_WIFI.md`, `esp32-monitoring-old/WIFI_APPROACH.md` (kept for
history; this file is authoritative).
**Last updated:** 2026-07-09
