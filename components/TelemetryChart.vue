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
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Filler)

interface TelemetryRecord {
  id: string
  soilMoisture: number
  recordedAt: string | null
  createdAt: string
}

const props = defineProps<{
  records: TelemetryRecord[]
}>()

const labels = computed(() => {
  return props.records.slice().reverse().map((r) => {
    const d = new Date(r.recordedAt ?? r.createdAt)
    return d.toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit' })
  })
})

const chartData = computed(() => ({
  labels: labels.value,
  datasets: [
    {
      label: 'Soil Moisture (%)',
      data: props.records.slice().reverse().map((r) => r.soilMoisture),
      borderColor: '#10b981',
      backgroundColor: 'rgba(16, 185, 129, 0.1)',
      fill: true,
      tension: 0.3,
      pointRadius: 2,
      pointHoverRadius: 4,
    },
    {
      // Alert threshold reference line
      label: 'Alert Threshold (40%)',
      data: props.records.map(() => 40),
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
        label: (ctx: any) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`,
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
  <div v-if="records.length > 0" class="bg-white rounded-xl border border-gray-200 p-5">
    <h3 class="text-sm font-semibold text-green-700 mb-3">Soil Moisture Trend</h3>
    <div class="h-64">
      <Line :data="chartData" :options="chartOptions" />
    </div>
  </div>
  <div v-else class="bg-white rounded-xl border border-gray-200 p-5 h-64 flex items-center justify-center text-gray-400 text-sm">
    No data available yet. Connect via BLE or wait for cloud data.
  </div>
</template>
