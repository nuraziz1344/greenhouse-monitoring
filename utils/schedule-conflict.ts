export interface ScheduleWindow {
  relayChannel: number
  startTime: string // "HH:MM"
  durationMinutes: number
  daysOfWeek: number[]
}

export function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/**
 * Existing enabled schedules whose window overlaps the candidate on at least
 * one shared day. On another relay channel that runs two pumps at once
 * (violates the single-active interlock); on the same channel it's a
 * duplicate/redundant window. Pass excludeId when re-checking a schedule that
 * is already in the list (e.g. on enable) so it doesn't conflict with itself.
 * Windows are compared as [start, start + duration) minutes since midnight,
 * without midnight wrap (same semantics as the in-app scheduler's
 * isWindowActive).
 */
export function findScheduleConflicts<T extends ScheduleWindow & { id: string; enabled: boolean }>(
  candidate: ScheduleWindow,
  existing: T[],
  excludeId?: string,
): T[] {
  const aStart = toMinutes(candidate.startTime)
  const aEnd = aStart + candidate.durationMinutes

  return existing.filter((s) => {
    if (!s.enabled || s.id === excludeId) return false
    if (!s.daysOfWeek.some((d) => candidate.daysOfWeek.includes(d))) return false
    const bStart = toMinutes(s.startTime)
    return aStart < bStart + s.durationMinutes && bStart < aEnd
  })
}
