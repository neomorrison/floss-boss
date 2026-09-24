// Synthesized fallback music: a small procedural Web Audio sequencer used when the composed track
// is missing or fails to decode. Owner: audio builder. Not aiming for realism, just a pleasant,
// on-genre, seamlessly loopable bar pattern per key.
import type { MusicKey } from '../data/assets';
import { envGain, noteFreq, renderOffline } from './synthCore';

interface Spec {
  bpm: number;
  bars: number;
  beatsPerBar: number;
  chords: number[][];       // one chord (semitones from C5) per bar, cycling
  bassType: OscillatorType;
  bassOctave: number;       // semitone offset applied to the chord root for the bass note
  leadType: OscillatorType;
  leadPeak: number;
  bassPeak: number;
  swing: number;            // 0..0.3, delays the off-beat lead notes for a laid-back feel
}

function note(ctx: OfflineAudioContext, out: GainNode, type: OscillatorType, freq: number, start: number, dur: number, peak: number) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = envGain(ctx, [[start, 0], [start + 0.01, peak], [start + dur * 0.55, peak * 0.5], [start + dur, 0]], 'exp');
  osc.connect(g);
  g.connect(out);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function buildSequence(ctx: OfflineAudioContext, out: GainNode, spec: Spec): void {
  const beatDur = 60 / spec.bpm;
  for (let bar = 0; bar < spec.bars; bar++) {
    const chord = spec.chords[bar % spec.chords.length];
    const barStart = bar * spec.beatsPerBar * beatDur;
    // bass: root note on beat 1, and beat 3 (or 2.5 for a bossa lilt) of every bar
    note(ctx, out, spec.bassType, noteFreq(chord[0] + spec.bassOctave), barStart, beatDur * 0.9, spec.bassPeak);
    if (spec.beatsPerBar >= 4) {
      note(ctx, out, spec.bassType, noteFreq(chord[0] + spec.bassOctave), barStart + beatDur * 2.5, beatDur * 0.9, spec.bassPeak * 0.85);
    }
    // lead: a short arpeggio over the chord tones, one pass per bar with a swung off-beat
    const n = chord.length;
    for (let i = 0; i < spec.beatsPerBar; i++) {
      const swung = i % 2 === 1 ? spec.swing * beatDur : 0;
      const t = barStart + i * beatDur + swung;
      const tone = chord[i % n] + 12; // one octave up from the chord voicing
      note(ctx, out, spec.leadType, noteFreq(tone), t, beatDur * (0.55 - spec.swing * 0.3), spec.leadPeak);
    }
  }
}

// Chord roots in semitones from C5. Simple diatonic progressions, kept small and bright/relaxed per track.
const SPECS: Record<MusicKey, Spec> = {
  music_title: {
    bpm: 122, bars: 8, beatsPerBar: 4,
    chords: [[0, 4, 7], [-5, -1, 2], [-9, -5, -2], [-7, -3, 0]],
    bassType: 'triangle', bassOctave: -12, leadType: 'triangle', leadPeak: 0.22, bassPeak: 0.28, swing: 0.08,
  },
  music_clinic: {
    bpm: 84, bars: 8, beatsPerBar: 4,
    chords: [[0, 4, 7, 11], [-3, 0, 4, 7], [-5, -1, 2, 6], [2, 5, 9, 12]],
    bassType: 'sine', bassOctave: -12, leadType: 'sine', leadPeak: 0.16, bassPeak: 0.22, swing: 0.18,
  },
  music_clean: {
    bpm: 104, bars: 8, beatsPerBar: 4,
    chords: [[0, 4, 7], [5, 9, 12], [-5, -1, 2], [2, 5, 9]],
    bassType: 'triangle', bassOctave: -12, leadType: 'square', leadPeak: 0.14, bassPeak: 0.24, swing: 0.1,
  },
};

const cache = new Map<MusicKey, Promise<AudioBuffer>>();

/** Renders (and caches) the synthesized fallback loop for a music key. Never throws. */
export function synthesizeMusic(key: MusicKey): Promise<AudioBuffer> {
  let p = cache.get(key);
  if (!p) {
    const spec = SPECS[key];
    const totalBeats = spec.bars * spec.beatsPerBar;
    const duration = (totalBeats * 60) / spec.bpm + 0.3;
    p = renderOffline(duration, 2, (ctx, out) => buildSequence(ctx, out, spec));
    cache.set(key, p);
  }
  return p;
}
