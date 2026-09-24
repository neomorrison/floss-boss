#!/usr/bin/env python3
"""
Floss Boss: audio audit round 2 (playtest fix) -- de-harshen the SFX the audit flagged.

The owner: "the beeping every time they get into a chair is really annoying. poor sound effect,
sounds like a fire alarm." door_chime and notify were already replaced; this pass covers everything
else the measured audit (art/audio/audit.py) flagged as a tonal beep/whine or bright-and-peaky,
especially the ones that play most often (scrape_1..3, flake, coins, cash, check, sparkle,
tooth_ding, shade_tick).

Treatment, all RBJ-cookbook biquads applied in the time domain, no external samples: a gentle
two-stage low-pass (two cascaded 2-pole low-pass biquads, about -24 dB/octave, musical rather than a
brick wall) at a per-key cutoff, chosen so a bell/ding keeps its fundamental but loses the brassy
overtone stack, and a scrape/pop keeps its crunch (which lives mostly below 5-6 kHz) but loses the
fizzy top octave. A first attempt used peaking notches on the dominant band instead: for harmonic
tones (bells, dings) that just exposed the next harmonic and made a few files measure brighter, not
darker, so this version cuts the whole top end back instead of chasing individual partials. If a
single narrow resonance still survives below the cutoff, one peaking notch cleans it up.
Every output is re-normalized to at or a touch below its original peak (never louder) and encoded
mono 44.1 kHz MP3 96 kbps, matching every other file in public/audio.

    python art/audio/soften.py

Needs ffmpeg and numpy. Re-run art/audio/audit.py afterward to confirm the fix.
"""
import os
import subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
AUDIO = os.path.join(ROOT, 'public', 'audio')
SR = 44100

N_BANDS = 40
BAND_EDGES = np.geomspace(40, 20000, N_BANDS + 1)

# key: (lowpass cutoff Hz, lowpass Q per stage, allow a follow-up notch)
PLAN = {
    # -------- high priority: the frequent, complained-about ones --------
    'scrape_2':    (4800, 0.75, True),
    'scrape_3':    (5200, 0.75, True),
    'flake':       (3900, 0.75, True),
    'coins':       (4600, 0.8, True),
    'cash':        (4200, 0.8, True),
    'check':       (4200, 0.8, True),
    'sparkle':     (4200, 0.75, True),
    'shade_tick':  (2700, 0.8, False),
    # -------- secondary: still flagged, lighter touch, character preserved --------
    'debris_pop':  (5000, 0.75, False),
    'floss_creak': (5500, 0.75, False),
    'gel_paint':   (4800, 0.75, False),
    'purchase':    (3600, 0.8, False),
    'shell_crack': (5200, 0.75, False),
    'day_end':     (4500, 0.75, False),
    'gold_ting':   (6500, 0.75, False),
    'coin_clink':  (6500, 0.75, False),
    'polish_loop':     (6000, 0.75, False),
    'rinse_loop':      (6500, 0.75, False),
    'suction_loop':    (6500, 0.75, False),
    'ultrasonic_loop': (6200, 0.75, False),
}


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                          capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def encode(x, path):
    pcm = np.clip(x, -1, 1).astype(np.float32).tobytes()
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
                     '-codec:a', 'libmp3lame', '-b:a', '96k', '-ar', str(SR), '-ac', '1', path],
                    input=pcm, check=True)


def biquad(x, kind, f0, q=0.707, gain_db=0.0):
    w = 2 * np.pi * f0 / SR
    cw, sw = np.cos(w), np.sin(w)
    a = sw / (2 * q)
    if kind == 'lowpass':
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        den = [1 + a, -2 * cw, 1 - a]
    elif kind == 'peaking':
        A = 10 ** (gain_db / 40)
        b = [1 + a * A, -2 * cw, 1 - a * A]
        den = [1 + a / A, -2 * cw, 1 - a / A]
    else:
        raise ValueError(kind)
    b = [v / den[0] for v in b]
    a1, a2 = den[1] / den[0], den[2] / den[0]
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b[0] * v + b[1] * x1 + b[2] * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, o
        y[i] = o
    return y


def band_powers(x):
    n = len(x)
    win = np.hanning(n)
    spec = np.abs(np.fft.rfft(x * win))
    freqs = np.fft.rfftfreq(n, d=1 / SR)
    power = spec ** 2
    bp = np.array([power[(freqs >= lo) & (freqs < hi)].sum() for lo, hi in zip(BAND_EDGES[:-1], BAND_EDGES[1:])])
    centers = np.sqrt(BAND_EDGES[:-1] * BAND_EDGES[1:])
    return bp, centers


def dominant_freq(x):
    bp, centers = band_powers(x)
    if bp.sum() <= 0:
        return 2000.0, 0.0
    i = int(np.argmax(bp))
    return float(centers[i]), float(bp[i] / bp.sum())


def process(key, cutoff, q, allow_notch):
    path = os.path.join(AUDIO, key + '.mp3')
    x = decode(path)
    orig_peak = np.max(np.abs(x))
    y = biquad(x, 'lowpass', cutoff, q=q)
    y = biquad(y, 'lowpass', cutoff, q=q)   # two stages: ~-24 dB/oct, musical not brickwall
    notes = ['lowpass x2 @ %.0f Hz (Q %.2f)' % (cutoff, q)]
    if allow_notch:
        f0, dom = dominant_freq(y)
        if dom > 0.4 and f0 < cutoff * 0.9:
            y = biquad(y, 'peaking', f0, q=1.8, gain_db=-7)
            notes.append('notch %.0f Hz x-7dB (still %.0f%% of energy after lowpass)' % (f0, dom * 100))
    new_peak = np.max(np.abs(y))
    if new_peak > 0:
        y = y * (orig_peak / new_peak)   # never louder than the original peak
    encode(y, path)
    return notes


def main():
    for key, (cutoff, q, allow_notch) in PLAN.items():
        path = os.path.join(AUDIO, key + '.mp3')
        if not os.path.exists(path):
            print('%-16s MISSING, skipped' % key)
            continue
        notes = process(key, cutoff, q, allow_notch)
        print('%-16s %s' % (key, '; '.join(notes)))


if __name__ == '__main__':
    main()
