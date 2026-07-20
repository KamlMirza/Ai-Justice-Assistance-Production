import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GROQ_API_KEY = Deno.env.get('Groq_API_KEY');
const GROQ_MODEL = Deno.env.get('Groq_MODEL') || 'llama-3.3-70b-versatile';

interface ClassifyRequest {
  description: string;
}

// Enhanced keywords for pre-check
const CRIMINAL_KEYWORDS = [
  'theft', 'steal', 'stolen', 'stealing', 'snatch', 'snatching', 'snatched',
  'rob', 'robbery', 'robbed', 'mugging', 'mugged', 'dacoity',
  'murder', 'kill', 'killed', 'killing', 'homicide', 'qatl', 'dafa 302', 'section 302',
  'assault', 'attack', 'attacked', 'beating', 'beaten', 'hurt', 'injury', 'injured',
  'fraud', 'cheat', 'cheated', 'cheating', 'scam', 'scammed', 'forgery',
  'rape', 'sexual assault', 'molestation',
  'extortion', 'blackmail', 'blackmailed', 'threaten', 'threatened',
  'bail', 'fir', 'police', 'arrest', 'criminal', 'crime', 'illegal',
  'kidnap', 'abduction', 'trafficking', 'smuggling',
  'drug', 'narcotics', 'weapon', 'gun', 'firearm',
  'bomb', 'dhamaka', 'blast', 'terrorism', 'terrorist', 'target kill'
];

const CIVIL_KEYWORDS = [
  'property', 'land', 'plot', 'house', 'building', 'estate', 'real estate',
  'contract', 'agreement', 'breach', 'terms', 'lease', 'rent', 'tenant', 'landlord',
  'debt', 'loan', 'money', 'payment', 'due', 'recovery',
  'inheritance', 'succession', 'will', 'heir', 'heirs', 'waaris',
  'civil', 'dispute', 'damage', 'compensation', 'tort',
  'company', 'business', 'partnership', 'corporation'
];

const FAMILY_KEYWORDS = [
  'divorce', 'talaq', 'khula', 'separation', 'dissolution',
  'marriage', 'nikah', 'wedding', 'spouse', 'husband', 'wife',
  'custody', 'child custody', 'guardianship', 'access', 'visitation',
  'maintenance', 'alimony', 'support', 'upkeep',
  'dowry', 'haq mehr', 'mahr',
  'family', 'domestic', 'domestic violence', 'inheritance'
];

const quickClassify = (text: string): { category: string; confidence: number; reasoning: string } | null => {
  const lower = text.toLowerCase();

  const criminalScore = CRIMINAL_KEYWORDS.filter(k => lower.includes(k)).length;
  const civilScore = CIVIL_KEYWORDS.filter(k => lower.includes(k)).length;
  const familyScore = FAMILY_KEYWORDS.filter(k => lower.includes(k)).length;

  const total = criminalScore + civilScore + familyScore;
  if (total === 0) return null;

  if (criminalScore >= civilScore && criminalScore >= familyScore) {
    return {
      category: 'Criminal',
      confidence: Math.min(0.7 + (criminalScore * 0.05), 0.95),
      reasoning: 'The described incident involves elements that fall under criminal law.'
    };
  }

  if (civilScore >= criminalScore && civilScore >= familyScore) {
    return {
      category: 'Civil',
      confidence: Math.min(0.7 + (civilScore * 0.05), 0.95),
      reasoning: 'The described incident involves civil matters such as property, contracts, or financial disputes.'
    };
  }

  return {
    category: 'Family',
    confidence: Math.min(0.7 + (familyScore * 0.05), 0.95),
    reasoning: 'The described incident involves family law matters such as marriage, divorce, or custody.'
  };
};

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

    // Quick keyword-based classification first (faster, no API call needed for obvious cases)
    const quickResult = quickClassify(description);
    if (quickResult && quickResult.confidence >= 0.85) {
      console.log('Quick classification:', quickResult);
      return new Response(
        JSON.stringify(quickResult),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=1800'
          }
        }
      );
    }

    // Fallback to Groq for ambiguous cases
    const prompt = `Classify this Pakistani legal case into ONE category: Civil, Criminal, or Family.

Case: ${description}

Categories:
- Civil: Property disputes, contracts, debt, inheritance, landlord-tenant, business disputes
- Criminal: Theft, robbery, assault, murder, fraud, rape, extortion, bail, FIR, police matters, mobile snatching, pickpocketing, terrorism, bomb blast, attack, any crime
- Family: Marriage, divorce, custody, maintenance, dowry, domestic issues

Respond ONLY with valid JSON:
{"category":"Criminal","confidence":0.95,"reasoning":"brief reason"}`;

    console.log('Calling Groq API for classification...');

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