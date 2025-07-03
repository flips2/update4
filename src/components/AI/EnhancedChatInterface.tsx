import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MessageCircle, 
  Send, 
  X, 
  User, 
  Loader2,
  Minimize2,
  Maximize2,
  Trash2,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import { enhancedAiService } from '../../services/enhancedAiService';
import { useAuth } from '../../hooks/useAuth';
import { ChatMessage } from '../../types';
import toast from 'react-hot-toast';

// Sydney Avatar Component
const SydneyAvatar = ({ className = "w-4 h-4" }: { className?: string }) => (
  <div className={`${className} bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center`}>
    <svg viewBox="0 0 24 24" fill="none" className="w-3/4 h-3/4 text-white">
      <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2Z" fill="currentColor"/>
      <path d="M21 9V7L15 1H5C3.89 1 3 1.89 3 3V7H1V9H3V15C3 16.1 3.9 17 5 17V19C5 20.1 5.9 21 7 21H9C10.1 21 11 20.1 11 19V17H13V19C13 20.1 13.9 21 15 21H17C18.1 21 19 20.1 19 19V17C20.1 17 21 16.1 21 15V9H21ZM7 3H15L19 7V15H5V3H7Z" fill="currentColor"/>
    </svg>
  </div>
);

// Typewriter Effect Component
const TypewriterText: React.FC<{ 
  text: string; 
  speed?: number; 
  onComplete?: () => void;
  className?: string;
}> = ({ text, speed = 30, onComplete, className = "" }) => {
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (currentIndex < text.length) {
      const timer = setTimeout(() => {
        setDisplayedText(prev => prev + text[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }, speed);

      return () => clearTimeout(timer);
    } else if (!isComplete) {
      setIsComplete(true);
      onComplete?.();
    }
  }, [currentIndex, text, speed, onComplete, isComplete]);

  // Reset when text changes
  useEffect(() => {
    setDisplayedText('');
    setCurrentIndex(0);
    setIsComplete(false);
  }, [text]);

  return (
    <span className={className}>
      {displayedText}
      {!isComplete && (
        <motion.span
          animate={{ opacity: [1, 0] }}
          transition={{ duration: 0.8, repeat: Infinity, repeatType: "reverse" }}
          className="inline-block w-0.5 h-4 bg-current ml-0.5"
        />
      )}
    </span>
  );
};

