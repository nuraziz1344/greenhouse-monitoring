import type { Schedule } from '../../prisma/generated/client'

/** Serialize a Schedule row for API responses (BigInt id → string, Date → ISO). */
export function serializeSchedule(s: Schedule) {
  return {
    id: s.id.toString(),
    relayChannel: s.relayChannel,
    startTime: s.startTime,
    durationMinutes: s.durationMinutes,
    daysOfWeek: s.daysOfWeek,
    enabled: s.enabled,
    createdAt: s.createdAt.toISOString(),
  }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Validate a schedule payload field-by-field. `partial` skips required-field
 * checks (used by PATCH). Throws a 400 createError on the first problem.
 * Returns a Prisma-ready data object containing only the supplied fields.
 */
export function validateScheduleInput(
  body: Record<string, unknown>,
  validChannels: number[],
  partial = false,
) {
  const data: Record<string, unknown> = {}

  if (body?.relayChannel !== undefined || !partial) {
    const channel = Number(body?.relayChannel)
    if (isNaN(channel) || !validChannels.includes(channel)) {
      throw createError({
        statusCode: 400,
        message: `relayChannel must be one of: ${validChannels.join(', ')}`,
      })
    }
    data.relayChannel = channel
  }

  if (body?.startTime !== undefined || !partial) {
    if (typeof body?.startTime !== 'string' || !HHMM.test(body.startTime)) {
      throw createError({
        statusCode: 400,
        message: 'startTime must be a "HH:MM" 24-hour string',
      })
    }
    data.startTime = body.startTime
  }

  if (body?.durationMinutes !== undefined || !partial) {
    const duration = Number(body?.durationMinutes)
    if (isNaN(duration) || duration <= 0 || duration > 1440) {
      throw createError({
        statusCode: 400,
        message: 'durationMinutes must be a number between 1 and 1440',
      })
    }
    data.durationMinutes = duration
  }

  if (body?.daysOfWeek !== undefined) {
    const days = body.daysOfWeek
    if (
      !Array.isArray(days) ||
      days.length === 0 ||
      !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    ) {
      throw createError({
        statusCode: 400,
        message: 'daysOfWeek must be a non-empty array of integers 0..6 (0=Sun)',
      })
    }
    data.daysOfWeek = Array.from(new Set(days as number[])).sort()
  }

  if (body?.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') {
      throw createError({ statusCode: 400, message: 'enabled must be a boolean' })
    }
    data.enabled = body.enabled
  }

  return data
}
