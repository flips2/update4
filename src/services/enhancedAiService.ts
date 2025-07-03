import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from '../lib/supabase';
import { ExtractedTradeData, ChatMessage } from '../types';

const genAI = new GoogleGenerativeAI('AIzaSyDQVkAyAqPuonnplLxqEhhGyW_FqjteaVw');

export class EnhancedAIService {
  private model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" }); // Updated to Gemini 2.0 Flash
  private fallbackResponses = [
    "I'm experiencing high demand right now. Let me help you with your trading analysis in a moment! 📊",
    "My systems are busy processing other requests. Meanwhile, feel free to add your trades manually! 💪",
    "I'm temporarily unavailable, but your trading data is safe. Try again in a few moments! 🔄",
    "High traffic detected! While I recover, you can still use all other features of the platform! ⚡"
  ];

  // Store conversation context in memory for each user
  private conversationContexts: Map<string, Array<{role: 'user' | 'assistant', content: string, timestamp: Date}>> = new Map();

  // Track quota usage to prevent unnecessary API calls
  private quotaExceeded = false;
  private quotaResetTime: Date | null = null;

  private getRandomFallback(): string {
    return this.fallbackResponses[Math.floor(Math.random() * this.fallbackResponses.length)];
  }

  private checkQuotaStatus(): boolean {
    // If quota was exceeded, check if enough time has passed (reset daily)
    if (this.quotaExceeded && this.quotaResetTime) {
      const now = new Date();
      const timeSinceReset = now.getTime() - this.quotaResetTime.getTime();
      const hoursElapsed = timeSinceReset / (1000 * 60 * 60);
      
      // Reset quota status after 24 hours
      if (hoursElapsed >= 24) {
        this.quotaExceeded = false;
        this.quotaResetTime = null;
        return true;
      }
      return false;
    }
    return !this.quotaExceeded;
  }

  private markQuotaExceeded(): void {
    this.quotaExceeded = true;
    this.quotaResetTime = new Date();
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 2, // Reduced retries to conserve quota
    baseDelay: number = 2000 // Increased base delay
  ): Promise<T> {
    // Check quota status before attempting
    if (!this.checkQuotaStatus()) {
      throw new Error('AI analysis quota exceeded. Please try again tomorrow or enter data manually.');
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        console.error(`Attempt ${attempt} failed:`, error);
        
        // Check if it's a quota error
        if (error.message?.includes('429') || error.message?.includes('quota') || error.message?.includes('exceeded')) {
          this.markQuotaExceeded();
          throw new Error('AI analysis quota exceeded for today. The service will reset tomorrow. Please enter your trade data manually for now.');
        }
        
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Only retry for non-quota errors
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error('Max retries exceeded');
  }

  // Get current date and time information for Sydney
  private getCurrentDateTimeInfo(): string {
    const now = new Date();
    
    // Get comprehensive date/time information
    const dateInfo = {
      fullDate: now.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      }),
      time: now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
      month: now.toLocaleDateString('en-US', { month: 'long' }),
      year: now.getFullYear(),
      hour: now.getHours(),
      minute: now.getMinutes(),
      isWeekend: now.getDay() === 0 || now.getDay() === 6,
      isBusinessHours: now.getHours() >= 9 && now.getHours() <= 17,
      season: this.getCurrentSeason(now),
      marketStatus: this.getMarketStatus(now)
    };

