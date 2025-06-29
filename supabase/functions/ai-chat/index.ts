import { createClient } from 'npm:@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ChatRequest {
  message: string;
  originalMessage?: string;
  sessionId?: string;
  userId: string;
  conversationContext?: string;
  hasLiveData?: boolean;
}

interface Trade {
  id: string;
  session_id: string;
  margin: number;
  roi: number;
  entry_side: 'Long' | 'Short';
  profit_loss: number;
  comments?: string;
  created_at: string;
}

interface TradingSession {
  id: string;
  user_id: string;
  name: string;
  initial_capital: number;
  current_capital: number;
  created_at: string;
  updated_at: string;
}

interface SearchResult {
  title: string;
  snippet: string;
  link: string;
}

// Enhanced function to detect if a message needs real-time search
function needsRealTimeSearch(message: string): boolean {
  const lowerMessage = message.toLowerCase().trim();
  
  // Always search for these high-priority categories
  const alwaysSearchKeywords = [
    // Market & Financial
    'price', 'market', 'trading', 'stock', 'crypto', 'bitcoin', 'ethereum', 'forex', 'usd', 'eur', 'gbp', 'jpy',
    'bull', 'bear', 'rally', 'crash', 'pump', 'dump', 'volatility', 'volume', 'chart', 'analysis',
    'fed', 'federal reserve', 'interest rate', 'inflation', 'gdp', 'unemployment', 'cpi', 'ppi',
    'gold', 'silver', 'oil', 'gas', 'commodity', 'bond', 'yield', 'treasury',
    
    // Geopolitical & News
    'war', 'conflict', 'election', 'president', 'government', 'policy', 'sanction', 'trade war',
    'ukraine', 'russia', 'china', 'usa', 'europe', 'middle east', 'israel', 'palestine',
    'nato', 'un', 'united nations', 'g7', 'g20', 'summit', 'meeting', 'agreement', 'treaty',
    
    // Time-sensitive indicators
    'today', 'now', 'current', 'latest', 'recent', 'breaking', 'news', 'update', 'live',
    'right now', 'this moment', 'currently', 'just happened', 'happening',
    
    // Weather & Events
    'weather', 'temperature', 'rain', 'storm', 'hurricane', 'earthquake', 'disaster',
    'sports', 'match', 'game', 'won', 'lost', 'score', 'championship', 'tournament',
    
    // Technology & Companies
    'apple', 'microsoft', 'google', 'amazon', 'tesla', 'nvidia', 'meta', 'netflix',
    'earnings', 'revenue', 'profit', 'loss', 'ipo', 'merger', 'acquisition',
    
    // Specific market terms
    'dow jones', 'nasdaq', 's&p 500', 'ftse', 'nikkei', 'hang seng', 'dax',
    'binance', 'coinbase', 'ftx', 'kraken', 'bybit', 'okx'
  ];
  
  // Question patterns that likely need current info
  const questionPatterns = [
    'what is', 'what are', 'what\'s', 'whats', 'how much', 'how many',
    'who is', 'who are', 'who won', 'who lost', 'where is', 'when is',
    'why is', 'why are', 'how is', 'how are', 'tell me about',
    'what happened', 'what\'s happening', 'any news', 'latest on'
  ];
  
  // Check for always-search keywords
  const hasMarketKeywords = alwaysSearchKeywords.some(keyword => lowerMessage.includes(keyword));
  
  // Check for question patterns
  const hasQuestionPattern = questionPatterns.some(pattern => lowerMessage.includes(pattern));
  
  // Check for specific entities that need current info
  const hasSpecificEntities = /\b(bitcoin|btc|ethereum|eth|tesla|apple|microsoft|google|amazon|nvidia|meta|netflix|dow|nasdaq|s&p|ftse|nikkei|dax|fed|ecb|boe|rbi|pboc)\b/i.test(lowerMessage);
  
  // Check for country/region mentions
  const hasGeopolitical = /\b(usa|america|china|russia|ukraine|europe|japan|india|pakistan|israel|palestine|iran|north korea|south korea|taiwan|hong kong|singapore|uk|germany|france|italy|spain|canada|australia|brazil|mexico)\b/i.test(lowerMessage);
  
  // Check for currency mentions
  const hasCurrency = /\b(usd|eur|gbp|jpy|cny|inr|pkr|aud|cad|chf|nzd|krw|sgd|hkd|mxn|brl|rub|try|zar)\b/i.test(lowerMessage);
  
  // Always search if any of these conditions are met
  return hasMarketKeywords || hasQuestionPattern || hasSpecificEntities || hasGeopolitical || hasCurrency;
}

