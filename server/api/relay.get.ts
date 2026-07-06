/**
 * GET /api/relay
 *
 * Returns the water-pump relay channels and their current state. Idempotently
 * seeds one row per channel configured in runtimeConfig.public.relayChannels
 * (so the endpoint works on a fresh database with no manual seeding).
 *
 * Returns 200 with an array of relays ordered by channel.
 */
export default defineEventHandler(async () => {
  const config = useRuntimeConfig()
  const channels = config.public.relayChannels as Array<{ channel: number; name: string }>

  // Ensure a Relay row exists for every configured channel (create-if-missing,
  // leave existing name/state untouched).
  await Promise.all(
    channels.map((c) =>
      prisma.relay.upsert({
        where: { channel: c.channel },
        create: { channel: c.channel, name: c.name },
        update: {},
      }),
    ),
  )

  const relays = await prisma.relay.findMany({ orderBy: { channel: 'asc' } })

  return relays.map((r) => ({
    id: r.id.toString(),
    channel: r.channel,
    name: r.name,
    isOn: r.isOn,
    updatedAt: r.updatedAt.toISOString(),
  }))
})
