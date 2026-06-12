<script setup lang="ts">
interface Props {
  title: string
  value: number | string
  unit: string
  icon?: string
  status?: 'normal' | 'warning' | 'critical'
}

withDefaults(defineProps<Props>(), {
  status: 'normal',
  icon: 'activity',
})

const statusColors: Record<string, { bg: string; text: string; border: string }> = {
  normal: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  warning: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  critical: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
}
</script>

<template>
  <div
    class="rounded-xl border p-5 transition-shadow hover:shadow-md"
    :class="statusColors[status].bg + ' ' + statusColors[status].border"
  >
    <div class="flex items-start justify-between mb-3">
      <span class="text-sm font-medium" :class="statusColors[status].text">
        {{ title }}
      </span>
      <span
        class="w-8 h-8 rounded-lg flex items-center justify-center"
        :class="statusColors[status].text + ' ' + statusColors[status].bg"
      >
        <svg v-if="icon === 'thermometer'" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 8a3 3 0 00-3 3v5a3 3 0 006 0v-5a3 3 0 00-3-3z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 2a1 1 0 011 1v5a4 4 0 01-2 3.464V3a1 1 0 011-1z" />
        </svg>
        <svg v-else-if="icon === 'droplets'" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.83c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
        <svg v-else-if="icon === 'moisture'" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
        </svg>
      </span>
    </div>

    <div class="flex items-baseline gap-1.5">
      <span class="text-3xl font-bold" :class="statusColors[status].text">
        {{ typeof value === 'number' ? value.toFixed(1) : value }}
      </span>
      <span class="text-sm text-gray-500 font-medium">{{ unit }}</span>
    </div>
  </div>
</template>
