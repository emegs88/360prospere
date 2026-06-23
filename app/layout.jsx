export const metadata = {
  title: 'Prospere 360 — Cérebro de Negócio',
  description: 'Consórcio & Capital · by Âncora',
};
export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, background: '#070709' }}>{children}</body>
    </html>
  );
}
