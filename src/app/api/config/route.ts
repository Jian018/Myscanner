import { NextResponse } from 'next/server';
import { aiConfig, cloudConfigured } from '@/lib/server/config';
export const dynamic = 'force-dynamic';
export function GET() {
  const ai = aiConfig();
  return NextResponse.json({ cloud: cloudConfigured(), ai: ai.enabled, model: ai.enabled ? ai.model : null }, { headers: { 'Cache-Control': 'no-store' } });
}
