<script setup lang="ts">
type BleState = 'idle' | 'scanning' | 'connecting' | 'connected' | 'syncing' | 'error'

export interface WifiStatus {
  state: 'idle' | 'sending' | 'connecting' | 'connected' | 'failed'
  ip?: string
  rssi?: number
  reason?: string
}

const emit = defineEmits<{
  // sensorId identifies which physical sensor unit took the reading (see
  // runtimeConfig.public.soilSensors); firmware that predates multi-sensor
  // support omits it and it defaults to sensor 1 in onRealtimeValue below.
  'realtime-reading': [sensorId: number, value: number]
  'sync-complete': [count: number]
  'connection-change': [connected: boolean]
  // Fired after connect + time-sync: the device now has wall-clock time, so
  // config push and history sync are safe to run.
  'ready': []
}>()

const config = useRuntimeConfig()
const route = useRoute()
const soilSensors = config.public.soilSensors as Array<{ sensorId: number; name: string }>

const bleState = ref<BleState>('idle')
// Latest realtime value per sensorId, for the compact status line.
const realtimeValues = ref<Record<number, number>>({})
const syncProgress = ref({ current: 0, total: 0 })
const errorMessage = ref<string | null>(null)
const isSupported = ref(false)
const isMockMode = computed(() => route.query.mockBle === '1')

// WiFi provisioning status, driven by Provision characteristic notifications.
const wifiStatus = ref<WifiStatus>({ state: 'idle' })
const provisionBusy = ref(false)
// Old firmware may lack the provision/command characteristics — degrade gracefully.
const provisionAvailable = ref(false)

// BLE object refs (browser-only)
let bleDevice: BluetoothDevice | null = null
let gattServer: BluetoothRemoteGATTServer | null = null
let realtimeChar: BluetoothRemoteGATTCharacteristic | null = null
let historyChar: BluetoothRemoteGATTCharacteristic | null = null
let commandChar: BluetoothRemoteGATTCharacteristic | null = null
let timeSyncChar: BluetoothRemoteGATTCharacteristic | null = null
let provisionChar: BluetoothRemoteGATTCharacteristic | null = null
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
  for (const s of soilSensors) realtimeValues.value[s.sensorId] = 60
  provisionAvailable.value = true
  emit('connection-change', true)
  emit('ready')

  mockInterval = setInterval(() => {
    for (const s of soilSensors) {
      const value = Math.round((55 + Math.random() * 15) * 10) / 10
      realtimeValues.value[s.sensorId] = value
      emit('realtime-reading', s.sensorId, value)
    }
  }, 3000)
}

async function mockSyncHistory() {
  bleState.value = 'syncing'
  const now = Date.now()
  // Interleave readings across all configured sensors for a realistic demo.
  const readings = soilSensors.flatMap((s) =>
    Array.from({ length: 24 }, (_, i) => ({
      sensorId: s.sensorId,
      soilMoisture: Math.round((45 + Math.random() * 30) * 10) / 10,
      recordedAt: new Date(now - (23 - i) * 3_600_000).toISOString(),
    })),
  )
  syncProgress.value = { current: 0, total: readings.length }

  try {
    const res = await $fetch<{ count: number }>('/api/telemetry/batch', {
      method: 'POST',
      body: { readings },
    })
    syncProgress.value.current = readings.length
    console.log('[BLE mock] history ack (0x02) — device buffer cleared')
    emit('sync-complete', res.count)
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Mock sync failed'
  } finally {
    bleState.value = 'connected'
  }
}

function mockProvisionWifi(creds: { ssid: string; password: string; serverUrl: string }) {
  console.log('[BLE mock] provisionWifi', { ...creds, password: '***' })
  wifiStatus.value = { state: 'connecting' }
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      wifiStatus.value = { state: 'connected', ip: '192.168.1.50', rssi: -58 }
      resolve()
    }, 2000)
  })
}

// ── Real BLE flow ──────────────────────────────────────────────────────────

