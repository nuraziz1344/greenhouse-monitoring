<script setup lang="ts">
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler,
  Legend,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Filler, Legend)

interface TelemetryRecord {
  id: string
  soilMoisture: number
  recordedAt: string | null
  createdAt: string
}

interface SensorSeries {
  name: string
  records: TelemetryRecord[]
}

const props = defineProps<{
  sensors: SensorSeries[]
}>()

// Distinct colors per sensor series; cycles if more sensors are configured.
const PALETTE = [
  { border: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' }, // green
  { border: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' }, // blue
  { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' }, // amber
  { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)' }, // violet
]

// ── Time-bucket aggregation ─────────────────────────────────────────────────
// Automatically downsample based on the actual time span of the data so the
// chart stays readable regardless of the selected range or data density.

const ONE_MINUTE = 60_000
const ONE_HOUR = 3_600_000

function effectiveTime(r: TelemetryRecord) {
  return new Date(r.recordedAt ?? r.createdAt).getTime()
}

/** Duration in ms between the oldest and newest record across all sensors. */
const timeSpan = computed(() => {
  let min = Infinity
  let max = -Infinity
  for (const s of props.sensors) {
    for (const r of s.records) {
      const t = effectiveTime(r)
      if (t < min) min = t
      if (t > max) max = t
    }
  }
  return min === Infinity ? 0 : max - min
})

/** Bucket width (ms) for averaging — 0 means show raw data. */
const bucketSizeMs = computed(() => {
  const span = timeSpan.value
  if (span <= ONE_HOUR) return 0                      // ≤1h  → raw
  if (span <= 6 * ONE_HOUR) return 5 * ONE_MINUTE     // ≤6h  → 5m avg
  if (span <= 24 * ONE_HOUR) return 15 * ONE_MINUTE   // ≤24h → 15m avg
  if (span <= 7 * 24 * ONE_HOUR) return ONE_HOUR      // ≤7d  → 1h avg
  return 12 * ONE_HOUR                                 // >7d  → 12h avg
})

/** Human-readable label for the current bucket size, shown in the header. */
const bucketLabel = computed(() => {
  const b = bucketSizeMs.value
  if (b === 0) return ''
  if (b === 5 * ONE_MINUTE) return '5m'
  if (b === 15 * ONE_MINUTE) return '15m'
  if (b === ONE_HOUR) return '1h'
  if (b === 12 * ONE_HOUR) return '12h'
  return ''
})

/**
 * Downsample each sensor series by grouping records into fixed-width time
 * buckets and averaging soil moisture within each bucket.  When bucketSizeMs
 * is 0 the raw records pass through unchanged.
 */
const aggregatedSensors = computed<SensorSeries[]>(() => {
  const bucket = bucketSizeMs.value
  if (bucket === 0) return props.sensors

  return props.sensors.map((sensor) => {
    const buckets = new Map<number, { sum: number; count: number; first: TelemetryRecord }>()

    for (const r of sensor.records) {
      const t = effectiveTime(r)
      const key = Math.floor(t / bucket) * bucket

      const existing = buckets.get(key)
      if (existing) {
        existing.sum += r.soilMoisture
        existing.count++
      } else {
        buckets.set(key, { sum: r.soilMoisture, count: 1, first: r })
      }
    }

    const records: TelemetryRecord[] = []
    for (const [bucketTime, data] of buckets) {
      records.push({
        ...data.first,
        soilMoisture: Math.round((data.sum / data.count) * 10) / 10,
        recordedAt: new Date(bucketTime).toISOString(),
      })
    }
    records.sort((a, b) => effectiveTime(a) - effectiveTime(b))

    return { name: sensor.name, records }
  })
})

// ── Shared time axis ────────────────────────────────────────────────────────
// Union of every (aggregated) sensor's timestamps, sorted ascending.
const labels = computed(() => {
  const times = new Set<number>()
  for (const s of aggregatedSensors.value) {
    for (const r of s.records) times.add(effectiveTime(r))
  }
  return [...times].sort((a, b) => a - b)
})

const labelStrings = computed(() => {
  const showDate = timeSpan.value > 24 * ONE_HOUR
  return labels.value.map((t) => {
    const d = new Date(t)
    if (showDate) {
      return d.toLocaleString('en-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    }
    return d.toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
  })
})

function seriesData(records: TelemetryRecord[]) {
  const byTime = new Map(records.map((r) => [effectiveTime(r), r.soilMoisture]))
  return labels.value.map((t) => byTime.get(t) ?? null)
}

const totalRecords = computed(() => props.sensors.reduce((n, s) => n + s.records.length, 0))

const chartData = computed(() => ({
  labels: labelStrings.value,
  datasets: [
    ...aggregatedSensors.value.map((s, i) => {
      const color = PALETTE[i % PALETTE.length]!
      return {
        label: s.name,
        data: seriesData(s.records),
        borderColor: color.border,
        backgroundColor: color.bg,
        fill: aggregatedSensors.value.length === 1,
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 4,
        spanGaps: true,
      }
    }),
    {
      // Alert threshold reference line
      label: 'Alert Threshold (40%)',
      data: labels.value.map(() => 40),
      borderColor: 'rgba(239, 68, 68, 0.5)',
      borderDash: [5, 5],
      borderWidth: 1,
      pointRadius: 0,
      fill: false,
      tension: 0,
    },
  ],
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    intersect: false,
    mode: 'index' as const,
  },
  plugins: {
    legend: {
      display: true,
      labels: {
        font: { size: 11 },
        boxWidth: 12,
      },
    },
    tooltip: {
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}%`,
      },
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { font: { size: 11 }, maxRotation: 45 },
    },
    y: {
      beginAtZero: true,
      max: 100,
      grid: { color: 'rgba(0,0,0,0.06)' },
      ticks: {
        font: { size: 11 },
        callback: (value: any) => `${value}%`,
      },
    },
  },
}))
</script>

<template>
  <div v-if="totalRecords > 0" class="bg-white rounded-xl border border-gray-200 p-5">
    <h3 class="text-sm font-semibold text-green-700 mb-3">
      Soil Moisture Trend
      <span v-if="bucketLabel" class="text-xs font-normal text-gray-500 ml-1">
        ({{ bucketLabel }} average)
      </span>
    </h3>
    <div class="h-64">
      <Line :data="chartData" :options="chartOptions" />
    </div>
  </div>
  <div v-else class="bg-white rounded-xl border border-gray-200 p-5 h-64 flex items-center justify-center text-gray-400 text-sm">
    No data available yet. Connect via BLE or wait for cloud data.
  </div>
</template>
