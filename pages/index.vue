<script setup lang="ts">
interface TelemetryRecord {
  id: string
  temperature: number
  humidity: number
  soilMoisture: number
  createdAt: string
}

const { data, refresh, pending, error } = useFetch<TelemetryRecord[]>('/api/telemetry?limit=50')

// Auto-poll every 30 seconds (client-side only)
let interval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  interval = setInterval(() => refresh(), 30_000)
})
onUnmounted(() => {
  if (interval) clearInterval(interval)
})

// Compute latest readings
const latest = computed(() => {
  if (!data.value || data.value.length === 0) return null
  return data.value[0]
})

// Sensor status helpers
function tempStatus(val: number) {
  if (val > 35 || val < 10) return 'critical'
  if (val > 30 || val < 15) return 'warning'
  return 'normal'
}

function humidityStatus(val: number) {
  if (val > 85 || val < 20) return 'critical'
  if (val > 75 || val < 30) return 'warning'
  return 'normal'
}

function moistureStatus(val: number) {
  if (val < 30) return 'critical'
  if (val < 40) return 'warning'
  return 'normal'
}

// Refresh counter for user feedback
const lastUpdated = ref(new Date())
watch(data, () => { lastUpdated.value = new Date() })

const timeSinceUpdate = computed(() => {
  const diff = Date.now() - lastUpdated.value.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  return `${Math.floor(sec / 60)}m ago`
})

// Update time display every 10s (client-side only)
let timeInterval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  timeInterval = setInterval(() => {
    lastUpdated.value = new Date(lastUpdated.value)
  }, 10_000)
})
onUnmounted(() => {
  if (timeInterval) clearInterval(timeInterval)
})
</script>

<template>
  <div class="space-y-6">
    <!-- Page Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-xl font-bold text-gray-900">Dashboard</h2>
        <p v-if="latest" class="text-sm text-gray-500 mt-0.5">
          Last updated {{ timeSinceUpdate }}
        </p>
      </div>
      <button
        class="text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50
               text-gray-600 transition-colors disabled:opacity-50"
        :disabled="pending"
        @click="refresh()"
      >
        {{ pending ? 'Refreshing...' : 'Refresh' }}
      </button>
    </div>

    <!-- Error State -->
    <div
      v-if="error"
      class="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700"
    >
      ⚠ Failed to load telemetry data: {{ error.message }}
      <button class="underline ml-2 hover:no-underline" @click="refresh()">Retry</button>
    </div>

    <!-- Loading State -->
    <div v-if="pending && !data?.length" class="space-y-6">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div v-for="i in 3" :key="i" class="rounded-xl border border-gray-200 p-5 animate-pulse">
          <div class="h-4 bg-gray-200 rounded w-24 mb-4" />
          <div class="h-8 bg-gray-200 rounded w-20" />
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-if="!pending && data && data.length === 0"
      class="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center"
    >
      <div class="text-amber-600 font-medium text-lg mb-1">No Data Yet</div>
      <p class="text-amber-700/70 text-sm">
        Waiting for the ESP32 sensor device to submit its first telemetry reading.
        <br />Connect your device and configure it to POST to <code class="bg-amber-100 px-1 rounded">/api/telemetry</code>.
      </p>
    </div>

    <!-- Metric Cards -->
    <div v-if="latest" class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <MetricCard
        title="Temperature"
        :value="latest.temperature"
        unit="°C"
        icon="thermometer"
        :status="tempStatus(latest.temperature)"
      />
      <MetricCard
        title="Humidity"
        :value="latest.humidity"
        unit="%"
        icon="droplets"
        :status="humidityStatus(latest.humidity)"
      />
      <MetricCard
        title="Soil Moisture"
        :value="latest.soilMoisture"
        unit="%"
        icon="moisture"
        :status="moistureStatus(latest.soilMoisture)"
      />
    </div>

    <!-- Chart -->
    <div v-if="data && data.length > 0">
      <TelemetryChart :records="data" />
    </div>

    <!-- Data Table -->
    <div v-if="data && data.length > 0">
      <TelemetryTable :records="data" />
    </div>
  </div>
</template>
