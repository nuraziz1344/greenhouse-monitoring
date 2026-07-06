<script setup lang="ts">
interface Relay {
  id: string
  channel: number
  name: string
  isOn: boolean
  updatedAt: string
}

const props = defineProps<{
  relays: Relay[]
  bleConnected: boolean
}>()

const emit = defineEmits<{
  toggle: [channel: number, isOn: boolean]
}>()

// Single-active interlock: turning a relay ON while another is already ON
// prompts a bypassable warning instead of switching immediately.
const pendingToggle = ref<{ channel: number; name: string } | null>(null)

const activeRelay = computed(() => props.relays.find((r) => r.isOn) ?? null)

function onSwitchClick(relay: Relay) {
  const next = !relay.isOn

  // Turning ON while a different relay is already ON → warn.
  if (next && activeRelay.value && activeRelay.value.channel !== relay.channel) {
    pendingToggle.value = { channel: relay.channel, name: relay.name }
    return
  }

  emit('toggle', relay.channel, next)
}

function confirmOverride() {
  if (pendingToggle.value) {
    emit('toggle', pendingToggle.value.channel, true)
  }
  pendingToggle.value = null
}

function cancelOverride() {
  pendingToggle.value = null
}
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
    <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
      <h3 class="text-sm font-semibold text-gray-700">Water Pump Relays</h3>
      <span v-if="!bleConnected" class="text-xs text-gray-400">
        Not connected — state saved, pump actuates when BLE-connected
      </span>
    </div>

    <div class="divide-y divide-gray-100">
      <div v-for="relay in relays" :key="relay.channel"
        class="flex items-center justify-between gap-4 px-5 py-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-gray-800 truncate">{{ relay.name }}</span>
            <span class="text-xs text-gray-400">Relay {{ relay.channel }}</span>
          </div>
          <div class="text-xs mt-0.5" :class="relay.isOn ? 'text-primary-600 font-medium' : 'text-gray-400'">
            {{ relay.isOn ? 'Running' : 'Off' }}
          </div>
        </div>

        <!-- Toggle switch -->
        <button type="button" role="switch" :aria-checked="relay.isOn"
          class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-1"
          :class="relay.isOn ? 'bg-primary-600' : 'bg-gray-300'"
          @click="onSwitchClick(relay)">
          <span class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
            :class="relay.isOn ? 'translate-x-6' : 'translate-x-1'" />
        </button>
      </div>

      <div v-if="relays.length === 0" class="px-5 py-8 text-center text-sm text-gray-400">
        No relays configured
      </div>
    </div>

    <!-- Interlock warning dialog -->
    <div v-if="pendingToggle"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="cancelOverride">
      <div class="bg-white rounded-xl shadow-xl max-w-sm w-full p-5">
        <div class="flex items-start gap-3">
          <svg class="w-6 h-6 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div>
            <h4 class="text-sm font-semibold text-gray-900">Another relay is running</h4>
            <p class="text-sm text-gray-600 mt-1">
              <strong>{{ activeRelay?.name }}</strong> is currently on. Running two pumps at once
              increases the electrical load. Turn on <strong>{{ pendingToggle.name }}</strong> anyway?
            </p>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-5">
          <button
            class="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm font-medium transition-colors"
            @click="cancelOverride">
            Cancel
          </button>
          <button
            class="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium transition-colors"
            @click="confirmOverride">
            Turn on anyway
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