    return `CURRENT DATE & TIME INFORMATION:
📅 Today is: ${dateInfo.fullDate}
🕐 Current time: ${dateInfo.time} (${dateInfo.timezone})
📊 Market status: ${dateInfo.marketStatus}
🌍 Season: ${dateInfo.season}
💼 Business hours: ${dateInfo.isBusinessHours ? 'Yes' : 'No'}
🎯 Weekend: ${dateInfo.isWeekend ? 'Yes' : 'No'}

Use this real-time information naturally in your responses when relevant (time-based greetings, market hours, weekend references, etc.).`;
  }

  private getCurrentSeason(date: Date): string {
    const month = date.getMonth() + 1; // getMonth() returns 0-11
    const day = date.getDate();
    
    if ((month === 12 && day >= 21) || month === 1 || month === 2 || (month === 3 && day < 20)) {
      return 'Winter ❄️';
    } else if ((month === 3 && day >= 20) || month === 4 || month === 5 || (month === 6 && day < 21)) {
      return 'Spring 🌸';
    } else if ((month === 6 && day >= 21) || month === 7 || month === 8 || (month === 9 && day < 23)) {
      return 'Summer ☀️';
    } else {
      return 'Autumn 🍂';
    }
  }

  private getMarketStatus(date: Date): string {
    const hour = date.getHours();
    const day = date.getDay(); // 0 = Sunday, 6 = Saturday
    
    // Weekend
    if (day === 0 || day === 6) {
      return 'Markets Closed (Weekend) 🏖️';
    }
    
    // Weekday market hours (approximate US market hours)
    if (hour >= 9 && hour < 16) {
      return 'Markets Open 📈';
    } else if (hour >= 16 && hour < 20) {
      return 'After Hours Trading 🌆';
    } else if (hour >= 4 && hour < 9) {
      return 'Pre-Market Trading 🌅';
    } else {
      return 'Markets Closed 🌙';
    }
  }

  // Add message to conversation context
  private addToConversationContext(userId: string, role: 'user' | 'assistant', content: string): void {
    if (!this.conversationContexts.has(userId)) {
      this.conversationContexts.set(userId, []);
    }
    
    const context = this.conversationContexts.get(userId)!;
    context.push({
      role,
      content,
      timestamp: new Date()
    });
    
    // Keep only the last 20 messages to manage memory and token usage
    if (context.length > 20) {
      context.splice(0, context.length - 20);
    }
  }

  // Get conversation context for a user
  private getConversationContext(userId: string): string {
    const context = this.conversationContexts.get(userId) || [];
    
    if (context.length === 0) {
      return "This is the start of our conversation.";
    }
    
    // Format the conversation history
    const formattedContext = context.map(msg => {
      const timeAgo = this.getTimeAgo(msg.timestamp);
      return `${msg.role === 'user' ? 'User' : 'Sydney'} (${timeAgo}): ${msg.content}`;
    }).join('\n\n');
    
    return `CONVERSATION HISTORY (Last ${context.length} messages):
${formattedContext}

Remember this context and refer to it naturally in your responses. Build upon previous topics, remember what the user has told you, and maintain conversation continuity.`;
  }

  // Helper function to get time ago string
  private getTimeAgo(timestamp: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - timestamp.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  // Clear conversation context for a user (useful for new sessions)
  public clearConversationContext(userId: string): void {
    this.conversationContexts.delete(userId);
  }

  // Load conversation context from database on initialization
  private async loadConversationContextFromDB(userId: string): Promise<void> {
    try {
      const { data: messages, error } = await supabase
        .from('chat_messages')
        .select('message, message_type, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(20); // Load last 20 messages

      if (error) {
        console.warn('Could not load conversation history from database:', error);
        return;
      }

      if (messages && messages.length > 0) {
        const context: Array<{role: 'user' | 'assistant', content: string, timestamp: Date}> = [];
        
        messages.forEach(msg => {
          context.push({
            role: msg.message_type === 'user' ? 'user' : 'assistant',
            content: msg.message,
            timestamp: new Date(msg.created_at)
          });
        });
        
        this.conversationContexts.set(userId, context);
      }
    } catch (error) {
      console.warn('Error loading conversation context from database:', error);
    }
  }

  async analyzeScreenshot(imageFile: File): Promise<ExtractedTradeData> {
    // Check quota status before attempting analysis
    if (!this.checkQuotaStatus()) {
      throw new Error('AI analysis quota exceeded for today. The service will reset tomorrow. Please enter your trade data manually for now.');
    }

    try {
      // Convert file to base64
      const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]); // Remove data:image/... prefix
        };
        reader.readAsDataURL(imageFile);
      });

      // Simplified prompt for better quota efficiency
      const prompt = `Analyze this trading table screenshot and extract ALL visible data. This is a trading history table with the following structure:

**TABLE FORMAT (left to right columns):**
1. Symbol (e.g., XAU/USD, EUR/USD)
2. Type (Buy/Sell with colored indicators)
3. Volume/Lot size (decimal numbers like 0.01, 0.1)
4. Open Price (entry price)
5. Close Price (exit price) 
6. **T/P (Take Profit)** - CRITICAL: This is column 6, always extract this number
7. **S/L (Stop Loss)** - CRITICAL: This is column 7, always extract this number
8. Position ID or status
9. Open Time (format: "Jun 16, 8:50:55 PM")
10. Close Time (format: "Jun 16, 11:41:00 PM")
11. Additional columns (Swap, Reason, P/L)

**CRITICAL EXTRACTION RULES:**
- T/P and S/L are ALWAYS in columns 6 and 7 - extract these numbers even if they look like prices
- Times are in format "Jun 16, 8:50:55 PM" - convert to ISO format "2024-06-16T20:50:55Z"
- Numbers may have commas (3,401.188) - extract as numbers without commas
- Look for +/- in P/L column for profit/loss values
- The table has NO headers - identify columns by position from left to right

**DATETIME CONVERSION:**
- "Jun 16, 8:50:55 PM" → "2024-06-16T20:50:55Z"
- "Jun 16, 11:41:00 PM" → "2024-06-16T23:41:00Z"
- Convert AM/PM to 24-hour format
- Assume current year (2024) if not specified

Return ONLY this JSON structure:

{
  "symbol": "extracted symbol",
  "type": "Buy or Sell",
  "volumeLot": extracted_lot_size_number,
  "openPrice": open_price_number,
  "closePrice": close_price_number,
  "tp": take_profit_from_column_6,
  "sl": stop_loss_from_column_7,
  "position": "Open or Closed",
  "openTime": "ISO_datetime_string",
  "closeTime": "ISO_datetime_string",
  "reason": "reason_if_visible",
  "pnlUsd": profit_loss_number
}

MANDATORY: Extract T/P and S/L from columns 6 and 7. Do NOT return null for these if numbers are visible in those positions.`;

      const result = await this.retryWithBackoff(async () => {
        return await this.model.generateContent([
          prompt,
          {
            inlineData: {
              data: base64Data,
              mimeType: imageFile.type
            }
          }
        ]);
      });

      const response = await result.response;
      const text = response.text();
      
      // Add debug logging to help troubleshoot extraction issues
      console.log('AI Response:', text);
      
      try {
        // Clean the response text first
        let cleanText = text.trim();
        
        // Remove any markdown formatting
        cleanText = cleanText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        
        // Try to parse the response as JSON
        let parsedData = JSON.parse(cleanText);
        
        // Validate and clean the data
        parsedData = this.validateAndCleanExtractedData(parsedData);
        
        // Log the final extracted data for debugging
        console.log('Extracted Data:', parsedData);
        
        return parsedData;
      } catch (parseError) {
        // Try to extract JSON from various formats
        const patterns = [
          /```json\n([\s\S]*?)\n```/,
          /```\n([\s\S]*?)\n```/,
          /\{[\s\S]*\}/
        ];
        
        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (match) {
            try {
              let jsonStr = match[1] || match[0];
              jsonStr = jsonStr.trim();
              
              let parsedData = JSON.parse(jsonStr);
              parsedData = this.validateAndCleanExtractedData(parsedData);
              return parsedData;
            } catch (e) {
              continue;
            }
          }
        }
        
        throw new Error('Could not extract valid JSON from AI response');
      }
    } catch (error: any) {
      console.error('Screenshot analysis error:', error);
      
      // Handle quota errors specifically
      if (error.message?.includes('429') || error.message?.includes('quota') || error.message?.includes('exceeded')) {
        this.markQuotaExceeded();
        throw new Error('AI analysis quota exceeded for today. The service will reset tomorrow. Please enter your trade data manually for now.');
      }
      
      throw new Error('Failed to analyze screenshot. Please ensure the image shows clear trading information.');
    }
  }

  private validateAndCleanExtractedData(data: any): ExtractedTradeData {
    // Ensure all expected fields exist and have proper types
    const cleanData: ExtractedTradeData = {
      symbol: data.symbol || undefined,
      type: data.type || undefined,
      volumeLot: this.parseNumber(data.volumeLot),
      openPrice: this.parseNumber(data.openPrice),
      closePrice: this.parseNumber(data.closePrice),
      tp: this.parseNumber(data.tp),
      sl: this.parseNumber(data.sl),
      position: this.normalizePosition(data.position), // Apply position normalization
      openTime: this.parseDateTime(data.openTime),
      closeTime: this.parseDateTime(data.closeTime),
      reason: this.normalizeReason(data.reason), // Apply reason normalization
      pnlUsd: this.parseNumber(data.pnlUsd)
    };

    return cleanData;
  }

  private normalizePosition(value: any): string | undefined {
    if (!value || value === null || value === undefined) return undefined;
    
    // Convert to string and clean up
    const positionStr = value.toString().trim().toLowerCase();
    
    // Map known variations to database-accepted values
    if (positionStr.includes('closed') || positionStr === 'all closed' || positionStr === 'close') {
      return 'Closed';
    }
    
    if (positionStr.includes('open') || positionStr === 'opened') {
      return 'Open';
    }
    
    // If it's already in the correct format, return as is
    if (positionStr === 'open') return 'Open';
    if (positionStr === 'closed') return 'Closed';
    
    // If we can't recognize the value, return undefined to let the database handle it
    return undefined;
  }

  private normalizeReason(value: any): string | undefined {
    if (!value || value === null || value === undefined) return undefined;
    
    // Convert to string and clean up
    const reasonStr = value.toString().trim().toLowerCase();
    
    // Map known variations to database-accepted values
    if (reasonStr.includes('tp') || reasonStr.includes('take profit') || reasonStr.includes('takeprofit')) {
      return 'TP';
    }
    
    if (reasonStr.includes('sl') || reasonStr.includes('stop loss') || reasonStr.includes('stoploss')) {
      return 'SL';
    }
    
    if (reasonStr.includes('early') || reasonStr.includes('manual') || reasonStr.includes('close')) {
      return 'Early Close';
    }
    
    // If it's already in the correct format, return as is
    if (['TP', 'SL', 'Early Close', 'Other'].includes(reasonStr.toUpperCase())) {
      return reasonStr.charAt(0).toUpperCase() + reasonStr.slice(1).toLowerCase();
    }
    
    // Default to 'Other' for any unrecognized reason to prevent constraint violations
    return 'Other';
  }

  private parseNumber(value: any): number | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    
    // Convert to string and clean up
    let numStr = value.toString().trim();
    
    // Remove commas (for numbers like "3,401.188")
    numStr = numStr.replace(/,/g, '');
    
    // Remove any currency symbols or extra characters
    numStr = numStr.replace(/[$€£¥+\s]/g, '');
    
    // Handle negative numbers with parentheses or minus sign
    if (numStr.includes('(') && numStr.includes(')')) {
      numStr = '-' + numStr.replace(/[()]/g, '');
    }
    
    const parsed = parseFloat(numStr);
    return isNaN(parsed) ? undefined : parsed;
  }

  private parseDateTime(value: any): string | undefined {
    if (!value || value === null || value === undefined) return undefined;
    
    try {
      // Handle the specific format from the trading screenshots: "Jun 16, 8:50:55 PM"
      const dateStr = value.toString().trim();
      
      // If it's already in ISO format, return as is
      if (dateStr.includes('T') && dateStr.includes('-')) {
        const date = new Date(dateStr);
        return isNaN(date.getTime()) ? undefined : date.toISOString();
      }
      
      // Handle "Jun 16, 8:50:55 PM" format specifically
      const monthMap: { [key: string]: string } = {
        'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
        'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
        'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
      };
      
      // Match pattern like "Jun 16, 8:50:55 PM"
      const match = dateStr.match(/(\w{3})\s+(\d{1,2}),\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)/i);
      if (match) {
        const [, monthName, day, hour, minute, second, ampm] = match;
        const month = monthMap[monthName];
        
        if (month) {
          let hour24 = parseInt(hour);
          if (ampm.toUpperCase() === 'PM' && hour24 !== 12) {
            hour24 += 12;
          } else if (ampm.toUpperCase() === 'AM' && hour24 === 12) {
            hour24 = 0;
          }
          
          const year = new Date().getFullYear(); // Assume current year
          const isoString = `${year}-${month}-${day.padStart(2, '0')}T${hour24.toString().padStart(2, '0')}:${minute}:${second}Z`;
          
          const date = new Date(isoString);
          return isNaN(date.getTime()) ? undefined : date.toISOString();
        }
      }
      
      // Fallback to standard parsing
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return undefined;
      
      return date.toISOString();
    } catch (e) {
      console.error('DateTime parsing error:', e, 'for value:', value);
      return undefined;
    }
  }

  async processMessage(message: string, userId: string): Promise<string> {
    // Check quota status before processing
    if (!this.checkQuotaStatus()) {
      return "I'm currently at my daily usage limit for AI responses. The service will reset tomorrow! In the meantime, you can still add trades manually and use all other features. 🤖✨";
    }

    try {
      // Load conversation context from database if not already loaded
      if (!this.conversationContexts.has(userId)) {
        await this.loadConversationContextFromDB(userId);
      }

      // Add user message to conversation context
      this.addToConversationContext(userId, 'user', message);

      // Get user's trading context with simplified query
      const { data: sessions } = await supabase
        .from('trading_sessions')
        .select('id, name, current_capital, initial_capital')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5);

      const { data: trades } = await supabase
        .from('trades')
        .select('profit_loss, entry_side, created_at')
        .eq('session_id', sessions?.[0]?.id || '')
        .order('created_at', { ascending: false })
        .limit(10);

      // Calculate basic stats for context
      const totalProfit = trades?.reduce((sum, trade) => sum + trade.profit_loss, 0) || 0;
      const winningTrades = trades?.filter(trade => trade.profit_loss > 0).length || 0;
      const totalTrades = trades?.length || 0;
      const winRate = totalTrades ? (winningTrades / totalTrades) * 100 : 0;

      // Get real-time date/time information
      const dateTimeInfo = this.getCurrentDateTimeInfo();

      // Get conversation context
      const conversationContext = this.getConversationContext(userId);

      // Enhanced system prompt for natural conversations with real-time awareness and context
      const systemPrompt = `You are Sydney, a friendly and conversational AI assistant specializing in trading analytics. You're designed to be personable, engaging, and capable of both trading discussions AND general conversations.

${dateTimeInfo}

${conversationContext}

PERSONALITY TRAITS:
- Warm, friendly, and approachable like a knowledgeable friend
- Naturally curious and engaging in conversations
- Use appropriate emojis to express emotions and make conversations lively
- Remember context and build on previous conversations
- Show genuine interest in the user's life, not just trading
- Be supportive, encouraging, and sometimes playful
- Ask follow-up questions to keep conversations flowing
- Share insights, opinions, and even personal preferences when appropriate
- Be conversational like ChatGPT - natural, flowing, and engaging
- Use real-time date/time information naturally in responses
- ALWAYS reference previous conversation context when relevant
- Remember what the user has told you and build upon it
- Keep responses concise and to the point - avoid being overly verbose

CONVERSATION CAPABILITIES:
✅ Trading analysis and advice
✅ General life conversations (hobbies, weather, food, movies, etc.)
✅ Current events and news discussions
✅ Personal advice and support
✅ Jokes, fun facts, and entertainment
✅ Technology, science, and learning topics
✅ Travel, culture, and lifestyle discussions
✅ Problem-solving and brainstorming
✅ Emotional support and motivation
✅ Time-aware responses (greetings based on actual time, market hours, etc.)
✅ Context-aware responses (remember what we've discussed before)

USER'S TRADING CONTEXT (use when relevant):
- Total Trades: ${totalTrades}
- Total P/L: $${totalProfit.toFixed(2)}
- Win Rate: ${winRate.toFixed(1)}%
- Recent Sessions: ${sessions?.length || 0}

RESPONSE GUIDELINES:
- Be naturally conversational - don't always steer back to trading
- Match the user's energy and topic interest
- Use emojis appropriately to convey emotion and engagement
- Ask follow-up questions to show interest and keep conversations going
- Share opinions, preferences, and insights when appropriate
- Be supportive and encouraging in all topics
- If trading comes up, use their data for personalized insights
- Keep responses engaging and varied - avoid being repetitive
- Show personality and be memorable
- Be helpful across ALL topics, not just trading
- Use the current date/time information naturally when relevant
- Give time-appropriate greetings and responses
- Reference market hours, weekends, seasons naturally when relevant
- MOST IMPORTANTLY: Reference and build upon our conversation history
- Remember what the user has shared with you and show that you remember
- If this is a continuation of a previous topic, acknowledge it
- If the user asks about something we discussed before, reference that conversation
- KEEP RESPONSES CONCISE - aim for 2-3 sentences unless more detail is specifically requested

CONTEXT AWARENESS:
- Always check the conversation history before responding
- Reference previous topics, questions, or information the user shared
- Show continuity in our conversation
- If the user mentions something we discussed before, acknowledge it
- Build relationships by remembering personal details they've shared
- Don't repeat information you've already provided unless asked

Current User Message: "${message}"

Respond naturally and engagingly, using the conversation context to provide a contextual, personable response. Remember our conversation history and build upon it! Keep it concise and to the point.`;

      const result = await this.retryWithBackoff(async () => {
        return await this.model.generateContent(systemPrompt);
      });

      const response = await result.response;
      const aiResponse = response.text();
      
      // Add AI response to conversation context
      this.addToConversationContext(userId, 'assistant', aiResponse);
      
      console.log("Response of AI:", aiResponse);
      return aiResponse;
    } catch (error: any) {
      console.error('AI message processing error:', error);
      
      // Handle quota errors specifically
      if (error.message?.includes('429') || error.message?.includes('quota') || error.message?.includes('exceeded')) {
        this.markQuotaExceeded();
        return "I've reached my daily chat limit! 😅 The service will reset tomorrow. You can still use all other features of the platform in the meantime! 🚀";
      }
      
      return "I'm having trouble processing your message right now. Please try again in a moment! 🤖";
    }
  }

  async saveChatMessage(userId: string, message: string, response: string): Promise<void> {
    try {
      // Save user message
      await supabase.from('chat_messages').insert({
        user_id: userId,
        message,
        message_type: 'user'
      });

      // Save AI response
      await supabase.from('chat_messages').insert({
        user_id: userId,
        message: response,
        message_type: 'ai'
      });
    } catch (error) {
      console.error('Error saving chat message:', error);
    }
  }

  async getChatHistory(userId: string, limit: number = 20): Promise<ChatMessage[]> {
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching chat history:', error);
      return [];
    }
  }

  getGreeting(userName?: string): string {
    const now = new Date();
    const hour = now.getHours();
    
    let timeGreeting = '';
    if (hour >= 5 && hour < 12) {
      timeGreeting = 'Good morning';
    } else if (hour >= 12 && hour < 17) {
      timeGreeting = 'Good afternoon';
    } else if (hour >= 17 && hour < 22) {
      timeGreeting = 'Good evening';
    } else {
      timeGreeting = 'Good evening';
    }

    const name = userName ? ` ${userName}` : '';
    const greetings = [
      `${timeGreeting}${name}! How's your trading going today?`,
      `${timeGreeting}${name}! Ready to analyze some trades?`,
      `${timeGreeting}${name}! What's on your trading radar today?`,
      `${timeGreeting}${name}! Any exciting market moves catching your eye?`,
      `${timeGreeting}${name}! I'm here to help with your trading analysis!`
    ];
    
    // Use a simple rotation based on the day
    const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));
    return greetings[dayOfYear % greetings.length];
  }

  /**
   * Analyzes crypto trading screenshots specifically for crypto futures tables
   * Handles different column layout compared to forex trading tables
   */
  async analyzeCryptoScreenshot(imageFile: File): Promise<ExtractedTradeData> {
    // Check quota status before attempting analysis
    if (!this.checkQuotaStatus()) {
      throw new Error('AI analysis quota exceeded for today. The service will reset tomorrow. Please enter your trade data manually for now.');
    }

    try {
      // Convert file to base64
      const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]); // Remove data:image/... prefix
        };
        reader.readAsDataURL(imageFile);
      });

      // Crypto-specific prompt for crypto trading tables
      const prompt = `Analyze this CRYPTO trading table screenshot and extract ALL visible data. This is a crypto futures trading history table with the following structure:

**CRYPTO TABLE FORMAT (columns from left to right):**
1. Futures (Symbol) - e.g., "BTCUSDT Perpetual", "ETHUSDT Perpetual"
2. Margin Mode - "Cross" or "Isolated"
3. Avg Close Price - closing price (numbers like 107,128.9)
4. Direction - "Long" or "Short" (may have colored indicators)
5. Margin Adjustment History - usually "View History" text or actual history
6. Close Time - format: "2024-05-28 21:11:47" or similar timestamp
7. Closing Quantity - amount with USDT suffix (e.g., "548.5579 USDT")
8. Status - "All Closed", "Open", etc.
9. Realized PNL - profit/loss amount, often in green/red (e.g., "4,881 USDT", "+2,144 USD")
10. Open Time - format: "2024-05-28 18:57:22" or similar timestamp  
11. Avg Entry Price - entry price (numbers like 108,045.3)

**CRITICAL EXTRACTION RULES FOR CRYPTO:**
- Extract futures symbol INCLUDING "Perpetual" if present
- Direction is "Long" or "Short" (look for colored indicators)
- Times are in format "2024-05-28 21:11:47" - keep as ISO format
- Closing Quantity may have "USDT" suffix - extract just the number
- Realized PNL may have "USDT" or "USD" suffix - extract just the number
- Numbers may have commas (107,128.9) - extract as numbers without commas
- Look for + or - signs in PNL values for profit/loss
- The table has NO headers - identify columns by position from left to right

**DATETIME HANDLING:**
- Times are already in format "2024-05-28 21:11:47"
- Convert to ISO format: "2024-05-28T21:11:47Z"

Return ONLY this JSON structure:

{
  "futuresSymbol": "extracted_futures_symbol",
  "marginMode": "Cross or Isolated", 
  "avgClosePrice": close_price_number,
  "direction": "Long or Short",
  "marginAdjustmentHistory": "extracted_history_or_null",
  "closeTime": "ISO_datetime_string",
  "closingQuantity": closing_quantity_number,
  "realizedPnl": realized_pnl_number,
  "openTime": "ISO_datetime_string",
  "avgEntryPrice": entry_price_number
}

MANDATORY: Extract ALL visible numeric values and times. Do NOT return null for fields that have visible data in the table.`;

      const result = await this.retryWithBackoff(async () => {
        return await this.model.generateContent([
          prompt,
          {
            inlineData: {
              data: base64Data,
              mimeType: imageFile.type
            }
          }
        ]);
      });

      const response = await result.response;
      const text = response.text();
      
      // Add debug logging to help troubleshoot extraction issues
      console.log('Crypto AI Response:', text);
      
      try {
        // Clean the response text first
        let cleanText = text.trim();
        
        // Remove any markdown formatting
        cleanText = cleanText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        
        // Try to parse the response as JSON
        let parsedData = JSON.parse(cleanText);
        
        // Validate and clean the crypto data
        parsedData = this.validateAndCleanCryptoData(parsedData);
        
        // Log the final extracted data for debugging
        console.log('Extracted Crypto Data:', parsedData);
        
        return parsedData;
      } catch (parseError) {
        // Try to extract JSON from various formats
        const patterns = [
          /```json\n([\s\S]*?)\n```/,
          /```\n([\s\S]*?)\n```/,
          /\{[\s\S]*\}/
        ];
        
        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (match) {
            try {
              let jsonStr = match[1] || match[0];
              jsonStr = jsonStr.trim();
              
              let parsedData = JSON.parse(jsonStr);
              parsedData = this.validateAndCleanCryptoData(parsedData);
              return parsedData;
            } catch (e) {
              continue;
            }
          }
        }
        
        throw new Error('Could not extract valid JSON from AI response');
      }
    } catch (error: any) {
      console.error('Crypto screenshot analysis error:', error);
      
      // Handle quota errors specifically
      if (error.message?.includes('429') || error.message?.includes('quota') || error.message?.includes('exceeded')) {
        this.markQuotaExceeded();
        throw new Error('AI analysis quota exceeded for today. The service will reset tomorrow. Please enter your trade data manually for now.');
      }
      
      throw new Error('Failed to analyze crypto screenshot. Please ensure the image shows clear trading information.');
    }
  }

  private validateAndCleanCryptoData(data: any): ExtractedTradeData {
    // Ensure all expected crypto fields exist and have proper types
    const cleanData: ExtractedTradeData = {
      // Crypto specific fields
      futuresSymbol: data.futuresSymbol || undefined,
      marginMode: data.marginMode || undefined,
      avgClosePrice: this.parseNumber(data.avgClosePrice),
      direction: data.direction || undefined,
      marginAdjustmentHistory: data.marginAdjustmentHistory || undefined,
      closeTime: this.parseDateTime(data.closeTime),
      closingQuantity: this.parseNumber(data.closingQuantity),
      realizedPnl: this.parseNumber(data.realizedPnl),
      openTime: this.parseDateTime(data.openTime),
      avgEntryPrice: this.parseNumber(data.avgEntryPrice),
      
      // Map to common fields for compatibility
      symbol: data.futuresSymbol || undefined,
      type: data.direction === 'Long' ? 'Buy' : data.direction === 'Short' ? 'Sell' : undefined,
      openPrice: this.parseNumber(data.avgEntryPrice),
      closePrice: this.parseNumber(data.avgClosePrice),
      pnlUsd: this.parseNumber(data.realizedPnl),
      volumeLot: this.parseNumber(data.closingQuantity),
      position: this.normalizePosition(data.status || 'Closed'), // Apply position normalization for crypto data too
      reason: this.normalizeReason(data.reason) // Apply reason normalization for crypto data too
    };

    return cleanData;
  }

  // Public method to check if quota is available
  public isQuotaAvailable(): boolean {
    return this.checkQuotaStatus();
  }

  // Public method to get quota reset time
  public getQuotaResetTime(): Date | null {
    return this.quotaResetTime;
  }
}

export const enhancedAiService = new EnhancedAIService();