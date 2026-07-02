export async function sendAlert(data: { soilMoisture: number }): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL

  if (!webhookUrl) {
    console.warn('[Alert] No ALERT_WEBHOOK_URL configured — skipping alert dispatch')
    return
  }

  const message = `
🚨 *Greenhouse Alert — Low Soil Moisture!*
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
