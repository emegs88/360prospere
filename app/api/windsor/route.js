import { pullSpend } from '@/lib/windsor';

export const runtime = 'nodejs';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const datePreset = searchParams.get('date_preset') || 'last_30d';
  const fields = searchParams.get('fields') || 'source,date,spend,clicks,impressions';

  try {
    const data = await pullSpend(datePreset, fields);
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
