<script setup lang="ts">
interface TelemetryRecord {
  id: string
  sensorId: number
  soilMoisture: number
  recordedAt: string | null
  createdAt: string
}

interface Relay {
  id: string
  channel: number
  name: string
  isOn: boolean
  updatedAt: string
}

interface Schedule {
  id: string
  relayChannel: number
  startTime: string
  durationMinutes: number
  daysOfWeek: number[]
  enabled: boolean
  createdAt: string
}

const config = useRuntimeConfig()

interface DeviceConfigBundle {
  settings: { measureIntervalMinutes: number; lowMoistureThreshold: number }
  schedules: Array<{
    channel: number
    startTime: string
    durationMinutes: number
    daysOfWeek: number[]
    enabled: boolean
  }>
  version: string
}

// Handle to the BLE component so we can send outbound commands to the ESP32.
const bleRef = ref<{
  sendCommand: (payload: object) => Promise<void>
  syncHistory: () => Promise<void>
} | null>(null)

// Time range selection (default from runtime config)
const RANGE_OPTIONS = [
  { v: '1h', l: '1H' },
  { v: '6h', l: '6H' },
  { v: '24h', l: '24H' },
  { v: '7d', l: '7D' },
  { v: 'all', l: 'All' },
]
const range = ref(config.public.telemetryDefaultRange)

// Two physical soil-moisture sensor units (runtimeConfig.public.soilSensors).
// We use useAsyncData + $fetch with server: false so SSR never participates —
// Nuxt's useFetch can hydrate from an empty SSR response and then refuse to
// refetch on mount.  Data is fetched manually in onMounted and on every poll.
const soilSensors = config.public.soilSensors as Array<{ sensorId: number; name: string }>

const sensorData = ref<Record<number, TelemetryRecord[]>>({})
const sensorPending = ref(false)
const sensorError = ref<Error | null>(null)

async function fetchSensor(sensorId: number): Promise<TelemetryRecord[]> {
  return $fetch<TelemetryRecord[]>(`/api/telemetry?range=${range.value}&sensorId=${sensorId}`)
}

async function refreshAll() {
  sensorPending.value = true
  sensorError.value = null
  try {
    const results = await Promise.all(soilSensors.map((s) => fetchSensor(s.sensorId)))
    const map: Record<number, TelemetryRecord[]> = {}
    for (let i = 0; i < soilSensors.length; i++) {
      map[soilSensors[i].sensorId] = results[i]
    }
    sensorData.value = map
  } catch (err) {
    sensorError.value = err as Error
  } finally {
    sensorPending.value = false
  }
}

const hasAnyData = computed(() =>
  Object.values(sensorData.value).some((arr) => arr.length > 0),
)

// All sensors' readings merged into one list, newest first — feeds the
// combined chart/table so the two sensors can be compared side by side.
const combinedRecords = computed(() => {
  const merged = soilSensors.flatMap((s) =>
    (sensorData.value[s.sensorId] ?? []).map((r) => ({ ...r, sensorName: s.name })),
  )
  return merged.sort((a, b) => {
    const ea = new Date(a.recordedAt ?? a.createdAt).getTime()
    const eb = new Date(b.recordedAt ?? b.createdAt).getTime()
    return eb - ea
  })
})

// Relay + schedule state
const { data: relays, refresh: refreshRelays } = useFetch<Relay[]>('/api/relay')
const { data: schedules, refresh: refreshSchedules } = useFetch<Schedule[]>('/api/schedule')

