import { NextResponse } from 'next/server';

export interface ConfigResponse {
  hasOpenAIKey: boolean;
}

export async function GET(): Promise<NextResponse<ConfigResponse>> {
  return NextResponse.json({
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
  });
}
