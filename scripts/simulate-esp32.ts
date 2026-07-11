/**
 * ESP32 Greenhouse Sensor Simulator
 * Generates realistic soil moisture data and POSTs to the backend API.
 *
 * Usage:
 *   pnpm simulate:once                                    — 10 realtime readings
 *   pnpm simulate:continuous                              — continuous stream
 *   npx tsx scripts/simulate-esp32.ts --batch              — 24 historical readings (batch sync)
 *   npx tsx scripts/simulate-esp32.ts --url=<url>          — custom API endpoint
 *   npx tsx scripts/simulate-esp32.ts --scenario=<name>    — test scenarios
 *   npx tsx scripts/simulate-esp32.ts --sensorId=<1|2>     — pin legacy modes to one sensor unit
 *
 * Scenarios:
 *   wifi-realtime           — ESP32 POSTs realtime every 15min (simulates WiFi direct)
 *   wifi-recovery           — Offline for 4 hours, then batch sync all records
 *   ble-realtime            — Realtime notifications (BLE to phone)
 *   ble-history-dump        — Full history dump via batch (24 records)
 *   low-moisture-alert      — Gradual drying trend (< 40%)
 *   daily-pattern           — 24-hour realistic watering pattern
 *
 * All scenarios interleave both configured sensor units (sensorId 1 and 2, see
 * nuxt.config.ts runtimeConfig.public.soilSensors) so the dashboard's per-sensor
 * cards/chart series both receive data — matching the two-sensor API model
 * (API_INTEGRATION.md §2.1) even though real firmware doesn't send sensorId yet.
 *
 * Examples:
 *   npx tsx scripts/simulate-esp32.ts --url=https://greenhouse-monitoring-opal.vercel.app
 *   npx tsx scripts/simulate-esp32.ts --scenario=wifi-recovery
 *   npx tsx scripts/simulate-esp32.ts --scenario=low-moisture-alert --url=http://localhost:3000
 */

interface TelemetryPayload {
  soilMoisture: number
  sensorId?: number
  recordedAt?: string
}

const BASE_MOISTURE = 55 // Ideal for melon: 50–70%
const SENSOR_IDS = [1, 2] // Mirrors nuxt.config.ts runtimeConfig.public.soilSensors

function generateReading(baseMoisture: number = BASE_MOISTURE, variance: number = 20, sensorId?: number): TelemetryPayload {
  return {
    soilMoisture: Math.round((baseMoisture + (Math.random() - 0.5) * variance) * 10) / 10,
    ...(sensorId !== undefined ? { sensorId } : {}),
  }
}

async function sendTelemetry(apiUrl: string, payload: TelemetryPayload): Promise<void> {
  const response = await fetch(`${apiUrl}/api/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`${response.status}: ${error}`)
  }

  const result = await response.json()
  const sensorTag = payload.sensorId !== undefined ? ` sensor=${payload.sensorId}` : ''
  console.log(`✓ POST /api/telemetry:${sensorTag} M=${payload.soilMoisture.toFixed(1)}%`)
}

async function sendBatch(apiUrl: string, readings: TelemetryPayload[]): Promise<void> {
  console.log(`Sending batch of ${readings.length} readings…`)

  const response = await fetch(`${apiUrl}/api/telemetry/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ readings }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`${response.status}: ${error}`)
  }

  const result = await response.json()
  console.log(`✅ POST /api/telemetry/batch: ${result.synced || result.count} records synced`)
}

