'use client';

/**
 * Chat Hook - Uses shared socket connection
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSocket } from '@/contexts/SocketContext';

export interface ChatMessage {
  id: string;
  walletAddress: string;
  displayName: string;
  message: string;
  timestamp: number;
}

export function useChat(walletAddress: string | null) {
  const { socket, isConnected } = useSocket();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subscribedRef = useRef(false);
  
  // Subscribe to chat when connected
  useEffect(() => {
    if (!socket || !isConnected) {
      setIsSubscribed(false);
      return;
    }
    
    // Avoid duplicate subscriptions
    if (subscribedRef.current) return;
    subscribedRef.current = true;
    
    // Subscribe to chat
    socket.emit('subscribeChat');
    setIsSubscribed(true);
    setError(null);
    
    // Identify if we have wallet
    if (walletAddress) {
      socket.emit('identify', { walletAddress });
    }
    
    // Receive chat history on subscribe
    const handleChatHistory = (history: ChatMessage[]) => {
      setMessages(history);
    };
    
    // Receive new messages
    const handleNewMessage = (message: ChatMessage) => {
      setMessages(prev => [...prev, message]);
    };
    
    socket.on('chatHistory', handleChatHistory);
    socket.on('newChatMessage', handleNewMessage);
    
    return () => {
      socket.off('chatHistory', handleChatHistory);
      socket.off('newChatMessage', handleNewMessage);
      socket.emit('unsubscribeChat');
      subscribedRef.current = false;
      setIsSubscribed(false);
    };
  }, [socket, isConnected, walletAddress]);
  
  // Re-identify when wallet changes
  useEffect(() => {
    if (socket?.connected && walletAddress) {
      socket.emit('identify', { walletAddress });
    }
  }, [socket, walletAddress]);
  
  // Send a message
  const sendMessage = useCallback((message: string): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      if (!socket?.connected) {
        resolve({ success: false, error: 'Not connected' });
        return;
      }
      
      if (!walletAddress) {
        resolve({ success: false, error: 'Connect wallet to chat' });
        return;
      }
      
      socket.emit('sendChatMessage', message, (response: { success: boolean; error?: string }) => {
        resolve(response);
      });
    });
  }, [socket, walletAddress]);
  
  return {
    messages,
    isConnected: isConnected && isSubscribed,
    error,
    sendMessage,
    canSend: !!walletAddress && isConnected && isSubscribed,
  };
}
