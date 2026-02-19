import { NextRequest, NextResponse } from 'next/server';

export interface DimensionEstimate {
  width_cm: number;
  depth_cm: number;
  height_cm: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  objectDescription: string;
}

export interface EstimateResponse {
  success: boolean;
  estimate?: DimensionEstimate;
  error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<EstimateResponse>> {
  const SHARP_SERVER_URL = process.env.SHARP_SERVER_URL;

  if (!SHARP_SERVER_URL) {
    return NextResponse.json(
      { success: false, error: 'SHARP_SERVER_URL not configured' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();

    const response = await fetch(`${SHARP_SERVER_URL}/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.ok ? 200 : 502 });
  } catch (error) {
    console.error('Dimension estimation proxy error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 502 }
    );
  }
}
