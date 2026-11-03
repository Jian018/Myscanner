import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '纸间 · AI Smart Scanner', description: '本地优先的智能扫描工作台' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
