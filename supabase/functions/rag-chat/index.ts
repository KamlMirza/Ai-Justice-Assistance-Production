import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const GROQ_API_KEY = Deno.env.get('Groq_API_KEY');
const GROQ_MODEL = Deno.env.get('Groq_MODEL') || 'llama-3.1-8b-instant';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

interface ChatRequest {
  message: string;
  extractedDocumentText?: string;
  hasAttachment?: boolean;
  attachmentName?: string;
  attachmentType?: string;
  sessionId?: string;
  userId?: string;
  stage?: number;
  caseCategory?: string;
}

const DOMAIN_CATEGORIES = ['Civil', 'Criminal', 'Family'];

const DOMAIN_KEYWORDS = [
  'pakistan', 'pakistani', 'law', 'legal', 'court', 'judge', 'advocate', 'lawyer', 'fir',
  'civil', 'criminal', 'family', 'divorce', 'custody', 'maintenance', 'inheritance', 'property',
  'contract', 'agreement', 'lease', 'rent', 'fraud', 'theft', 'assault', 'murder', 'bail',
  'evidence', 'police', 'complaint', 'rights', 'petition', 'suit', 'khula', 'talaq'
];

const normalizeCategory = (value?: string): string | null => {
  if (!value) return null;
  const normalized = DOMAIN_CATEGORIES.find(
    (category) => category.toLowerCase() === value.toLowerCase()
  );
  return normalized || null;
};

const looksLegalByKeyword = (text: string) => {
  const lower = text.toLowerCase();
  return DOMAIN_KEYWORDS.some((keyword) => lower.includes(keyword));
};

const isDomainRelevant = async (text: string, providedCategory?: string) => {
  const normalizedProvided = normalizeCategory(providedCategory);
  if (normalizedProvided) {
    return { inDomain: true, category: normalizedProvided, confidence: 0.99, reason: 'provided-category' };
  }

  if (looksLegalByKeyword(text)) {
    return { inDomain: true, category: null, confidence: 0.8, reason: 'keyword-match' };
  }

  if (!GROQ_API_KEY) {
    return { inDomain: false, category: null, confidence: 0.5, reason: 'no-model-fallback' };
  }

  const prompt = `Determine whether this text is a Pakistani legal matter in Civil, Criminal, or Family domain.

Text:
${text.slice(0, 3500)}

Reply ONLY JSON:
{"inDomain":true,"category":"Civil","confidence":0.9,"reason":"short reason"}

Rules:
- inDomain=false for general chit-chat, technology, business, coding, health, finance, travel, education, or any non-legal topic.
- category must be one of Civil, Criminal, Family when inDomain=true.
- If unclear, set inDomain=false.`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 180
    })
  });

  if (!response.ok) {
    return { inDomain: false, category: null, confidence: 0.5, reason: 'classifier-request-failed' };
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || '';
  const match = content.match(/\{[\s\S]*\}/);

  if (!match) {
    return { inDomain: false, category: null, confidence: 0.5, reason: 'classifier-parse-failed' };
  }

  try {
    const parsed = JSON.parse(match[0]);
    const normalizedCategory = normalizeCategory(parsed?.category);
    return {
      inDomain: Boolean(parsed?.inDomain) && Boolean(normalizedCategory),
      category: normalizedCategory,
      confidence: Number(parsed?.confidence || 0.5),
      reason: parsed?.reason || 'classifier-result'
    };
  } catch {
    return { inDomain: false, category: null, confidence: 0.5, reason: 'classifier-json-invalid' };
  }
};

