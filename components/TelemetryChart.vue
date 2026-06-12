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
  temperature: number
  humidity: number
  soilMoisture: number
  createdAt: string
}

const props = defineProps<{
  records: TelemetryRecord[]
}>()

const chartData = computed(() => {
  // Show last 24 data points or all
  const data = props.records.slice().reverse()

  return {
    labels: data.map((r) => {
      const d = new Date(r.createdAt)
      return d.toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit' })
    }),
    datasets: [
      {
        label: 'Temperature (°C)',
        data: data.map((r) => r.temperature),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 5,
      },
      {
        label: 'Humidity (%)',
        data: data.map((r) => r.humidity),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 5,
      },
      {
        label: 'Soil Moisture (%)',
        data: data.map((r) => r.soilMoisture),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 5,
      },
    ],
  }
})

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    intersect: false,
    mode: 'index' as const,
  },
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: {
        usePointStyle: true,
        padding: 20,
        font: { size: 12 },
      },
    },
    tooltip: {
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}`,
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
      grid: { color: 'rgba(0,0,0,0.06)' },
      ticks: { font: { size: 11 } },
    },
  },
}))
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 p-5">
    <h3 class="text-sm font-semibold text-gray-700 mb-4">Environmental Trends</h3>
    <div class="h-72">
      <Line v-if="records.length > 0" :data="chartData" :options="chartOptions" />
      <div v-else class="h-full flex items-center justify-center text-gray-400 text-sm">
        No data available yet. Waiting for sensor readings...
      </div>
    </div>
  </div>
</template>
