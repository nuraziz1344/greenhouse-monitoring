/**
 * GET /api/schedule
 *
 * Lists watering schedules, optionally filtered to a single relay channel.
 *
 * Query params:
 * - channel (optional): only return schedules for this relay channel
 *
 * Returns 200 with an array of schedules.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  const where =
    query?.channel !== undefined && !isNaN(Number(query.channel))
      ? { relayChannel: Number(query.channel) }
      : undefined

  const schedules = await prisma.schedule.findMany({
    where,
    orderBy: [{ relayChannel: 'asc' }, { startTime: 'asc' }],
  })

  return schedules.map(serializeSchedule)
})
