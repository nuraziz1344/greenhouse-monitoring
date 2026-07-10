/**
 * GET /api/config
 *
 * Returns the device configuration bundle the PWA pushes to the ESP32 over BLE:
 * device settings (measure interval, low-moisture threshold) plus all enabled
 * watering schedules. Seeds the single DeviceConfig row on first call.
 *
 * Response: {
 *   settings: { measureIntervalMinutes, lowMoistureThreshold },
 *   schedules: [{ channel, startTime, durationMinutes, daysOfWeek, enabled }],
 *   version: string (ISO timestamp of the most recent config change)
 * }
 */
export default defineEventHandler(async () => {
  return await getDeviceConfigBundle()
})
