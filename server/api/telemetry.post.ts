/**
 * POST /api/telemetry
 *
 * Ingests environmental sensor readings from the ESP32 greenhouse device.
 * Validates payload, stores in database, and triggers alert if soil moisture
 * is critically low (< 40%).
 *
 * Body: { temperature: number, humidity: number, soilMoisture: number }
 *
 * Returns 201 on success.
 */
export default defineEventHandler(async (event) => {
  // Read and validate the request body
  const body = await readBody(event)

  const errors: string[] = []

  // Manual validation (no heavy deps)
  const temperature = Number(body?.temperature)
  const humidity = Number(body?.humidity)
  const soilMoisture = Number(body?.soilMoisture)

  if (body?.temperature === undefined || isNaN(temperature)) {
    errors.push('temperature is required and must be a number')
  }
  if (body?.humidity === undefined || isNaN(humidity)) {
    errors.push('humidity is required and must be a number')
  }
  if (body?.soilMoisture === undefined || isNaN(soilMoisture)) {
    errors.push('soilMoisture is required and must be a number')
  }

  if (errors.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Validation failed',
      data: { errors },
    })
  }

  // Validate ranges
  if (temperature < -40 || temperature > 80) {
    throw createError({
      statusCode: 400,
      message: 'temperature must be between -40 and 80°C',
    })
  }
  if (humidity < 0 || humidity > 100) {
    throw createError({
      statusCode: 400,
      message: 'humidity must be between 0 and 100%',
    })
  }
  if (soilMoisture < 0 || soilMoisture > 100) {
    throw createError({
      statusCode: 400,
      message: 'soilMoisture must be between 0 and 100%',
    })
  }

  // Insert telemetry record
  const telemetry = await prisma.telemetry.create({
    data: {
      temperature,
      humidity,
      soilMoisture,
    },
  })

  // Async alert dispatch — fire and forget to avoid Vercel timeout
  if (soilMoisture < 40) {
    sendAlert({ temperature, humidity, soilMoisture }).catch((err) => {
      console.error('Alert dispatch failed:', err)
    })
  }

  // Log telemetry reception
  console.log(
    `[Telemetry] T=${temperature}°C H=${humidity}% M=${soilMoisture}% → id=${telemetry.id}`
  )

  return {
    id: telemetry.id.toString(),
    message: 'Telemetry recorded',
  }
})

/**
 * Dispatches an alert notification when soil moisture is critically low.
 * Uses the ALERT_WEBHOOK_URL environment variable if configured.
 */
async function sendAlert(data: { temperature: number; humidity: number; soilMoisture: number }) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL

  if (!webhookUrl) {
    console.warn('[Alert] No ALERT_WEBHOOK_URL configured — skipping alert dispatch')
    return
  }

  const message = `
🚨 *Greenhouse Alert — Low Soil Moisture!*
- Soil Moisture: ${data.soilMoisture}% (below 40% threshold)
- Temperature: ${data.temperature}°C
- Humidity: ${data.humidity}%
- Time: ${new Date().toISOString()}
  `.trim()

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
  })

  console.log('[Alert] Notification dispatched successfully')
}
