/**
 * Device configuration bundle: the single payload the PWA fetches and pushes
 * to the ESP32 over BLE (settings + enabled schedules). Shared by
 * GET /api/config and PATCH /api/config.
 */
export async function getDeviceConfigBundle() {
  // Single-row table (id=1); create-if-missing so a fresh DB just works,
  // mirroring the relay seeding in relay.get.ts.
  const settings = await prisma.deviceConfig.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  })

  const schedules = await prisma.schedule.findMany({
    where: { enabled: true },
    orderBy: [{ relayChannel: 'asc' }, { startTime: 'asc' }],
  })

  // `version` is a debug aid: changes whenever settings or schedules change.
  const latestSchedule = schedules.reduce(
    (max, s) => (s.createdAt > max ? s.createdAt : max),
    new Date(0),
  )
  const version = (settings.updatedAt > latestSchedule ? settings.updatedAt : latestSchedule)

  return {
    settings: {
      measureIntervalMinutes: settings.measureIntervalMinutes,
      lowMoistureThreshold: settings.lowMoistureThreshold,
    },
    // `channel` (not `relayChannel`) to match the BLE command payload shape.
    schedules: schedules.map((s) => ({
      channel: s.relayChannel,
      startTime: s.startTime,
      durationMinutes: s.durationMinutes,
      daysOfWeek: s.daysOfWeek,
      enabled: s.enabled,
    })),
    version: version.toISOString(),
  }
}
