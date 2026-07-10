/** Configured soil-moisture sensor units (runtimeConfig.public.soilSensors). */
export function configuredSensors(): Array<{ sensorId: number; name: string }> {
  const config = useRuntimeConfig()
  return config.public.soilSensors as Array<{ sensorId: number; name: string }>
}

/**
 * Validates an optional `sensorId` from a request body/query against the
 * configured sensor list. Omitted → defaults to the first configured sensor
 * (sensorId 1), so single-sensor firmware that never sends the field keeps
 * working unmodified. Throws a 400 createError if an explicit value doesn't
 * match any configured sensor.
 */
export function resolveSensorId(value: unknown): number {
  const sensors = configuredSensors()
  if (value === undefined || value === null) {
    return sensors[0]?.sensorId ?? 1
  }
  const sensorId = Number(value)
  if (isNaN(sensorId) || !sensors.some((s) => s.sensorId === sensorId)) {
    throw createError({
      statusCode: 400,
      message: `sensorId must be one of: ${sensors.map((s) => s.sensorId).join(', ')}`,
    })
  }
  return sensorId
}

export function sensorName(sensorId: number): string {
  return configuredSensors().find((s) => s.sensorId === sensorId)?.name ?? `Sensor ${sensorId}`
}
