export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWED = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8'];

export async function POST(request) {
  try {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return Response.json({ error: 'ANTHROPIC_API_KEY ausente' }, { status: 500 });

    const body = await request.json();
    const model = ALLOWED.includes(body.model) ? body.model : 'claude-sonnet-4-6';
    const payload = {
      model,
      max_tokens: Math.min(body.max_tokens || 1200, 2000),
      system: body.system,
      messages: body.messages,
    };
    if (body.tools) payload.tools = body.tools;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    return Response.json(data, { status: r.status });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
