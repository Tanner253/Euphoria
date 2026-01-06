'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export interface ChatMessage {
  id: string;
  walletAddress: string;
  displayName: string;
  message: string;
  timestamp: number;
}

const SERVER_URL = process.env.NEXT_PUBLIC_GAME_SERVER_URL || 'http://localhost:3002';

export function useChat(walletAddress: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  
  // Connect to chat server
  useEffect(() => {
    // Reuse existing socket or create new one
    const socket = io(SERVER_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
    });
    
    socketRef.current = socket;
    
    socket.on('connect', () => {
      setIsConnected(true);
      setError(null);
      socket.emit('subscribeChat');
      
      // Re-identify if we have wallet
      if (walletAddress) {
        socket.emit('identify', { walletAddress });
      }
    });
    
    socket.on('disconnect', () => {
      setIsConnected(false);
    });
    
    // Receive chat history on subscribe
    socket.on('chatHistory', (history: ChatMessage[]) => {
      setMessages(history);
    });
    
    // Receive new messages
    socket.on('newChatMessage', (message: ChatMessage) => {
      setMessages(prev => [...prev, message]);
    });
    
    socket.on('connect_error', (err) => {
      setError('Connection error');
      console.error('[Chat] Connection error:', err.message);
    });
    
    return () => {
      socket.emit('unsubscribeChat');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [walletAddress]);
  
  // Send a message
  const sendMessage = useCallback((message: string): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected) {
        resolve({ success: false, error: 'Not connected' });
        return;
      }
      
      if (!walletAddress) {
        resolve({ success: false, error: 'Connect wallet to chat' });
        return;
      }
      
      socketRef.current.emit('sendChatMessage', message, (response: { success: boolean; error?: string }) => {
        resolve(response);
      });
    });
  }, [walletAddress]);
  
  return {
    messages,
    isConnected,
    error,
    sendMessage,
    canSend: !!walletAddress && isConnected,
  };
}

