import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

interface LawyerRequest {
  caseType: 'Civil' | 'Criminal' | 'Family';
  city?: string;
  minExperience?: number;
  minRating?: number;
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

    const { caseType, city, minExperience = 0, minRating = 0 }: LawyerRequest = await req.json();

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

    console.log(`Searching lawyers for: ${caseType}, city: ${city || 'any'}, minExp: ${minExperience}, minRating: ${minRating}`);

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Convert case type to lowercase to match database
    const caseTypeLower = caseType.toLowerCase();

    // Build query - lawyers with matching specialization
    let query = supabase
      .from('lawyers')
      .select('*')
      .contains('specialization', [caseTypeLower])
      .gte('experience_years', minExperience)
      .gte('rating', minRating)
      .order('rating', { ascending: false })
      .order('experience_years', { ascending: false })
      .limit(15);

    // Add city filter if provided (case-insensitive partial match)
    if (city) {
      query = query.ilike('city', `%${city}%`);
    }

    const { data: lawyers, error } = await query;

    if (error) {
      console.error('Database error:', error);
      throw new Error(`Database query failed: ${error.message}`);
    }

    console.log(`Found ${lawyers?.length || 0} lawyers`);

    // Calculate match score for each lawyer
    const scoredLawyers = lawyers?.map(lawyer => {
      let score = 0;
      
      // Rating weight (40%)
      score += (parseFloat(lawyer.rating) / 5) * 40;
      
      // Experience weight (30%)
      score += Math.min(lawyer.experience_years / 20, 1) * 30;
      
      // Success rate weight (20%)
      if (lawyer.success_rate) {
        score += (lawyer.success_rate / 100) * 20;
      }
      
      // Total cases weight (10%)
      if (lawyer.total_cases) {
        score += Math.min(lawyer.total_cases / 100, 1) * 10;
      }
      
      return {
        ...lawyer,
        match_score: Math.round(score)
      };
    }).sort((a, b) => b.match_score - a.match_score);

    // If no lawyers found with city filter, try without it
    if ((!scoredLawyers || scoredLawyers.length === 0) && city) {
      console.log('No lawyers found with city filter, trying without...');
      const { data: fallbackLawyers, error: fallbackError } = await supabase
        .from('lawyers')
        .select('*')
        .contains('specialization', [caseTypeLower])
        .gte('experience_years', Math.max(minExperience - 2, 0)) // Relax experience requirement
        .gte('rating', Math.max(minRating - 0.5, 0)) // Relax rating requirement
        .order('rating', { ascending: false })
        .limit(10);

      if (fallbackError) {
        console.error('Fallback query error:', fallbackError);
      }

      if (fallbackLawyers && fallbackLawyers.length > 0) {
        const fallbackScored = fallbackLawyers.map(lawyer => {
          let score = 0;
          score += (parseFloat(lawyer.rating) / 5) * 40;
          score += Math.min(lawyer.experience_years / 20, 1) * 30;
          if (lawyer.success_rate) score += (lawyer.success_rate / 100) * 20;
          if (lawyer.total_cases) score += Math.min(lawyer.total_cases / 100, 1) * 10;
          return { ...lawyer, match_score: Math.round(score) };
        }).sort((a, b) => b.match_score - a.match_score);

        return new Response(
          JSON.stringify({
            lawyers: fallbackScored,
            platformLawyers: fallbackScored.filter(l => l.is_platform_lawyer),
            networkLawyers: fallbackScored.filter(l => !l.is_platform_lawyer),
            message: `No lawyers found in ${city}. Showing ${fallbackScored.length} ${caseType} lawyer(s) from other locations.`
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
    if (!scoredLawyers || scoredLawyers.length === 0) {
      return new Response(
        JSON.stringify({
          lawyers: [],
          message: `No ${caseType} lawyers found matching your criteria. Try adjusting your filters.`
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
        lawyers: scoredLawyers,
        platformLawyers: scoredLawyers.filter(l => l.is_platform_lawyer),
        networkLawyers: scoredLawyers.filter(l => !l.is_platform_lawyer),
        message: `Found ${scoredLawyers.length} ${caseType} lawyer(s)${city ? ` in ${city}` : ''}`
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
    console.error('Lawyer recommendation error:', error);
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
