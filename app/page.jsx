export default function Home() {
  const wrap = { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, background: '#070709', color: '#f5f5f7', fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: 24 };
  const card = { display: 'block', padding: '18px 26px', borderRadius: 14, border: '1px solid #28282f', background: '#121216', color: '#fff', textDecoration: 'none', fontWeight: 700, minWidth: 280 };
  return (
    <main style={wrap}>
      <div style={{ fontSize: 13, letterSpacing: '.2em', textTransform: 'uppercase', color: '#8c8c95' }}>Grupo Prospere · by Âncora</div>
      <h1 style={{ fontSize: 40, margin: 0 }}>Prospere <span style={{ color: '#ff4651' }}>360</span></h1>
      <p style={{ color: '#8c8c95', maxWidth: 440, margin: '0 0 8px' }}>Cérebro de negócio: dados reais, pesquisa 24h e decisão sobre consórcio &amp; capital.</p>
      <a href="/cerebro.html" style={{ ...card, borderColor: '#D4111E' }}>🧠 Abrir o Cérebro 360</a>
      <a href="/painel.html" style={card}>📊 Abrir o Painel de Comando</a>
    </main>
  );
}
