/**
 * POST /api/telemetry
 *
 * Ingests a soil moisture reading from the ESP32 (via mobile PWA BLE relay).
 * Validates payload, stores in database, and triggers alert if soil moisture < 40%.
 *
 * Body: { soilMoisture: number, recordedAt?: string (ISO 8601) }
 *
 * Returns 201 on success.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  const soilMoisture = Number(body?.soilMoisture)

  if (body?.soilMoisture === undefined || isNaN(soilMoisture)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'soilMoisture is required and must be a number',
    })
  }

  if (soilMoisture < 0 || soilMoisture > 100) {
    throw createError({
      statusCode: 400,
      message: 'soilMoisture must be between 0 and 100%',
    })
  }

  // Parse optional client-supplied timestamp (ESP32 measurement time)
  let recordedAt: Date | undefined
  if (body?.recordedAt) {
    const parsed = new Date(body.recordedAt)
    if (!isNaN(parsed.getTime())) {
      recordedAt = parsed
    }
  }

  const telemetry = await prisma.telemetry.create({
    data: {
      soilMoisture,
      ...(recordedAt ? { recordedAt } : {}),
    },
  })

  if (soilMoisture < 40) {
    sendAlert({ soilMoisture }).catch((err) => {
      console.error('Alert dispatch failed:', err)
    })
  }

  console.log(`[Telemetry] M=${soilMoisture}% → id=${telemetry.id}`)

  setResponseStatus(event, 201)
  return {
    id: telemetry.id.toString(),
    message: 'Telemetry recorded',
  }
})
