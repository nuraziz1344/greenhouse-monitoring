<script setup lang="ts">
import type { WifiStatus } from './BLEConnection.vue'

const props = defineProps<{
  status: WifiStatus
  busy: boolean
}>()

const emit = defineEmits<{
  submit: [creds: { ssid: string; password: string; serverUrl: string }]
}>()

const open = ref(false)
const ssid = ref('')
const password = ref('')
const serverUrl = ref('')
const showPassword = ref(false)

onMounted(() => {
  // Default to this dashboard's own origin — the ESP32 will POST telemetry here.
  serverUrl.value = window.location.origin
})

const canSubmit = computed(
  () => ssid.value.trim().length > 0 && serverUrl.value.trim().length > 0 && !props.busy,
)

function submit() {
  if (!canSubmit.value) return
  emit('submit', {
    ssid: ssid.value.trim(),
    password: password.value,
    serverUrl: serverUrl.value.trim().replace(/\/$/, ''),
  })
}
</script>

<template>
  <div class="border-t border-gray-100 pt-3">
    <!-- Toggle -->
    <button
      class="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
      @click="open = !open">
      <svg class="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
      </svg>
      WiFi Setup
      <svg class="w-4 h-4 transition-transform" :class="{ 'rotate-180': open }"
        fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
      <!-- Compact status when collapsed -->
      <span v-if="!open && status.state === 'connected'" class="text-xs text-green-600 font-normal">
        Connected{{ status.ip ? ` · ${status.ip}` : '' }}
      </span>
    </button>

    <!-- Form -->
    <form v-if="open" class="mt-3 space-y-3" @submit.prevent="submit">
      <p class="text-xs text-gray-500">
        Send WiFi credentials to the device over Bluetooth. Once connected, the ESP32
        uploads readings to the server by itself — no phone needed.
      </p>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="text-xs font-medium text-gray-600">WiFi network (SSID)</span>
          <input v-model="ssid" type="text" required autocomplete="off"
            class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
            placeholder="Greenhouse-WiFi">
        </label>

        <label class="block">
          <span class="text-xs font-medium text-gray-600">Password</span>
          <span class="mt-1 flex items-center rounded-lg border border-gray-200 focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500">
            <input v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="off"
              class="w-full rounded-lg px-3 py-1.5 text-sm outline-none"
              placeholder="••••••••">
            <button type="button" class="px-2 text-gray-400 hover:text-gray-600" tabindex="-1"
              @click="showPassword = !showPassword">
              <svg v-if="showPassword" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
              <svg v-else class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>
          </span>
        </label>
      </div>

      <label class="block">
        <span class="text-xs font-medium text-gray-600">Server URL</span>
        <input v-model="serverUrl" type="url" required
          class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
          placeholder="https://greenhouse.example.com">
      </label>

      <div class="flex items-center gap-3">
        <button type="submit" :disabled="!canSubmit"
          class="px-3 py-1.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          {{ busy ? 'Sending…' : 'Send to device' }}
        </button>

        <!-- Status line -->
        <span v-if="status.state === 'sending'" class="text-sm text-gray-500">
          Sending credentials…
        </span>
        <span v-else-if="status.state === 'connecting'" class="text-sm text-amber-600">
          Device is joining the network…
        </span>
        <span v-else-if="status.state === 'connected'" class="text-sm text-green-600">
          ✓ Connected{{ status.ip ? ` — ${status.ip}` : '' }}{{ status.rssi ? ` (${status.rssi} dBm)` : '' }}
        </span>
        <span v-else-if="status.state === 'failed'" class="text-sm text-red-600">
          ✕ {{ status.reason ?? 'Failed to connect' }}
        </span>
      </div>
    </form>
  </div>
</template>
