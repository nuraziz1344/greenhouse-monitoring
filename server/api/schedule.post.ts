/**
 * POST /api/schedule
 *
 * Creates a recurring daily watering schedule for a relay.
 *
 * Body: {
 *   relayChannel: number,
 *   startTime: "HH:MM",
 *   durationMinutes: number,
 *   daysOfWeek?: number[]   // 0=Sun..6=Sat, defaults to every day
 *   enabled?: boolean       // defaults to true
 * }
 *
 * Returns 201 with the created schedule.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const channels = (config.public.relayChannels as Array<{ channel: number }>).map((c) => c.channel)

  const body = await readBody(event)
  const data = validateScheduleInput(body ?? {}, channels)

  const schedule = await prisma.schedule.create({
    data: data as {
      relayChannel: number
      startTime: string
      durationMinutes: number
      daysOfWeek?: number[]
      enabled?: boolean
    },
  })

  console.log(`[Schedule] created id=${schedule.id} ch=${schedule.relayChannel} @${schedule.startTime}`)

  setResponseStatus(event, 201)
  return serializeSchedule(schedule)
})
