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

> ⚠️ **Accuracy note.** This spec is written against the **currently deployed backend** and the
> **current PWA source** — not the older aspirational drafts. Where the live system differs from
> the previous docs (response shapes, auth, dedup, BLE history transfer), it is documented as-is
> and the gaps are collected in **[§9 Implementation Status & Open Items](#9-implementation-status--open-items)**.
> Coordinate those open items with the web team before finalizing firmware.

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

---

## 2. Shared cloud API contract

Everything below is served by the deployed backend and is identical regardless of transport.

### Conventions

- **Content-Type:** `application/json` (UTF-8).
- **IDs:** returned as **strings** (the DB uses 64-bit integers, serialized as decimal strings).
- **Timestamps:** ISO 8601 UTC, e.g. `"2026-06-25T10:00:00Z"` (accepted) / `"2026-06-25T10:00:00.000Z"` (returned).
- **Auth:** **None enforced today.** An `Authorization` header is accepted but ignored. Do not
  rely on 401s. (Adding a device API key is an open item — see §9.)
- **Success codes:** `201 Created` for writes that insert; `200 OK` for reads and relay/schedule updates.
- **Errors:** `{ "statusCode": 400, "message": "…" }` with a `4xx` status. There is currently
  **no** `409` dedup, **no** `429` rate-limit, and **no** timestamp-skew rejection.

### 2.1 `POST /api/telemetry` — single reading

Ingest one soil-moisture reading (used by WiFi direct realtime, or any single insert).

**Request**
```json
{ "soilMoisture": 62.3, "recordedAt": "2026-06-25T10:00:00Z" }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `soilMoisture` | number 0–100 | **Yes** | Percentage, 1 decimal recommended |
| `recordedAt` | ISO 8601 string | No | Measurement time. **If omitted or invalid, the server uses its own clock** (= receipt time). Send it explicitly in WiFi mode. |

> Fields from the old WiFi draft — `timestamp` (epoch ms) and `deviceId` — are **not consumed**
> by the current backend. Send measurement time as `recordedAt` (ISO 8601). See §9.

**Response `201`**
```json
{ "id": "12345", "message": "Telemetry recorded" }
```

**Errors:** `400` if `soilMoisture` is missing/NaN or outside 0–100.
Side effect: if `soilMoisture < 40`, the server fires a low-moisture alert (fire-and-forget).

### 2.2 `POST /api/telemetry/batch` — bulk upload

Used by the **PWA after a BLE history sync**, and by **WiFi recovery** after an outage.

**Request** (max **500** items per call)
```json
{
  "readings": [
    { "soilMoisture": 62.3, "recordedAt": "2026-06-25T10:00:00Z" },
    { "soilMoisture": 58.1, "recordedAt": "2026-06-25T10:15:00Z" },
    { "soilMoisture": 55.7 }
  ]
}
```

Each item follows the same field rules as §2.1 (`recordedAt` optional → defaults to server time).

**Response `201`**
```json
{ "count": 3, "message": "Batch recorded" }
```

**Errors:** `400` if `readings` is missing/empty, exceeds 500 items, or any item's
`soilMoisture` is invalid. **No per-item partial success / no dedup** — the whole batch inserts
or the request 400s on the first bad item.

### 2.3 `GET /api/telemetry` — history read (mainly for the PWA)

```
GET /api/telemetry?range=24h&limit=1000
```
| Query | Values | Default |
|---|---|---|
| `range` | `1h` `6h` `24h` `7d` `all` | `24h` |
| `limit` | 1–1000 | `1000` |

**Response `200`** — newest first (by effective time `recordedAt ?? createdAt`):
```json
[
  { "id": "54", "soilMoisture": 62.3,
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

---

## 3. Approach A — WiFi Direct

The ESP32 has its own internet connection and talks to the cloud REST API directly.

### 3.1 Telemetry upload

- Every measurement interval (default **15 min**): read sensor → `POST /api/telemetry` with
  `soilMoisture` and an ISO-8601 `recordedAt` derived from NTP time (see §7).
- On success (`201`) continue. On failure, buffer locally and retry (see §3.2).

### 3.2 Offline buffering & retry

```
POST fails ─► store reading in local ring buffer (recommended ≥100 records)
           ─► retry with backoff: 5s → 30s → 1m → 5m → 30m (cap ~2h)

WiFi restored ─► drain buffer via POST /api/telemetry/batch (≤500 per call, page if more)
              ─► on 201, clear the drained records
```

Because the backend has **no dedup**, the device must not re-send already-acknowledged records
(clear them only after a `201`). Keep batches ≤ 500.

### 3.3 Relay/schedule control in WiFi mode (polling)

There is no cloud→device push. The device **polls** the cloud for desired state:

```
Every POLL_INTERVAL (recommend 10–30 s):
  GET /api/relay      → for each channel, apply isOn to the physical relay
  GET /api/schedule   → cache schedules; run them locally against the RTC/NTP clock
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

| # | Characteristic | UUID | Props (as used by PWA) | Payload |
|---|---|---|---|---|
| 1 | Realtime | `beb5483e-36e1-4688-b7f5-ea07361b26a8` | NOTIFY | `{"soilMoisture":62.3}` |
| 2 | History | `1c95d5e3-d8f7-413a-bf3d-7a2e5d7be87e` | READ | JSON **array** `[{soilMoisture,recordedAt?}]` |
| 3 | Command | `a8261b36-3f5e-4a2c-9b1d-2e6f7c8a9b01` | WRITE (with response) | JSON relay/schedule command (§5) |
| 4 | Time Sync | `a1b2c3d4-e5f6-7890-abcd-ef0123456789` | WRITE | epoch-ms ASCII string (see §7) — **recommended, not yet wired in PWA** |

> The previous BLE draft used a NOTIFY-streamed history (`write 0x01` → stream → `{"done":true}`)
> and a single-byte relay characteristic (`6e400001-…`). **Both are superseded:** history is a
> single READ of a JSON array in the current PWA, and relay control now goes through the JSON
> **Command** characteristic (#3). See §4.3 for the size limitation this READ approach implies,
> and §9 for the streaming upgrade path.

### 4.2 Realtime characteristic (NOTIFY)

While a phone is connected, the ESP32 notifies the latest reading. The current PWA parses only
`soilMoisture`:

```json
{ "soilMoisture": 62.3 }
```
You may include `recordedAt` too (harmless; ignored by the realtime handler). Suggested cadence:
every 15 min, or faster while connected for a live feel. **These are not persisted** — they only
update the on-screen metric.

### 4.3 History characteristic (READ)

On **Sync History**, the PWA performs a single `readValue()` and expects a **JSON array**:

```json
[
  { "soilMoisture": 62.3, "recordedAt": "2026-06-25T10:00:00Z" },
  { "soilMoisture": 58.1, "recordedAt": "2026-06-25T10:15:00Z" }
]
```

It then forwards the array to `POST /api/telemetry/batch` as `{ "readings": [...] }`.

> ⚠️ **Size limit.** A GATT characteristic value maxes out at **512 bytes**, so a single READ
> fits only ~8–9 records. For the full on-device buffer (target ~100 records) this is
> insufficient. **Recommended upgrade** (requires a coordinated PWA change): switch History to the
> streaming protocol in §9.2. Until then, either keep the buffer small or expect multiple syncs.

### 4.4 Command characteristic (WRITE)

The PWA writes JSON commands (UTF-8, `writeValueWithResponse`) — see §5 for payloads.

### 4.5 Connection & sync flow (current PWA)

```
Phone (PWA)                                  ESP32
  ├─ requestDevice({name:'GH-Sensor'})
  ├─ gatt.connect()
  ├─ getPrimaryService(4fafc201…)
  ├─ Realtime: startNotifications() ───────► (subscribe)
  │      ◄──────── NOTIFY {"soilMoisture":62.3}   (live display only)
  │
  ├─ (user taps "Sync History")
  │   History: readValue() ────────────────► returns JSON array
  │      ◄──────── [ {soilMoisture,recordedAt}, … ]
  │   POST /api/telemetry/batch  ──► cloud
  │
  ├─ (user toggles a relay / edits a schedule)
  │   Command: writeValueWithResponse(json) ─► ESP32 actuates / stores schedule
  │   POST /api/relay  or  /api/schedule  ──► cloud (desired state persisted)
```

### 4.6 Reference PWA logic (informative)

```javascript
// Realtime
realtimeChar.addEventListener('characteristicvaluechanged', (e) => {
  const { soilMoisture } = JSON.parse(new TextDecoder().decode(e.target.value))
  updateDashboard(soilMoisture)            // NOT posted to cloud
})
await realtimeChar.startNotifications()

// History sync (single READ → batch upload)
const buf = await historyChar.readValue()
const readings = JSON.parse(new TextDecoder().decode(buf))   // [{soilMoisture,recordedAt}]
await fetch('/api/telemetry/batch', { method:'POST', body: JSON.stringify({ readings }) })

// Command (relay / schedule)
await commandChar.writeValueWithResponse(
  new TextEncoder().encode(JSON.stringify({ type:'relay', channel:1, on:true }))
)
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

### 5.3 BLE command payloads (Command characteristic #3)

The PWA writes these JSON objects when connected:

```json
// Manual relay toggle
{ "type": "relay", "channel": 1, "on": true }

// Full schedule set (push on connect and on any change)
{ "type": "schedule", "schedules": [
  { "channel": 2, "startTime": "06:30", "durationMinutes": 15, "daysOfWeek": [1,3,5], "enabled": true }
] }
```

**Firmware contract:**
- `type:"relay"` → set relay `channel` to `on` immediately.
- `type:"schedule"` → **replace** the stored schedule set with the provided array and run it
  locally against the device clock. `channel`/`startTime`/`durationMinutes`/`daysOfWeek`/`enabled`
  map 1:1 to §5.2. Days use `0=Sun … 6=Sat`. `startTime` is local `"HH:MM"`.

### 5.4 How commands reach the device per transport

| | Manual toggle | Schedule set |
|---|---|---|
| **BLE** | PWA writes `{type:"relay",…}` to Command char | PWA writes `{type:"schedule",…}` on connect & on change |
| **WiFi** | Device polls `GET /api/relay`, applies each `isOn` | Device polls `GET /api/schedule`, runs locally |

In **both** cases the cloud DB is authoritative. The in-app scheduler in the PWA also enacts due
windows while it is open+connected (belt-and-suspenders); a WiFi device running schedules locally
is the reliable path when no phone is present.

---

## 6. Dual-mode firmware guidance

Recommended behavior for a node that supports both transports:

```
boot
 ├─ start sensor sampling + local ring buffer (always)
 ├─ start BLE advertising as "GH-Sensor" (always, cheap local channel)
 └─ if WiFi configured:
       try WiFi connect (NTP time sync)
       ┌── WiFi up ──────────────────────────────────────────────┐
       │  • POST /api/telemetry each reading (buffer+retry on fail)│
       │  • poll GET /api/relay + GET /api/schedule (10–30 s)      │
       │  • execute relays/schedules from polled desired-state     │
       └──────────────────────────────────────────────────────────┘
       ┌── WiFi down / not configured ───────────────────────────┐
       │  • keep buffering readings locally                       │
       │  • serve realtime NOTIFY + History READ to the PWA       │
       │  • accept relay/schedule via Command characteristic      │
       │  • get time via phone Time-Sync char or on-board RTC     │
       └──────────────────────────────────────────────────────────┘
```

Notes:
- BLE and WiFi can be active simultaneously; if both a poll and a BLE command arrive, **last write
  wins** (the DB reflects whatever was written most recently). Keep the poll interval modest to
  avoid fighting a just-issued BLE command.
- Deep-sleep strategies must account for BLE advertising and poll cadence.

---

## 7. Timestamps & time sync

The backend needs a correct `recordedAt` per reading to place it on the timeline (batch uploads
of old data rely on it; missing `recordedAt` defaults to **upload time**, which is wrong for
history).

**WiFi mode:** sync time via **NTP** on connect; format `recordedAt` as ISO 8601 UTC.

**BLE-only mode (no NTP):** two options —
1. **On-board RTC** (e.g. DS3231) — most robust; device always has real time.
2. **Phone time sync** — PWA writes epoch-ms to the **Time-Sync characteristic** (#4):
   ```
   Write ASCII "1751234567890"   // String(Date.now())
   ESP32: epochOffset = epochMs - millis();  timeSynced = true
   recordedAt = formatISO8601(epochOffset + millis())
   ```
   > The **current PWA does not yet write the Time-Sync characteristic** (open item §9.1). Until
   > it does, prefer an on-board RTC for BLE-only deployments, or accept that BLE-synced history
   > will be timestamped at upload time.

After a reboot, `millis()` resets — always re-sync (NTP or phone) before trusting derived times.

---

## 8. Field specs, validation & status codes

### Field reference

| Field | Type | Where | Rules |
|---|---|---|---|
| `soilMoisture` | number | telemetry | Required; `0 ≤ v ≤ 100`; else `400` |
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
| `200` | GET / relay / schedule update ok | Continue |
| `201` | telemetry / batch / schedule insert ok | Clear buffered records that were acked |
| `400` | Invalid payload (bad number, bad range, empty/oversized batch, bad id) | Log, fix payload, **don't blind-retry** |
| `404` | Schedule id not found (PATCH/DELETE) | Refresh schedule list |
| `5xx` | Server/DB error | Retry with backoff |

> **Not implemented today:** `401` (no auth), `409` (no dedup — do not resend acked records),
> `429` (no rate limiting — still be a good citizen and keep cadence ≥ ~1 req/s). See §9.

---

## 9. Implementation status & open items

What the live system does today vs. what the older drafts assumed. Align these with the web team.

### 9.1 Status matrix

| Capability | Status | Notes |
|---|---|---|
| `POST /api/telemetry` (single) | ✅ Live | Returns `{id,message}` `201`; uses `recordedAt`, ignores `timestamp`/`deviceId` |
| `POST /api/telemetry/batch` | ✅ Live | ≤500/req; returns `{count,message}` `201` |
| `GET /api/telemetry` | ✅ Live | `range`/`limit` params |
| Relay + schedule + actuation APIs | ✅ Live | §5 |
| BLE Realtime NOTIFY | ✅ Live (PWA) | Display-only; not persisted |
| BLE History transfer | ⚠️ Live as **single READ** of a JSON array | 512-byte limit ≈ ~9 records — see §9.2 |
| BLE Command char (relay/schedule JSON) | ✅ Live (PWA) | `a8261b36-…` |
| BLE Time-Sync char | ❌ Not wired in PWA | Firmware may still expose it; prefer RTC for now |
| Auth / API key | ❌ None | Header ignored; add for production |
| Dedup / idempotency (`409`) | ❌ None | Device must not resend acked records |
| Rate limiting (`429`) | ❌ None | Self-throttle |
| Timestamp-skew rejection | ❌ None | Bad clocks are accepted as-is |
| WiFi relay control | ⚙️ By polling existing `GET /api/relay` + `GET /api/schedule` | No cloud→device push exists |
| Device actuation confirmation | ⚙️ Optional | `POST /api/relay {source:"device"}` |

Legend: ✅ implemented · ⚠️ implemented with a caveat · ⚙️ pattern using existing endpoints · ❌ not present.

### 9.2 Recommended: streaming BLE history (v2)

To move beyond the ~9-record READ limit, migrate the History characteristic to a NOTIFY stream
(this needs a **coordinated PWA + firmware change**):

```
Phone → History (WRITE 0x01)         // request dump
ESP32 → NOTIFY {"soilMoisture":…,"recordedAt":"…"}   // one per record
ESP32 → NOTIFY {"soilMoisture":…,"recordedAt":"…"}
ESP32 → NOTIFY {"done":true,"total":96}              // end marker
Phone accumulates → POST /api/telemetry/batch (paged ≤500)
```

Until the PWA implements this, treat the single-READ array (§4.3) as the contract.

### 9.3 Recommended backend hardening (track separately)

- Device API key on `POST` routes.
- Dedup by (`recordedAt`,`soilMoisture`) or a device-supplied idempotency key → return `409`.
- Rate limiting → `429`.
- Optional `deviceId` column for multi-node support.

---

## 10. Troubleshooting

**WiFi — POST times out / data not arriving**
- Verify reachability: `curl -X POST https://greenhouse-monitoring-opal.vercel.app/api/telemetry -H 'Content-Type: application/json' -d '{"soilMoisture":50}'` → expect `201 {id,message}`.
- Check serial for the HTTP status; `400` means payload shape (send `soilMoisture` number, `recordedAt` ISO 8601).

**WiFi — relays not following the app**
- Confirm the poll loop calls `GET /api/relay` and applies each `isOn`.
- Remember there's no push; latency ≈ your poll interval.

**BLE — no notifications**
- PWA must be on Android Chrome; device must advertise exact name `GH-Sensor`.
- Confirm the phone subscribed to the Realtime characteristic and the link is stable.

**BLE — history sync empty or truncated**
- The current PWA does a single READ; ensure the History value is a valid JSON **array** and
  fits in 512 bytes (≈9 records). Larger buffers need the streaming upgrade (§9.2).

**Timestamps wrong in dashboard**
- WiFi: sync NTP before formatting `recordedAt`. BLE-only: use an RTC (Time-Sync char not yet in
  PWA). After reboot, re-sync before trusting timestamps.

**Duplicates in database**
- Backend does **not** dedup. Only clear local buffer entries after a `201`, and never resend
  acked records.

---

**Supersedes:** `API_BLE.md`, `API_WIFI.md` (kept for history; this file is authoritative).
**Last updated:** 2026-07-06
