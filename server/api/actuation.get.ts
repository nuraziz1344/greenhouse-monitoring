/**
 * GET /api/actuation
 *
 * Returns the relay actuation history (on/off events), newest first.
 *
 * Query params:
 * - channel (optional): filter to a single relay channel
 * - limit (optional): max records to return (default: 100, max: 500)
 *
 * Returns 200 with an array of actuation log entries.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const limit = Math.min(Math.max(Number(query?.limit) || 100, 1), 500)

  const where =
    query?.channel !== undefined && !isNaN(Number(query.channel))
      ? { relayChannel: Number(query.channel) }
      : undefined

  const logs = await prisma.actuationLog.findMany({
    where,
    orderBy: { recordedAt: 'desc' },
    take: limit,
  })

  return logs.map((l) => ({
    id: l.id.toString(),
    relayChannel: l.relayChannel,
    action: l.action,
    source: l.source,
    recordedAt: l.recordedAt.toISOString(),
  }))
})
