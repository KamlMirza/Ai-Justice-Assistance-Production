import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

interface CourtRequest {
  caseType: 'Civil' | 'Criminal' | 'Family';
  city?: string;
  jurisdiction?: string;
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

    const { caseType, city, jurisdiction }: CourtRequest = await req.json();

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
      .eq('type', caseType);

    // Add city filter if provided
    if (city) {
      query = query.ilike('city', `%${city}%`); // Use ilike for case-insensitive partial match
    }

    const { data: courts, error } = await query.order('name');

    if (error) {
      console.error('Database error:', error);
      throw new Error(`Database query failed: ${error.message}`);
    }

    console.log(`Found ${courts?.length || 0} courts`);

    // If no courts found with city filter, try without it
    if ((!courts || courts.length === 0) && city) {
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

      if (fallbackCourts && fallbackCourts.length > 0) {
        return new Response(
          JSON.stringify({
            courts: fallbackCourts,
            message: `No courts found in ${city}. Showing ${fallbackCourts.length} ${caseType} court(s) from other locations.`
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
    if (!courts || courts.length === 0) {
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

    return new Response(
      JSON.stringify({
        courts: courts,
        message: `Found ${courts.length} ${caseType} court(s)${city ? ` in ${city}` : ''}`
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
