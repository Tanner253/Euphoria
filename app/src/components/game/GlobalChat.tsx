'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useChat, ChatMessage } from '@/hooks/useChat';
import { X, Send, MessageCircle, Smile } from 'lucide-react';

// Common emojis for quick access
const QUICK_EMOJIS = ['🚀', '🔥', '💎', '🌙', '🎰', '💰', '🎯', '✨', '😎', '🤑', '📈', '📉'];

interface GlobalChatProps {
  walletAddress: string | null;
  isOpen: boolean;
  onClose: () => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MessageBubble({ 
  message, 
  isOwn 
}: { 
  message: ChatMessage; 
  isOwn: boolean;
}) {
  return (
    <div className={`flex flex-col mb-3 ${isOwn ? 'items-end' : 'items-start'}`}>
      {/* Username and time */}
      <div className={`flex items-center gap-2 mb-1 ${isOwn ? 'flex-row-reverse' : ''}`}>
        <span className={`text-xs font-mono ${isOwn ? 'text-emerald-400' : 'text-cyan-400'}`}>
          {message.displayName}
        </span>
        <span className="text-[10px] text-white/30">
          {formatTime(message.timestamp)}
        </span>
      </div>
      
      {/* Message bubble */}
      <div 
        className={`
          max-w-[80%] px-3 py-2 rounded-2xl text-sm
          ${isOwn 
            ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white rounded-br-sm' 
            : 'bg-white/10 text-white rounded-bl-sm border border-white/5'
          }
        `}
      >
        {message.message}
      </div>
    </div>
  );
}

export function GlobalChat({ walletAddress, isOpen, onClose }: GlobalChatProps) {
  const { messages, isConnected, sendMessage, canSend, error } = useChat(walletAddress);
  const [input, setInput] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);
  
  const handleSend = async () => {
    if (!input.trim() || sending) return;
    
    setSending(true);
    setSendError(null);
    
    const result = await sendMessage(input.trim());
    
    if (result.success) {
      setInput('');
    } else {
      setSendError(result.error || 'Failed to send');
    }
    
    setSending(false);
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  
  const insertEmoji = (emoji: string) => {
    setInput(prev => prev + emoji);
    setShowEmoji(false);
    inputRef.current?.focus();
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div 
        className="
          w-[400px] max-w-[95vw] h-[600px] max-h-[80vh]
          bg-gradient-to-b from-slate-900 to-slate-950
          border border-white/10 rounded-2xl
          flex flex-col overflow-hidden shadow-2xl
        "
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-cyan-400" />
            <span className="font-semibold text-white">Global Chat</span>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5 text-white/60" />
          </button>
        </div>
        
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/40">
              <MessageCircle className="w-12 h-12 mb-2 opacity-50" />
              <p>No messages yet</p>
              <p className="text-sm">Be the first to say something!</p>
            </div>
          ) : (
            messages.map((msg) => (
              <MessageBubble 
                key={msg.id} 
                message={msg} 
                isOwn={msg.walletAddress === walletAddress}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
        
        {/* Error display */}
        {(error || sendError) && (
          <div className="px-4 py-2 bg-red-500/20 border-t border-red-500/30 text-red-300 text-sm">
            {error || sendError}
          </div>
        )}
        
        {/* Emoji picker */}
        {showEmoji && (
          <div className="px-4 py-2 border-t border-white/10 bg-white/5">
            <div className="flex flex-wrap gap-2">
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => insertEmoji(emoji)}
                  className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/20 text-lg transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
        
        {/* Input */}
        <div className="p-3 border-t border-white/10 bg-white/5">
          {!walletAddress ? (
            <div className="text-center py-2 text-white/50 text-sm">
              Connect wallet to chat
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowEmoji(!showEmoji)}
                className={`p-2 rounded-lg transition-colors ${showEmoji ? 'bg-cyan-500/30 text-cyan-400' : 'hover:bg-white/10 text-white/60'}`}
              >
                <Smile className="w-5 h-5" />
              </button>
              
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                maxLength={200}
                disabled={!canSend || sending}
                className="
                  flex-1 px-4 py-2 rounded-full
                  bg-white/10 border border-white/10
                  text-white placeholder-white/40
                  focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30
                  disabled:opacity-50
                "
              />
              
              <button
                onClick={handleSend}
                disabled={!canSend || !input.trim() || sending}
                className="
                  p-2 rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500
                  hover:from-cyan-400 hover:to-emerald-400
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all
                "
              >
                <Send className="w-5 h-5 text-white" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Mini chat indicator for sidebar
export function ChatButton({ onClick, unreadCount }: { onClick: () => void; unreadCount?: number }) {
  return (
    <button
      onClick={onClick}
      className="
        relative p-3 rounded-xl
        bg-white/5 border border-white/10
        hover:bg-white/10 hover:border-cyan-500/30
        transition-all group
      "
      title="Global Chat"
    >
      <MessageCircle className="w-5 h-5 text-white/70 group-hover:text-cyan-400 transition-colors" />
      
      {unreadCount && unreadCount > 0 && (
        <span className="
          absolute -top-1 -right-1 w-5 h-5 rounded-full
          bg-gradient-to-r from-red-500 to-pink-500
          text-white text-[10px] font-bold
          flex items-center justify-center
        ">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );
}

