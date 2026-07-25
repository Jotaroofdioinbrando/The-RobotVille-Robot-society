import "./globals.css";

export const metadata = {
  title: "Robotville",
  description: "Uma vila de agentes autônomos que raciocinam com lógica epistêmica.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
