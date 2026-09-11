// Posts a message to a Slack Incoming Webhook. Used to alert on unattended
// script failures (e.g. scripts/auto-ingest-onehome.ts), since a scheduled
// task's stderr goes nowhere anyone will see it in time.
export async function sendSlackAlert(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("SLACK_ALERT_WEBHOOK_URL not set — skipping Slack alert. Message was:", text);
    return;
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook returned ${res.status}: ${await res.text()}`);
  }
}
