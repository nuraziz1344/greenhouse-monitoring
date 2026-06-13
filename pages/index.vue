<script setup lang="ts">
interface TelemetryRecord {
    id: string
    temperature: number
    humidity: number
    soilMoisture: number
    createdAt: string
}

const config = useRuntimeConfig()
const { data, refresh, pending, error } = useFetch<TelemetryRecord[]>('/api/telemetry?limit=50')

// Auto-poll telemetry (configurable interval, default: 30 seconds)
let interval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
    interval = setInterval(() => refresh(), config.public.telemetryPollInterval)
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

// Track when dashboard last received data (browser time, not DB time)
const lastDataReceivedTime = ref<Date | null>(null)
watch(data, () => {
    //   lastDataReceivedTime.value = new Date()
    const lastData = data.value?.[0];
    if (lastData) {
        lastDataReceivedTime.value = new Date(lastData.createdAt);
    }
})

// Refresh counter for user feedback
const lastUpdated = ref(new Date())
watch(data, () => { lastUpdated.value = new Date() })

// Calculate ESP32 connection status based on when dashboard received data
const esp32Connected = computed(() => {
    if (!lastDataReceivedTime.value) return false
    const now = Date.now()
    const diff = now - lastDataReceivedTime.value.getTime()
    return diff < config.public.esp32DisconnectTimeout
})

const timeSinceLastMetric = computed(() => {
    if (!latest.value) return 'No data'
    const metricTime = new Date(latest.value.createdAt)
    const now = Date.now()
    const diff = now - metricTime.getTime()
    const sec = Math.floor(diff / 1000)
    const min = Math.floor(sec / 60)

    if (sec < 60) return `${sec}s ago`
    if (min < 60) return `${min}m ago`
    return `${Math.floor(min / 60)}h ago`
})

// Share ESP32 status with layout via useState (plain values, not computed)
const esp32Status = useState('esp32Status', () => ({
    connected: false,
    timeSince: 'No data',
}))

// Watch for changes and update the shared state
watch(esp32Connected, (newVal) => {
    esp32Status.value.connected = newVal
})
watch(timeSinceLastMetric, (newVal) => {
    esp32Status.value.timeSince = newVal
})

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

// Pagination
const recordsPerPage = 10
const currentPage = ref(1)

const paginatedRecords = computed(() => {
    if (!data.value) return []
    const start = (currentPage.value - 1) * recordsPerPage
    const end = start + recordsPerPage
    return data.value.slice(start, end)
})

const totalPages = computed(() => {
    if (!data.value) return 0
    return Math.ceil(data.value.length / recordsPerPage)
})

watch(data, () => {
    currentPage.value = 1
})
</script>

<template>
    <div class="space-y-6">
        <!-- Page Header -->
        <div class="flex items-center justify-between">
            <div>
                <h2 class="text-xl font-bold text-gray-900">Dashboard</h2>
            </div>
            <button class="text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50
               text-gray-600 transition-colors disabled:opacity-50" :disabled="pending" @click="refresh()">
                {{ pending ? 'Refreshing...' : 'Refresh' }}
            </button>
        </div>

        <!-- Error State -->
        <div v-if="error" class="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
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
        <div v-if="!pending && data && data.length === 0"
            class="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
            <div class="text-amber-600 font-medium text-lg mb-1">No Data Yet</div>
            <p class="text-amber-700/70 text-sm">
                Waiting for the ESP32 sensor device to submit its first telemetry reading.
                <br />Connect your device and configure it to POST to <code
                    class="bg-amber-100 px-1 rounded">/api/telemetry</code>.
            </p>
        </div>

        <!-- Metric Cards -->
        <div v-if="latest" class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricCard title="Temperature" :value="latest.temperature" unit="°C" icon="thermometer"
                :status="tempStatus(latest.temperature)" />
            <MetricCard title="Humidity" :value="latest.humidity" unit="%" icon="droplets"
                :status="humidityStatus(latest.humidity)" />
            <MetricCard title="Soil Moisture" :value="latest.soilMoisture" unit="%" icon="moisture"
                :status="moistureStatus(latest.soilMoisture)" />
        </div>

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
                    Showing {{ (currentPage - 1) * recordsPerPage + 1 }}-{{ Math.min(currentPage * recordsPerPage,
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
