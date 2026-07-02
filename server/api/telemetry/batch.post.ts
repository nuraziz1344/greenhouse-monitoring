/**
 * POST /api/telemetry/batch
 *
 * Bulk-inserts soil moisture readings synced from ESP32 LittleFS history via BLE.
 * Accepts up to 500 readings in a single request.
 *
 * Body: { readings: [{ soilMoisture: number, recordedAt?: string }] }
 *
 * Returns 201 with the count of inserted records.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  if (!Array.isArray(body?.readings) || body.readings.length === 0) {
    throw createError({
      statusCode: 400,
      message: 'readings must be a non-empty array',
    })
  }

  if (body.readings.length > 500) {
    throw createError({
      statusCode: 400,
      message: 'readings must not exceed 500 items per batch',
    })
  }

  const data: { soilMoisture: number; recordedAt?: Date }[] = []

  for (let i = 0; i < body.readings.length; i++) {
    const item = body.readings[i]
    const soilMoisture = Number(item?.soilMoisture)

    if (isNaN(soilMoisture) || soilMoisture < 0 || soilMoisture > 100) {
      throw createError({
        statusCode: 400,
        message: `readings[${i}].soilMoisture must be a number between 0 and 100`,
      })
    }

    const entry: { soilMoisture: number; recordedAt?: Date } = { soilMoisture }

    if (item?.recordedAt) {
      const parsed = new Date(item.recordedAt)
      if (!isNaN(parsed.getTime())) {
        entry.recordedAt = parsed
      }
    }

    data.push(entry)
  }

  const result = await prisma.telemetry.createMany({ data })

  // Fire one grouped alert if any reading is critically low
  const criticalReadings = data.filter((r) => r.soilMoisture < 40)
  if (criticalReadings.length > 0) {
    const lowest = Math.min(...criticalReadings.map((r) => r.soilMoisture))
    sendAlert({ soilMoisture: lowest }).catch((err) => {
      console.error('Alert dispatch failed:', err)
    })
  }

  console.log(`[Batch] Inserted ${result.count} readings`)

  setResponseStatus(event, 201)
  return {
    count: result.count,
    message: 'Batch recorded',
  }
})
