import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GROQ_API_KEY = Deno.env.get('Groq_API_KEY');
const GROQ_MODEL = Deno.env.get('Groq_MODEL') || 'llama-3.1-8b-instant';

interface ClassifyRequest {
  description: string;
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
    // Validate API key
    if (!GROQ_API_KEY) {
      throw new Error('Groq_API_KEY not configured');
    }

    const { description }: ClassifyRequest = await req.json();

    if (!description || description.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Case description is required' }),
        { 
          status: 400, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          } 
        }
      );
    }

    // Simplified classification prompt for better accuracy
    const prompt = `Classify this Pakistani legal case into ONE category: Civil, Criminal, or Family.

Case: ${description}

Categories:
- Civil: Property, contracts, debt, inheritance
- Criminal: Theft, assault, murder, fraud, violence
- Family: Marriage, divorce, custody, maintenance

Respond ONLY with valid JSON:
{"category":"Civil","confidence":0.95,"reasoning":"brief reason"}`;

    console.log('Calling Groq API...');

    const groqResponse = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 200
        })
      }
    );

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      console.error('Groq error:', errorText);
      throw new Error(`Groq API error: ${groqResponse.status}`);
    }

    const groqData = await groqResponse.json();
    
    if (!groqData.choices || groqData.choices.length === 0) {
      throw new Error('No response from AI model');
    }

    const responseText = groqData.choices[0].message.content;
    console.log('AI Response:', responseText);

    // Parse JSON response with better error handling
    let classification;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      classification = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Parse error:', parseError);
      // Fallback: try to extract category from text
      const categoryMatch = responseText.match(/(Civil|Criminal|Family)/i);
      if (categoryMatch) {
        classification = {
          category: categoryMatch[1],
          confidence: 0.7,
          reasoning: 'Extracted from text response'
        };
      } else {
        throw new Error('Failed to parse classification response');
      }
    }

    // Validate and normalize category
    const validCategories = ['Civil', 'Criminal', 'Family'];
    if (!classification.category || !validCategories.includes(classification.category)) {
      // Try case-insensitive match
      const normalized = validCategories.find(
        cat => cat.toLowerCase() === classification.category?.toLowerCase()
      );
      classification.category = normalized || 'Civil'; // Default fallback
    }

    // Ensure confidence is a number
    if (typeof classification.confidence !== 'number') {
      classification.confidence = 0.8;
    }

    // Ensure reasoning exists
    if (!classification.reasoning) {
      classification.reasoning = `Classified as ${classification.category} based on case description`;
    }

    console.log('Final classification:', classification);

    return new Response(
      JSON.stringify(classification),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=1800' // Cache for 30 minutes
        }
      }
    );

  } catch (error) {
    console.error('Classification error:', error);
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
