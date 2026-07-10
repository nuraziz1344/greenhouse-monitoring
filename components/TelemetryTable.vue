<script setup lang="ts">
interface TelemetryRecord {
  id: string
  sensorId: number
  sensorName: string
  soilMoisture: number
  recordedAt: string | null
  createdAt: string
}

defineProps<{
  records: TelemetryRecord[]
}>()

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-ID', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  })
}
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
    <div class="px-5 py-4 border-b border-gray-100">
      <h3 class="text-sm font-semibold text-gray-700">History Log</h3>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            <th class="px-5 py-3">Time</th>
            <th class="px-5 py-3">Sensor</th>
            <th class="px-5 py-3">Soil Moisture</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="record in records" :key="`${record.sensorId}-${record.id}`" class="hover:bg-gray-50 transition-colors">
            <td class="px-5 py-3 text-gray-500 whitespace-nowrap">
              {{ formatDate(record.recordedAt ?? record.createdAt) }}
            </td>
            <td class="px-5 py-3 text-gray-500 whitespace-nowrap">
              {{ record.sensorName }}
            </td>
            <td class="px-5 py-3">
              <span class="font-medium" :class="record.soilMoisture < 40 ? 'text-red-600' : 'text-gray-700'">
                {{ record.soilMoisture.toFixed(1) }} %
              </span>
            </td>
          </tr>
          <tr v-if="records.length === 0">
            <td colspan="3" class="px-5 py-8 text-center text-gray-400">
              No telemetry data recorded yet
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
