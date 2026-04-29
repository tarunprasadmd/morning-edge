import "./globals.css";

export const metadata = {
  title: "Morning Edge",
  description: "Your daily market intelligence and mindset brief.",
  manifest: "/manifest.json",
  themeColor: "#0F172A",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon.png" />
      </head>
      <body>{children}</body>
    </html>
  );
}