// Scenario: WiFi direct realtime POSTs (every 15 minutes, immediate to cloud)
async function scenarioWiFiRealtime(apiUrl: string, count: number = 10): Promise<void> {
  console.log('📡 WiFi Realtime Scenario: ESP32 POSTs directly to API every 15 min\n')

  for (let i = 0; i < count; i++) {
    try {
      const sensorId = SENSOR_IDS[i % SENSOR_IDS.length]
      const reading = generateReading(BASE_MOISTURE, 20, sensorId)
      await sendTelemetry(apiUrl, reading)
      if (i < count - 1) {
        console.log(`   Waiting 2s before next reading (simulating 15min interval)…\n`)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    } catch (err) {
      console.error('✗ Failed:', err)
    }
  }
  console.log(`\n✅ Sent ${count} realtime readings to cloud`)
}

// Scenario: WiFi recovery (offline for hours, then batch sync)
async function scenarioWiFiRecovery(apiUrl: string): Promise<void> {
  console.log('📶 WiFi Recovery Scenario: Offline for 4 hours, then batch sync\n')

  const now = Date.now()
  const readings = Array.from({ length: 16 }, (_, i) => {
    const moisture = BASE_MOISTURE + (Math.random() - 0.5) * 30
    return {
      soilMoisture: Math.round(moisture * 10) / 10,
      sensorId: SENSOR_IDS[i % SENSOR_IDS.length],
      recordedAt: new Date(now - (15 - i) * 15 * 60_000).toISOString(), // 15-min intervals
    }
  })

  console.log(`Generated ${readings.length} readings from 4 hours ago…\n`)
  readings.forEach((r, i) => {
    console.log(`  ${i + 1}. [sensor ${r.sensorId}] ${r.recordedAt}: ${r.soilMoisture}%`)
  })
  console.log()

  try {
    await sendBatch(apiUrl, readings)
  } catch (err) {
    console.error('✗ Batch failed:', err)
  }
}

// Scenario: BLE realtime notifications (phone connected)
async function scenarioBLERealtime(apiUrl: string, count: number = 10): Promise<void> {
  console.log('📱 BLE Realtime Scenario: Phone receives NOTIFY every 15 min\n')

  for (let i = 0; i < count; i++) {
    try {
      const now = Date.now()
      const sensorId = SENSOR_IDS[i % SENSOR_IDS.length]
      const reading = {
        ...generateReading(BASE_MOISTURE, 20, sensorId),
        recordedAt: new Date(now - (count - i - 1) * 15 * 60_000).toISOString(),
      }
      console.log(`📲 BLE NOTIFY: [sensor ${reading.sensorId}] ${reading.recordedAt} → ${reading.soilMoisture}%`)

      if (i < count - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    } catch (err) {
      console.error('✗ Failed:', err)
    }
  }
  console.log(`\n(Note: These are BLE notifications, not POSTs yet)`)
}

// Scenario: BLE history dump (phone syncs to cloud)
async function scenarioBLEHistoryDump(apiUrl: string): Promise<void> {
  console.log('📚 BLE History Dump Scenario: Phone syncs all buffered records to cloud\n')

  const now = Date.now()
  const readings = Array.from({ length: 24 }, (_, i) => ({
    soilMoisture: Math.round((BASE_MOISTURE + (Math.random() - 0.5) * 30) * 10) / 10,
    sensorId: SENSOR_IDS[i % SENSOR_IDS.length],
    recordedAt: new Date(now - (23 - i) * 60 * 60_000).toISOString(), // 1-hour intervals for demo
  }))

  try {
    await sendBatch(apiUrl, readings)
  } catch (err) {
    console.error('✗ History dump failed:', err)
  }
}

// Scenario: Low moisture alert (drying trend)
async function scenarioLowMoistureAlert(apiUrl: string): Promise<void> {
  console.log('⚠️  Low Moisture Alert Scenario: Gradual drying (< 40%)\n')

  const readings: TelemetryPayload[] = []
  const moisture = { 1: 65, 2: 65 } as Record<number, number>
  const now = Date.now()

  for (let i = 0; i < 12; i++) {
    const recordedAt = new Date(now - (11 - i) * 15 * 60_000).toISOString()
    for (const sensorId of SENSOR_IDS) {
      moisture[sensorId]! -= 2 + Math.random() * 2 // Gradual decrease
      const reading = {
        soilMoisture: Math.round(moisture[sensorId]! * 10) / 10,
        sensorId,
        recordedAt,
      }
      readings.push(reading)

      const status = reading.soilMoisture < 40 ? '🚨 ALERT' : '📊'
      console.log(`  ${status} [sensor ${sensorId}] ${reading.recordedAt}: ${reading.soilMoisture}%`)
    }
  }

  console.log()
  try {
    await sendBatch(apiUrl, readings)
  } catch (err) {
    console.error('✗ Failed:', err)
  }
}

// Scenario: Daily watering pattern
async function scenarioDailyPattern(apiUrl: string): Promise<void> {
  console.log('🌅 Daily Watering Pattern: Realistic 24-hour cycle\n')

  const readings: TelemetryPayload[] = []
  const now = Date.now()

  for (const sensorId of SENSOR_IDS) {
    // 6 AM: Before watering
    readings.push({ soilMoisture: 35, sensorId, recordedAt: new Date(now - 18 * 3600_000).toISOString() })

    // 6:15 AM: After watering
    readings.push({ soilMoisture: 72, sensorId, recordedAt: new Date(now - 17.75 * 3600_000).toISOString() })

    // Gradual drying throughout day (every 1 hour)
    for (let i = 1; i <= 12; i++) {
      readings.push({
        soilMoisture: Math.round((72 - i * 3 + Math.random() * 5) * 10) / 10,
        sensorId,
        recordedAt: new Date(now - (17.75 - i) * 3600_000).toISOString(),
      })
    }
  }

  readings
    .sort((a, b) => new Date(a.recordedAt!).getTime() - new Date(b.recordedAt!).getTime())
    .forEach(r => {
      console.log(`  [sensor ${r.sensorId}] ${r.recordedAt}: ${r.soilMoisture}%`)
    })

  console.log()
  try {
    await sendBatch(apiUrl, readings)
  } catch (err) {
    console.error('✗ Failed:', err)
  }
}

function printHelp(): void {
  console.log(`
🌱 Greenhouse Sensor Simulator

USAGE:
  npx tsx scripts/simulate-esp32.ts [OPTIONS]

OPTIONS:
  --url=<url>           Custom API endpoint (default: http://localhost:3000)
  --scenario=<name>     Run a predefined test scenario
  --batch               Send 24 historical readings via batch endpoint
  --continuous          Continuous stream mode (Ctrl+C to stop)
  --interval=<seconds>  Delay between readings (default: 5)
  --count=<number>      Number of readings to send (default: 10)
  --sensorId=<1|2>      Pin legacy modes (--batch/--continuous/one-time) to one sensor unit
                        (default: alternate between both configured sensors)
  --help                Show this help message

SCENARIOS:
  wifi-realtime         ESP32 POSTs realtime readings every 15 min (direct to API)
  wifi-recovery         Simulate WiFi outage: offline 4h, then batch sync all records
  ble-realtime          Phone receives BLE NOTIFY every 15 min (while connected)
  ble-history-dump      Phone syncs buffered history to cloud (24 records)
  low-moisture-alert    Gradual drying trend crossing 40% threshold (alert scenario)
  daily-pattern         Realistic 24-hour watering cycle with sensors readings

EXAMPLES:
  # WiFi approach: Real-time POST to API
  npx tsx scripts/simulate-esp32.ts --scenario=wifi-realtime \\
    --url=https://greenhouse-monitoring-opal.vercel.app

  # WiFi approach: Recovery after offline period
  npx tsx scripts/simulate-esp32.ts --scenario=wifi-recovery \\
    --url=https://greenhouse-monitoring-opal.vercel.app

  # BLE approach: History sync to cloud
  npx tsx scripts/simulate-esp32.ts --scenario=ble-history-dump \\
    --url=https://greenhouse-monitoring-opal.vercel.app

  # Test low moisture alert
  npx tsx scripts/simulate-esp32.ts --scenario=low-moisture-alert

  # Test daily watering pattern
  npx tsx scripts/simulate-esp32.ts --scenario=daily-pattern

  # Legacy: 10 readings with 3-second intervals
  npx tsx scripts/simulate-esp32.ts --interval=3 --count=10

  # Legacy: Batch sync mode
  npx tsx scripts/simulate-esp32.ts --batch --url=http://localhost:3000

  # Legacy: Continuous stream every 2 seconds
  npx tsx scripts/simulate-esp32.ts --continuous --interval=2

ENVIRONMENT VARIABLES:
  API_URL               Default API endpoint (overridden by --url flag)

  `)
}

async function main(): Promise<void> {
  // Check for help
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp()
    return
  }

  // Parse CLI arguments
  const apiUrl = (() => {
    const urlArg = process.argv.find(arg => arg.startsWith('--url='))
    return urlArg ? urlArg.split('=')[1] : process.env.API_URL || 'http://localhost:3000'
  })()

  const isBatch = process.argv.includes('--batch')
  const isContinuous = process.argv.includes('--continuous')
  const scenario = process.argv.find(arg => arg.startsWith('--scenario='))?.split('=')[1]
  const interval = parseInt(process.argv.find(arg => arg.startsWith('--interval='))?.split('=')[1] || '5', 10)
  const count = parseInt(process.argv.find(arg => arg.startsWith('--count='))?.split('=')[1] || '10', 10)
  const sensorIdArg = process.argv.find(arg => arg.startsWith('--sensorId='))?.split('=')[1]
  const pinnedSensorId = sensorIdArg ? parseInt(sensorIdArg, 10) : undefined

  console.log('🌱 Greenhouse Sensor Simulator')
  console.log(`📍 API URL: ${apiUrl}`)
  console.log('---\n')

  // Run scenario if specified
  if (scenario) {
    switch (scenario) {
      case 'wifi-realtime':
        await scenarioWiFiRealtime(apiUrl, count)
        return
      case 'wifi-recovery':
        await scenarioWiFiRecovery(apiUrl)
        return
      case 'ble-realtime':
        await scenarioBLERealtime(apiUrl, count)
        return
      case 'ble-history-dump':
        await scenarioBLEHistoryDump(apiUrl)
        return
      case 'low-moisture-alert':
        await scenarioLowMoistureAlert(apiUrl)
        return
      case 'daily-pattern':
        await scenarioDailyPattern(apiUrl)
        return
      default:
        console.error(`❌ Unknown scenario: ${scenario}`)
        process.exit(1)
    }
  }

  // Legacy modes
  if (isBatch) {
    const now = Date.now()
    const readings = Array.from({ length: 24 }, (_, i) => ({
      soilMoisture: Math.round((BASE_MOISTURE + (Math.random() - 0.5) * 30) * 10) / 10,
      sensorId: pinnedSensorId ?? SENSOR_IDS[i % SENSOR_IDS.length],
      recordedAt: new Date(now - (23 - i) * 3_600_000).toISOString(),
    }))
    await sendBatch(apiUrl, readings)
    return
  }

  if (isContinuous) {
    console.log(`♾️  Continuous mode — every ${interval}s (Ctrl+C to stop)\n`)
    let reading = 0
    const timer = setInterval(async () => {
      const sensorId = pinnedSensorId ?? SENSOR_IDS[reading % SENSOR_IDS.length]
      reading++
      try {
        await sendTelemetry(apiUrl, generateReading(BASE_MOISTURE, 20, sensorId))
      } catch (err) {
        console.error('✗ Failed:', err)
      }
    }, interval * 1000)

    process.on('SIGINT', () => {
      clearInterval(timer)
      console.log(`\n\n✅ Stopped after ${reading} readings`)
      process.exit(0)
    })
  } else {
    console.log(`📊 One-time mode — ${count} readings every ${interval}s\n`)
    for (let i = 0; i < count; i++) {
      try {
        const sensorId = pinnedSensorId ?? SENSOR_IDS[i % SENSOR_IDS.length]
        await sendTelemetry(apiUrl, generateReading(BASE_MOISTURE, 20, sensorId))
      } catch (err) {
        console.error('✗ Failed:', err)
      }
      if (i < count - 1) {
        await new Promise(resolve => setTimeout(resolve, interval * 1000))
      }
    }
    console.log(`\n✅ Done! Sent ${count} readings`)
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
