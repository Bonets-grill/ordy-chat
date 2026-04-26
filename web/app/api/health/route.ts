import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROCESS_START = Date.now();

export async function GET() {
  const startedAt = Date.now();

  let dbStatus: 'ok' | 'error' = 'ok';
  let dbLatencyMs: number | null = null;
  let dbError: string | null = null;

  try {
    const url = process.env.DATABASE_URL;
    if (!url) {
      dbStatus = 'error';
      dbError = 'DATABASE_URL not set';
    } else {
      const sql = neon(url);
      const t0 = Date.now();
      await sql`SELECT 1 AS ping`;
      dbLatencyMs = Date.now() - t0;
    }
  } catch (err) {
    dbStatus = 'error';
    dbError = err instanceof Error ? err.message : String(err);
  }

  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.GIT_SHA ||
    'unknown';

  const payload = {
    service: 'ordy-chat-web',
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    commit: sha === 'unknown' ? sha : sha.slice(0, 12),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    uptime_ms: Date.now() - PROCESS_START,
    db: {
      status: dbStatus,
      latency_ms: dbLatencyMs,
      error: dbError,
    },
    response_ms: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(payload, {
    status: dbStatus === 'ok' ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'CDN-Cache-Control': 'no-store',
    },
  });
}
