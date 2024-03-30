
import { Header } from '@/app/components/Header';
import { Sidebar } from '@/app/components/Sidebar';
import { Footer } from "@/app/components/Footer";

import './globals.css';

import { Metadata } from 'next'
import React from 'react'

import { Providers } from './providers'

export const metadata: Metadata = {
    title: 'Selfie',
    description: 'Welcome to Selfie',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <Providers>
          {/*<div className="container mx-auto">*/}
            {/*<Header/>*/}
            {/*<div className="flex my-4">*/}
              {/*<Sidebar/>*/}
              {/*<main className="flex-1 p-4">*/}
                {children}
              {/*</main>*/}
            {/*</div>*/}
            {/*<Footer/>*/}
          {/*</div>*/}
        </Providers>
      </body>
    </html>
  );
}