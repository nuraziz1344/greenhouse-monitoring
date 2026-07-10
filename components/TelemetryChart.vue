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

// A shared time axis: the union of every sensor's timestamps, sorted
// ascending, so series with different sampling times still line up sensibly.
const labels = computed(() => {
  const times = new Set<number>()
  for (const s of props.sensors) {
    for (const r of s.records) times.add(new Date(r.recordedAt ?? r.createdAt).getTime())
  }
  return [...times].sort((a, b) => a - b)
})

const labelStrings = computed(() =>
  labels.value.map((t) => new Date(t).toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit' })),
)

function seriesData(records: TelemetryRecord[]) {
  const bySecond = new Map(records.map((r) => [new Date(r.recordedAt ?? r.createdAt).getTime(), r.soilMoisture]))
  return labels.value.map((t) => bySecond.get(t) ?? null)
}

const totalRecords = computed(() => props.sensors.reduce((n, s) => n + s.records.length, 0))

const chartData = computed(() => ({
  labels: labelStrings.value,
  datasets: [
    ...props.sensors.map((s, i) => {
      const color = PALETTE[i % PALETTE.length]!
      return {
        label: s.name,
        data: seriesData(s.records),
        borderColor: color.border,
        backgroundColor: color.bg,
        fill: props.sensors.length === 1,
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
    <h3 class="text-sm font-semibold text-green-700 mb-3">Soil Moisture Trend</h3>
    <div class="h-64">
      <Line :data="chartData" :options="chartOptions" />
    </div>
  </div>
  <div v-else class="bg-white rounded-xl border border-gray-200 p-5 h-64 flex items-center justify-center text-gray-400 text-sm">
    No data available yet. Connect via BLE or wait for cloud data.
  </div>
</template>