// Auto-poll cloud data
let interval: ReturnType<typeof setInterval> | null = null
function onVisibilityChange() {
  if (document.visibilityState === 'visible') refreshAll()
}
onMounted(() => {
  refreshAll()
  interval = setInterval(() => refreshAll(), config.public.telemetryPollInterval)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onUnmounted(() => {
  if (interval) clearInterval(interval)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

// Latest cloud reading per sensor
const latestBySensor = computed(() => {
  const map: Record<number, TelemetryRecord | null> = {}
  for (const s of soilSensors) {
    map[s.sensorId] = sensorData.value[s.sensorId]?.[0] ?? null
  }
  return map
})

// BLE state — driven by BLEConnection events
const bleConnected = ref(false)
const realtimeReadings = ref<Record<number, number | null>>({})

// Value shown per metric card: prefer live BLE when connected
const displayMoistureBySensor = computed(() => {
  const map: Record<number, number | null> = {}
  for (const s of soilSensors) {
    const live = realtimeReadings.value[s.sensorId]
    map[s.sensorId] =
      bleConnected.value && live != null ? live : latestBySensor.value[s.sensorId]?.soilMoisture ?? null
  }
  return map
})

function moistureStatus(val: number) {
  if (val < 30) return 'critical'
  if (val < 40) return 'warning'
  return 'normal'
}

// Share device connection state with layout header. lastSeenAt is the
// effective time of the freshest reading across both sensors — the header
// treats a fresh value as "connected via WiFi" when BLE is down.
const esp32Status = useState<{ bleConnected: boolean; lastSeenAt: string | null }>(
  'esp32Status',
  () => ({ bleConnected: false, lastSeenAt: null }),
)

watch(latestBySensor, (map) => {
  let freshest: string | null = null
  for (const record of Object.values(map)) {
    if (!record) continue
    const effective = record.recordedAt ?? record.createdAt
    if (!freshest || new Date(effective) > new Date(freshest)) freshest = effective
  }
  if (!freshest) return
  // Only move forward — switching to a narrow time range must not regress it
  const prev = esp32Status.value.lastSeenAt
  if (!prev || new Date(freshest) > new Date(prev)) {
    esp32Status.value = { ...esp32Status.value, lastSeenAt: freshest }
  }
}, { immediate: true, deep: true })

function onConnectionChange(connected: boolean) {
  bleConnected.value = connected
  esp32Status.value = { ...esp32Status.value, bleConnected: connected }
  if (!connected) {
    realtimeReadings.value = {}
  }
}

// Fired after connect + time-sync: push config, enact due windows, then pull
// the device's buffered history automatically (manual Sync button still works).
async function onReady() {
  await pushConfigToDevice()
  await runScheduler()
  bleRef.value?.syncHistory().catch((err: unknown) => {
    console.error('Auto history sync failed:', err)
  })
}

function onRealtimeReading(sensorId: number, value: number) {
  realtimeReadings.value = { ...realtimeReadings.value, [sensorId]: value }
}

function onSyncComplete() {
  refreshAll()
}

// ── Relay control ───────────────────────────────────────────────────────────

// Persist desired state to the DB (always), then actuate physically over BLE
// when connected. Works in cloud/mock mode; the pump only moves when BLE is up.
async function onRelayToggle(channel: number, isOn: boolean, source = 'manual') {
  try {
    await $fetch('/api/relay', { method: 'POST', body: { channel, isOn, source } })
  } catch (err) {
    console.error('Relay state update failed:', err)
    return
  }

  if (bleConnected.value) {
    try {
      await bleRef.value?.sendCommand({ type: 'relay', channel, on: isOn })
    } catch (err) {
      console.error('BLE relay command failed:', err)
    }
  }

  await refreshRelays()
}

// daysOfWeek array (0=Sun..6=Sat) → bitmask (bit0=Sun) for compact BLE frames.
function daysToBitmask(days: number[]) {
  return days.reduce((mask, d) => mask | (1 << d), 0)
}

// Push the server config bundle (settings + enabled schedules) to the device
// as a framed sequence — each write stays far below the 512-byte GATT limit.
// The firmware stages frames and commits atomically on cfgend.
async function pushConfigToDevice() {
  if (!bleConnected.value) return
  try {
    const bundle = await $fetch<DeviceConfigBundle>('/api/config')
    const send = bleRef.value?.sendCommand
    if (!send) return

    await send({ type: 'cfgbegin', settings: bundle.settings, count: bundle.schedules.length })
    for (const s of bundle.schedules) {
      await send({
        type: 'sched',
        c: s.channel,
        s: s.startTime,
        d: s.durationMinutes,
        w: daysToBitmask(s.daysOfWeek),
        e: s.enabled,
      })
    }
    await send({ type: 'cfgend', count: bundle.schedules.length })
  } catch (err) {
    console.error('Config push failed:', err)
  }
}

async function onSchedulesChanged() {
  await refreshSchedules()
  await pushConfigToDevice()
}

// ── In-app scheduler (fallback while the dashboard is open + connected) ───────
// Device-side execution via the pushed schedule is the reliable path; this
// enacts due windows when the app is open so schedules still fire without firmware.
const scheduleOwned = ref<Set<number>>(new Set())

function isWindowActive(s: Schedule, now: Date) {
  if (!s.enabled) return false
  if (!s.daysOfWeek.includes(now.getDay())) return false
  const start = toMinutes(s.startTime)
  const cur = now.getHours() * 60 + now.getMinutes()
  return cur >= start && cur < start + s.durationMinutes
}

async function runScheduler() {
  if (!bleConnected.value || !schedules.value || !relays.value) return
  const now = new Date()

  const dueChannels = new Set<number>()
  for (const s of schedules.value) {
    if (isWindowActive(s, now)) dueChannels.add(s.relayChannel)
  }

  // Turn ON newly-due relays that are currently off (take ownership so we
  // can turn them back off — never touch a relay the user switched on manually).
  for (const channel of dueChannels) {
    if (scheduleOwned.value.has(channel)) continue
    const relay = relays.value.find((r) => r.channel === channel)
    if (relay && !relay.isOn) {
      await onRelayToggle(channel, true, 'schedule')
      scheduleOwned.value.add(channel)
    }
  }

  // Turn OFF relays whose window has ended (only those we own).
  for (const channel of [...scheduleOwned.value]) {
    if (dueChannels.has(channel)) continue
    const relay = relays.value.find((r) => r.channel === channel)
    if (relay && relay.isOn) await onRelayToggle(channel, false, 'schedule')
    scheduleOwned.value.delete(channel)
  }
}

let scheduleInterval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  scheduleInterval = setInterval(runScheduler, config.public.relayScheduleCheckInterval)
})
onUnmounted(() => {
  if (scheduleInterval) clearInterval(scheduleInterval)
})

// Pagination (over the combined, sensor-tagged record list)
const recordsPerPage = 10
const currentPage = ref(1)

const paginatedRecords = computed(() => {
  const start = (currentPage.value - 1) * recordsPerPage
  return combinedRecords.value.slice(start, start + recordsPerPage)
})

const totalPages = computed(() => Math.ceil(combinedRecords.value.length / recordsPerPage))

watch(combinedRecords, () => { currentPage.value = 1 })
</script>

<template>
  <div class="space-y-6">
    <!-- Page Header -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-xl font-bold text-gray-900">Dashboard</h2>
      <div class="flex items-center gap-3">
        <!-- Time range selector -->
        <div class="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
          <button
            v-for="opt in RANGE_OPTIONS"
            :key="opt.v"
            class="text-sm px-3 py-1 rounded-md font-medium transition-colors"
            :class="range === opt.v
              ? 'bg-primary-600 text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-100'"
            @click="range = opt.v"
          >
            {{ opt.l }}
          </button>
        </div>
        <button class="text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50
           text-gray-600 transition-colors disabled:opacity-50" :disabled="sensorPending" @click="refreshAll()">
          {{ sensorPending ? 'Refreshing...' : 'Refresh' }}
        </button>
      </div>
    </div>

    <!-- BLE Connection Panel (client-only: Web Bluetooth is browser-only) -->
    <ClientOnly>
      <BLEConnection
        ref="bleRef"
        @realtime-reading="onRealtimeReading"
        @sync-complete="onSyncComplete"
        @connection-change="onConnectionChange"
        @ready="onReady"
      />
    </ClientOnly>

    <!-- Data mode banner -->
    <div v-if="bleConnected"
      class="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
      <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
      BLE Connected — showing live readings
    </div>
    <div v-else-if="hasAnyData"
      class="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5">
      <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
      </svg>
      Cloud Mode — showing historical data
    </div>

    <!-- Error State -->
    <div v-if="sensorError" class="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
      ⚠ Failed to load telemetry data: {{ sensorError.message }}
      <button class="underline ml-2 hover:no-underline" @click="refreshAll()">Retry</button>
    </div>

    <!-- Loading skeleton -->
    <div v-if="sensorPending && !hasAnyData">
      <div class="rounded-xl border border-gray-200 p-5 animate-pulse">
        <div class="h-4 bg-gray-200 rounded w-24 mb-4" />
        <div class="h-8 bg-gray-200 rounded w-20" />
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!sensorPending && !hasAnyData && !bleConnected"
      class="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
      <div class="text-amber-600 font-medium text-lg mb-1">No Data Yet</div>
      <p class="text-amber-700/70 text-sm">
        Connect to the ESP32 sensor via Bluetooth above, or wait for cloud data to appear.
      </p>
    </div>

    <!-- Metric Cards, one per sensor -->
    <div v-if="hasAnyData || bleConnected" class="grid gap-4 sm:grid-cols-2">
      <MetricCard
        v-for="s in soilSensors"
        :key="s.sensorId"
        :title="`${s.name} — Soil Moisture`"
        :value="displayMoistureBySensor[s.sensorId] ?? '—'"
        unit="%"
        icon="moisture"
        :status="displayMoistureBySensor[s.sensorId] != null ? moistureStatus(displayMoistureBySensor[s.sensorId]!) : 'normal'"
      />
    </div>

    <!-- Water Pump Relay Control -->
    <RelayControl
      :relays="relays ?? []"
      :ble-connected="bleConnected"
      @toggle="onRelayToggle"
    />

    <!-- Watering Schedules -->
    <ScheduleEditor
      :relays="relays ?? []"
      :schedules="schedules ?? []"
      @changed="onSchedulesChanged"
    />

    <!-- Chart (one series per sensor) -->
    <div v-if="hasAnyData">
      <TelemetryChart :sensors="soilSensors.map((s) => ({ name: s.name, records: sensorData[s.sensorId] ?? [] }))" />
    </div>

    <!-- Data Table (combined, tagged with sensor) -->
    <div v-if="hasAnyData" class="space-y-4">
      <TelemetryTable :records="paginatedRecords" />

      <!-- Pagination Controls -->
      <div class="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-5 py-3">
        <div class="text-sm text-gray-600">
          Showing {{ (currentPage - 1) * recordsPerPage + 1 }}–{{ Math.min(currentPage * recordsPerPage,
          combinedRecords.length) }} of {{ combinedRecords.length }}
        </div>
        <div class="flex gap-2">
          <button class="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium
             text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            :disabled="currentPage === 1" @click="currentPage--">
            Previous
          </button>
          <div class="flex items-center gap-1 px-2">
            <span class="text-sm text-gray-600">{{ currentPage }}/{{ totalPages }}</span>
          </div>
          <button class="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium
             text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            :disabled="currentPage === totalPages" @click="currentPage++">
            Next
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
