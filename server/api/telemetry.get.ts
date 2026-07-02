/**
 * GET /api/telemetry
 *
 * Retrieves historical soil moisture data, ordered by most recent first.
 *
 * Query params:
 *   limit (number, optional) — number of records to return (default: 50, max: 1000)
 *
 * Returns 200 with an array of telemetry records.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const limit = Math.min(Math.max(Number(query?.limit) || 50, 1), 1000)

  const records = await prisma.telemetry.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return records.map((record) => ({
    id: record.id.toString(),
    soilMoisture: record.soilMoisture,
    recordedAt: record.recordedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  }))
})
