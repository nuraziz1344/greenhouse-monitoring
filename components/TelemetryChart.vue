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
  temperature: number
  humidity: number
  soilMoisture: number
  createdAt: string
}

const props = defineProps<{
  records: TelemetryRecord[]
}>()

const labels = computed(() => {
  const data = props.records.slice().reverse()
  return data.map((r) => {
    const d = new Date(r.createdAt)
    return d.toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit' })
  })
})

const temperatureData = computed(() => {
  const data = props.records.slice().reverse()
  return {
    labels: labels.value,
    datasets: [
      {
        label: 'Temperature (°C)',
        data: data.map((r) => r.temperature),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 4,
      },
    ],
  }
})

const humidityData = computed(() => {
  const data = props.records.slice().reverse()
  return {
    labels: labels.value,
    datasets: [
      {
        label: 'Humidity (%)',
        data: data.map((r) => r.humidity),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 4,
      },
    ],
  }
})

const moistureData = computed(() => {
  const data = props.records.slice().reverse()
  return {
    labels: labels.value,
    datasets: [
      {
        label: 'Soil Moisture (%)',
        data: data.map((r) => r.soilMoisture),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 4,
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
      display: false,
    },
    tooltip: {
      callbacks: {
        label: (ctx: any) => `${ctx.parsed.y.toFixed(1)}`,
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
  <div v-if="records.length > 0" class="grid grid-cols-1 gap-4">
    <!-- Temperature Chart -->
    <div class="bg-white rounded-xl border border-gray-200 p-5">
      <h3 class="text-sm font-semibold text-red-700 mb-3">Temperature Trend</h3>
      <div class="h-48">
        <Line :data="temperatureData" :options="chartOptions" />
      </div>
    </div>

    <!-- Humidity Chart -->
    <div class="bg-white rounded-xl border border-gray-200 p-5">
      <h3 class="text-sm font-semibold text-blue-700 mb-3">Humidity Trend</h3>
      <div class="h-48">
        <Line :data="humidityData" :options="chartOptions" />
      </div>
    </div>

    <!-- Soil Moisture Chart -->
    <div class="bg-white rounded-xl border border-gray-200 p-5">
      <h3 class="text-sm font-semibold text-green-700 mb-3">Soil Moisture Trend</h3>
      <div class="h-48">
        <Line :data="moistureData" :options="chartOptions" />
      </div>
    </div>
  </div>
  <div v-else class="bg-white rounded-xl border border-gray-200 p-5 h-48 flex items-center justify-center text-gray-400 text-sm">
    No data available yet. Waiting for sensor readings...
  </div>
</template>
