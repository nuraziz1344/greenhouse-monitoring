/**
 * PATCH /api/config
 *
 * Updates device-wide settings (schedules have their own CRUD endpoints).
 *
 * Body: { measureIntervalMinutes?: number (1-1440), lowMoistureThreshold?: number (0-100) }
 *
 * Returns 200 with the full config bundle (same shape as GET /api/config).
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const data: { measureIntervalMinutes?: number; lowMoistureThreshold?: number } = {}

  if (body?.measureIntervalMinutes !== undefined) {
    const interval = Number(body.measureIntervalMinutes)
    if (!Number.isInteger(interval) || interval < 1 || interval > 1440) {
      throw createError({
        statusCode: 400,
        message: 'measureIntervalMinutes must be an integer between 1 and 1440',
      })
    }
    data.measureIntervalMinutes = interval
  }

  if (body?.lowMoistureThreshold !== undefined) {
    const threshold = Number(body.lowMoistureThreshold)
    if (isNaN(threshold) || threshold < 0 || threshold > 100) {
      throw createError({
        statusCode: 400,
        message: 'lowMoistureThreshold must be a number between 0 and 100',
      })
    }
    data.lowMoistureThreshold = threshold
  }

  if (Object.keys(data).length === 0) {
    throw createError({
      statusCode: 400,
      message: 'Provide at least one of: measureIntervalMinutes, lowMoistureThreshold',
    })
  }

  await prisma.deviceConfig.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  })

  return await getDeviceConfigBundle()
})
