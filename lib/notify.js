export async function notify(text) {
  const body = String(text || '').slice(0, 4000);

  // 1) WhatsApp Cloud API nativo (se configurado)
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const to = process.env.WHATSAPP_TO;
  if (token && phoneId && to) {
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
      });
      if (r.ok) return { via: 'whatsapp' };
    } catch (e) {}
  }

  // 2) Webhook genérico (n8n / Make / Slack / e-mail)
  const hook = process.env.NOTIFY_WEBHOOK;
  if (hook) {
    try {
      await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: body }) });
      return { via: 'webhook' };
    } catch (e) {}
  }
  return { via: 'none' };
}
