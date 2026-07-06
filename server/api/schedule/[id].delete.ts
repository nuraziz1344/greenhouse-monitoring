/**
 * DELETE /api/schedule/:id
 *
 * Removes a watering schedule.
 *
 * Returns 200 with { id, message }.
 */
export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  let id: bigint
  try {
    id = BigInt(idParam ?? '')
  } catch {
    throw createError({ statusCode: 400, message: 'id must be an integer' })
  }

  try {
    await prisma.schedule.delete({ where: { id } })
  } catch {
    throw createError({ statusCode: 404, message: 'schedule not found' })
  }

  return { id: id.toString(), message: 'Schedule deleted' }
})
