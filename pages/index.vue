<script setup lang="ts">
interface TelemetryRecord {
  id: string
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

// Handle to the BLE component so we can send outbound commands to the ESP32.
const bleRef = ref<{ sendCommand: (payload: object) => Promise<void> } | null>(null)

// Time range selection (default from runtime config)
const RANGE_OPTIONS = [
  { v: '1h', l: '1H' },
  { v: '6h', l: '6H' },
  { v: '24h', l: '24H' },
  { v: '7d', l: '7D' },
  { v: 'all', l: 'All' },
]
const range = ref(config.public.telemetryDefaultRange)

const { data, refresh, pending, error } = useFetch<TelemetryRecord[]>(
  () => `/api/telemetry?range=${range.value}`,
)

// Relay + schedule state
const { data: relays, refresh: refreshRelays } = useFetch<Relay[]>('/api/relay')
const { data: schedules, refresh: refreshSchedules } = useFetch<Schedule[]>('/api/schedule')

// Auto-poll cloud data (regardless of BLE state)
let interval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  interval = setInterval(() => refresh(), config.public.telemetryPollInterval)
})
onUnmounted(() => {
  if (interval) clearInterval(interval)
})

// Latest cloud reading
const latest = computed(() => {
  if (!data.value || data.value.length === 0) return null
  return data.value[0]
})

// BLE state — driven by BLEConnection events
const bleConnected = ref(false)
const realtimeReading = ref<number | null>(null)

// Value shown in the metric card: prefer live BLE when connected
const displayMoisture = computed(() =>
  bleConnected.value && realtimeReading.value !== null
    ? realtimeReading.value
    : latest.value?.soilMoisture ?? null
)

function moistureStatus(val: number) {
  if (val < 30) return 'critical'
  if (val < 40) return 'warning'
  return 'normal'
}

// Share device connection state with layout header. lastSeenAt is the
// effective time of the newest cloud reading — the header treats a fresh
// value as "connected via WiFi" when BLE is down.
const esp32Status = useState<{ bleConnected: boolean; lastSeenAt: string | null }>(
  'esp32Status',
  () => ({ bleConnected: false, lastSeenAt: null }),
)

watch(latest, (record) => {
  if (!record) return
  const effective = record.recordedAt ?? record.createdAt
  // Only move forward — switching to a narrow time range must not regress it
  const prev = esp32Status.value.lastSeenAt
  if (!prev || new Date(effective) > new Date(prev)) {
    esp32Status.value = { ...esp32Status.value, lastSeenAt: effective }
  }
}, { immediate: true })

function onConnectionChange(connected: boolean) {
  bleConnected.value = connected
  esp32Status.value = { ...esp32Status.value, bleConnected: connected }
  if (!connected) {
    realtimeReading.value = null
  } else {
    // Sync schedules to the device and enact any window that's already due.
    pushSchedulesToDevice()
    runScheduler()
  }
}

function onRealtimeReading(value: number) {
  realtimeReading.value = value
}

function onSyncComplete() {
  refresh()
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

// Push the full schedule set to the device so firmware can run it autonomously.
async function pushSchedulesToDevice() {
  if (!bleConnected.value || !schedules.value) return
  try {
    await bleRef.value?.sendCommand({
      type: 'schedule',
      schedules: schedules.value.map((s) => ({
        channel: s.relayChannel,
        startTime: s.startTime,
        durationMinutes: s.durationMinutes,
        daysOfWeek: s.daysOfWeek,
        enabled: s.enabled,
      })),
    })
  } catch (err) {
    console.error('Schedule push failed:', err)
  }
}

async function onSchedulesChanged() {
  await refreshSchedules()
  await pushSchedulesToDevice()
}

// ── In-app scheduler (fallback while the dashboard is open + connected) ───────
// Device-side execution via the pushed schedule is the reliable path; this
// enacts due windows when the app is open so schedules still fire without firmware.
const scheduleOwned = ref<Set<number>>(new Set())

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

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

// Refresh timestamp
const lastUpdated = ref(new Date())
watch(data, () => { lastUpdated.value = new Date() })

// Pagination
const recordsPerPage = 10
const currentPage = ref(1)

const paginatedRecords = computed(() => {
  if (!data.value) return []
  const start = (currentPage.value - 1) * recordsPerPage
  return data.value.slice(start, start + recordsPerPage)
})

const totalPages = computed(() => {
  if (!data.value) return 0
  return Math.ceil(data.value.length / recordsPerPage)
})

watch(data, () => { currentPage.value = 1 })
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
           text-gray-600 transition-colors disabled:opacity-50" :disabled="pending" @click="refresh()">
          {{ pending ? 'Refreshing...' : 'Refresh' }}
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
      />
    </ClientOnly>

    <!-- Data mode banner -->
    <div v-if="bleConnected"
      class="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
      <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
      BLE Connected — showing live readings
    </div>
    <div v-else-if="data && data.length > 0"
      class="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5">
      <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
      </svg>
      Cloud Mode — showing historical data
    </div>

    <!-- Error State -->
    <div v-if="error" class="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
      ⚠ Failed to load telemetry data: {{ error.message }}
      <button class="underline ml-2 hover:no-underline" @click="refresh()">Retry</button>
    </div>

    <!-- Loading skeleton -->
    <div v-if="pending && !data?.length">
      <div class="rounded-xl border border-gray-200 p-5 animate-pulse">
        <div class="h-4 bg-gray-200 rounded w-24 mb-4" />
        <div class="h-8 bg-gray-200 rounded w-20" />
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!pending && data && data.length === 0 && !bleConnected"
      class="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
      <div class="text-amber-600 font-medium text-lg mb-1">No Data Yet</div>
      <p class="text-amber-700/70 text-sm">
        Connect to the ESP32 sensor via Bluetooth above, or wait for cloud data to appear.
      </p>
    </div>

    <!-- Metric Card -->
    <div v-if="displayMoisture !== null">
      <MetricCard
        title="Soil Moisture"
        :value="displayMoisture"
        unit="%"
        icon="moisture"
        :status="moistureStatus(displayMoisture)"
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

    <!-- Chart -->
    <div v-if="data && data.length > 0">
      <TelemetryChart :records="data" />
    </div>

    <!-- Data Table -->
    <div v-if="data && data.length > 0" class="space-y-4">
      <TelemetryTable :records="paginatedRecords" />

      <!-- Pagination Controls -->
      <div class="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-5 py-3">
        <div class="text-sm text-gray-600">
          Showing {{ (currentPage - 1) * recordsPerPage + 1 }}–{{ Math.min(currentPage * recordsPerPage,
          data.length) }} of {{ data.length }}
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
