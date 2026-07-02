<script setup lang="ts">
// Web Bluetooth types may not be included in the default TS lib.
// If BluetoothRemoteGATTCharacteristic errors, run: pnpm add -D @types/web-bluetooth

type BleState = 'idle' | 'scanning' | 'connecting' | 'connected' | 'syncing' | 'error'

const emit = defineEmits<{
  'realtime-reading': [value: number]
  'sync-complete': [count: number]
  'connection-change': [connected: boolean]
}>()

const config = useRuntimeConfig()
const route = useRoute()

const bleState = ref<BleState>('idle')
const realtimeValue = ref<number | null>(null)
const syncProgress = ref({ current: 0, total: 0 })
const errorMessage = ref<string | null>(null)
const isSupported = ref(false)
const isMockMode = computed(() => route.query.mockBle === '1')

// BLE object refs (browser-only)
let bleDevice: BluetoothDevice | null = null
let gattServer: BluetoothRemoteGATTServer | null = null
let realtimeChar: BluetoothRemoteGATTCharacteristic | null = null
let mockInterval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  isSupported.value = 'bluetooth' in navigator

  if (isMockMode.value) {
    activateMockMode()
  }
})

onUnmounted(() => {
  if (mockInterval) clearInterval(mockInterval)
})

// ── Mock mode (dev/demo without hardware) ──────────────────────────────────

function activateMockMode() {
  bleState.value = 'connected'
  realtimeValue.value = 60
  emit('connection-change', true)

  mockInterval = setInterval(() => {
    const value = Math.round((55 + Math.random() * 15) * 10) / 10
    realtimeValue.value = value
    emit('realtime-reading', value)
  }, 3000)
}

async function mockSyncHistory() {
  bleState.value = 'syncing'
  const now = Date.now()
  const readings = Array.from({ length: 24 }, (_, i) => ({
    soilMoisture: Math.round((45 + Math.random() * 30) * 10) / 10,
    recordedAt: new Date(now - (23 - i) * 3_600_000).toISOString(),
  }))
  syncProgress.value = { current: 0, total: readings.length }

  try {
    await $fetch('/api/telemetry/batch', { method: 'POST', body: { readings } })
    syncProgress.value.current = readings.length
    emit('sync-complete', readings.length)
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Mock sync failed'
  } finally {
    bleState.value = 'connected'
  }
}

// ── Real BLE flow ──────────────────────────────────────────────────────────

function onRealtimeValue(event: Event) {
  const char = event.target as BluetoothRemoteGATTCharacteristic
  if (!char.value) return
  try {
    const text = new TextDecoder().decode(char.value)
    const parsed = JSON.parse(text) as { soilMoisture: number }
    realtimeValue.value = parsed.soilMoisture
    emit('realtime-reading', parsed.soilMoisture)
  } catch {
    // ignore malformed frames
  }
}

function onDisconnected() {
  resetState()
  emit('connection-change', false)
}

function resetState() {
  bleState.value = 'idle'
  bleDevice = null
  gattServer = null
  realtimeChar = null
  realtimeValue.value = null
  errorMessage.value = null
}

async function connect() {
  bleState.value = 'scanning'
  errorMessage.value = null

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ name: config.public.ble.deviceName }],
      optionalServices: [config.public.ble.serviceUuid],
    })

    bleState.value = 'connecting'
    bleDevice = device
    device.addEventListener('gattserverdisconnected', onDisconnected)

    const server = await device.gatt!.connect()
    gattServer = server

    const service = await server.getPrimaryService(config.public.ble.serviceUuid)

    const rtChar = await service.getCharacteristic(config.public.ble.realtimeCharUuid)
    realtimeChar = rtChar
    await rtChar.startNotifications()
    rtChar.addEventListener('characteristicvaluechanged', onRealtimeValue)

    bleState.value = 'connected'
    emit('connection-change', true)
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      // User cancelled the browser picker
      bleState.value = 'idle'
    } else {
      bleState.value = 'error'
      errorMessage.value = err instanceof Error ? err.message : 'Unknown BLE error'
    }
  }
}

