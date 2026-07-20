import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const GROQ_API_KEY = Deno.env.get('Groq_API_KEY');
const GROQ_MODEL = Deno.env.get('Groq_MODEL') || 'llama-3.3-70b-versatile';
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const EMBEDDING_DIM = 1536;
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

// ─── INTENT TYPES ───────────────────────────────────────────────────────────
type IntentType = 
  | 'LEGAL_QUERY'      // Normal legal question → RAG pipeline
  | 'META_QUERY'       // "What did I ask?", "Repeat that", etc. → Use memory
  | 'GREETING'         // "Hi", "Hello", "Thanks" → Simple response
  | 'CLARIFICATION'    // "What do you mean?", "Explain more" → Needs context
  | 'OUT_OF_DOMAIN';   // Truly outside scope → Rejection

interface IntentResult {
  intent: IntentType;
  category?: string | null;
  confidence: number;
  reason: string;
}

const DOMAIN_CATEGORIES = ['Civil', 'Criminal', 'Family'];

type ReplyLanguage = 'english' | 'roman-urdu' | 'urdu';

// ─── ENHANCED KEYWORDS WITH SYNONYMS ────────────────────────────────────────
// Maps colloquial/legal terms to canonical forms for better matching
const LEGAL_SYNONYMS: Record<string, string[]> = {
  'theft': ['steal', 'stolen', 'stealing', 'snatch', 'snatching', 'snatched', 'pickpocket', 'pickpocketing', 'burglary', 'burglarize', 'larceny'],
  'robbery': ['rob', 'robbed', 'robbing', 'mugging', 'mugged', 'armed robbery', 'dacoity', 'dacoit'],
  'assault': ['attack', 'attacked', 'beating', 'beaten', 'hit', 'hurt', 'injury', 'injured', 'violence', 'violent'],
  'murder': ['kill', 'killed', 'killing', 'homicide', 'manslaughter', 'qatl', 'dafa 302', 'section 302'],
  'fraud': ['cheat', 'cheated', 'cheating', 'scam', 'scammed', 'deceit', 'deception', 'forgery', 'fake'],
  'extortion': ['blackmail', 'blackmailed', 'threaten', 'threatened', 'coercion', 'demand money'],
  'property': ['land', 'plot', 'house', 'building', 'estate', 'real estate', 'possession', 'tenant', 'landlord'],
  'contract': ['agreement', 'breach', 'terms', 'clause', 'parties', 'obligation', 'binding'],
  'divorce': ['talaq', 'khula', 'separation', 'dissolution', 'marriage end'],
  'custody': ['child custody', 'guardianship', 'minor', 'children', 'access', 'visitation'],
  'maintenance': ['alimony', 'support', 'upkeep', 'financial support', 'monthly allowance'],
  'inheritance': ['succession', 'heir', 'heirs', 'will', 'testament', 'estate distribution', 'waaris'],
  'harassment': ['sexual harassment', 'workplace harassment', 'bullying', 'intimidation'],
  'rape': ['sexual assault', 'molestation', 'sexual abuse', 'zina-bil-jabr'],
  'bail': ['bail bond', 'surety', 'release on bail', 'anticipatory bail', 'post-arrest bail'],
  'fir': ['first information report', 'complaint', 'police complaint', 'report to police', 'thana'],
  'court': ['judge', 'magistrate', 'session judge', 'high court', 'supreme court', 'trial', 'hearing', 'date'],
  'lawyer': ['advocate', 'attorney', 'counsel', 'legal representative', 'vakil', 'pleader'],
  'evidence': ['proof', 'witness', 'testimony', 'documentary evidence', 'exhibit', 'forensic'],
  'dafa': ['section', 'sections', '§', 'article', 'clause', 'provision'],
};

// Flatten all legal terms for keyword matching
const ALL_LEGAL_TERMS: string[] = Object.values(LEGAL_SYNONYMS).flat();
const DOMAIN_KEYWORDS = [
  'pakistan', 'pakistani', 'law', 'legal', 'court', 'judge', 'advocate', 'lawyer', 'fir',
  'civil', 'criminal', 'family', 'divorce', 'custody', 'maintenance', 'inheritance', 'property',
  'contract', 'agreement', 'lease', 'rent', 'fraud', 'theft', 'assault', 'murder', 'bail',
  'evidence', 'police', 'complaint', 'rights', 'petition', 'suit', 'khula', 'talaq',
  'dafa', 'section', 'ppc', 'penal code', 'qanun', 'act', 'ordinance',
  ...ALL_LEGAL_TERMS
];

// Meta-query patterns — these should NEVER go through legal domain check
const META_QUERY_PATTERNS = [
  /what\s+(was|is|did)\s+(i|you)\s+(ask|say|tell|mention)/i,
  /repeat\s+(that|this|your\s+last|the\s+last)/i,
  /can\s+you\s+repeat/i,
  /what\s+(was|is)\s+(my|the)\s+(last|previous)\s+(question|query)/i,
  /who\s+are\s+you/i,
  /what\s+can\s+you\s+do/i,
  /how\s+does\s+this\s+work/i,
  /what\s+(is|are)\s+your\s+(capabilities|features)/i,
  /explain\s+(that|this)\s+again/i,
  /i\s+don'?t\s+understand/i,
  /can\s+you\s+clarify/i,
  /tell\s+me\s+more/i,
  /go\s+on/i,
  /and\s+then\s+what/i,
  /what\s+happened\s+next/i,
];

// Greeting patterns
const GREETING_PATTERNS = [
  /^(hi|hello|hey|greetings|salam|assalam|asalam|assalamo|salaam)/i,
  /^(good\s+(morning|afternoon|evening|day))/i,
  /^(thanks|thank\s+you|shukria|shukriya)/i,
  /^(ok|okay|got\s+it|understood|alright|sure)/i,
  /^(bye|goodbye|see\s+you)/i,
];

const normalizeCategory = (value?: string): string | null => {
  if (!value) return null;
  const normalized = DOMAIN_CATEGORIES.find(
    (category) => category.toLowerCase() === value.toLowerCase()
  );
  return normalized || null;
};

