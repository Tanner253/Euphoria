/**
 * Hook for controlling arcade background music
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getArcadeMusic } from '@/lib/audio/ArcadeMusic';

interface UseArcadeMusicReturn {
  isPlaying: boolean;
  volume: number;
  toggle: () => void;
  setVolume: (vol: number) => void;
  tryAutoStart: () => void; // Call on first user interaction
}

export function useArcadeMusic(): UseArcadeMusicReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(0.25);
  const hasAutoStarted = useRef(false);
  
  const toggle = useCallback(async () => {
    const music = getArcadeMusic();
    
    if (music.isCurrentlyPlaying()) {
      music.stop();
      setIsPlaying(false);
      // Remember user preference
      localStorage.setItem('musicEnabled', 'false');
    } else {
      await music.play();
      setIsPlaying(true);
      localStorage.setItem('musicEnabled', 'true');
    }
  }, []);
  
  // Try to auto-start music on first user interaction
  const tryAutoStart = useCallback(async () => {
    if (hasAutoStarted.current) return;
    hasAutoStarted.current = true;
    
    // Check if user previously disabled music
    const musicPref = localStorage.getItem('musicEnabled');
    if (musicPref === 'false') {
      console.log('[useArcadeMusic] Music disabled by user preference');
      return;
    }
    
    console.log('[useArcadeMusic] Auto-starting music...');
    const music = getArcadeMusic();
    await music.play();
    setIsPlaying(music.isCurrentlyPlaying());
  }, []);
  
  const setVolume = useCallback((vol: number) => {
    const music = getArcadeMusic();
    music.setVolume(vol);
    setVolumeState(vol);
  }, []);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const music = getArcadeMusic();
      music.stop();
    };
  }, []);
  
  return {
    isPlaying,
    volume,
    toggle,
    setVolume,
    tryAutoStart,
  };
}

