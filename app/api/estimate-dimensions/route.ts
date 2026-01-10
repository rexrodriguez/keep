import { NextRequest, NextResponse } from 'next/server';

export interface DimensionEstimate {
  width_cm: number;
  depth_cm: number;
  height_cm: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  objectDescription: string;
}

export interface EstimateRequest {
  image: string; // base64 encoded image
  provider?: 'openai' | 'deepseek';
}

export interface EstimateResponse {
  success: boolean;
  estimate?: DimensionEstimate;
  error?: string;
}

const DIMENSION_PROMPT = `You are analyzing an image to estimate the dimensions of an object for storage purposes.

Look at the main object in the image and estimate its approximate dimensions in centimeters.

Respond ONLY with a JSON object in this exact format (no markdown, no explanation):
{
  "width_cm": <number>,
  "depth_cm": <number>,
  "height_cm": <number>,
  "confidence": "<HIGH|MEDIUM|LOW>",
  "objectDescription": "<brief description of what you see>"
}

Guidelines:
- Width is the left-right dimension
- Depth is the front-back dimension
- Height is the top-bottom dimension
- Use realistic estimates based on common object sizes
- If you see reference objects (people, furniture, doors), use them for scale
- Set confidence to LOW if the object is hard to identify or scale is unclear
- Set confidence to MEDIUM if you can estimate but with some uncertainty
- Set confidence to HIGH if the object is clearly identifiable with good scale reference

If you cannot identify any object or estimate dimensions, respond with:
{"width_cm": 50, "depth_cm": 50, "height_cm": 50, "confidence": "LOW", "objectDescription": "Unable to identify object"}`;

async function callOpenAI(image: string): Promise<DimensionEstimate> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: DIMENSION_PROMPT },
            {
              type: 'image_url',
              image_url: {
                url: image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 300,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('No response from OpenAI');
  }

  return parseResponse(content);
}

async function callDeepSeek(image: string): Promise<DimensionEstimate> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY not configured');
  }

  // DeepSeek uses OpenAI-compatible API
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: DIMENSION_PROMPT },
            {
              type: 'image_url',
              image_url: {
                url: image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 300,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepSeek API error: ${error}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('No response from DeepSeek');
  }

  return parseResponse(content);
}

function parseResponse(content: string): DimensionEstimate {
  // Try to extract JSON from the response
  let jsonStr = content.trim();

  // Handle markdown code blocks
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  // Try to find JSON object in the response
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // Validate and sanitize the response
    const estimate: DimensionEstimate = {
      width_cm: Math.max(1, Math.min(1000, Number(parsed.width_cm) || 50)),
      depth_cm: Math.max(1, Math.min(1000, Number(parsed.depth_cm) || 50)),
      height_cm: Math.max(1, Math.min(1000, Number(parsed.height_cm) || 50)),
      confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(parsed.confidence)
        ? parsed.confidence
        : 'LOW',
      objectDescription: String(parsed.objectDescription || 'Unknown object').slice(0, 200),
    };

    return estimate;
  } catch (e) {
    console.error('Failed to parse LLM response:', content);
    throw new Error('Failed to parse dimension estimate from LLM response');
  }
}

// Determine which provider to use based on available API keys
function getDefaultProvider(): 'openai' | 'deepseek' {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;

  // Prefer DeepSeek if only that key is available
  if (hasDeepSeek && !hasOpenAI) {
    return 'deepseek';
  }
  // Default to OpenAI if available, or DeepSeek as fallback
  if (hasOpenAI) {
    return 'openai';
  }
  return 'deepseek';
}

export async function POST(request: NextRequest): Promise<NextResponse<EstimateResponse>> {
  try {
    const body: EstimateRequest = await request.json();
    const { image, provider } = body;

    // Auto-detect provider if not specified
    const selectedProvider = provider || getDefaultProvider();

    if (!image) {
      return NextResponse.json(
        { success: false, error: 'No image provided' },
        { status: 400 }
      );
    }

    // Check if we have any API key configured
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;

    if (!hasOpenAI && !hasDeepSeek) {
      return NextResponse.json(
        { success: false, error: 'No LLM API key configured. Add OPENAI_API_KEY or DEEPSEEK_API_KEY to .env' },
        { status: 500 }
      );
    }

    let estimate: DimensionEstimate;

    if (selectedProvider === 'deepseek') {
      estimate = await callDeepSeek(image);
    } else {
      estimate = await callOpenAI(image);
    }

    return NextResponse.json({ success: true, estimate });
  } catch (error) {
    console.error('Dimension estimation error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
