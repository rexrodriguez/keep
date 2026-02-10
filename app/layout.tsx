import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Keep - Measure Anything. Store Everything.',
  description: 'Point your phone at any object to instantly measure its dimensions and find the perfect storage unit nearby.',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.png',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Keep - Measure Anything. Store Everything.',
    description: 'Point your phone at any object to instantly measure its dimensions and find the perfect storage unit nearby.',
    url: 'https://keep.storage',
    siteName: 'Keep',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Keep - Measure Anything. Store Everything.',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Keep - Measure Anything. Store Everything.',
    description: 'Point your phone at any object to instantly measure its dimensions and find the perfect storage unit nearby.',
    images: ['/og-image.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="screen-orientation" content="portrait" />
      </head>
      <body className="bg-gray-900 text-white antialiased">
        {children}
      </body>
    </html>
  );
}
