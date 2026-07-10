export async function sendAlert(data: { soilMoisture: number; sensorId?: number }): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL

  if (!webhookUrl) {
    console.warn('[Alert] No ALERT_WEBHOOK_URL configured — skipping alert dispatch')
    return
  }

  const label = data.sensorId !== undefined ? sensorName(data.sensorId) : null

  const message = `
🚨 *Greenhouse Alert — Low Soil Moisture!*${label ? `\n- Sensor: ${label}` : ''}
- Soil Moisture: ${data.soilMoisture.toFixed(1)}% (below 40% threshold)
- Time: ${new Date().toISOString()}
  `.trim()

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
  })

  console.log('[Alert] Notification dispatched successfully')
}