function onRealtimeValue(event: Event) {
  const char = event.target as BluetoothRemoteGATTCharacteristic
  if (!char.value) return
  try {
    const text = new TextDecoder().decode(char.value)
    const parsed = JSON.parse(text) as { sensorId?: number; soilMoisture: number }
    const sensorId = parsed.sensorId ?? soilSensors[0]?.sensorId ?? 1
    realtimeValues.value[sensorId] = parsed.soilMoisture
    emit('realtime-reading', sensorId, parsed.soilMoisture)
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
  historyChar = null
  commandChar = null
  timeSyncChar = null
  provisionChar = null
  realtimeValues.value = {}
  errorMessage.value = null
  provisionAvailable.value = false
  wifiStatus.value = { state: 'idle' }
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

    // Cache all characteristic handles once. Command/provision are optional so
    // the PWA still works against firmware that predates them.
    realtimeChar = await service.getCharacteristic(config.public.ble.realtimeCharUuid)
    historyChar = await service.getCharacteristic(config.public.ble.historyCharUuid)
    try {
      commandChar = await service.getCharacteristic(config.public.ble.commandCharUuid)
    } catch { commandChar = null }
    try {
      timeSyncChar = await service.getCharacteristic(config.public.ble.timeSyncCharUuid)
    } catch { timeSyncChar = null }
    try {
      provisionChar = await service.getCharacteristic(config.public.ble.provisionCharUuid)
      await provisionChar.startNotifications()
      provisionChar.addEventListener('characteristicvaluechanged', onProvisionValue)
      provisionAvailable.value = true
    } catch { provisionChar = null }

    await realtimeChar.startNotifications()
    realtimeChar.addEventListener('characteristicvaluechanged', onRealtimeValue)

    // Time-sync FIRST so buffered history gets recordedAt timestamps.
    if (timeSyncChar) {
      await timeSyncChar.writeValueWithResponse(
        new TextEncoder().encode(String(Date.now())),
      )
    }

    bleState.value = 'connected'
    emit('connection-change', true)
    emit('ready')
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
  if (provisionChar) {
    try {
      await provisionChar.stopNotifications()
      provisionChar.removeEventListener('characteristicvaluechanged', onProvisionValue)
    } catch { /* already disconnected */ }
  }
  if (gattServer?.connected) {
    gattServer.disconnect()
  }
  resetState()
  emit('connection-change', false)
}

// ── Outbound commands (relay control / config push) ─────────────────────────

/**
 * Write a JSON command to the ESP32 command characteristic. Resolves silently
 * in mock mode; throws if not connected so callers can surface the failure.
 * Payloads: { type: 'relay', channel, on }
 *         | { type: 'cfgbegin', settings, count } → { type: 'sched', ... }×N → { type: 'cfgend', count }
 */
async function sendCommand(payload: object): Promise<void> {
  if (isMockMode.value) {
    console.log('[BLE mock] sendCommand', payload)
    return
  }
  if (!commandChar || bleState.value !== 'connected') {
    throw new Error('BLE not connected (or firmware has no command characteristic)')
  }
  await commandChar.writeValueWithResponse(new TextEncoder().encode(JSON.stringify(payload)))
}

// ── History sync (streaming protocol) ────────────────────────────────────────
// Firmware streams the LittleFS ring buffer: we write 0x01, it notifies one
// JSON record per frame, then {"done":true,"total":N}. After all records are
// uploaded we write 0x02 so the device clears its buffer. The server skips
// duplicates, so a lost ack only costs a redundant (harmless) re-upload.

const SYNC_INACTIVITY_MS = 30_000
const BATCH_CHUNK = 500

async function syncHistory(): Promise<void> {
  if (isMockMode.value) return mockSyncHistory()
  if (!historyChar || bleState.value !== 'connected') return

  bleState.value = 'syncing'
  syncProgress.value = { current: 0, total: 0 }
  errorMessage.value = null

  const records: Array<{ sensorId?: number; soilMoisture: number; recordedAt?: string }> = []
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null
  let settleDone: (total: number) => void
  let settleFail: (err: Error) => void

  const streamed = new Promise<number>((resolve, reject) => {
    settleDone = resolve
    settleFail = reject
  })

  const resetInactivity = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer)
    inactivityTimer = setTimeout(
      () => settleFail(new Error('History stream timed out — device stopped responding')),
      SYNC_INACTIVITY_MS,
    )
  }

  const onHistoryValue = (event: Event) => {
    const char = event.target as BluetoothRemoteGATTCharacteristic
    if (!char.value) return
    try {
      const frame = JSON.parse(new TextDecoder().decode(char.value)) as
        | { sensorId?: number; soilMoisture: number; recordedAt?: string }
        | { done: true; total: number }
      if ('done' in frame && frame.done) {
        settleDone(frame.total)
        return
      }
      if ('soilMoisture' in frame) {
        records.push(frame)
        syncProgress.value.current = records.length
      }
      resetInactivity()
    } catch {
      // ignore malformed frames
    }
  }

  try {
    await historyChar.startNotifications()
    historyChar.addEventListener('characteristicvaluechanged', onHistoryValue)
    resetInactivity()

    // Request the dump and wait for the end-of-stream marker.
    await historyChar.writeValueWithResponse(Uint8Array.of(0x01))
    await streamed
    syncProgress.value.total = records.length

    let inserted = 0
    for (let i = 0; i < records.length; i += BATCH_CHUNK) {
      const res = await $fetch<{ count: number }>('/api/telemetry/batch', {
        method: 'POST',
        body: { readings: records.slice(i, i + BATCH_CHUNK) },
      })
      inserted += res.count
    }

    // All chunks stored — tell the device it can clear its ring buffer.
    if (records.length > 0) {
      await historyChar.writeValueWithResponse(Uint8Array.of(0x02))
    }

    emit('sync-complete', inserted)
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Sync failed'
  } finally {
    if (inactivityTimer) clearTimeout(inactivityTimer)
    historyChar.removeEventListener('characteristicvaluechanged', onHistoryValue)
    try {
      await historyChar.stopNotifications()
    } catch { /* disconnected mid-sync */ }
    if (bleState.value === 'syncing') bleState.value = 'connected'
  }
}

