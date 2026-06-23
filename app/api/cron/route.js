import { brain } from '@/lib/anthropic';
import { pullSpend } from '@/lib/windsor';
import { notify } from '@/lib/notify';
import { COMPLIANCE } from '@/lib/compliance';

export const runtime = 'nodejs';
export const maxDuration = 120;

const SYS = `Você é o Cérebro do Prospere 360 (consórcios, by Âncora) — estrategista de growth, mídia e capital.
Português do Brasil, direto, tom de centro de comando.
${COMPLIANCE}
Formato: ## Diagnóstico  ## Ações por canal  ## Plano do dia  ## 3 ideias de conteúdo`;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const isVercelCron = request.headers.get('x-vercel-cron');
  const { searchParams } = new URL(request.url);
  const auth = request.headers.get('authorization') || '';
  if (secret && !isVercelCron && auth !== `Bearer ${secret}` && searchParams.get('secret') !== secret) {
    return Response.json({ error: 'não autorizado' }, { status: 401 });
  }

  try {
    let spend = [];
    try { spend = await pullSpend('last_30d'); } catch (e) { spend = [{ aviso: 'Windsor sem dados de Ads — conecte Meta/TikTok/Google.' }]; }

    const ctx = `Gasto de mídia (Windsor, últimos 30d): ${JSON.stringify(spend).slice(0, 5000)}`;
    const report = await brain(SYS, `${ctx}\n\nGere o relatório de execução de hoje.`, true);

    const sent = await notify(`🧠 PROSPERE 360 — Relatório do dia\n\n${report}`);
    return Response.json({ ok: true, at: new Date().toISOString(), sent, report });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