async function disconnect() {
  if (realtimeChar) {
    try {
      await realtimeChar.stopNotifications()
      realtimeChar.removeEventListener('characteristicvaluechanged', onRealtimeValue)
    } catch { /* already disconnected */ }
  }
  if (gattServer?.connected) {
    gattServer.disconnect()
  }
  resetState()
  emit('connection-change', false)
}

async function syncHistory() {
  if (isMockMode.value) return mockSyncHistory()
  if (!gattServer || bleState.value !== 'connected') return

  bleState.value = 'syncing'
  syncProgress.value = { current: 0, total: 0 }
  errorMessage.value = null

  try {
    const service = await gattServer.getPrimaryService(config.public.ble.serviceUuid)
    const histChar = await service.getCharacteristic(config.public.ble.historyCharUuid)
    const value = await histChar.readValue()

    const text = new TextDecoder().decode(value)
    const readings = JSON.parse(text) as Array<{ soilMoisture: number; recordedAt?: string }>
    syncProgress.value.total = readings.length

    await $fetch('/api/telemetry/batch', { method: 'POST', body: { readings } })
    syncProgress.value.current = readings.length
    emit('sync-complete', readings.length)
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Sync failed'
  } finally {
    bleState.value = 'connected'
  }
}
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 p-4">
    <!-- Browser not supported -->
    <div v-if="!isSupported && !isMockMode"
      class="flex items-start gap-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
      <svg class="w-5 h-5 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>
        Web Bluetooth requires <strong>Android Chrome</strong> (or Chromium).
        Open this page in Chrome to connect to the ESP32 sensor.
      </span>
    </div>

    <!-- Supported or mock mode -->
    <div v-else class="flex flex-wrap items-center gap-3">
      <!-- Status indicator -->
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <span class="relative flex h-2.5 w-2.5 shrink-0">
          <span v-if="bleState === 'connected' || bleState === 'syncing'"
            class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span class="relative inline-flex rounded-full h-2.5 w-2.5"
            :class="{
              'bg-green-500': bleState === 'connected' || bleState === 'syncing',
              'bg-gray-300': bleState === 'idle',
              'bg-amber-400': bleState === 'scanning' || bleState === 'connecting',
              'bg-red-500': bleState === 'error',
            }" />
        </span>

        <span class="text-sm font-medium text-gray-700 truncate">
          <template v-if="bleState === 'idle'">BLE — Not connected</template>
          <template v-else-if="bleState === 'scanning'">Opening device picker…</template>
          <template v-else-if="bleState === 'connecting'">Connecting…</template>
          <template v-else-if="bleState === 'connected'">
            {{ isMockMode ? 'Mock Mode' : config.public.ble.deviceName }} — Live
            <span v-if="realtimeValue !== null" class="text-green-700 font-bold ml-1">
              {{ realtimeValue.toFixed(1) }}%
            </span>
          </template>
          <template v-else-if="bleState === 'syncing'">
            Syncing {{ syncProgress.current }}/{{ syncProgress.total }} records…
          </template>
          <template v-else-if="bleState === 'error'">Error</template>
        </span>
      </div>

      <!-- Error message -->
      <p v-if="bleState === 'error' && errorMessage" class="w-full text-xs text-red-600 mt-1">
        {{ errorMessage }}
      </p>

      <!-- Action buttons -->
      <div class="flex items-center gap-2 shrink-0">
        <!-- Connect -->
        <button v-if="bleState === 'idle' || bleState === 'error'"
          class="px-3 py-1.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors"
          @click="connect">
          Connect
        </button>

        <!-- Sync History -->
        <button v-if="bleState === 'connected'"
          class="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium transition-colors"
          @click="syncHistory">
          Sync History
        </button>

        <!-- Disconnect -->
        <button v-if="bleState === 'connected'"
          class="text-sm text-gray-400 hover:text-red-500 transition-colors"
          @click="disconnect">
          Disconnect
        </button>

        <!-- Syncing state — no action -->
        <span v-if="bleState === 'syncing'" class="text-sm text-gray-500">
          Please wait…
        </span>
      </div>
    </div>
  </div>
</template>
