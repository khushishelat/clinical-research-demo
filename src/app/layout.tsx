import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import { Logo } from '@/components/ui';
import { Typeahead } from '@/components/Typeahead';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Trial Check',
  description:
    'Every active trial a biotech runs, partners on or collaborates on, checked against its own news, filings and papers, with registry lags flagged. Built on Parallel Data Connectors for ClinicalTrials.gov, PubMed and ChEMBL.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="min-h-screen">
        <header className="sticky top-0 z-30 border-b border-line bg-page/95 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-4 px-4 sm:px-8">
            <Link href="/" className="flex items-center gap-4" aria-label="Trial Check home">
              <Logo />
              <span className="hidden h-6 w-px bg-line sm:block" />
              <span className="hidden font-mono text-[13px] tracking-[0.08em] sm:block">TRIAL CHECK</span>
            </Link>
            <div className="ml-auto w-full max-w-[320px]">
              <Typeahead compact />
            </div>
          </div>
        </header>
        <div className="bracket mx-auto max-w-[1280px] px-4 sm:px-8">{children}</div>
      </body>
    </html>
  );
}
