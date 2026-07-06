<script setup lang="ts">
interface Relay {
  channel: number
  name: string
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

const props = defineProps<{
  relays: Relay[]
  schedules: Schedule[]
}>()

// Emitted after any create/update/delete so the parent can refetch and
// re-push the schedule set to the device over BLE.
const emit = defineEmits<{ changed: [] }>()

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const busy = ref(false)
const formError = ref<string | null>(null)

// New-schedule form
const form = reactive({
  relayChannel: props.relays[0]?.channel ?? 1,
  startTime: '06:00',
  durationMinutes: 15,
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6] as number[],
})

function relayName(channel: number) {
  return props.relays.find((r) => r.channel === channel)?.name ?? `Relay ${channel}`
}

function toggleFormDay(day: number) {
  const i = form.daysOfWeek.indexOf(day)
  if (i === -1) form.daysOfWeek.push(day)
  else form.daysOfWeek.splice(i, 1)
}

function summarizeDays(days: number[]) {
  if (days.length === 7) return 'Every day'
  return [...days].sort().map((d) => DAY_LABELS[d]).join(', ')
}

async function createSchedule() {
  formError.value = null
  if (form.daysOfWeek.length === 0) {
    formError.value = 'Select at least one day'
    return
  }
  busy.value = true
  try {
    await $fetch('/api/schedule', {
      method: 'POST',
      body: {
        relayChannel: form.relayChannel,
        startTime: form.startTime,
        durationMinutes: form.durationMinutes,
        daysOfWeek: [...form.daysOfWeek].sort(),
      },
    })
    emit('changed')
  } catch (err) {
    formError.value =
      (err as { data?: { message?: string } })?.data?.message ??
      (err instanceof Error ? err.message : 'Failed to create schedule')
  } finally {
    busy.value = false
  }
}

async function toggleEnabled(schedule: Schedule) {
  busy.value = true
  try {
    await $fetch(`/api/schedule/${schedule.id}`, {
      method: 'PATCH',
      body: { enabled: !schedule.enabled },
    })
    emit('changed')
  } finally {
    busy.value = false
  }
}

async function deleteSchedule(schedule: Schedule) {
  busy.value = true
  try {
    await $fetch(`/api/schedule/${schedule.id}`, { method: 'DELETE' })
    emit('changed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
    <div class="px-5 py-4 border-b border-gray-100">
      <h3 class="text-sm font-semibold text-gray-700">Watering Schedules</h3>
    </div>

    <!-- Existing schedules -->
    <div class="divide-y divide-gray-100">
      <div v-for="s in schedules" :key="s.id" class="flex items-center justify-between gap-4 px-5 py-3">
        <div class="min-w-0">
          <div class="text-sm font-medium text-gray-800">
            {{ relayName(s.relayChannel) }} · {{ s.startTime }}
            <span class="text-gray-400 font-normal">for {{ s.durationMinutes }} min</span>
          </div>
          <div class="text-xs text-gray-400 mt-0.5">{{ summarizeDays(s.daysOfWeek) }}</div>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <button type="button" role="switch" :aria-checked="s.enabled" :disabled="busy"
            class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
            :class="s.enabled ? 'bg-primary-600' : 'bg-gray-300'"
            @click="toggleEnabled(s)">
            <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
              :class="s.enabled ? 'translate-x-5' : 'translate-x-1'" />
          </button>
          <button type="button" :disabled="busy"
            class="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50"
            title="Delete schedule" @click="deleteSchedule(s)">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      <div v-if="schedules.length === 0" class="px-5 py-6 text-center text-sm text-gray-400">
        No schedules yet
      </div>
    </div>

    <!-- New schedule form -->
    <div class="border-t border-gray-100 bg-gray-50 px-5 py-4 space-y-3">
      <div class="flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-gray-500">Relay</span>
          <select v-model.number="form.relayChannel"
            class="text-sm rounded-lg border border-gray-200 px-2 py-1.5 bg-white">
            <option v-for="r in relays" :key="r.channel" :value="r.channel">{{ r.name }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-gray-500">Start</span>
          <input v-model="form.startTime" type="time"
            class="text-sm rounded-lg border border-gray-200 px-2 py-1.5 bg-white">
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-gray-500">Duration (min)</span>
          <input v-model.number="form.durationMinutes" type="number" min="1" max="1440"
            class="text-sm rounded-lg border border-gray-200 px-2 py-1.5 bg-white w-24">
        </label>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <button v-for="(label, day) in DAY_LABELS" :key="day" type="button"
          class="text-xs px-2 py-1 rounded-md border transition-colors"
          :class="form.daysOfWeek.includes(day)
            ? 'bg-primary-600 text-white border-primary-600'
            : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'"
          @click="toggleFormDay(day)">
          {{ label }}
        </button>
      </div>

      <div class="flex items-center justify-between gap-3">
        <p v-if="formError" class="text-xs text-red-600">{{ formError }}</p>
        <span v-else />
        <button type="button" :disabled="busy"
          class="px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
          @click="createSchedule">
          Add schedule
        </button>
      </div>
    </div>
  </div>
</template>
