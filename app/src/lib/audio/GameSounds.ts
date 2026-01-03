/**
 * GameSounds - Euphoric, synthwave-inspired sound effects
 * Creates musical, pleasant sounds that match the Euphoria aesthetic
 */

type SoundType = 'win' | 'bigWin' | 'loss' | 'click' | 'bet' | 'connect' | 'disconnect';

class GameSounds {
  private static instance: GameSounds | null = null;
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled: boolean = true;
  private volume: number = 0.3;

  private constructor() {}

  static getInstance(): GameSounds {
    if (!GameSounds.instance) {
      GameSounds.instance = new GameSounds();
    }
    return GameSounds.instance;
  }

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    
    if (!this.audioContext) {
      const AudioContextClass = window.AudioContext || 
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      
      if (!AudioContextClass) return null;
      
      this.audioContext = new AudioContextClass();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.audioContext.destination);
    }
    
    // Resume if suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    
    return this.audioContext;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.masterGain) {
      this.masterGain.gain.value = this.volume;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Play a sound effect
   */
  play(type: SoundType): void {
    if (!this.enabled) return;
    
    const ctx = this.getContext();
    if (!ctx || !this.masterGain) return;

    try {
      switch (type) {
        case 'win':
          this.playWinSound(ctx);
          break;
        case 'bigWin':
          this.playBigWinSound(ctx);
          break;
        case 'loss':
          this.playLossSound(ctx);
          break;
        case 'click':
          this.playClickSound(ctx);
          break;
        case 'bet':
          this.playBetSound(ctx);
          break;
        case 'connect':
          this.playConnectSound(ctx);
          break;
        case 'disconnect':
          this.playDisconnectSound(ctx);
          break;
      }
    } catch (error) {
      console.warn('[GameSounds] Failed to play sound:', error);
    }
  }

  /**
   * Win sound - Bright, ascending arpeggio (euphoric!)
   */
  private playWinSound(ctx: AudioContext): void {
    const now = ctx.currentTime;
    
    // Play a major chord arpeggio (C-E-G-C)
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.value = freq;
      
      gain.gain.setValueAtTime(0, now + i * 0.08);
      gain.gain.linearRampToValueAtTime(0.15, now + i * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.3);
      
      osc.connect(gain);
      gain.connect(this.masterGain!);
      
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.4);
    });
    
    // Add shimmer
    this.addShimmer(ctx, now, 0.08);
  }

  /**
   * Big win sound - Extended celebration sound
   */
  private playBigWinSound(ctx: AudioContext): void {
    const now = ctx.currentTime;
    
    // Extended arpeggio with harmony
    const melody = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1046.50, 783.99];
    
    melody.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.value = freq;
      
      const startTime = now + i * 0.1;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.12, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);
      
      osc.connect(gain);
      gain.connect(this.masterGain!);
      
      osc.start(startTime);
      osc.stop(startTime + 0.5);
    });
    
    // Rich shimmer
    this.addShimmer(ctx, now, 0.15);
    this.addShimmer(ctx, now + 0.3, 0.1);
  }

  /**
   * Loss sound - Soft, descending tone (not jarring)
   */
  private playLossSound(ctx: AudioContext): void {
    const now = ctx.currentTime;
    
    // Gentle descending whoosh
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.2);
    
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.exponentialRampToValueAtTime(500, now + 0.2);
    
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    
    osc.start(now);
    osc.stop(now + 0.3);
  }

  /**
   * Click/UI sound - Subtle pop
   */
  private playClickSound(ctx: AudioContext): void {
    const now = ctx.currentTime;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.05);
    
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    
    osc.connect(gain);
    gain.connect(this.masterGain!);
    
    osc.start(now);
    osc.stop(now + 0.1);
  }

  /**
   * Bet placed sound - Satisfying confirmation
   */
  private playBetSound(ctx: AudioContext): void {
    const now = ctx.currentTime;
    
    // Two-tone chime
    [880, 1100].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.value = freq;
      
      const startTime = now + i * 0.05;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.08, startTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.15);
      
      osc.connect(gain);
      gain.connect(this.masterGain!);
      
      osc.start(startTime);
      osc.stop(startTime + 0.2);
    });
  }

  /**
   * Wallet connected sound - Positive confirmation
   */
  private playConnectSound(ctx: AudioContext): void {
    const now = ctx.currentTime;
    
    // Ascending two notes
    [392, 523.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.value = freq;
      
      const startTime = now + i * 0.1;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.1, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);
      
      osc.connect(gain);
      gain.connect(this.masterGain!);
      
      osc.start(startTime);
      osc.stop(startTime + 0.4);
    });
  }

  /**
   * Wallet disconnected sound - Neutral exit
   */
  private playDisconnectSound(ctx: AudioContext): void {
    const now = ctx.currentTime;
    
    // Descending two notes
    [523.25, 392].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'triangle';
      osc.frequency.value = freq;
      
      const startTime = now + i * 0.12;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.06, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25);
      
      osc.connect(gain);
      gain.connect(this.masterGain!);
      
      osc.start(startTime);
      osc.stop(startTime + 0.3);
    });
  }

  /**
   * Add ethereal shimmer effect
   */
  private addShimmer(ctx: AudioContext, startTime: number, volume: number): void {
    const shimmerFreqs = [2093, 2637, 3136]; // High harmonics
    
    shimmerFreqs.forEach(freq => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.value = freq + (Math.random() * 20 - 10); // Slight detuning
      
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(volume * 0.3, startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.5);
      
      osc.connect(gain);
      gain.connect(this.masterGain!);
      
      osc.start(startTime);
      osc.stop(startTime + 0.6);
    });
  }
}

// Export singleton getter function
export function getGameSounds(): GameSounds {
  return GameSounds.getInstance();
}

// Export sound types for usage
export type { SoundType };

