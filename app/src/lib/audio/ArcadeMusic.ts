/**
 * Arcade Music - Extended chiptune melody with multiple sections
 * Uses same audio patterns as GameSounds for reliability
 */

// Musical notes (frequencies in Hz)
const N = {
  // Octave 3
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
  // Octave 4
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
  // Octave 5
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
  // Octave 6
  C6: 1046.50,
};

// Extended 32-bar melody with verse, chorus, bridge structure
const MELODY: (number | null)[] = [
  // === VERSE 1 (8 bars) - Gentle intro ===
  N.E4, N.G4, N.C5, null,    N.E5, N.D5, N.C5, null,      // Bar 1-2: Rising opening
  N.G4, N.A4, N.B4, N.C5,    N.D5, null, N.C5, null,      // Bar 3-4: Stepwise motion
  N.E4, N.E4, N.G4, N.G4,    N.C5, N.C5, N.E5, null,      // Bar 5-6: Rhythmic pattern
  N.D5, N.C5, N.B4, N.A4,    N.G4, null, null, null,      // Bar 7-8: Descending close
  
  // === CHORUS (8 bars) - High energy ===
  N.C5, N.E5, N.G5, N.E5,    N.C5, N.E5, N.G5, N.C6,      // Bar 9-10: Arpeggio burst
  N.B5, N.G5, N.E5, N.D5,    N.C5, N.D5, N.E5, null,      // Bar 11-12: Cascade
  N.F5, N.E5, N.D5, N.C5,    N.D5, N.E5, N.F5, N.G5,      // Bar 13-14: Wave up
  N.A5, N.G5, N.F5, N.E5,    N.D5, N.C5, null, null,      // Bar 15-16: Wave down
  
  // === VERSE 2 (8 bars) - Variation ===
  N.G4, N.B4, N.D5, null,    N.G5, N.F5, N.E5, null,      // Bar 17-18: New phrase
  N.A4, N.C5, N.E5, N.G5,    N.F5, N.E5, N.D5, null,      // Bar 19-20: Climbing
  N.C5, null, N.E5, null,    N.G5, null, N.E5, N.C5,      // Bar 21-22: Syncopated
  N.D5, N.E5, N.D5, N.C5,    N.B4, N.A4, N.G4, null,      // Bar 23-24: Resolution
  
  // === BRIDGE (8 bars) - Build tension ===
  N.E4, N.E4, N.E4, N.E4,    N.G4, N.G4, N.G4, N.G4,      // Bar 25-26: Driving pulse
  N.A4, N.A4, N.A4, N.A4,    N.B4, N.B4, N.C5, N.C5,      // Bar 27-28: Rising tension
  N.D5, N.E5, N.D5, N.E5,    N.F5, N.G5, N.F5, N.G5,      // Bar 29-30: Alternating
  N.A5, N.G5, N.F5, N.E5,    N.D5, N.C5, N.B4, null,      // Bar 31-32: Big finish
];

// Extended bass line (16 bars, loops twice for full melody)
const BASS: (number | null)[] = [
  // Verse bass
  N.C3, null, N.C3, null,    N.G3, null, N.G3, null,      // C pedal
  N.A3, null, N.A3, null,    N.E3, null, N.E3, null,      // Am - Em
  N.F3, null, N.F3, null,    N.C3, null, N.C3, null,      // F - C
  N.G3, null, N.G3, N.A3,    N.B3, null, N.G3, null,      // G walkup
  
  // Chorus bass - more movement
  N.C3, N.E3, N.G3, N.E3,    N.C3, N.E3, N.G3, null,      // C arpeggio
  N.A3, N.C4, N.E4, N.C4,    N.A3, null, null, null,      // Am arpeggio
  N.F3, N.A3, N.C4, N.A3,    N.F3, null, N.G3, null,      // F - G
  N.G3, N.B3, N.D4, N.B3,    N.G3, null, null, null,      // G arpeggio
];

// Harmony notes (play occasionally for richness)
const HARMONY: (number | null)[] = [
  null, null, N.E5, null,    null, null, N.G5, null,
  null, null, N.C5, null,    null, null, N.B4, null,
  null, null, N.G5, null,    null, null, N.E5, null,
  null, null, N.D5, null,    null, null, null, null,
];

class ArcadeMusic {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isPlaying = false;
  private currentStep = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private bpm = 140; // Tempo
  private volume = 0.25;

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
    
