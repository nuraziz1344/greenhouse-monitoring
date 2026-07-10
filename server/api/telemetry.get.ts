/**
 * GET /api/telemetry
 *
 * Retrieves historical soil moisture data, ordered by most recent first.
 *
 * Query params:
 *   range (string, optional) — time window: 1h | 6h | 24h | 7d | all (default: 24h)
 *   limit (number, optional) — max records to return (default: 1000, max: 1000)
 *   sensorId (number, optional) — filter to one physical sensor unit (see
 *     runtimeConfig.public.soilSensors). Omitted returns all sensors mixed
 *     together, each record tagged with its sensorId.
 *
 * Records are filtered and ordered by their effective time (recordedAt ?? createdAt),
 * matching how the dashboard chart and table display timestamps.
 *
 * Returns 200 with an array of telemetry records.
 */
const RANGE_MS: Record<string, number> = {
  '1h': 3_600_000,
  '6h': 21_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const limit = Math.min(Math.max(Number(query?.limit) || 1000, 1), 1000)

  const rangeParam = String(query?.range ?? '24h')
  const range = rangeParam === 'all' || rangeParam in RANGE_MS ? rangeParam : '24h'

  const sensorId = query?.sensorId !== undefined ? resolveSensorId(query.sensorId) : undefined

  const timeWhere =
    range === 'all'
      ? undefined
      : (() => {
          const since = new Date(Date.now() - RANGE_MS[range])
          return {
            OR: [
              { recordedAt: { gte: since } },
              { recordedAt: null, createdAt: { gte: since } },
            ],
          }
        })()

  // Prisma ANDs sibling top-level keys, so sensorId and the time-range OR can
  // simply be spread onto one where object rather than nested in an AND array.
  const where =
    sensorId !== undefined || timeWhere
      ? { ...(sensorId !== undefined ? { sensorId } : {}), ...(timeWhere ?? {}) }
      : undefined

  const records = await prisma.telemetry.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  // Order by effective time (recordedAt ?? createdAt) descending — Prisma can't
  // orderBy a COALESCE directly, so re-sort the bounded result set in JS.
  const effective = (r: (typeof records)[number]) =>
    (r.recordedAt ?? r.createdAt).getTime()

  return records
    .sort((a, b) => effective(b) - effective(a))
    .map((record) => ({
      id: record.id.toString(),
      sensorId: record.sensorId,
      soilMoisture: record.soilMoisture,
      recordedAt: record.recordedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
    }))
})
