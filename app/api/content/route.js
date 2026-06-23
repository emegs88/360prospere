import { brain } from '@/lib/anthropic';
import { COMPLIANCE } from '@/lib/compliance';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SYS = `Você é o cérebro de conteúdo do Prospere 360 (consórcios, by Âncora).
Pesquise tendências atuais e gere ideias PRONTAS pra Instagram/TikTok: formato, hook, roteiro curto e CTA.
Português do Brasil, direto.
${COMPLIANCE}
Formato: ## Ideias (cada uma com formato + hook + CTA)`;

export async function POST(request) {
  try {
    const { tema } = await request.json().catch(() => ({}));
    const ask = tema
      ? `Gere ideias de conteúdo sobre: ${tema}`
      : `Gere 10 ideias de conteúdo de consórcio pra esta semana, pesquisando tendências atuais.`;
    const ideas = await brain(SYS, ask, true);
    return Response.json({ ok: true, ideas });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