// ── WiFi provisioning ────────────────────────────────────────────────────────
// Send credentials + server URL over the Provision characteristic; the device
// answers with status notifications while it tries to join the network.

const PROVISION_TIMEOUT_MS = 60_000
let provisionSettle: { resolve: () => void; reject: (err: Error) => void } | null = null

function onProvisionValue(event: Event) {
  const char = event.target as BluetoothRemoteGATTCharacteristic
  if (!char.value) return
  try {
    const frame = JSON.parse(new TextDecoder().decode(char.value)) as {
      wifi: WifiStatus['state'] | 'connecting' | 'connected' | 'failed'
      ip?: string
      rssi?: number
      reason?: string
    }
    if (frame.wifi === 'connecting') {
      wifiStatus.value = { state: 'connecting' }
    } else if (frame.wifi === 'connected') {
      wifiStatus.value = { state: 'connected', ip: frame.ip, rssi: frame.rssi }
      provisionSettle?.resolve()
      provisionSettle = null
    } else if (frame.wifi === 'failed') {
      wifiStatus.value = { state: 'failed', reason: frame.reason }
      provisionSettle?.reject(new Error(frame.reason ?? 'WiFi connection failed'))
      provisionSettle = null
    }
  } catch {
    // ignore malformed frames
  }
}

async function provisionWifi(creds: { ssid: string; password: string; serverUrl: string }): Promise<void> {
  if (provisionBusy.value) return
  provisionBusy.value = true
  try {
    if (isMockMode.value) {
      await mockProvisionWifi(creds)
      return
    }
    if (!provisionChar || bleState.value === 'idle') {
      throw new Error('Device not connected (or firmware has no provisioning support)')
    }

    const payload = new TextEncoder().encode(JSON.stringify(creds))
    if (payload.byteLength > 480) {
      throw new Error('WiFi credentials too long (max ~480 bytes)')
    }

    wifiStatus.value = { state: 'sending' }
    const settled = new Promise<void>((resolve, reject) => {
      provisionSettle = { resolve, reject }
      setTimeout(() => {
        if (provisionSettle) {
          provisionSettle = null
          wifiStatus.value = { state: 'failed', reason: 'Timed out waiting for device' }
          reject(new Error('Timed out waiting for the device to join WiFi'))
        }
      }, PROVISION_TIMEOUT_MS)
    })

    await provisionChar.writeValueWithResponse(payload)
    await settled
  } finally {
    provisionBusy.value = false
  }
}

/** Panel submit handler: surface failures in wifiStatus instead of an unhandled rejection. */
async function onProvisionSubmit(creds: { ssid: string; password: string; serverUrl: string }) {
  try {
    await provisionWifi(creds)
  } catch (err) {
    if (wifiStatus.value.state !== 'failed') {
      wifiStatus.value = {
        state: 'failed',
        reason: err instanceof Error ? err.message : 'Provisioning failed',
      }
    }
  }
}

defineExpose({ sendCommand, syncHistory, provisionWifi })
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
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
            <span
              v-for="s in soilSensors"
              :key="s.sensorId"
              v-show="realtimeValues[s.sensorId] !== undefined"
              class="text-green-700 font-bold ml-1"
            >
              {{ s.name }}: {{ realtimeValues[s.sensorId]?.toFixed(1) }}%
            </span>
          </template>
          <template v-else-if="bleState === 'syncing'">
            Syncing — {{ syncProgress.current }} record{{ syncProgress.current === 1 ? '' : 's' }} received…
          </template>
          <template v-else-if="bleState === 'error'">Error</template>
        </span>
      </div>

      <!-- Error message -->
      <p v-if="bleState === 'error' && errorMessage" class="w-full text-xs text-red-600 mt-1">
        {{ errorMessage }}
      </p>
      <p v-else-if="errorMessage" class="w-full text-xs text-red-600 mt-1">
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

    <!-- WiFi provisioning (device setup) -->
    <WifiProvisionPanel
      v-if="(bleState === 'connected' || bleState === 'syncing') && provisionAvailable"
      :status="wifiStatus"
      :busy="provisionBusy"
      @submit="onProvisionSubmit"
    />
  </div>
</template>
