# Prospere 360 — Cérebro de Negócio

Sistema do Grupo Prospere (by Âncora) para comandar a operação de consórcio & capital:
cérebro de IA que pesquisa, decide e gera conteúdo, com mapa de oportunidade de
brasileiros no mundo (dado real Itamaraty) e relatório de execução automático todo dia.

Stack: **Next.js (App Router) + Vercel** · IA pela **Anthropic API** · dados de Ads pela **Windsor.ai**.

---

## O que vem pronto

- **Front `/cerebro.html`** — Mapa de Oportunidade (4,99M brasileiros no mundo, cálculo de
  crédito-alvo por país) + Cérebro IA com 4 modos: Pesquisa Mundial, Negociação (Porto Vale),
  Captação & Bens (veículos, embarcações, capital de giro) e Conteúdo 24h. Pesquisa a internet
  de verdade (web_search).
- **Front `/painel.html`** — Painel de Comando: orçamento e previsão de gasto por canal, funil
  de performance (CPL/CAC/ROAS) e relatório de execução diário.
- **`/api/brain`** — chama o Claude com a SUA chave (nunca exposta no front).
- **`/api/windsor`** — puxa gasto real de Ads (Meta/TikTok/Google) pelo Windsor.ai.
- **`/api/cron`** — o cérebro autônomo: roda todo dia, puxa os dados, gera o relatório e
  dispara pra um webhook (WhatsApp/Slack/e-mail).

---

## Passo a passo (deploy)

1. **Subir no GitHub**
   ```bash
   git init && git add . && git commit -m "prospere 360"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/prospere-360.git
   git push -u origin main
   ```

2. **Deploy no Vercel** — importe o repositório em vercel.com → New Project → Import.
   O Vercel detecta Next.js sozinho.

3. **Variáveis de ambiente** (Vercel → Project → Settings → Environment Variables).
   Veja `.env.example`:
   - `ANTHROPIC_API_KEY` — sua chave (console.anthropic.com). **Obrigatória.**
   - `WINDSOR_API_KEY` — sua chave do Windsor.ai (dados de Ads).
   - `NOTIFY_WEBHOOK` — URL que recebe o relatório diário (opcional).
   - `CRON_SECRET` — senha simples pra proteger o /api/cron (opcional).

4. **Pronto.** O front fica em `https://SEU-PROJETO.vercel.app`.

---

## Como ele fica AUTÔNOMO (24h)

O arquivo `vercel.json` agenda o cron:
```
{ "crons": [ { "path": "/api/cron", "schedule": "0 11 * * *" } ] }
```
`0 11 * * *` = 11:00 UTC ≈ **08:00 de Brasília**, todo dia. O Vercel chama `/api/cron`
sozinho, que puxa os dados, manda o cérebro montar o relatório e dispara pro seu webhook.
Para testar na mão: `https://SEU-PROJETO.vercel.app/api/cron?secret=SEU_CRON_SECRET`.

> Cron diário no Vercel exige plano que permita cron (Hobby = 1x/dia, suficiente aqui).

---

## Conectar os canais REAIS (Ads) no Windsor

Hoje, no seu Windsor, **só o Instagram** está conectado. Para puxar GASTO real, conecte:
- **Meta Ads** (Facebook/Instagram) — connector `facebook`
- **TikTok Ads** — connector `tiktok`
- **Google Ads** — connector `google_ads`

Faça login no painel do Windsor.ai e adicione esses conectores. Sem isso, o gasto de mídia
vem vazio (o cérebro avisa).

---

## Atalhos pra colocar crédito (você clica, você paga)

O sistema NUNCA move dinheiro sozinho. Quando um canal está estourando/baixo, ele aponta o
atalho — você entra e adiciona o crédito:
- **Meta (WhatsApp Oficial + Instagram/Meta Ads):** https://business.facebook.com/billing_hub/accounts
- **TikTok Ads:** https://ads.tiktok.com  → Finanças → Recarga
- **Google Ads:** https://ads.google.com  → Faturamento
- **Zaia:** https://endless.zaia.app  → uso/assinatura
- **ManyChat:** https://app.manychat.com  → Settings → Billing

---

## Rodar localmente

```bash
npm install
cp .env.example .env.local   # preencha as chaves
npm run dev                  # http://localhost:3000
```

## Abrir no Claude Code
Abra esta pasta no Claude Code e peça melhorias direto ("adicione X ao /api/cron",
"crie o /api/content", etc.). Ele edita, testa e faz deploy.

---

Grupo Prospere **by Âncora** · Cores: preto, branco, vermelho.
Compliance: consórcio é planejamento patrimonial / compra programada — nunca "investimento",
"investidor" ou "rendimento garantido"; nunca prometer contemplação.