// Enhanced Markdown renderer component
const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
  const renderMarkdown = (text: string) => {
    // Convert **text** to <strong>text</strong>
    let rendered = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Convert *text* to <em>text</em>
    rendered = rendered.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    
    // Convert ### text to <h3>text</h3>
    rendered = rendered.replace(/^### (.*$)/gm, '<h3 class="text-lg font-semibold text-white mt-3 mb-2">$1</h3>');
    
    // Convert ## text to <h2>text</h2>
    rendered = rendered.replace(/^## (.*$)/gm, '<h2 class="text-xl font-semibold text-white mt-4 mb-2">$1</h2>');
    
    // Convert # text to <h1>text</h1>
    rendered = rendered.replace(/^# (.*$)/gm, '<h1 class="text-2xl font-bold text-white mt-4 mb-3">$1</h1>');
    
    // Convert numbered lists (1. text)
    rendered = rendered.replace(/^(\d+)\.\s+(.*$)/gm, '<li class="ml-4 mb-1"><span class="font-semibold text-blue-400">$1.</span> $2</li>');
    
    // Convert bullet points
    rendered = rendered.replace(/^[•-]\s+(.*$)/gm, '<li class="ml-4 mb-1">• $1</li>');
    
    // Wrap consecutive <li> elements in <ul>
    rendered = rendered.replace(/(<li>.*?<\/li>(?:\s*<li>.*?<\/li>)*)/gs, '<ul class="my-2">$1</ul>');
    
    // Convert line breaks to <br> but preserve paragraph structure
    rendered = rendered.replace(/\n\n/g, '</p><p class="mb-2">');
    rendered = rendered.replace(/\n/g, '<br>');
    
    // Wrap in paragraph tags if not already wrapped
    if (!rendered.startsWith('<')) {
      rendered = `<p class="mb-2">${rendered}</p>`;
    }
    
    return rendered;
  };

  return (
    <div 
      className="markdown-content text-sm whitespace-pre-wrap leading-relaxed"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
};

interface EnhancedChatInterfaceProps {
  currentSessionId?: string;
}

const EnhancedChatInterface: React.FC<EnhancedChatInterfaceProps> = ({ currentSessionId }) => {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'limited' | 'offline'>('connected');
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isOpen && !isMinimized) {
      inputRef.current?.focus();
      if (messages.length === 0) {
        loadChatHistory();
      }
    }
  }, [isOpen, isMinimized]);

  const loadChatHistory = async () => {
    if (!user) return;
    
    setLoadingHistory(true);
    try {
      const history = await enhancedAiService.getChatHistory(user.id, 20);
      // Convert to display format
      const displayMessages = history.map(msg => ({
        id: msg.id.toString(),
        role: msg.message_type as 'user' | 'ai',
        content: msg.message,
        timestamp: new Date(msg.created_at),
      }));
      setMessages(displayMessages.reverse()); // Reverse to show oldest first
      setConnectionStatus('connected');
    } catch (error) {
      console.error('Failed to load chat history:', error);
      setConnectionStatus('limited');
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !user || isLoading) return;

    const userMessage = {
      id: Date.now().toString(),
      role: 'user' as const,
      content: inputMessage.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = inputMessage.trim();
    setInputMessage('');
    setIsLoading(true);

    // Create placeholder AI message for streaming
    const aiMessageId = (Date.now() + 1).toString();
    const placeholderAiMessage = {
      id: aiMessageId,
      role: 'ai' as const,
      content: '',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, placeholderAiMessage]);
    setStreamingMessageId(aiMessageId);

    try {
      const aiResponse = await enhancedAiService.processMessage(currentInput, user.id);

      // Update the placeholder message with the actual response
      setMessages(prev => prev.map(msg => 
        msg.id === aiMessageId 
          ? { ...msg, content: aiResponse }
          : msg
      ));
      
      // Save to database (don't block UI if this fails)
      try {
        await enhancedAiService.saveChatMessage(user.id, currentInput, aiResponse);
        setConnectionStatus('connected');
      } catch (saveError) {
        console.warn('Failed to save chat message:', saveError);
        setConnectionStatus('limited');
      }
    } catch (error: any) {
      console.error('Chat error:', error);
      
      let errorMessage = 'I\'m having trouble right now. Please try again in a moment! 🤖';
      
      if (error.message?.includes('quota') || error.message?.includes('429')) {
        errorMessage = 'I\'m experiencing high demand right now. Please try again in a few minutes! ⏰';
        setConnectionStatus('limited');
      } else {
        setConnectionStatus('offline');
      }
      
      // Update the placeholder message with error
      setMessages(prev => prev.map(msg => 
        msg.id === aiMessageId 
          ? { ...msg, content: errorMessage }
          : msg
      ));
      
      toast.error('Sydney is temporarily busy. Try again in a moment!');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTypewriterComplete = (messageId: string) => {
    if (streamingMessageId === messageId) {
      setStreamingMessageId(null);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setStreamingMessageId(null);
    // Clear conversation context in the AI service
    if (user) {
      enhancedAiService.clearConversationContext(user.id);
    }
    toast.success('Chat cleared and conversation context reset');
  };

  const refreshChat = async () => {
    if (!user) return;
    
    setLoadingHistory(true);
    try {
      // Clear current context and reload from database
      enhancedAiService.clearConversationContext(user.id);
      await loadChatHistory();
      toast.success('Chat refreshed with latest conversation history');
    } catch (error) {
      toast.error('Failed to refresh chat');
    } finally {
      setLoadingHistory(false);
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-400';
      case 'limited': return 'text-yellow-400';
      case 'offline': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'Online';
      case 'limited': return 'Limited';
      case 'offline': return 'Offline';
      default: return 'Unknown';
    }
  };

  if (!isOpen) {
    return (
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 bg-gradient-to-r from-purple-600 to-pink-600 text-white p-4 rounded-full shadow-lg hover:from-purple-700 hover:to-pink-700 transition-all z-50"
      >
        <MessageCircle className="w-6 h-6" />
        {connectionStatus !== 'connected' && (
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-500 rounded-full animate-pulse" />
        )}
      </motion.button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ 
        opacity: 1, 
        y: 0, 
        scale: 1,
        height: isMinimized ? 'auto' : '600px'
      }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className="fixed bottom-6 right-6 w-96 bg-slate-800 rounded-xl shadow-2xl border border-slate-700 z-50 flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <div className="flex items-center">
          <SydneyAvatar className="w-8 h-8 mr-3" />
          <div>
            <h3 className="text-white font-medium">Sydney</h3>
            <div className="flex items-center space-x-2">
              <p className="text-slate-400 text-xs">Your AI Trading Assistant</p>
              <div className={`w-2 h-2 rounded-full ${getStatusColor().replace('text-', 'bg-')}`} />
              <span className={`text-xs ${getStatusColor()}`}>{getStatusText()}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={refreshChat}
            disabled={loadingHistory}
            className="p-1 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            title="Refresh conversation context"
          >
            <RefreshCw className={`w-4 h-4 ${loadingHistory ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 text-slate-400 hover:text-white transition-colors"
          >
            {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {!isMinimized && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex flex-col flex-1"
          >
            {/* Connection Status Banner */}
            {connectionStatus !== 'connected' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="bg-yellow-900/20 border-b border-yellow-700/50 p-2"
              >
                <div className="flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-yellow-400" />
                  <span className="text-yellow-300 text-xs">
                    {connectionStatus === 'limited' 
                      ? 'Sydney is experiencing high demand. Some features may be limited.'
                      : 'Sydney is temporarily offline. Please try again later.'
                    }
                  </span>
                </div>
              </motion.div>
            )}

            {/* Messages with Enhanced Scrollbar */}
            <div className="flex-1 p-4 overflow-y-auto max-h-96 space-y-4 scrollbar-glow">
              {loadingHistory && (
                <div className="text-center text-slate-400 py-4">
                  <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" />
                  <p className="text-xs">Loading conversation history...</p>
                </div>
              )}

              {messages.length === 0 && !loadingHistory && (
                <div className="text-center text-slate-400 py-8">
                  <SydneyAvatar className="w-12 h-12 mx-auto mb-3" />
                  <p className="text-sm">Hi! I'm Sydney, your AI trading assistant.</p>
                  <p className="text-xs mt-1">I remember our conversations and can chat about anything!</p>
                  <div className="mt-4 space-y-2 text-xs">
                    <p className="text-slate-500">Try asking:</p>
                    <div className="space-y-1">
                      <p>"How's my trading performance?"</p>
                      <p>"Tell me a trading joke"</p>
                      <p>"What's Bitcoin doing today?"</p>
                      <p>"How was your day?"</p>
                    </div>
                  </div>
                </div>
              )}

              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex items-start space-x-2 max-w-[80%] ${
                    message.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''
                  }`}>
                    <div className={`p-2 rounded-full ${
                      message.role === 'user' 
                        ? 'bg-blue-600' 
                        : 'bg-gradient-to-br from-purple-500 to-pink-500'
                    }`}>
                      {message.role === 'user' ? (
                        <User className="w-3 h-3 text-white" />
                      ) : (
                        <SydneyAvatar className="w-3 h-3" />
                      )}
                    </div>
                    <div className={`p-3 rounded-lg ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-700 text-slate-100'
                    }`}>
                      {message.role === 'ai' && streamingMessageId === message.id ? (
                        <TypewriterText
                          text={message.content}
                          speed={25}
                          onComplete={() => handleTypewriterComplete(message.id)}
                          className="text-sm whitespace-pre-wrap"
                        />
                      ) : message.role === 'ai' ? (
                        <MarkdownRenderer content={message.content} />
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      )}
                      <p className="text-xs opacity-70 mt-1">
                        {message.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}

              {isLoading && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-start"
                >
                  <div className="flex items-start space-x-2">
                    <SydneyAvatar className="w-8 h-8" />
                    <div className="p-3 rounded-lg bg-slate-700 text-slate-100">
                      <div className="flex items-center space-x-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Sydney is thinking...</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 border-t border-slate-700">
              <div className="flex items-center space-x-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder={connectionStatus === 'connected' ? "Ask Sydney anything..." : "Limited functionality..."}
                  className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                  disabled={isLoading || connectionStatus === 'offline'}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!inputMessage.trim() || isLoading || connectionStatus === 'offline'}
                  className="p-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              
              {messages.length > 0 && (
                <div className="flex items-center justify-between mt-2">
                  <button
                    onClick={clearChat}
                    className="text-xs text-slate-400 hover:text-slate-300 transition-colors flex items-center"
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Clear & Reset Context
                  </button>
                  <span className="text-xs text-slate-500">
                    {messages.length} messages • Context preserved
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default EnhancedChatInterface;