/**
 * POST /api/relay
 *
 * Sets a relay's on/off state and appends an ActuationLog entry. This is the
 * persisted "desired state" — physical actuation happens separately over BLE
 * from the client. The single-active interlock is enforced in the UI (bypassable
 * warning), so this endpoint records whatever it is told.
 *
 * Body: { channel: number, isOn: boolean, source?: "manual" | "schedule" | "device" }
 *
 * Returns 200 with the updated relay list.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const channels = (config.public.relayChannels as Array<{ channel: number }>).map((c) => c.channel)

  const body = await readBody(event)
  const channel = Number(body?.channel)

  if (body?.channel === undefined || isNaN(channel) || !channels.includes(channel)) {
    throw createError({
      statusCode: 400,
      message: `channel is required and must be one of: ${channels.join(', ')}`,
    })
  }

  if (typeof body?.isOn !== 'boolean') {
    throw createError({
      statusCode: 400,
      message: 'isOn is required and must be a boolean',
    })
  }

  const source =
    body?.source === 'schedule' || body?.source === 'device' ? body.source : 'manual'

  await prisma.relay.update({
    where: { channel },
    data: { isOn: body.isOn },
  })

  await prisma.actuationLog.create({
    data: {
      relayChannel: channel,
      action: body.isOn ? 'on' : 'off',
      source,
    },
  })

  console.log(`[Relay] ch=${channel} → ${body.isOn ? 'ON' : 'OFF'} (${source})`)

  const relays = await prisma.relay.findMany({ orderBy: { channel: 'asc' } })

  return relays.map((r) => ({
    id: r.id.toString(),
    channel: r.channel,
    name: r.name,
    isOn: r.isOn,
    updatedAt: r.updatedAt.toISOString(),
  }))
})
