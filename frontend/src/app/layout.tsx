import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/lib/theme';
import HireBanner from '@/components/HireBanner';

export const metadata: Metadata = {
  title: 'Shipublic',
  description: 'Turn your commits into build in public posts. Locally.',
};

export const viewport: Viewport = {
  themeColor: '#0a0a0b',
};

// Runs before React hydrates so we never paint with the wrong theme and
// avoid an additional ThemeProvider render on mount.
const themeBootstrap = `(()=>{try{var t=localStorage.getItem('shipublic.theme');document.documentElement.dataset.theme=(t==='light'||t==='dark')?t:'dark';}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <ThemeProvider>
          <HireBanner />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
