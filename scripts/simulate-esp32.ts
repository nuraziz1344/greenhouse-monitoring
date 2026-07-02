/**
 * ESP32 Greenhouse Sensor Simulator
 * Generates realistic soil moisture data and POSTs to the backend API.
 *
 * Usage:
 *   pnpm simulate:once                  — 50 individual readings
 *   pnpm simulate:continuous            — continuous stream every 5 seconds
 *   npx tsx scripts/simulate-esp32.ts --batch  — 24 historical readings via batch endpoint
 */

interface TelemetryPayload {
  soilMoisture: number
  recordedAt?: string
}

const BASE_MOISTURE = 55 // Ideal for melon: 50–70%

function generateReading(): TelemetryPayload {
  return {
    soilMoisture: BASE_MOISTURE + (Math.random() - 0.5) * 20,
  }
}

async function sendTelemetry(payload: TelemetryPayload): Promise<void> {
  const apiUrl = process.env.API_URL || 'http://localhost:3000'

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
  console.log(`✓ Sent: M=${payload.soilMoisture.toFixed(1)}% (ID: ${result.id})`)
}

async function sendBatch(): Promise<void> {
  const apiUrl = process.env.API_URL || 'http://localhost:3000'
  const now = Date.now()

  const readings = Array.from({ length: 24 }, (_, i) => ({
    soilMoisture: Math.round((BASE_MOISTURE + (Math.random() - 0.5) * 30) * 10) / 10,
    recordedAt: new Date(now - (23 - i) * 3_600_000).toISOString(),
  }))

  console.log(`Sending batch of ${readings.length} readings (last 24 hours)…`)

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
  console.log(`✅ Batch complete: ${result.count} records inserted`)
}

async function main(): Promise<void> {
  const isBatch = process.argv.includes('--batch')
  const isContinuous = process.argv.includes('--continuous')
  const interval = parseInt(process.argv.find(arg => arg.startsWith('--interval='))?.split('=')[1] || '5', 10)
  const count = parseInt(process.argv.find(arg => arg.startsWith('--count='))?.split('=')[1] || '10', 10)

  console.log('🌱 Greenhouse Sensor Simulator')
  console.log(`📍 API URL: ${process.env.API_URL || 'http://localhost:3000'}`)
  console.log('---\n')

  if (isBatch) {
    await sendBatch()
    return
  }

  if (isContinuous) {
    console.log(`♾️  Continuous mode — every ${interval}s (Ctrl+C to stop)\n`)
    let reading = 0
    const timer = setInterval(async () => {
      reading++
      try {
        await sendTelemetry(generateReading())
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
        await sendTelemetry(generateReading())
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
