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

// Web search function using native fetch() for Deno compatibility
async function performWebSearch(query: string): Promise<string> {
  console.log('🔍 Starting web search for:', query);
  
  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': 'd37d92d960bfa9381d3c6151a15779d9613c2706',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        num: 5
      })
    });

    console.log('📡 Serper response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Serper API error:', response.status, errorText);
      throw new Error(`Serper API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('📊 Serper returned', data.organic?.length || 0, 'results');
    
    // Format results for Gemini
    const results = data.organic?.slice(0, 5).map((result: any) => 
      `Title: ${result.title}\nSnippet: ${result.snippet}\nURL: ${result.link}`
    ).join('\n\n') || 'No results found';
    
    console.log('✅ Serper search successful, credits should be used');
    return `LIVE SEARCH RESULTS:\n\n${results}`;
    
  } catch (error) {
    console.error('❌ Web search failed:', error);
    return 'Search unavailable';
  }
}

// Smart search detection
function needsRealTimeSearch(message: string): boolean {
  const searchKeywords = [
    'current', 'now', 'today', 'latest', 'recent', 'news',
    'weather', 'price', 'bitcoin', 'crypto', 'stock',
    'war', 'election', 'breaking', 'update', 'situation',
    'who won', 'score', 'match', 'game', 'live'
  ];
  
  const lowerMessage = message.toLowerCase();
  return searchKeywords.some(keyword => lowerMessage.includes(keyword));
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

    let finalPrompt = '';
    let searchPerformed = false;

    // Check if real-time search is needed
    if (needsRealTimeSearch(message)) {
      console.log('🌐 Real-time search triggered for:', message);
      try {
        const searchResults = await performWebSearch(message);
        searchPerformed = true;
        
        finalPrompt = `You are Sydney, a helpful AI trading assistant with access to real-time information.

${searchResults}

USER QUESTION: ${message}

User Trading Stats: ${totalTrades} trades, ${winRate.toFixed(1)}% win rate, $${totalProfit.toFixed(2)} total P/L

Use the search results above to provide an accurate, up-to-date response. Incorporate the real-time data naturally into your answer. Always mention when you're using current information.`;

      } catch (searchError) {
        console.error('🚫 Search failed, falling back to regular chat:', searchError);
        searchPerformed = false;
      }
    }

    // If no search was performed or search failed, use regular prompt
    if (!searchPerformed) {
      finalPrompt = `You are Sydney, a friendly AI trading assistant for Laxmi Chit Fund's trading analytics platform.

User Stats: ${totalTrades} trades, ${winRate.toFixed(1)}% win rate, $${totalProfit.toFixed(2)} total P/L

${conversationContext ? `Recent conversation:\n${conversationContext}\n\n` : ''}

User Question: ${message}

Respond naturally and helpfully about trading, markets, or general conversation.`;
    }

    console.log('🤖 Sending to Gemini, search performed:', searchPerformed);

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
                text: finalPrompt
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
          searchPerformed,
          query: message,
          searchTriggered: needsRealTimeSearch(message)
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