// Enhanced web search function with better query optimization
async function performWebSearch(query: string): Promise<string> {
  try {
    const serperApiKey = Deno.env.get('SERPER_API_KEY');
    if (!serperApiKey) {
      console.warn('SERPER_API_KEY not found, skipping web search');
      return '';
    }

    // Optimize search query for better results
    let optimizedQuery = query;
    
    // Add current date context for time-sensitive queries
    const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    if (needsTimeContext(query)) {
      optimizedQuery = `${query} ${currentDate}`;
    }
    
    // Add specific search terms for better financial data
    if (isFinancialQuery(query)) {
      optimizedQuery = `${query} price market analysis`;
    }

    console.log('Performing web search for:', optimizedQuery);

    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': serperApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        q: optimizedQuery,
        num: 5 // Get more results for better context
      }),
    });

    if (!response.ok) {
      console.error('Serper API error:', response.status, response.statusText);
      return '';
    }

    const data = await response.json();
    
    // Extract top 5 results for more comprehensive context
    const results: SearchResult[] = (data.organic || []).slice(0, 5).map((result: any) => ({
      title: result.title || '',
      snippet: result.snippet || '',
      link: result.link || '',
    }));

    // Also include knowledge graph if available
    let knowledgeGraph = '';
    if (data.knowledgeGraph) {
      knowledgeGraph = `📊 Quick Facts: ${data.knowledgeGraph.title || ''} - ${data.knowledgeGraph.description || ''}\n\n`;
    }

    // Include answer box if available
    let answerBox = '';
    if (data.answerBox) {
      answerBox = `💡 Direct Answer: ${data.answerBox.answer || data.answerBox.snippet || ''}\n\n`;
    }

    if (results.length === 0 && !knowledgeGraph && !answerBox) {
      return '';
    }

    // Format results into a comprehensive context string
    let searchContext = `🌐 LIVE INTERNET SEARCH RESULTS for "${query}":\n\n`;
    
    if (answerBox) searchContext += answerBox;
    if (knowledgeGraph) searchContext += knowledgeGraph;
    
    searchContext += `📰 Latest Information:\n`;
    results.forEach((result, index) => {
      searchContext += `${index + 1}. **${result.title}**\n`;
      searchContext += `   ${result.snippet}\n`;
      searchContext += `   Source: ${result.link}\n\n`;
    });

    return searchContext;
  } catch (error) {
    console.error('Web search error:', error);
    return '';
  }
}

// Helper function to determine if query needs time context
function needsTimeContext(query: string): boolean {
  const timeKeywords = ['today', 'now', 'current', 'latest', 'recent', 'breaking'];
  return timeKeywords.some(keyword => query.toLowerCase().includes(keyword));
}