const URDU_SCRIPT_RE = /[\u0600-\u06FF]/;
const ROMAN_URDU_HINTS = [
  'kya', 'kyun', 'kaise', 'kaisay', 'kis', 'kisi', 'nahi', 'nahin', 'nai', 'ha', 'hai', 'hain', 'ho',
  'tha', 'thi', 'the', 'mera', 'myra', 'meri', 'mere', 'mujhe', 'mujhy', 'mujy', 'apna', 'apni',
  'apne', 'aap', 'ap', 'ham', 'hum', 'tum', 'isko', 'usko', 'yeh', 'ye', 'woh', 'wo', 'karo', 'karen',
  'karna', 'krna', 'chahiye', 'bataye', 'batao', 'madad', 'zarorat', 'zarurat', 'case', 'file', 'zamanat',
  'guzaarish', 'faisla', 'talak', 'khula', 'jaidad', 'juraim', 'chori', 'mobile', 'chhin', 'chin', 'gaya'
];

const detectReplyLanguage = (text: string): ReplyLanguage => {
  if (URDU_SCRIPT_RE.test(text)) {
    return 'urdu';
  }

  const lower = text.toLowerCase();
  const hintCount = ROMAN_URDU_HINTS.filter((hint) => {
    const pattern = new RegExp(`\\b${hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return pattern.test(lower);
  }).length;
  const latinWordCount = (lower.match(/\b[a-z]{2,}\b/g) || []).length;

  if (hintCount >= 2 && hintCount >= Math.max(1, Math.floor(latinWordCount / 4))) {
    return 'roman-urdu';
  }

  return 'english';
};

const localizeText = (
  language: ReplyLanguage,
  english: string,
  romanUrdu: string,
  urdu: string
) => {
  if (language === 'urdu') return urdu;
  if (language === 'roman-urdu') return romanUrdu;
  return english;
};

const getReplyLanguageInstruction = (language: ReplyLanguage) => {
  if (language === 'urdu') {
    return 'Respond only in Urdu script. Keep the wording simple, short, and natural for a Pakistani user. Ignore the language used in previous conversation turns when choosing the reply language.';
  }

  if (language === 'roman-urdu') {
    return 'Respond only in Roman Urdu using Latin characters. Do not use Urdu script or English. Ignore the language used in previous conversation turns when choosing the reply language.';
  }

  return 'Respond only in English. Ignore the language used in previous conversation turns when choosing the reply language.';
};

const getPromptHistory = (
  chatHistory: Array<{ role: string; content: string }> = [],
  replyLanguage: ReplyLanguage
) => {
  if (replyLanguage !== 'roman-urdu') {
    return chatHistory;
  }

  return chatHistory
    .filter((message) => message.role === 'user')
    .slice(-3)
    .map((message) => ({
      ...message,
      content: message.content.replace(/[\u0600-\u06FF]/g, '')
    }));
};

const extractSupportingPassages = (
  query: string,
  documents: Array<{ content?: string; title?: string }>,
  language: ReplyLanguage
) => {
  const sourceDocs = documents
    .map((doc) => (doc.content || '').trim())
    .filter(Boolean)
    .slice(0, 2);

  if (sourceDocs.length === 0) {
    return '';
  }

  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 3);

  const passages = sourceDocs.map((content) => {
    const sentences = content
      .split(/(?<=[.!?۔])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    const matchedSentence = sentences.find((sentence) => {
      const lowerSentence = sentence.toLowerCase();
      return queryTerms.some((term) => lowerSentence.includes(term));
    });

    const passage = matchedSentence || sentences[0] || content.slice(0, 240);
    return passage.length > 280 ? `${passage.slice(0, 277)}...` : passage;
  });

  const heading = localizeText(
    language,
    'Relevant extracted passage:',
    'Relevant extracted passage:',
    'متعلقہ اخذ شدہ اقتباس:'
  );

  return `\n\n${heading}\n- ${passages.map((passage) => `"${passage.replace(/\s+/g, ' ')}"`).join('\n- ')}`;
};

const extractSectionLabel = (doc: any) => {
  const candidates = [doc?.title, doc?.source_file, doc?.content?.slice?.(0, 400), doc?.metadata?.title]
    .filter(Boolean)
    .map((value) => String(value));

  for (const text of candidates) {
    const match = text.match(/(?:section|dafa|article)\s*(\d+[a-z]?)/i);
    if (match) {
      return `Section ${match[1]}`;
    }
  }

  return doc?.metadata?.section ? `Section ${doc.metadata.section}` : null;
};

const getSourceDisplay = (doc: any) => {
  const sectionLabel = extractSectionLabel(doc);
  const title = doc?.title || 'Legal document';
  const sourceFile = doc?.source_file ? String(doc.source_file).split(/[\\/]/).pop() : '';

  const parts = [title];
  if (sectionLabel && !title.toLowerCase().includes(sectionLabel.toLowerCase())) {
    parts.push(sectionLabel);
  }
  if (sourceFile && sourceFile !== title) {
    parts.push(sourceFile);
  }

  return parts.join(' · ');
};

const expandSearchTerms = (query: string) => {
  const expanded = new Set(
    query
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );

  const lower = query.toLowerCase();
  const add = (...terms: string[]) => terms.forEach((term) => expanded.add(term));

  if (/(mobile|phone|cell)/.test(lower) && /(chhin|chin|snatch|snatching|chori|theft|stolen|stole)/.test(lower)) {
    add('snatching', 'theft', 'robbery', 'fir', 'police', 'phone', 'mobile');
  }

  if (/(lost|missing|wapis|dhund|dhoond)/.test(lower) && /(mobile|phone)/.test(lower)) {
    add('lost mobile', 'mobile theft', 'snatching', 'theft', 'police');
  }

  if (/(mujhe|mujhy|case|file|madad|zarurat)/.test(lower) && /(mobile|phone)/.test(lower)) {
    add('snatching', 'theft', 'robbery', 'fir');
  }

  return [...expanded].join(' ');
};

const isRestrictedPersonLookup = (text: string) => {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();

  const blockedPatterns = [
    /how many cases\s+(on|against|for)\s+[a-z]/i,
    /cases\s+(on|against|for)\s+[a-z]/i,
    /(criminal\s+record|police\s+record|fir\s+record)\s+(of|for)\s+[a-z]/i,
    /(any|all)\s+(case|cases|fir|firs)\s+(against|on)\s+[a-z]/i,
    /(background\s+check|verify\s+record)\s+(for|of)\s+[a-z]/i
  ];

  return blockedPatterns.some((pattern) => pattern.test(normalized));
};

// ─── INTENT CLASSIFICATION (REPLACES isDomainRelevant) ──────────────────────
const classifyIntent = async (text: string, providedCategory?: string): Promise<IntentResult> => {
  const normalizedProvided = normalizeCategory(providedCategory);
  
  // 1. Check for restricted person lookups FIRST
  if (isRestrictedPersonLookup(text)) {
    return {
      intent: 'OUT_OF_DOMAIN',
      confidence: 1,
      reason: 'restricted-person-lookup'
    };
  }

  // 2. Check for meta-queries — these bypass legal domain entirely
  if (META_QUERY_PATTERNS.some(p => p.test(text))) {
    return {
      intent: 'META_QUERY',
      confidence: 0.95,
      reason: 'meta-question-pattern'
    };
  }

  // 3. Check for greetings/acknowledgments
  if (GREETING_PATTERNS.some(p => p.test(text))) {
    return {
      intent: 'GREETING',
      confidence: 0.9,
      reason: 'greeting-pattern'
    };
  }

  // 4. If category provided by classify-case, trust it
  if (normalizedProvided) {
    return {
      intent: 'LEGAL_QUERY',
      category: normalizedProvided,
      confidence: 0.99,
      reason: 'provided-category'
    };
  }

  // 5. Enhanced keyword matching with synonyms
  const lowerText = text.toLowerCase();
  
  // Check for explicit section references (e.g., "dafa 303", "section 302", "§ 375")
  const sectionPattern = /(?:dafa|section|§|article)\s*(\d+[a-z]?)/i;
  const sectionMatch = lowerText.match(sectionPattern);
  if (sectionMatch) {
    return {
      intent: 'LEGAL_QUERY',
      category: null, // Will be determined by section number
      confidence: 0.95,
      reason: `explicit-section-reference-${sectionMatch[1]}`
    };
  }

  // Check for legal keywords and synonyms
  const hasLegalKeyword = DOMAIN_KEYWORDS.some((keyword) => lowerText.includes(keyword));
  
  // Check for synonym expansion
  let detectedCategory: string | null = null;
  for (const [canonical, synonyms] of Object.entries(LEGAL_SYNONYMS)) {
    const allTerms = [canonical, ...synonyms];
    if (allTerms.some(term => lowerText.includes(term))) {
      // Map to category
      if (['theft', 'robbery', 'assault', 'murder', 'fraud', 'extortion', 'rape', 'bail', 'fir'].includes(canonical)) {
        detectedCategory = 'Criminal';
      } else if (['property', 'contract', 'inheritance'].includes(canonical)) {
        detectedCategory = 'Civil';
      } else if (['divorce', 'custody', 'maintenance'].includes(canonical)) {
        detectedCategory = 'Family';
      }
      break;
    }
  }

  if (hasLegalKeyword || detectedCategory) {
    return {
      intent: 'LEGAL_QUERY',
      category: detectedCategory,
      confidence: 0.85,
      reason: detectedCategory ? `synonym-match-${detectedCategory}` : 'keyword-match'
    };
  }

  // 6. Fallback: Use Groq for ambiguous cases, but with better prompt
  if (!GROQ_API_KEY) {
    return {
      intent: 'OUT_OF_DOMAIN',
      confidence: 0.5,
      reason: 'no-model-fallback'
    };
  }

  const prompt = `Analyze this user message and classify its intent for a Pakistani legal AI assistant.

User message: "${text.slice(0, 2000)}"

Classify into ONE of these intents:
- LEGAL_QUERY: Asking about Pakistani law, legal procedures, rights, sections, acts, or seeking legal guidance
- META_QUERY: Asking about previous conversation, asking me to repeat, asking what I can do, or asking about myself
- GREETING: Hello, thanks, goodbye, or simple acknowledgment
- OUT_OF_DOMAIN: General chit-chat, technology, coding, health, finance, travel, math, science, non-legal topics, or any nonsense, absurd, or unrealistic scenarios (e.g., animals committing crimes).

If LEGAL_QUERY, also specify category: Civil, Criminal, or Family.

Respond ONLY with JSON:
{"intent":"LEGAL_QUERY","category":"Criminal","confidence":0.9,"reason":"brief reason"}`;

  try {
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
        max_tokens: 150
      })
    });

    if (!response.ok) {
      return { intent: 'OUT_OF_DOMAIN', confidence: 0.5, reason: 'classifier-request-failed' };
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content || '';
    const match = content.match(/\{[\s\S]*\}/);

    if (!match) {
      return { intent: 'OUT_OF_DOMAIN', confidence: 0.5, reason: 'classifier-parse-failed' };
    }

    const parsed = JSON.parse(match[0]);
    const intent = parsed?.intent || 'OUT_OF_DOMAIN';
    const normalizedCategory = normalizeCategory(parsed?.category);

    // Validate intent
    const validIntents: IntentType[] = ['LEGAL_QUERY', 'META_QUERY', 'GREETING', 'CLARIFICATION', 'OUT_OF_DOMAIN'];
    const finalIntent = validIntents.includes(intent) ? intent as IntentType : 'OUT_OF_DOMAIN';

    return {
      intent: finalIntent,
      category: normalizedCategory,
      confidence: Number(parsed?.confidence || 0.5),
      reason: parsed?.reason || 'classifier-result'
    };
  } catch {
    return { intent: 'OUT_OF_DOMAIN', confidence: 0.5, reason: 'classifier-error' };
  }
};

// ─── SECTION TO CATEGORY MAPPING ────────────────────────────────────────────
const getCategoryBySection = (sectionNum: string): string => {
  const num = parseInt(sectionNum);
  if (isNaN(num)) return 'Criminal';
  
  // PPC Section ranges by category (approximate)
  if (num >= 299 && num <= 338) return 'Criminal'; // Offences affecting human body
  if (num >= 375 && num <= 377) return 'Criminal'; // Rape, unnatural offences
  if (num >= 378 && num <= 462) return 'Criminal'; // Theft, robbery, property offences
  if (num >= 121 && num <= 130) return 'Criminal'; // Offences against state
  if (num >= 141 && num <= 160) return 'Criminal'; // Public tranquillity
  if (num >= 161 && num <= 171) return 'Criminal'; // Public servants
  if (num >= 191 && num <= 229) return 'Criminal'; // False evidence
  if (num >= 268 && num <= 294) return 'Criminal'; // Public health, safety, morals
  if (num >= 295 && num <= 298) return 'Criminal'; // Religion
  if (num >= 302 && num <= 322) return 'Criminal'; // Qatl (murder)
  
  if (num >= 1 && num <= 75) return 'Criminal'; // General explanations, punishments
  
  // Family law sections
  if (num >= 493 && num <= 498) return 'Family'; // Marriage offences
  if (num >= 310 && num <= 338) return 'Family'; // Diyat, hurt (can be family-related)
  
  // Civil/property
  if (num >= 405 && num <= 424) return 'Civil'; // Criminal breach of trust, cheating
  if (num >= 425 && num <= 440) return 'Civil'; // Mischief
  
  return 'Criminal'; // Default for PPC
};

// ─── QUERY EMBEDDING (OpenRouter) ───────────────────────────────────────────
const normalizeQuery = (text: string): string =>
  text.replace(/\bdafa\s+(\d+[a-z]?)/gi, 'Section $1');

const embedQuery = async (text: string): Promise<number[] | null> => {
  if (!OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY not configured — skipping vector search');
    return null;
  }

  const normalized = normalizeQuery(text).replace(/\n/g, ' ').trim();

  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: normalized
      })
    });

    if (!response.ok) {
      console.error('Embedding request failed:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    return data?.data?.[0]?.embedding || null;
  } catch (e) {
    console.error('Embedding error:', e);
    return null;
  }
};

// ─── VECTOR SEARCH via match_legal_documents RPC ────────────────────────────
const vectorSearch = async (
  supabase: any,
  queryEmbedding: number[],
  category: string | null,
  matchThreshold: number = 0.65,
  matchCount: number = 5
) => {
  const { data, error } = await supabase.rpc('match_legal_documents', {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
    filter_category: category
  });

  if (error) {
    console.error('Vector search RPC error:', error);
    return [];
  }

  // Map similarity (0-1) onto the same relevanceScore scale your ilike path uses
  return (data || []).map((doc: any) => ({
    ...doc,
    relevanceScore: Math.round(doc.similarity * 100)
  }));
};

// ─── RETRIEVAL WITH CONFIDENCE CHECKING ─────────────────────────────────────
const searchDocuments = async (
  supabase: any,
  query: string,
  category: string | null,
  extractedText?: string
) => {
  const searchTerms = expandSearchTerms(query);
  
  // Extract section numbers for precise lookup
  const sectionMatch = searchTerms.match(/(?:dafa|section|§|article)\s*(\d+[a-z]?)/i);
  const sectionNum = sectionMatch ? sectionMatch[1] : null;
  
  // Determine effective category
  let effectiveCategory = category;
  if (!effectiveCategory && sectionNum) {
    effectiveCategory = getCategoryBySection(sectionNum);
  }

  // ─── STRATEGY 0: VECTOR SEARCH (primary path) ─────────────────────────────
  const queryEmbedding = await embedQuery(searchTerms);
  if (queryEmbedding) {
    const vectorResults = await vectorSearch(supabase, queryEmbedding, effectiveCategory);
    if (vectorResults.length > 0 && vectorResults[0].relevanceScore >= 65) {
      return {
        documents: vectorResults,
        sectionNum,
        category: effectiveCategory
      };
    }
    // Low-confidence or empty vector results fall through to keyword search below,
    // which may catch exact section-number matches vector search missed.
  }

  // Build search query
  let dbQuery = supabase
    .from('legal_documents')
    .select('id, title, category, source_file, content, metadata');

  if (effectiveCategory) {
    dbQuery = dbQuery.eq('category', effectiveCategory);
  }

  // Strategy 1: Exact section match (highest priority)
  let documents: any[] = [];
  
  if (sectionNum) {
    const { data: sectionDocs } = await dbQuery
      .ilike('content', `%section ${sectionNum}%`)
      .limit(3);
    
    if (sectionDocs && sectionDocs.length > 0) {
      documents = sectionDocs;
    }
    
    // Also try "dafa" variant for Urdu queries
    if (documents.length === 0) {
      const { data: dafaDocs } = await supabase
        .from('legal_documents')
        .select('id, title, category, source_file, content, metadata')
        .eq('category', effectiveCategory || 'Criminal')
        .ilike('content', `%${sectionNum}%`)
        .limit(3);
      
      if (dafaDocs && dafaDocs.length > 0) {
        documents = dafaDocs;
      }
    }
  }

  // Strategy 2: Content keyword search with multiple terms
  if (documents.length === 0) {
    // Extract meaningful terms (keep short terms like "303", "fir", "ppc")
    const terms = searchTerms
      .split(/\s+/)
      .filter(t => t.length > 2 || /^\d+$/.test(t)) // Keep numeric terms
      .filter(t => !['what', 'how', 'when', 'where', 'why', 'who', 'is', 'are', 'was', 'were', 'the', 'a', 'an', 'this', 'that', 'these', 'those', 'can', 'could', 'will', 'would', 'should', 'shall', 'may', 'might', 'must', 'do', 'does', 'did', 'have', 'has', 'had', 'be', 'been', 'being', 'about', 'tell', 'explain', 'describe', 'define', 'meaning', 'mean'].includes(t));

    // Try each term until we get results
    for (const term of terms.slice(0, 5)) {
      const { data: termDocs } = await supabase
        .from('legal_documents')
        .select('id, title, category, source_file, content, metadata')
        .eq('category', effectiveCategory || 'Criminal')
        .ilike('content', `%${term}%`)
        .limit(3);

      if (termDocs && termDocs.length > 0) {
        documents = termDocs;
        break;
      }
    }
  }

  // Strategy 3: Full-text search if available, or fallback to title search
  if (documents.length === 0 && effectiveCategory) {
    const { data: fallbackDocs } = await supabase
      .from('legal_documents')
      .select('id, title, category, source_file, content, metadata')
      .eq('category', effectiveCategory)
      .limit(3);
    
    documents = fallbackDocs || [];
  }

  // Calculate relevance score for each document
  const scoredDocs = documents.map((doc: any) => {
    const content = (doc.content || '').toLowerCase();
    let score = 0;
    
    // Section match is highest score
    if (sectionNum && content.includes(`section ${sectionNum}`)) score += 100;
    if (sectionNum && content.includes(sectionNum)) score += 50;
    
    // Keyword overlap
    const queryWords = searchTerms.split(/\s+/);
    const contentWords = content.split(/\s+/);
    const overlap = queryWords.filter(w => contentWords.includes(w)).length;
    score += overlap * 10;
    
    // Title match
    const title = (doc.title || '').toLowerCase();
    if (queryWords.some(w => title.includes(w))) score += 20;
    
    return { ...doc, relevanceScore: score };
  });

  // Sort by relevance
  scoredDocs.sort((a: any, b: any) => b.relevanceScore - a.relevanceScore);

  return {
    documents: scoredDocs,
    sectionNum,
    category: effectiveCategory
  };
};

// ─── CHAT HISTORY RETRIEVAL ─────────────────────────────────────────────────
const getChatHistory = async (supabase: any, sessionId: string, limit: number = 10) => {
  const { data: messages } = await supabase
    .from('chat_messages')
    .select('role, content, created_at, metadata')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!messages) return [];
  
  // Reverse to chronological order
  return messages.reverse().map((m: any) => ({
    role: m.role,
    content: m.content,
    metadata: m.metadata
  }));
};

// ─── SYSTEM PROMPTS ─────────────────────────────────────────────────────────
const getSystemPrompt = (
  stage: number,
  caseCategory: string | undefined,
  context: string,
  extractedDocumentText?: string,
  hasAttachment?: boolean,
  chatHistory?: Array<{role: string, content: string}>,
  replyLanguage: ReplyLanguage = 'english'
) => {
  const baseRules = `You are an AI Legal Assistant for Pakistani law. Provide clear, simple guidance.

${getReplyLanguageInstruction(replyLanguage)}

When the latest user message is Roman Urdu, answer in Roman Urdu even if earlier history was in Urdu script. The current user message language overrides old conversation language.

IMPORTANT FORMATTING RULES:
- Write in plain, simple language
- Keep responses SHORT (maximum 7-8 lines)
- Use simple bullet points with - (dash) only
- NO special characters like **, ##, ***, etc.
- NO markdown formatting
- Direct and to the point
- Focus on actionable steps only

SAFETY AND SCOPE RULES:
- Never provide or infer case counts, FIR status, criminal history, or allegations about any identifiable individual by name.
- If the user asks personal record lookup questions, refuse briefly and direct them to official court/police channels.
- Stay within Pakistani Civil, Criminal, and Family legal guidance only.
- REJECT any nonsense, absurd, or unrealistic scenarios (e.g., animals committing crimes, superheroes, magic) by stating you can only assist with real legal matters.

Context from Pakistani Legal Documents:
${context}

Uploaded Document Context:
${hasAttachment ? (extractedDocumentText || 'Attachment provided but no readable text extracted.') : 'No attachment provided.'}`;

  // Add conversation history context if available
  const historyContext = chatHistory && chatHistory.length > 0
    ? `\n\nPREVIOUS CONVERSATION:\n${chatHistory.slice(-4).map(m => `${m.role.toUpperCase()}: ${m.content.substring(0, 200)}`).join('\n')}`
    : '';

  switch (stage) {
    case 1:
      const attachmentInstructions = hasAttachment 
        ? `- First, evaluate if the provided document contains any relevant legal facts, FIR details, or case information.\n- If the document is irrelevant or contains no legal information, start your response with "The uploaded document does not appear to contain relevant legal information." and then answer their question normally based on their text.\n- If the document IS a legal document, meticulously analyze its text to extract and list:\n  * Case Type\n  * Applicable Law (Specific Sections mentioned)\n  * Nature of Allegation / Main Issue\n  * Police Station / Jurisdiction (if applicable)\n- CRITICAL: Evaluate each detail individually. If a specific detail (like the allegation or section) is missing or illegible, state "Unknown" for that line only. Do NOT guess or invent any missing information.\n- Add one short reason paragraph starting with "Reason:" explaining the exact legal basis strictly based on the laws/sections found in the document. Do NOT give generic reasons like "a report was filed".`
        : `- Identify the legal issue in 1-2 sentences\n- Mention which category (Civil, Criminal, or Family)\n- Add one short reason paragraph starting with "Reason:" that explains why this category fits, using the retrieved context`;

      return `${baseRules}${historyContext}

STAGE 1: CASE PROBLEM ANALYSIS
Your role: Provide brief initial guidance (7-8 lines maximum).

Instructions:
${attachmentInstructions}
- Give 3-4 immediate action steps
- Keep it simple and direct
- NO lengthy explanations
- NO special formatting characters

CRITICAL: If the provided legal documents do NOT contain specific information about the user's query, say: "I don't have specific information on [topic] in my legal database. However, here is general guidance:" and then provide general Pakistani legal information. NEVER invent specific section details or cite documents that don't contain the answer.`;

    case 2:
      return `${baseRules}${historyContext}

STAGE 2: COURT INFORMATION
Case Category: ${caseCategory || 'Not specified'}
Your role: Answer court questions briefly (7-8 lines maximum).

Instructions:
- Answer the specific question asked
- Keep responses short and practical
- Focus on what user needs to do
- Add one short reason paragraph starting with "Reason:" that explains why the answer fits, using the retrieved context
- Use ONLY the provided case category for court guidance
- Do NOT mention courts/procedures from other categories
- If user asks mixed-category questions, ask them to stay in ${caseCategory || 'the selected'} category
- NO lengthy legal explanations
- Simple language only

CRITICAL: If the provided legal documents do NOT contain specific court information, say: "I don't have specific court details for this in my database. Here is general guidance:"`;

    case 3:
      return `${baseRules}${historyContext}

STAGE 3: LAWYER GUIDANCE
Case Category: ${caseCategory || 'Not specified'}
Your role: Answer lawyer questions briefly (7-8 lines maximum).

Instructions:
- Answer the specific question asked
- Keep responses short and practical
- Focus on what to look for in a lawyer
- Add one short reason paragraph starting with "Reason:" that explains why this lawyer guidance fits, using the retrieved context
- NO lengthy explanations
- Simple language only`;

    default:
      return baseRules + historyContext;
  }
};

// ─── META-QUERY HANDLER ─────────────────────────────────────────────────────
const handleMetaQuery = async (
  supabase: any,
  sessionId: string,
  message: string,
  userId?: string,
  replyLanguage: ReplyLanguage = 'english'
): Promise<string> => {
  const history = await getChatHistory(supabase, sessionId, 20);
  
  if (history.length === 0) {
    return localizeText(
      replyLanguage,
      "We haven't started our conversation yet. How can I help you with your Pakistani legal matter today?",
      'Abhi hamari guftagu shuru nahi hui. Aaj aap ke Pakistani qanooni maslay mein main kis tarah madad kar sakta hoon?',
      'ابھی ہماری گفتگو شروع نہیں ہوئی۔ آج آپ کے پاکستانی قانونی مسئلے میں میں کس طرح مدد کر سکتا ہوں؟'
    );
  }

  const lastUserMessage = [...history].reverse().find(m => m.role === 'user');
  const lastAssistantMessage = [...history].reverse().find(m => m.role === 'assistant');

  // Handle specific meta-questions
  const lowerMsg = message.toLowerCase();
  
  if (/what\s+(was|is|did)\s+i\s+(ask|say)/i.test(lowerMsg)) {
    if (lastUserMessage) {
      return localizeText(
        replyLanguage,
        `Your last question was: "${lastUserMessage.content}"`,
        `Aap ka aakhri sawal tha: "${lastUserMessage.content}"`,
        `آپ کا آخری سوال تھا: "${lastUserMessage.content}"`
      );
    }
    return localizeText(
      replyLanguage,
      "I don't see any previous questions from you in this session.",
      'Mujhe is session mein aap ke pehle sawalat nazar nahi aa rahe.',
      'مجھے اس سیشن میں آپ کے پہلے سوالات نظر نہیں آ رہے۔'
    );
  }

  if (/what\s+(was|is)\s+(my|the)\s+(last|previous)\s+(question|query)/i.test(lowerMsg)) {
    if (lastUserMessage) {
      return localizeText(
        replyLanguage,
        `Your last question was: "${lastUserMessage.content}"`,
        `Aap ka aakhri sawal tha: "${lastUserMessage.content}"`,
        `آپ کا آخری سوال تھا: "${lastUserMessage.content}"`
      );
    }
    return localizeText(
      replyLanguage,
      "I don't see any previous questions from you in this session.",
      'Mujhe is session mein aap ke pehle sawalat nazar nahi aa rahe.',
      'مجھے اس سیشن میں آپ کے پہلے سوالات نظر نہیں آ رہے۔'
    );
  }

  if (/repeat\s+(that|this|your\s+last|the\s+last)/i.test(lowerMsg) || /can\s+you\s+repeat/i.test(lowerMsg)) {
    if (lastAssistantMessage) {
      return lastAssistantMessage.content;
    }
    return localizeText(
      replyLanguage,
      "I don't have a previous response to repeat.",
      'Mere paas dobara sunane ke liye koi pichhla jawab nahi hai.',
      'میرے پاس دوبارہ سنانے کے لیے کوئی پچھلا جواب نہیں ہے۔'
    );
  }

  if (/who\s+are\s+you/i.test(lowerMsg) || /what\s+can\s+you\s+do/i.test(lowerMsg)) {
    return localizeText(
      replyLanguage,
      "I am an AI Legal Assistant for Pakistani law. I can help you with Civil, Criminal, and Family legal matters including understanding laws, court procedures, and finding lawyers. What legal issue can I help you with?",
      'Main Pakistani qanoon ke liye ek AI Legal Assistant hoon. Main Civil, Criminal, aur Family mamlaat mein qanoon samajhne, adalati amal, aur lawyer dhoondhne mein madad kar sakta hoon. Aap kis qanooni maslay par baat karna chahte hain?',
      'میں پاکستانی قانون کے لیے ایک AI قانونی معاون ہوں۔ میں سول، فوجداری اور خاندانی معاملات میں قانون سمجھنے، عدالتی طریقہ کار، اور وکیل ڈھونڈنے میں مدد کر سکتا ہوں۔ آپ کس قانونی مسئلے پر بات کرنا چاہتے ہیں؟'
    );
  }

  if (/explain\s+(that|this)\s+again/i.test(lowerMsg) || /i\s+don'?t\s+understand/i.test(lowerMsg)) {
    if (lastAssistantMessage) {
      return localizeText(
        replyLanguage,
        `Let me explain again: ${lastAssistantMessage.content}`,
        `Dobara samjhata hoon: ${lastAssistantMessage.content}`,
        `دوبارہ سمجھاتا ہوں: ${lastAssistantMessage.content}`
      );
    }
    return localizeText(
      replyLanguage,
      "I don't have a previous explanation to repeat. Please ask your question again.",
      'Mere paas dobara samjhane ke liye pichhli wazahat nahi hai. Barah-e-karam sawal dobara bhejein.',
      'میرے پاس دوبارہ سمجھانے کے لیے پچھلی وضاحت نہیں ہے۔ براہ کرم سوال دوبارہ بھیجیں۔'
    );
  }

  // Generic fallback for other meta-queries
  return localizeText(
    replyLanguage,
    "I'm here to help with your Pakistani legal questions. Could you please clarify what you'd like to know?",
    'Main aap ke Pakistani qanooni sawalat mein madad ke liye yahan hoon. Barah-e-karam wazeh kar dein ke aap kya jan-na chahte hain?',
    'میں آپ کے پاکستانی قانونی سوالات میں مدد کے لیے یہاں ہوں۔ براہِ کرم واضح کریں کہ آپ کیا جاننا چاہتے ہیں؟'
  );
};

// ─── GREETING HANDLER ───────────────────────────────────────────────────────
const handleGreeting = (message: string): string => {
  const lower = message.toLowerCase();
  const replyLanguage = detectReplyLanguage(message);
  
  if (/^(hi|hello|hey|greetings|salam|assalam)/i.test(lower)) {
    return localizeText(
      replyLanguage,
      "Hello! I am your AI Legal Assistant for Pakistani law. I can help with Civil, Criminal, and Family legal matters. What can I help you with today?",
      'Assalam-o-alaikum! Main Pakistani qanoon ke liye aap ka AI Legal Assistant hoon. Main Civil, Criminal, aur Family mamlaat mein madad kar sakta hoon. Aaj main aap ki kis tarah madad karun?',
      'السلام علیکم! میں پاکستانی قانون کے لیے آپ کا AI قانونی معاون ہوں۔ میں سول، فوجداری اور خاندانی معاملات میں مدد کر سکتا ہوں۔ آج میں آپ کی کس طرح مدد کروں؟'
    );
  }
  
  if (/^(thanks|thank\s+you|shukria|shukriya)/i.test(lower)) {
    return localizeText(
      replyLanguage,
      "You're welcome! If you have any more legal questions, feel free to ask.",
      'Khush aamadid! Agar aap ke aur qanooni sawalat hon to zaroor poochain.',
      'خوش آمدید! اگر آپ کے اور قانونی سوالات ہوں تو ضرور پوچھیں۔'
    );
  }
  
  if (/^(ok|okay|got\s+it|understood|alright|sure)/i.test(lower)) {
    return localizeText(
      replyLanguage,
      "Great! Let me know if you need any more help with your legal matter.",
      'Theek hai! Agar aap ko apne qanooni maslay mein mazeed madad chahiye ho to bata dein.',
      'ٹھیک ہے! اگر آپ کو اپنے قانونی مسئلے میں مزید مدد چاہیے ہو تو بتا دیں۔'
    );
  }
  
  if (/^(bye|goodbye|see\s+you)/i.test(lower)) {
    return localizeText(
      replyLanguage,
      "Goodbye! Take care, and don't hesitate to return if you need legal assistance.",
      'Allah hafiz! Khayal rakhein, aur agar qanooni madad chahiye ho to dobara zaroor aayein.',
      'اللہ حافظ! خیال رکھیں، اور اگر قانونی مدد چاہیے ہو تو دوبارہ ضرور آئیں۔'
    );
  }
  
  return localizeText(
    replyLanguage,
    "Hello! How can I help you with your Pakistani legal matter today?",
    'Assalam-o-alaikum! Aaj aap ke Pakistani qanooni maslay mein main kis tarah madad kar sakta hoon?',
    'السلام علیکم! آج آپ کے پاکستانی قانونی مسئلے میں میں کس طرح مدد کر سکتا ہوں؟'
  );
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
    const replyLanguage = detectReplyLanguage(message);
    
    // ─── STEP 1: INTENT CLASSIFICATION ─────────────────────────────────────
    const intentResult = await classifyIntent(combinedInput, caseCategory);

    // ─── STEP 2: ROUTE BY INTENT ───────────────────────────────────────────
    
    // META_QUERY: Handle conversation memory questions
    if (intentResult.intent === 'META_QUERY') {
      if (!sessionId) {
        const response = localizeText(
          replyLanguage,
          "I don't have access to our conversation history right now. Please ask your legal question again.",
          'Abhi mere paas hamari conversation history tak rasai nahi hai. Barah-e-karam apna qanooni sawal dobara poochain.',
          'ابھی میرے پاس ہماری گفتگو کی ہسٹری تک رسائی نہیں ہے۔ براہِ کرم اپنا قانونی سوال دوبارہ پوچھیں۔'
        );
        return new Response(
          JSON.stringify({ response, intent: 'META_QUERY', stage }),
          { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        );
      }

      const metaResponse = await handleMetaQuery(supabase, sessionId, message, userId, replyLanguage);
      
      // Store in chat history
      if (sessionId && userId) {
        await supabase.from('chat_messages').insert([
          { session_id: sessionId, role: 'user', content: message, metadata: { stage, intent: 'META_QUERY' } },
          { session_id: sessionId, role: 'assistant', content: metaResponse, metadata: { stage, intent: 'META_QUERY' } }
        ]);
      }

      return new Response(
        JSON.stringify({ response: metaResponse, intent: 'META_QUERY', stage }),
        { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // GREETING: Handle simple social interactions
    if (intentResult.intent === 'GREETING') {
      const greetingResponse = handleGreeting(message);
      
      if (sessionId && userId) {
        await supabase.from('chat_messages').insert([
          { session_id: sessionId, role: 'user', content: message, metadata: { stage, intent: 'GREETING' } },
          { session_id: sessionId, role: 'assistant', content: greetingResponse, metadata: { stage, intent: 'GREETING' } }
        ]);
      }

      return new Response(
        JSON.stringify({ response: greetingResponse, intent: 'GREETING', stage }),
        { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // OUT_OF_DOMAIN: Reject non-legal queries
    if (intentResult.intent === 'OUT_OF_DOMAIN') {
      const rejection = intentResult.reason === 'restricted-person-lookup'
        ? localizeText(
            replyLanguage,
            'I cannot provide case counts, FIR status, or criminal record details about a named person. Please use official court registries or police verification channels for lawful record checks.',
            'Main kisi named shakhs ke case counts, FIR status, ya criminal record details nahi de sakta. Barah-e-karam lawful record checks ke liye official court registries ya police verification channels use karein.',
            'میں کسی نامزد شخص کے کیس کاؤنٹس، ایف آئی آر اسٹیٹس، یا کریمنل ریکارڈ کی تفصیل نہیں دے سکتا۔ براہ کرم قانونی ریکارڈ چیک کے لیے سرکاری کورٹ رجسٹریز یا پولیس ویریفیکیشن چینلز استعمال کریں۔'
          )
        : hasAttachment
        ? localizeText(
            replyLanguage,
            'I reviewed your uploaded file, but it does not appear to be a Pakistani Civil, Criminal, or Family legal matter. Please upload/share a relevant legal case document or ask a legal question in this domain.',
            'Maine aap ki uploaded file dekhi hai, lekin yeh Pakistani Civil, Criminal, ya Family legal matter jaisi nahi lagti. Barah-e-karam koi relevant legal case document upload/share karein ya isi domain mein sawal karein.',
            'میں نے آپ کی اپ لوڈ کی ہوئی فائل دیکھی ہے، لیکن یہ پاکستانی سول، فوجداری، یا خاندانی قانونی معاملہ نہیں لگتی۔ براہ کرم کوئی متعلقہ قانونی دستاویز اپ لوڈ/شیئر کریں یا اسی دائرے میں سوال کریں۔'
          )
        : localizeText(
            replyLanguage,
            'I can only help with Pakistani Civil, Criminal, and Family legal matters. Please ask a question in this domain.',
            'Main sirf Pakistani Civil, Criminal, aur Family legal matters mein madad kar sakta hoon. Barah-e-karam isi domain mein sawal karein.',
            'میں صرف پاکستانی سول، فوجداری اور خاندانی قانونی معاملات میں مدد کر سکتا ہوں۔ براہ کرم اسی دائرے میں سوال کریں۔'
          );

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
              domainReason: intentResult.reason,
              intent: 'OUT_OF_DOMAIN'
            }
          }
        ]);
      }

      return new Response(
        JSON.stringify({
          response: rejection,
          outOfDomain: true,
          stage,
          intent: 'OUT_OF_DOMAIN'
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    // ─── STEP 3: LEGAL QUERY PROCESSING ────────────────────────────────────
    const effectiveCategory = normalizeCategory(caseCategory) || intentResult.category || null;

    // Retrieve chat history for context
    let chatHistory: Array<{role: string, content: string}> = [];
    if (sessionId) {
      chatHistory = await getChatHistory(supabase, sessionId, 10);
    }

    // Search documents with improved retrieval
    const { documents, sectionNum, category: searchCategory } = await searchDocuments(
      supabase,
      combinedInput,
      effectiveCategory,
      extractedDocumentText
    );

    // ─── STEP 4: SOURCE VERIFICATION & CONFIDENCE CHECKING ─────────────────
    const MIN_RELEVANCE_SCORE = 20; // Minimum score to trust a document
    const hasRelevantDocuments = documents.length > 0 && documents[0].relevanceScore >= MIN_RELEVANCE_SCORE;
    
    // Build context with source verification
    let context: string;
    let sources: any[] = [];
    
    if (hasRelevantDocuments) {
      context = documents
        .filter((d: any) => d.relevanceScore >= MIN_RELEVANCE_SCORE)
        .slice(0, 2)
        .map((doc: any) => {
          sources.push({
            title: doc.title,
            displayTitle: getSourceDisplay(doc),
            category: doc.category,
            source_file: doc.source_file,
            sectionLabel: extractSectionLabel(doc),
            relevanceScore: doc.relevanceScore
          });
          return `[SOURCE: ${getSourceDisplay(doc)} (${doc.category})]\n${doc.content.substring(0, 1000)}`;
        })
        .join('\n\n');
    } else if (documents.length > 0) {
      // Documents found but low relevance — use with caution flag
      context = `WARNING: Low confidence in retrieved documents. The following sources may not fully answer the query:\n\n${documents.slice(0, 2).map((doc: any) => {
        sources.push({
          title: doc.title,
          displayTitle: getSourceDisplay(doc),
          category: doc.category,
          source_file: doc.source_file,
          sectionLabel: extractSectionLabel(doc),
          relevanceScore: doc.relevanceScore,
          lowConfidence: true
        });
        return `[SOURCE: ${getSourceDisplay(doc)} (${doc.category}) - LOW CONFIDENCE]\n${doc.content.substring(0, 600)}`;
      }).join('\n\n')}`;
    } else {
      context = 'No specific legal documents found for this query. Provide general Pakistani legal guidance and explicitly state when information is not found in the database.';
      sources = [];
    }

    // ─── STEP 5: GENERATE RESPONSE ─────────────────────────────────────────
    const systemPrompt = getSystemPrompt(
      stage,
      searchCategory || effectiveCategory,
      context,
      extractedDocumentText,
      hasAttachment,
      getPromptHistory(chatHistory, replyLanguage),
      replyLanguage
    );

    if (!GROQ_API_KEY) {
      throw new Error('Groq_API_KEY not configured');
    }

    // Build messages with history
    const messages: Array<{role: string, content: string}> = [
      { role: 'system', content: systemPrompt }
    ];

    // Add relevant chat history (last 3 exchanges)
    if (chatHistory.length > 0) {
      const recentHistory = chatHistory.slice(-6); // Last 3 exchanges (user + assistant pairs)
      for (const msg of recentHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: message });

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
          messages,
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

    let assistantMessage = groqData.choices[0].message.content;

    // Post-process: If no relevant docs and response seems fabricated, add disclaimer
    if (!hasRelevantDocuments && sources.length === 0) {
      if (!assistantMessage.toLowerCase().includes('i don\'t have') && 
          !assistantMessage.toLowerCase().includes('not found')) {
        assistantMessage = localizeText(
          replyLanguage,
          `Note: I don't have specific legal documents on this exact topic in my database. Here's general guidance:\n\n${assistantMessage}`,
          `Note: Mere database mein is exact topic par koi khaas legal documents maujood nahi hain. Yeh general رہنمائی hai:\n\n${assistantMessage}`,
          `نوٹ: میرے ڈیٹا بیس میں اس مخصوص موضوع پر کوئی خاص قانونی دستاویزات موجود نہیں ہیں۔ یہ عمومی رہنمائی ہے:\n\n${assistantMessage}`
        );
      }
    }

    const evidenceDocs = documents.filter((doc: any) => {
      const score = Number(doc?.relevanceScore || 0);
      return score >= MIN_RELEVANCE_SCORE || Boolean(sectionNum && String(doc?.content || '').toLowerCase().includes(`section ${sectionNum}`));
    });


    // ─── STEP 6: STORE CONVERSATION ────────────────────────────────────────
    if (sessionId && userId) {
      // Store user message
      await supabase.from('chat_messages').insert([
        {
          session_id: sessionId,
          role: 'user',
          content: message,
          metadata: {
            stage,
            category: effectiveCategory,
            intent: intentResult.intent,
            attachmentName: attachmentName || null,
            attachmentType: attachmentType || null,
            hasAttachment: Boolean(hasAttachment)
          }
        }
      ]);

      // Store assistant message
      await supabase.from('chat_messages').insert([
        {
          session_id: sessionId,
          role: 'assistant',
          content: assistantMessage,
          metadata: {
            stage,
            category: effectiveCategory,
            intent: intentResult.intent,
            attachmentName: attachmentName || null,
            attachmentType: attachmentType || null,
            hasAttachment: Boolean(hasAttachment),
            sectionReferenced: sectionNum,
            sources: sources.map((s: any) => ({
              title: s.title,
              displayTitle: s.displayTitle || s.title,
              category: s.category,
              relevanceScore: s.relevanceScore,
              sectionLabel: s.sectionLabel || null,
              lowConfidence: s.lowConfidence || false
            })),
            hasRelevantDocuments,
            retrievalConfidence: documents[0]?.relevanceScore || 0
          }
        }
      ]);
    }

    return new Response(
      JSON.stringify({
        response: assistantMessage,
        sources: sources.map((s: any) => ({
          title: s.title,
          displayTitle: s.displayTitle || s.title,
          category: s.category,
          source_file: s.source_file,
          relevanceScore: s.relevanceScore,
          sectionLabel: s.sectionLabel || null,
          lowConfidence: s.lowConfidence || false
        })),
        sectionReferenced: sectionNum,
        stage: stage,
        intent: intentResult.intent,
        category: effectiveCategory,
        retrievalConfidence: documents[0]?.relevanceScore || 0,
        hasRelevantDocuments
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