/**
 * ESP32 Greenhouse Sensor Simulator
 * Generates realistic telemetry data and POSTs to the backend API
 *
 * Usage: npx tsx scripts/simulate-esp32.ts
 * Or: npx tsx scripts/simulate-esp32.ts --continuous
 */

interface TelemetryPayload {
  temperature: number
  humidity: number
  soilMoisture: number
}

// Realistic greenhouse conditions (melon greenhouse)
const BASE_TEMP = 28 // Melons thrive around 25-30°C
const BASE_HUMIDITY = 65 // Ideal: 60-70%
const BASE_MOISTURE = 55 // Ideal: 50-70% for melon

/**
 * Generate realistic sensor readings with small variations
 * Includes diurnal patterns (temperature drops at night)
 */
function generateReading(): TelemetryPayload {
  const hour = new Date().getHours()

  // Simulate day/night temperature variation
  const tempVariation = Math.sin((hour - 6) * Math.PI / 12) * 5

  return {
    temperature: BASE_TEMP + tempVariation + (Math.random() - 0.5) * 2,
    humidity: BASE_HUMIDITY + (Math.random() - 0.5) * 10,
    soilMoisture: BASE_MOISTURE + (Math.random() - 0.5) * 15,
  }
}

/**
 * Send telemetry data to the backend
 */
async function sendTelemetry(payload: TelemetryPayload): Promise<void> {
  const apiUrl = process.env.API_URL || 'http://localhost:3000'

  try {
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
    console.log(
      `✓ Sent: T=${payload.temperature.toFixed(1)}°C H=${payload.humidity.toFixed(1)}% M=${payload.soilMoisture.toFixed(1)}% (ID: ${result.id})`
    )
  } catch (error) {
    console.error(`✗ Failed to send telemetry:`, error)
  }
}

/**
 * Main simulation loop
 */
async function main(): Promise<void> {
  const isContinuous = process.argv.includes('--continuous')
  const interval = parseInt(process.argv.find(arg => arg.startsWith('--interval='))?.split('=')[1] || '5', 10)
  const count = parseInt(process.argv.find(arg => arg.startsWith('--count='))?.split('=')[1] || '10', 10)

  console.log(`🌱 Greenhouse Sensor Simulator`)
  console.log(`📍 API URL: ${process.env.API_URL || 'http://localhost:3000'}`)
  console.log(`⏱️  Interval: ${interval}s`)
  console.log(isContinuous ? `♾️  Mode: Continuous` : `📊 Mode: One-time (${count} readings)`)
  console.log('---\n')

  if (isContinuous) {
    // Continuous mode: send data every N seconds indefinitely
    console.log('Starting continuous simulation (Ctrl+C to stop)...\n')

    let reading = 0
    const timer = setInterval(async () => {
      reading++
      const payload = generateReading()
      await sendTelemetry(payload)
      process.stdout.write(`\r${reading} readings sent`)
    }, interval * 1000)

    process.on('SIGINT', () => {
      clearInterval(timer)
      console.log(`\n\n✅ Stopped after ${reading} readings`)
      process.exit(0)
    })
  } else {
    // One-time mode: send N readings with delay
    console.log(`Sending ${count} readings...\n`)

    for (let i = 0; i < count; i++) {
      const payload = generateReading()
      await sendTelemetry(payload)

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
