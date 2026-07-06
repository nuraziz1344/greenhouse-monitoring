/**
 * PATCH /api/schedule/:id
 *
 * Updates fields of an existing schedule (any subset of relayChannel, startTime,
 * durationMinutes, daysOfWeek, enabled). Commonly used to toggle `enabled`.
 *
 * Returns 200 with the updated schedule.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const channels = (config.public.relayChannels as Array<{ channel: number }>).map((c) => c.channel)

  const idParam = getRouterParam(event, 'id')
  let id: bigint
  try {
    id = BigInt(idParam ?? '')
  } catch {
    throw createError({ statusCode: 400, message: 'id must be an integer' })
  }

  const body = await readBody(event)
  const data = validateScheduleInput(body ?? {}, channels, true)

  if (Object.keys(data).length === 0) {
    throw createError({ statusCode: 400, message: 'no updatable fields supplied' })
  }

  try {
    const schedule = await prisma.schedule.update({ where: { id }, data })
    return serializeSchedule(schedule)
  } catch {
    throw createError({ statusCode: 404, message: 'schedule not found' })
  }
})