// Stage-specific system prompts
const getSystemPrompt = (
  stage: number,
  caseCategory: string | undefined,
  context: string,
  extractedDocumentText?: string,
  hasAttachment?: boolean
) => {
  const baseRules = `You are an AI Legal Assistant for Pakistani law. Provide clear, simple guidance.

IMPORTANT FORMATTING RULES:
- Write in plain, simple language
- Keep responses SHORT (maximum 7-8 lines)
- Use simple bullet points with - (dash) only
- NO special characters like **, ##, ***, etc.
- NO markdown formatting
- Direct and to the point
- Focus on actionable steps only

Context from Pakistani Legal Documents:
${context}

Uploaded Document Context:
${hasAttachment ? (extractedDocumentText || 'Attachment provided but no readable text extracted.') : 'No attachment provided.'}`;

  switch (stage) {
    case 1:
      return `${baseRules}

STAGE 1: CASE PROBLEM ANALYSIS
Your role: Provide brief initial guidance (7-8 lines maximum).

Instructions:
- Identify the legal issue in 1-2 sentences
- Mention which category (Civil, Criminal, or Family)
- Give 3-4 immediate action steps
- Keep it simple and direct
- NO lengthy explanations
- NO special formatting characters`;

    case 2:
      return `${baseRules}

STAGE 2: COURT INFORMATION
Case Category: ${caseCategory || 'Not specified'}
Your role: Answer court questions briefly (7-8 lines maximum).

Instructions:
- Answer the specific question asked
- Keep responses short and practical
- Focus on what user needs to do
- NO lengthy legal explanations
- Simple language only`;

    case 3:
      return `${baseRules}

STAGE 3: LAWYER GUIDANCE
Case Category: ${caseCategory || 'Not specified'}
Your role: Answer lawyer questions briefly (7-8 lines maximum).

Instructions:
- Answer the specific question asked
- Keep responses short and practical
- Focus on what to look for in a lawyer
- NO lengthy explanations
- Simple language only`;

    default:
      return baseRules;
  }
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
    const {
      message,
      extractedDocumentText,
      hasAttachment,
      attachmentName,
      attachmentType,
      sessionId,
      userId,
      stage = 1,
      caseCategory
    }: ChatRequest = await req.json();

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const combinedInput = [message, extractedDocumentText || ''].join('\n').trim();
    const domainVerdict = await isDomainRelevant(combinedInput, caseCategory);

    if (!domainVerdict.inDomain) {
      const rejection = hasAttachment
        ? 'I reviewed your uploaded file, but it does not appear to be a Pakistani Civil, Criminal, or Family legal matter. Please upload/share a relevant legal case document or ask a legal question in this domain.'
        : 'I can only help with Pakistani Civil, Criminal, and Family legal matters. Please ask a question in this domain.';

      if (sessionId && userId) {
        await supabase.from('chat_messages').insert([
          {
            session_id: sessionId,
            role: 'assistant',
            content: rejection,
            metadata: {
              stage,
              domainRejected: true,
              attachmentName: attachmentName || null,
              attachmentType: attachmentType || null,
              domainReason: domainVerdict.reason
            }
          }
        ]);
      }

      return new Response(
        JSON.stringify({
          response: rejection,
          outOfDomain: true,
          stage
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    const effectiveCategory = normalizeCategory(caseCategory) || domainVerdict.category || caseCategory;

    // Step 1: Search for relevant documents using keyword search
    const searchTerms = combinedInput.toLowerCase().split(' ').filter(term => term.length > 3);
    
    // Keywords that indicate criminal cases - EXPANDED
    const criminalKeywords = ['theft', 'steal', 'snatch', 'snatching', 'mobile', 'phone', 'rob', 'robbery', 'murder', 'assault', 'crime', 'criminal', 'police', 'fir', 'arrest', 'kidnap', 'rape', 'fraud', 'cheat', 'threat', 'extortion', 'blackmail'];
    const civilKeywords = ['property', 'contract', 'debt', 'dispute', 'inheritance', 'land', 'agreement', 'lease', 'rent', 'sale', 'purchase'];
    const familyKeywords = ['divorce', 'marriage', 'custody', 'maintenance', 'family', 'wife', 'husband', 'child', 'khula', 'talaq', 'dowry'];
    
    // Determine likely category from message
    let likelyCategory = effectiveCategory;
    if (!likelyCategory) {
      const messageLower = combinedInput.toLowerCase();
      if (criminalKeywords.some(kw => messageLower.includes(kw))) {
        likelyCategory = 'Criminal';
      } else if (familyKeywords.some(kw => messageLower.includes(kw))) {
        likelyCategory = 'Family';
      } else if (civilKeywords.some(kw => messageLower.includes(kw))) {
        likelyCategory = 'Civil';
      }
    }
    
    let query = supabase
      .from('legal_documents')
      .select('id, title, category, source_file, content, metadata');

    // Filter by category if detected or provided
    if (likelyCategory) {
      query = query.eq('category', likelyCategory);
    }

    // Search for documents containing key terms (try multiple terms)
    if (searchTerms.length > 0) {
      // Try first term
      const searchPattern = `%${searchTerms[0]}%`;
      query = query.ilike('content', searchPattern);
    }

    let { data: documents, error: searchError } = await query.limit(3);
    
    // If no results, try broader search without category filter
    if ((!documents || documents.length === 0) && likelyCategory) {
      query = supabase
        .from('legal_documents')
        .select('id, title, category, source_file, content, metadata');
      
      if (searchTerms.length > 0) {
        const searchPattern = `%${searchTerms[0]}%`;
        query = query.ilike('content', searchPattern);
      }
      
      const result = await query.limit(3);
      documents = result.data;
      searchError = result.error;
    }

    if (searchError) {
      console.error('Search error:', searchError);
      throw searchError;
    }

    // Step 2: Build context from retrieved documents (shorter)
    const context = documents && documents.length > 0
      ? documents.map((doc: any) => 
          `[${doc.title}]\n${doc.content.substring(0, 800)}`
        ).join('\n\n')
      : 'No specific legal documents found. Provide general Pakistani legal guidance.';

    // Step 3: Get stage-specific system prompt
    const systemPrompt = getSystemPrompt(stage, effectiveCategory || undefined, context, extractedDocumentText, hasAttachment);

    // Step 4: Generate response using Groq
    if (!GROQ_API_KEY) {
      throw new Error('Groq_API_KEY not configured');
    }

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
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: message
            }
          ],
          temperature: 0.2,
          max_tokens: 400
        })
      }
    );

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      throw new Error(`Groq API error: ${groqResponse.status} - ${errorText}`);
    }

    const groqData = await groqResponse.json();
    
    if (!groqData.choices || groqData.choices.length === 0) {
      throw new Error('No response from Groq API');
    }

    const assistantMessage = groqData.choices[0].message.content;

    // Step 5: Store conversation in database (if sessionId provided)
    if (sessionId && userId) {
      await supabase.from('chat_messages').insert([
        {
          session_id: sessionId,
          role: 'assistant',
          content: assistantMessage,
          metadata: {
            stage: stage,
            category: effectiveCategory,
            attachmentName: attachmentName || null,
            attachmentType: attachmentType || null,
            hasAttachment: Boolean(hasAttachment),
            sources: documents?.map((d: any) => ({
              title: d.title,
              category: d.category
            }))
          }
        }
      ]);
    }

    return new Response(
      JSON.stringify({
        response: assistantMessage,
        sources: documents?.map((d: any) => ({
          title: d.title,
          category: d.category,
          source_file: d.source_file
        })) || [],
        stage: stage
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );

  } catch (error) {
    console.error('Error:', error);
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
