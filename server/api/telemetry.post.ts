/**
 * POST /api/telemetry
 *
 * Ingests a soil moisture reading from the ESP32 (via mobile PWA BLE relay).
 * Validates payload, stores in database, and triggers alert if soil moisture < 40%.
 *
 * Body: { soilMoisture: number, sensorId?: number, recordedAt?: string (ISO 8601) }
 * `sensorId` identifies which physical sensor unit took the reading (see
 * runtimeConfig.public.soilSensors); omitted defaults to sensor 1.
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

  const sensorId = resolveSensorId(body?.sensorId)

  // Parse optional client-supplied timestamp (ESP32 measurement time).
  // Default to the current server time so recordedAt is never stored as null.
  let recordedAt = new Date()
  if (body?.recordedAt) {
    const parsed = new Date(body.recordedAt)
    if (!isNaN(parsed.getTime())) {
      recordedAt = parsed
    }
  }

  let telemetry
  try {
    telemetry = await prisma.telemetry.create({
      data: {
        sensorId,
        soilMoisture,
        recordedAt,
      },
    })
  } catch (err) {
    // Unique (sensorId, recordedAt, soilMoisture) violation: the same reading
    // already arrived via another path (e.g. BLE batch sync). Not an error for the device.
    if ((err as { code?: string })?.code === 'P2002') {
      setResponseStatus(event, 200)
      return { message: 'Duplicate ignored' }
    }
    throw err
  }

  if (soilMoisture < 40) {
    sendAlert({ soilMoisture, sensorId }).catch((err) => {
      console.error('Alert dispatch failed:', err)
    })
  }

  console.log(`[Telemetry] sensor=${sensorId} M=${soilMoisture}% → id=${telemetry.id}`)

  setResponseStatus(event, 201)
  return {
    id: telemetry.id.toString(),
    message: 'Telemetry recorded',
  }
})
