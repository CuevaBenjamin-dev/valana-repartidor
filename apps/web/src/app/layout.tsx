import type { Metadata } from 'next';
import './globals.css';
import './boston.css';
export const metadata:Metadata={title:'Boston Bilingual School · Valana',description:'Panel comercial de Boston Bilingual School'};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="es"><body>{children}</body></html>}
