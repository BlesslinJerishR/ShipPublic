import './globals.css';
import type { Metadata } from 'next';
import { ThemeProvider } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'Shipublic',
  description: 'Turn your commits into build in public posts. Locally.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
