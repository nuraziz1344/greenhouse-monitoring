<script setup lang="ts">
const config = useRuntimeConfig()
const esp32Status = useState<{ bleConnected: boolean; lastSeenAt: string | null }>(
  'esp32Status',
  () => ({ bleConnected: false, lastSeenAt: null }),
)

// Ticking "now" so the badge flips to Disconnected when readings go stale
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  tick = setInterval(() => { now.value = Date.now() }, config.public.statusBadgeInterval)
})
onUnmounted(() => {
  if (tick) clearInterval(tick)
})

// Universal ESP32 connection state:
//  'ble'     — connected directly over BLE (esp → ble → PWA)
//  'online'  — recent reading arrived via the cloud API (esp → wifi → API)
//  'offline' — neither
const connection = computed<'ble' | 'online' | 'offline'>(() => {
  if (esp32Status.value.bleConnected) return 'ble'
  const last = esp32Status.value.lastSeenAt
  if (last && now.value - new Date(last).getTime() <= config.public.deviceOnlineThreshold) {
    return 'online'
  }
  return 'offline'
})

const connectionLabel = computed(() => ({
  ble: 'BLE Connected',
  online: 'Connected',
  offline: 'Disconnected',
}[connection.value]))
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- Header -->
    <header class="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center">
            <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
          </div>
          <div>
            <h1 class="text-lg font-semibold text-gray-900">Greenhouse Monitor</h1>
            <p class="text-xs text-gray-500">Environmental Dashboard</p>
          </div>
        </div>

        <!-- ESP32 Connection Status (BLE or WiFi/cloud) -->
        <div class="flex items-center gap-2 text-sm">
          <span
            class="w-2 h-2 rounded-full"
            :class="{
              'bg-blue-500 animate-pulse': connection === 'ble',
              'bg-green-500 animate-pulse': connection === 'online',
              'bg-gray-300': connection === 'offline',
            }"
          />
          <span class="text-gray-600 hidden sm:inline">
            {{ connectionLabel }}
          </span>
        </div>
      </div>
    </header>

    <!-- Main content -->
    <main class="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
      <slot />
    </main>

    <!-- Footer -->
    <footer class="border-t border-gray-200 bg-white py-4 text-center text-xs text-gray-400">
      Greenhouse Monitoring System &mdash; KKN Project
    </footer>
  </div>
</template>
