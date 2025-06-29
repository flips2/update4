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

// Simplified function - search for almost everything except basic greetings
function needsRealTimeSearch(message: string): boolean {
  const lowerMessage = message.toLowerCase().trim();
  
  // Only skip search for very basic greetings
  const skipPatterns = [
    /^(hi|hello|hey)$/,
    /^(thanks|thank you|ok|okay)$/,
    /^(yes|no)$/
  ];
  
  const shouldSkip = skipPatterns.some(pattern => pattern.test(lowerMessage));
  
  console.log(`🔍 Search decision for "${message}": ${shouldSkip ? 'SKIP' : 'SEARCH'}`);
  return !shouldSkip;
}

// Enhanced web search function with comprehensive error handling
async function performWebSearch(query: string): Promise<string> {
  console.log('🌐 Starting web search for:', query);
  
  try {
    // Check environment variable first
    let serperApiKey = Deno.env.get('SERPER_API_KEY');
    console.log('🔑 SERPER_API_KEY from env:', serperApiKey ? 'Found' : 'Not found');
    
    // Use hardcoded key for debugging if env var not found
    if (!serperApiKey) {
      serperApiKey = 'd37d92d960bfa9381d3c6151a15779d9613c2706';
      console.log('🔑 Using hardcoded API key for debugging');
    }

    // Optimize search query
    let optimizedQuery = query;
    
    // Add current date for time-sensitive queries
    if (query.toLowerCase().includes('today') || query.toLowerCase().includes('now') || query.toLowerCase().includes('current')) {
      const currentDate = new Date().toISOString().split('T')[0];
      optimizedQuery = `${query} ${currentDate}`;
    }
    
    // Add market context for financial queries
    if (query.toLowerCase().includes('price') || query.toLowerCase().includes('bitcoin') || query.toLowerCase().includes('stock')) {
      optimizedQuery = `${query} latest market data`;
    }

    console.log('🔍 Optimized search query:', optimizedQuery);

    const requestBody = { 
      q: optimizedQuery,
      num: 5
    };
    
    console.log('📤 Sending request to Serper API...');
    console.log('📤 Request body:', JSON.stringify(requestBody));

    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': serperApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    console.log('📥 Serper API response status:', response.status);
    console.log('📥 Serper API response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Serper API error:', response.status, response.statusText);
      console.error('❌ Error response body:', errorText);
      return '';
    }

    const data = await response.json();
    console.log('📊 Serper API response data keys:', Object.keys(data));
    console.log('📊 Number of organic results:', data.organic?.length || 0);

    // Extract search results
    const results: SearchResult[] = (data.organic || []).slice(0, 5).map((result: any) => ({
      title: result.title || '',
      snippet: result.snippet || '',
      link: result.link || '',
    }));

    console.log('📋 Extracted results count:', results.length);

    if (results.length === 0) {
      console.log('⚠️ No search results found');
      return '';
    }

    // Format comprehensive search context
    let searchContext = `🌐 LIVE SEARCH RESULTS for "${query}":\n\n`;
    
    // Include knowledge graph if available
    if (data.knowledgeGraph) {
      searchContext += `📊 Quick Facts: ${data.knowledgeGraph.title || ''} - ${data.knowledgeGraph.description || ''}\n\n`;
    }

    // Include answer box if available
    if (data.answerBox) {
      searchContext += `💡 Direct Answer: ${data.answerBox.answer || data.answerBox.snippet || ''}\n\n`;
    }
    
    searchContext += `📰 Latest Information:\n`;
    results.forEach((result, index) => {
      searchContext += `${index + 1}. **${result.title}**\n`;
      searchContext += `   ${result.snippet}\n`;
      searchContext += `   Source: ${result.link}\n\n`;
    });

    console.log('✅ Search context generated successfully, length:', searchContext.length);
    console.log('📄 Search context preview:', searchContext.substring(0, 200) + '...');

    return searchContext;
  } catch (error) {
    console.error('❌ Web search error:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    return '';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🚀 AI Chat function started');
    
    // Log environment variable status
    const serperKey = Deno.env.get('SERPER_API_KEY');
    console.log('🔑 Environment check - SERPER_API_KEY:', serperKey ? 'Available' : 'Missing');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { message, originalMessage, sessionId, userId, conversationContext, hasLiveData }: ChatRequest = await req.json();
    console.log('📨 Received message:', message);

    // TEMPORARILY BYPASS CONDITION FOR TESTING - ALWAYS SEARCH
    console.log('🧪 TESTING MODE: Performing search for all messages');
    
    let searchContext = '';
    let hasSearchData = false;

    // Perform search for every message (testing mode)
    console.log('🔍 Initiating web search...');
    searchContext = await performWebSearch(message);
    
    if (searchContext) {
      hasSearchData = true;
      console.log('✅ Search successful - context length:', searchContext.length);
    } else {
      console.log('❌ Search failed or returned empty results');
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

    // Calculate trading stats
    const totalProfit = trades?.reduce((sum, trade) => sum + trade.profit_loss, 0) || 0;
    const winningTrades = trades?.filter(trade => trade.profit_loss > 0).length || 0;
    const losingTrades = trades?.filter(trade => trade.profit_loss < 0).length || 0;
    const winRate = trades?.length ? (winningTrades / trades.length) * 100 : 0;

    // Create enhanced system prompt with search results
    const systemPrompt = `You are Sydney, an AI trading assistant with COMPLETE INTERNET ACCESS. You are helpful, friendly, conversational, and knowledgeable about trading, markets, geopolitics, and current events.

PERSONALITY:
- Be conversational and natural like ChatGPT
- Use appropriate emojis to make responses engaging
- Ask follow-up questions to keep conversations flowing
- Be encouraging and supportive about trading journey
- Handle trading topics, current events, geopolitics, markets, and general conversation
- Show genuine interest in world events and trading progress

USER'S TRADING DATA:
- Total Sessions: ${sessions?.length || 0}
- Total Trades: ${trades?.length || 0}
- Total P/L: $${totalProfit.toFixed(2)}
- Win Rate: ${winRate.toFixed(1)}%

${hasSearchData ? `
🌐 LIVE INTERNET SEARCH RESULTS:
I have access to real-time internet information for your question. Here are the latest search results:

${searchContext}

IMPORTANT: Use this live internet data as your primary source. This information is current and up-to-date. Analyze it, provide insights, and relate it to trading/markets when relevant.
` : ''}

CAPABILITIES:
- Real-time market data and analysis
- Live geopolitical developments
- Breaking news and current events
- Economic data and central bank decisions
- Cryptocurrency and stock market updates
- Weather, sports, and general information
- Company earnings and financial news

USER QUESTION: "${message}"

Provide a comprehensive, well-informed response using the live search data above. Connect current events to trading implications when relevant. Be analytical and insightful.

Current date: ${new Date().toLocaleDateString()}
Current time: ${new Date().toLocaleTimeString()}`;

    console.log('🤖 Sending request to Gemini API...');

    // Use Gemini API
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
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1500,
        }
      }),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('❌ Gemini API error:', errorText);
      throw new Error('Gemini API request failed');
    }

    const aiData = await geminiResponse.json();
    const aiMessage = aiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not process your request.';

    console.log('✅ AI response generated successfully');
    console.log('📊 Response length:', aiMessage.length);

    return new Response(
      JSON.stringify({ 
        message: aiMessage,
        usage: aiData.usageMetadata,
        hasLiveData: hasSearchData,
        searchPerformed: hasSearchData,
        debugInfo: {
          searchContextLength: searchContext.length,
          apiKeyAvailable: !!serperKey,
          searchQuery: message
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('❌ Error in AI chat function:', error);
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