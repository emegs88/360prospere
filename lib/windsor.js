export async function pullSpend(datePreset = 'last_30d', fields = 'source,date,spend,clicks,impressions') {
  const key = process.env.WINDSOR_API_KEY;
  if (!key) throw new Error('WINDSOR_API_KEY ausente');
  const url = `https://connectors.windsor.ai/all?api_key=${encodeURIComponent(key)}&date_preset=${encodeURIComponent(datePreset)}&fields=${encodeURIComponent(fields)}`;
  const r = await fetch(url);
  const d = await r.json();
  if (!r.ok) throw new Error('windsor ' + r.status);
  return d;
}
