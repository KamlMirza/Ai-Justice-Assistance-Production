import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GROQ_API_KEY = Deno.env.get('Groq_API_KEY');
// Defaulting to the powerful vision model, allowing override via env
const VISION_MODEL = Deno.env.get('GROQ_VISION_MODEL') || 'qwen/qwen3.6-27b';

interface VisionRequest {
  image: string; // Base64 encoded image
  mimeType?: string;
}

Deno.serve(async (req: Request) => {
  // CORS headers
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    });
  }

  try {
    if (!GROQ_API_KEY) {
      throw new Error('Groq_API_KEY not configured');
    }

    const { image, mimeType = 'image/jpeg' }: VisionRequest = await req.json();

    if (!image) {
      return new Response(
        JSON.stringify({ error: 'Image (base64) is required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    console.log(`Sending image to Groq API using model: ${VISION_MODEL}`);

    const prompt = `You are a highly accurate Optical Character Recognition (OCR) system. 
Please transcribe all the text you can read in this image. 
The image may contain English, Urdu, or a mix of both. 
If it is a legal document like an FIR, transcribe it as accurately as possible.
Return ONLY the transcribed text, with no introductory or concluding remarks.`;

    const groqResponse = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: VISION_MODEL,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${image}`
                  }
                }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 1024
        })
      }
    );

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      console.error('Groq API Error:', errorText);
      throw new Error(`Groq API returned ${groqResponse.status}: ${errorText}`);
    }

    const groqData = await groqResponse.json();
    const extractedText = groqData.choices[0]?.message?.content || '';

    console.log(`Extracted text length: ${extractedText.length}`);

    return new Response(
      JSON.stringify({ text: extractedText.trim() }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );

  } catch (error: any) {
    console.error('Vision OCR error:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Internal server error',
        details: error.toString()
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
});
