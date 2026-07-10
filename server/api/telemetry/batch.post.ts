/**
 * POST /api/telemetry/batch
 *
 * Bulk-inserts soil moisture readings synced from ESP32 LittleFS history via BLE.
 * Accepts up to 500 readings in a single request.
 *
 * Body: { readings: [{ soilMoisture: number, sensorId?: number, recordedAt?: string }] }
 * `sensorId` identifies which physical sensor unit took each reading (see
 * runtimeConfig.public.soilSensors); omitted per-item defaults to sensor 1.
 *
 * Returns 201 with the count of inserted records. Readings that already exist
 * (same sensorId + recordedAt + soilMoisture) are silently skipped, so
 * re-syncing the same ESP32 history buffer never creates duplicate rows.
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

  const data: { sensorId: number; soilMoisture: number; recordedAt: Date }[] = []

  for (let i = 0; i < body.readings.length; i++) {
    const item = body.readings[i]
    const soilMoisture = Number(item?.soilMoisture)

    if (isNaN(soilMoisture) || soilMoisture < 0 || soilMoisture > 100) {
      throw createError({
        statusCode: 400,
        message: `readings[${i}].soilMoisture must be a number between 0 and 100`,
      })
    }

    const sensorId = resolveSensorId(item?.sensorId)

    // Default to current server time so recordedAt is never stored as null.
    const entry: { sensorId: number; soilMoisture: number; recordedAt: Date } = {
      sensorId,
      soilMoisture,
      recordedAt: new Date(),
    }

    if (item?.recordedAt) {
      const parsed = new Date(item.recordedAt)
      if (!isNaN(parsed.getTime())) {
        entry.recordedAt = parsed
      }
    }

    data.push(entry)
  }

  const result = await prisma.telemetry.createMany({ data, skipDuplicates: true })

  // Fire one grouped alert per sensor that has any critically-low reading.
  const criticalBySensor = new Map<number, number>()
  for (const r of data) {
    if (r.soilMoisture >= 40) continue
    const current = criticalBySensor.get(r.sensorId)
    if (current === undefined || r.soilMoisture < current) {
      criticalBySensor.set(r.sensorId, r.soilMoisture)
    }
  }
  for (const [sensorId, lowest] of criticalBySensor) {
    sendAlert({ soilMoisture: lowest, sensorId }).catch((err) => {
      console.error('Alert dispatch failed:', err)
    })
  }

  console.log(`[Batch] Inserted ${result.count}/${data.length} readings (duplicates skipped)`)

  setResponseStatus(event, 201)
  return {
    count: result.count,
    message: 'Batch recorded',
  }
})
