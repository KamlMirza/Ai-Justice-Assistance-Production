import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

interface CourtRequest {
  caseType: 'Civil' | 'Criminal' | 'Family';
  city?: string;
  jurisdiction?: string;
  description?: string;
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
    // Validate environment variables
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase configuration missing');
    }

    const { caseType, city, jurisdiction, description }: CourtRequest = await req.json();

    if (!caseType) {
      return new Response(
        JSON.stringify({ error: 'Case type is required' }),
        { 
          status: 400, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          } 
        }
      );
    }

    // Validate caseType
    const validTypes = ['Civil', 'Criminal', 'Family'];
    if (!validTypes.includes(caseType)) {
      return new Response(
        JSON.stringify({ error: `Invalid case type. Must be one of: ${validTypes.join(', ')}` }),
        { 
          status: 400, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          } 
        }
      );
    }

    console.log(`Searching courts for: ${caseType}, city: ${city || 'any'}`);

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Build query - try exact match first
    let query = supabase
      .from('courts')
      .select('*')
      .or(`type.eq.${caseType},jurisdiction.ilike.%${caseType}%`);

    // Add city filter if provided
    if (city) {
      query = query.ilike('city', `%${city}%`); // Use ilike for case-insensitive partial match
    }

    const { data: courts, error } = await query.order('name');

    if (error) {
      console.error('Database error:', error);
      throw new Error(`Database query failed: ${error.message}`);
    }

    const strictCourts = (courts || []).filter((court: any) => {
      const courtType = String(court?.type || '').trim().toLowerCase();
      const jurisdiction = String(court?.jurisdiction || '').toLowerCase();
      return courtType === caseType.toLowerCase() || jurisdiction.includes(caseType.toLowerCase());
    });

    const normalizedDescription = String(description || '').toLowerCase();
    
    const isTerrorismCase =
      caseType === 'Criminal' &&
      /(terror|kidnap|ransom|sectarian|target kill|bomb|explosive|extortion|bhatta|attack|firing|hamla|shaheed|check post)/i.test(normalizedDescription);

    const isSmallTheftCase =
      caseType === 'Criminal' &&
      /(snatch|snatching|mobile theft|cell phone|phone theft|mobile chori|mobile|phone|theft|steal|stolen|chori)/i.test(normalizedDescription) &&
      !/(terror|kidnap|ransom|sectarian|dacoity|robbery|gang|armed|gun|weapon|murder|kill)/i.test(normalizedDescription);

    let guidance: string | undefined = undefined;
    if (caseType === 'Criminal' && !isTerrorismCase && /(mobile|theft|snatch|chori|steal|stolen|gun|robbery)/i.test(normalizedDescription)) {
      guidance = "Note: Anti-Terrorism Courts (ATC) only handle terrorism-related cases. They do not handle theft, snatching, or regular criminal cases. For your case, you need to file a report at your local police station, and it will be heard in a regular District or Magistrate court.";
    }

    const rankAndFilterCourts = (courtsList: any[]) => {
      return courtsList
        .map((court: any) => {
          const name = String(court?.name || '').toLowerCase();
          const jurisdictionText = String(court?.jurisdiction || '').toLowerCase();
          const courtText = `${name} ${jurisdictionText}`;

          let rank = 0;

          if (isTerrorismCase) {
             if (courtText.includes('anti-terrorism') || courtText.includes('atc')) rank += 100;
             if (courtText.includes('sessions')) rank += 20;
          } else if (isSmallTheftCase) {
             if (courtText.includes('district and sessions')) rank += 100;
             if (courtText.includes('district sessions')) rank += 100;
             if (courtText.includes('sessions court')) rank += 90;
             if (courtText.includes('district court')) rank += 80;
             if (courtText.includes('magistrate')) rank += 70;
             if (courtText.includes('anti-terrorism') || courtText.includes('atc')) rank -= 1000;
          } else {
             if (courtText.includes('sessions')) rank += 60;
             if (courtText.includes('district')) rank += 50;
             if (courtText.includes('anti-terrorism') || courtText.includes('atc')) rank -= 1000;
          }

          return { court, rank };
        })
        .filter(({ court, rank }: any) => rank > -500)
        .sort((a: any, b: any) => b.rank - a.rank)
        .map(({ court }: any) => court);
    };

    const rankedCourts = rankAndFilterCourts(strictCourts);

    console.log(`Found ${strictCourts.length} strictly-matched courts`);

    // If no courts found with city filter, try without it
    if (rankedCourts.length === 0 && city) {
      console.log('No courts found with city filter, trying without...');
      const { data: fallbackCourts, error: fallbackError } = await supabase
        .from('courts')
        .select('*')
        .eq('type', caseType)
        .order('name')
        .limit(10);

      if (fallbackError) {
        console.error('Fallback query error:', fallbackError);
      }

      const strictFallbackCourts = (fallbackCourts || []).filter((court: any) => {
        const courtType = String(court?.type || '').trim().toLowerCase();
        return courtType === caseType.toLowerCase();
      });

      const rankedFallbackCourts = rankAndFilterCourts(strictFallbackCourts);

      if (rankedFallbackCourts.length > 0) {
        return new Response(
          JSON.stringify({
            courts: rankedFallbackCourts,
            message: `No courts found in ${city}. Showing ${rankedFallbackCourts.length} ${caseType} court(s) from other locations.`,
            guidance
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
            }
          }
        );
      }
    }

    // Return results
    if (rankedCourts.length === 0) {
      return new Response(
        JSON.stringify({
          courts: [],
          message: `No ${caseType} courts found. Please try a different case type or contact support.`
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    // Removed duplicate guidance logic

    return new Response(
      JSON.stringify({
        courts: rankedCourts,
        message: `Found ${rankedCourts.length} ${caseType} court(s)${city ? ` in ${city}` : ''}`,
        guidance
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
        }
      }
    );

  } catch (error) {
    console.error('Court recommendation error:', error);
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
