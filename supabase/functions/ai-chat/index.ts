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

// Log environment variable at the top
console.log('🔑 SERPER_API_KEY is:', Deno.env.get('SERPER_API_KEY'));

// Enhanced web search function with comprehensive debugging
async function performWebSearch(query: string): Promise<string> {
  console.log('🔍 About to call Serper.dev with query:', query);
  
  try {
    // Get API key with fallback
    let serperApiKey = Deno.env.get('SERPER_API_KEY');
    if (!serperApiKey) {
      serperApiKey = 'd37d92d960bfa9381d3c6151a15779d9613c2706';
      console.log('🔑 Using hardcoded API key as fallback');
    }

    const requestBody = { 
      q: query,
      num: 5
    };

    // Log the full request configuration
    const config = {
      method: 'POST',
      url: 'https://google.serper.dev/search',
      headers: {
        'X-API-KEY': serperApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    };
    
    console.log('⚙️ Request config:', JSON.stringify(config, null, 2));
    console.log('📤 Making request to Serper.dev...');

    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': serperApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    console.log('📥 Response status:', response.status);
    console.log('📥 Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Serper.dev request failed - Status:', response.status);
      console.error('❌ Error response:', errorText);
      throw new Error(`Serper API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('📊 Serper response data keys:', Object.keys(data));
    console.log('📊 Number of results:', data.organic?.length || 0);

    // Format search results
    const results = (data.organic || []).slice(0, 3);
    let searchContext = `Search Results:\n\n`;
    
    results.forEach((result: any, index: number) => {
      searchContext += `${index + 1}. ${result.title}\n`;
      searchContext += `${result.snippet}\n`;
      searchContext += `${result.link}\n\n`;
    });

    console.log('📥 Serper.dev returned:', searchContext.substring(0, 200) + '...');
    return searchContext;

  } catch (err) {
    console.error('❌ Serper.dev request failed:', err);
    console.error('❌ Error details:', err.message);
    console.error('❌ Error stack:', err.stack);
    throw err;
  }
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

    // BYPASS ALL CONDITIONS - SEARCH FOR EVERY MESSAGE
    console.log('🧪 TESTING MODE: Bypassing all conditions, searching for:', message);
    
    let searchContext = '';
    try {
      searchContext = await performWebSearch(message);
      console.log('✅ Search completed successfully');
    } catch (searchError) {
      console.error('❌ Search failed:', searchError);
      searchContext = '';
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

    // Calculate basic stats for context
    const totalProfit = trades?.reduce((sum, trade) => sum + trade.profit_loss, 0) || 0;
    const winningTrades = trades?.filter(trade => trade.profit_loss > 0).length || 0;
    const totalTrades = trades?.length || 0;
    const winRate = totalTrades ? (winningTrades / totalTrades) * 100 : 0;

    // Create system prompt with search context
    const systemPrompt = `You are Sydney, a friendly AI trading assistant with complete internet access.

User Stats: ${totalTrades} trades, ${winRate.toFixed(1)}% win rate, $${totalProfit.toFixed(2)} total P/L

${searchContext ? `
LIVE INTERNET DATA:
${searchContext}

Use this real-time information to answer the user's question: "${message}"
` : ''}

User Question: ${message}

Respond naturally and helpfully. If you have live data, use it to provide current, accurate information.`;

    console.log('🤖 Sending to Gemini with search context length:', searchContext.length);

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
          temperature: 0.8,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1000,
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
        debugInfo: {
          searchPerformed: true,
          searchContextLength: searchContext.length,
          apiKeyFound: !!Deno.env.get('SERPER_API_KEY'),
          query: message
        }
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