// Helper function to identify financial queries
function isFinancialQuery(query: string): boolean {
  const financialKeywords = ['price', 'stock', 'crypto', 'bitcoin', 'ethereum', 'market', 'trading', 'forex'];
  return financialKeywords.some(keyword => query.toLowerCase().includes(keyword));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { message, originalMessage, sessionId, userId, conversationContext, hasLiveData }: ChatRequest = await req.json();

    // Enhanced search logic - search for almost everything except basic greetings
    let searchContext = '';
    let enrichedMessage = message;
    let hasSearchData = false;

    // Skip search only for very basic interactions
    const skipSearchPatterns = [
      /^(hi|hello|hey|good morning|good afternoon|good evening)$/i,
      /^(thanks|thank you|ok|okay|yes|no)$/i,
      /^(how are you|what's up|sup)$/i
    ];

    const shouldSkipSearch = skipSearchPatterns.some(pattern => pattern.test(message.trim()));

    if (!shouldSkipSearch && needsRealTimeSearch(message)) {
      console.log('🔍 Performing enhanced web search for:', message);
      searchContext = await performWebSearch(message);
      if (searchContext) {
        hasSearchData = true;
        enrichedMessage = `${message}\n\n${searchContext}`;
        console.log('✅ Search completed successfully');
      } else {
        console.log('⚠️ Search returned no results');
      }
    } else {
      console.log('⏭️ Skipping search for basic interaction:', message);
    }

    // Get user's trading data
    const { data: sessions, error: sessionsError } = await supabaseClient
      .from('trading_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (sessionsError) {
      throw new Error('Failed to fetch sessions');
    }

    const { data: trades, error: tradesError } = await supabaseClient
      .from('trades')
      .select('*, trading_sessions!inner(name)')
      .eq('trading_sessions.user_id', userId)
      .order('created_at', { ascending: false });

    if (tradesError) {
      throw new Error('Failed to fetch trades');
    }

    // Prepare context for AI
    const tradingContext = {
      sessions: sessions || [],
      trades: trades || [],
      totalSessions: sessions?.length || 0,
      totalTrades: trades?.length || 0,
      currentDate: new Date().toISOString(),
    };

    // Calculate some basic stats for context
    const totalProfit = trades?.reduce((sum, trade) => sum + trade.profit_loss, 0) || 0;
    const winningTrades = trades?.filter(trade => trade.profit_loss > 0).length || 0;
    const losingTrades = trades?.filter(trade => trade.profit_loss < 0).length || 0;
    const winRate = trades?.length ? (winningTrades / trades.length) * 100 : 0;

    const systemPrompt = `You are Sydney, an AI trading assistant for Laxmi Chit Fund's trading analytics platform. You are helpful, friendly, conversational, and knowledgeable about trading, markets, geopolitics, and current events.

PERSONALITY:
- Be conversational and natural like ChatGPT
- Use appropriate emojis to make responses engaging (but not too many)
- Ask follow-up questions to keep conversations flowing
- Remember context from recent messages
- Be encouraging and supportive about trading journey
- Handle trading topics, current events, geopolitics, markets, and general conversation
- Show genuine interest in the user's trading progress and world events
- Be knowledgeable about financial markets, economics, geopolitics, and current affairs

CONVERSATION CONTEXT:
${conversationContext || 'No previous conversation'}

USER'S TRADING DATA SUMMARY:
- Total Sessions: ${tradingContext.totalSessions}
- Total Trades: ${tradingContext.totalTrades}
- Total P/L: $${totalProfit.toFixed(2)}
- Win Rate: ${winRate.toFixed(1)}%
- Winning Trades: ${winningTrades}
- Losing Trades: ${losingTrades}

Recent Sessions: ${JSON.stringify(sessions?.slice(0, 3), null, 2)}
Recent Trades: ${JSON.stringify(trades?.slice(0, 5), null, 2)}

${hasSearchData ? `
🌐 LIVE INTERNET ACCESS - REAL-TIME INFORMATION:
I have complete access to current internet information for this query. The search results below are live and up-to-date as of right now.

ORIGINAL USER QUESTION: "${originalMessage || message}"

LIVE SEARCH RESULTS FROM THE INTERNET:
${searchContext}

IMPORTANT: Use this live internet data to provide accurate, current, and comprehensive responses. This information is fresh from the web and should be your primary source for current events, market data, geopolitical developments, and any time-sensitive information.

Analyze the search results, provide insights, connect dots between different pieces of information, and relate findings to trading/markets when relevant.
` : ''}

${hasLiveData ? `
🌐 LIVE DATA INTEGRATION:
The user's message has been enriched with real-time market data or web search results. This information is current and accurate. Use it naturally in your response.

ORIGINAL USER MESSAGE: "${originalMessage}"
ENRICHED MESSAGE WITH LIVE DATA: "${enrichedMessage}"

Please incorporate the live data naturally into your response. Don't just repeat it - analyze it, provide insights, and relate it to trading.
` : ''}

ENHANCED CAPABILITIES WITH COMPLETE INTERNET ACCESS:
1. Real-time market analysis (crypto, stocks, forex, commodities)
2. Live geopolitical developments and their market impact
3. Breaking news and current events analysis
4. Economic data and central bank decisions
5. Company earnings, mergers, acquisitions
6. Weather, sports, and general current events
7. Cryptocurrency and DeFi developments
8. Government policies and regulatory changes
9. International trade and sanctions
10. Social and political movements affecting markets
11. Technology trends and their market implications
12. Energy markets and commodity prices

RESPONSE GUIDELINES:
- Provide comprehensive, well-informed responses using live internet data
- Connect current events to potential trading/market implications
- Be analytical and insightful, not just informative
- Use specific data from search results to support your points
- Relate geopolitical events to market movements when relevant
- Explain complex topics in an accessible way
- Ask follow-up questions to encourage deeper discussion
- Use emojis appropriately to maintain engagement
- Always cite that information is current/live when using search results
- Provide actionable insights for traders when applicable

Current date: ${new Date().toLocaleDateString()}
Current time: ${new Date().toLocaleTimeString()}

Respond naturally and comprehensively to the user's message. If live internet search data was provided, use it as your primary source for current information and provide detailed analysis and insights.`;

    // Use Gemini API with enhanced parameters for better responses
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': 'AIzaSyDQVkAyAqPuonnplLxqEhhGyW_FqjteaVw',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: systemPrompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7, // Slightly lower for more factual responses
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1500, // Increased for more comprehensive responses
        }
      }),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      throw new Error('Gemini API request failed');
    }

    const aiData = await geminiResponse.json();
    const aiMessage = aiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not process your request.';

    return new Response(
      JSON.stringify({ 
        message: aiMessage,
        usage: aiData.usageMetadata,
        hasLiveData: hasSearchData || hasLiveData,
        searchPerformed: hasSearchData
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in AI chat function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process chat request',
        details: error.message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});