    return this.audioContext;
  }

  private async resumeContext(): Promise<void> {
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  private playNote(freq: number, duration: number, type: OscillatorType = 'square', vol = 0.15): void {
    const ctx = this.audioContext;
    if (!ctx || !this.masterGain) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;

    const now = ctx.currentTime;
    
    // Quick attack, sustain, release envelope
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.01);
    gain.gain.setValueAtTime(vol * 0.7, now + duration * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + duration);
  }

  private playBass(freq: number, duration: number): void {
    const ctx = this.audioContext;
    if (!ctx || !this.masterGain) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.value = freq;

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.9);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + duration);
  }

  private playKick(): void {
    const ctx = this.audioContext;
    if (!ctx || !this.masterGain) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';

    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.1);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.15);
  }

  private playHihat(): void {
    const ctx = this.audioContext;
    if (!ctx || !this.masterGain) return;

    // White noise hihat
    const bufferSize = ctx.sampleRate * 0.05;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    filter.type = 'highpass';
    filter.frequency.value = 7000;

    noise.buffer = buffer;

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start(now);
  }

  private playSnare(): void {
    const ctx = this.audioContext;
    if (!ctx || !this.masterGain) return;

    // Noise burst for snare
    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    const noiseGain = ctx.createGain();
    const noiseFilter = ctx.createBiquadFilter();

    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 3000;

    noise.buffer = buffer;

    const now = ctx.currentTime;
    noiseGain.gain.setValueAtTime(0.12, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);

    noise.start(now);

    // Tonal body
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.05);

    oscGain.gain.setValueAtTime(0.15, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.1);
  }

  private tick(): void {
    const stepDuration = 60 / this.bpm / 2; // 8th note duration
    const melodyIndex = this.currentStep % MELODY.length;
    const bassIndex = this.currentStep % BASS.length;
    const harmonyIndex = this.currentStep % HARMONY.length;
    
    // Determine which section we're in for dynamics
    const section = Math.floor((this.currentStep % MELODY.length) / 32);
    const isChorus = section === 1 || section === 3; // Bars 9-16 and 25-32
    
    // Melody - main square wave lead
    const melodyNote = MELODY[melodyIndex];
    if (melodyNote) {
      const melodyVol = isChorus ? 0.14 : 0.11;
      this.playNote(melodyNote, stepDuration * 0.85, 'square', melodyVol);
    }

    // Harmony - subtle sine wave accompaniment
    const harmonyNote = HARMONY[harmonyIndex];
    if (harmonyNote && isChorus) {
      this.playNote(harmonyNote, stepDuration * 1.2, 'sine', 0.06);
    }

    // Bass line
    const bassNote = BASS[bassIndex];
    if (bassNote) {
      this.playBass(bassNote, stepDuration * 1.8);
    }

    // Drums - more complex pattern
    const beatInBar = this.currentStep % 16;
    
    // Kick: 1, 1+, 3 pattern (with occasional variation)
    if (beatInBar === 0 || beatInBar === 2 || beatInBar === 8) {
      this.playKick();
    }
    
    // Snare on 2 and 4
    if (beatInBar === 4 || beatInBar === 12) {
      this.playSnare();
    }

    // Hihat pattern - more during chorus
    if (isChorus) {
      // Every 8th note during chorus
      if (this.currentStep % 2 === 1) {
        this.playHihat();
      }
    } else {
      // Every quarter note during verse
      if (this.currentStep % 4 === 2) {
        this.playHihat();
      }
    }

    this.currentStep++;
  }

  async play(): Promise<void> {
    if (this.isPlaying) {
      console.log('[ArcadeMusic] Already playing');
      return;
    }

    console.log('[ArcadeMusic] Attempting to play...');

    // Create context on user interaction
    if (!this.audioContext) {
      console.log('[ArcadeMusic] Creating new AudioContext...');
      try {
        const AudioContextClass = window.AudioContext || 
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        
        if (!AudioContextClass) {
          console.error('[ArcadeMusic] No AudioContext support');
          return;
        }
        
        this.audioContext = new AudioContextClass();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = this.volume;
        this.masterGain.connect(this.audioContext.destination);
        console.log('[ArcadeMusic] AudioContext created, state:', this.audioContext.state);
      } catch (e) {
        console.error('[ArcadeMusic] Failed to create AudioContext:', e);
        return;
      }
    }

    // Resume if suspended
    if (this.audioContext.state === 'suspended') {
      console.log('[ArcadeMusic] Resuming suspended context...');
      try {
        await this.audioContext.resume();
        console.log('[ArcadeMusic] Context resumed, state:', this.audioContext.state);
      } catch (e) {
        console.error('[ArcadeMusic] Failed to resume:', e);
        return;
      }
    }

    this.isPlaying = true;
    this.currentStep = 0;

    const stepMs = (60 / this.bpm / 2) * 1000; // ms per 8th note
    console.log('[ArcadeMusic] Step interval:', stepMs, 'ms');
    
    // Play first note immediately
    this.tick();
    
    this.intervalId = setInterval(() => {
      this.tick();
    }, stepMs);

    console.log('[ArcadeMusic] ✅ Started playing!');
  }

  stop(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log('[ArcadeMusic] Stopped');
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain) {
      this.masterGain.gain.value = this.volume;
    }
  }

  isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }
}

// Singleton
let instance: ArcadeMusic | null = null;

export function getArcadeMusic(): ArcadeMusic {
  if (!instance) {
    instance = new ArcadeMusic();
  }
  return instance;
}

export default ArcadeMusic;
