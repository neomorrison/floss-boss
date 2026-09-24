#!/usr/bin/env python3
"""
Floss Boss: post-process the ElevenLabs takes for the case SFX (DESIGN 5) into public/audio/<key>.mp3.

    python art/audio/process_cases.py

Raw takes live in art/audio/raw/cases/ (gitignored, see art/audio/generation.md for the prompts and
which take won). Every output is trimmed (leading silence cut at the first real transient, trailing
silence cut below -40 dB of the peak), faded, peak-normalized, and encoded like the existing files:
mono, 44.1 kHz, MP3 96 kbps. lamp_loop is built from two takes and crossfaded into a seamless loop.
Needs ffmpeg and numpy.
"""
import os
import subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(HERE, 'raw', 'cases')
OUT = os.path.join(ROOT, 'public', 'audio')
SR = 44100

# key: (take, peak dBFS, max seconds or None, onset threshold dB below peak, extra options)
ONESHOTS = {
    'squish':       ('squish_raw_b.mp3', -2.0, 0.55, 20, {}),
    'floss_creak':  ('floss_creak_raw_a.mp3', -6.0, 0.5, 18, {'fade': 0.08}),
    'floss_thwip':  ('floss_thwip_raw_b.mp3', -2.0, 0.3, 20, {}),
    'floss_zip':    ('floss_zip_raw_a.mp3', -3.0, 0.45, 20, {}),
    'gel_paint':    ('gel_paint_raw_b.mp3', -4.0, 0.35, 12, {'pre': 0.03}),
    'gold_ting':    ('gold_ting_raw_a.mp3', -4.0, 1.0, 20, {'fade': 0.25}),
    'arr':          ('arr_raw_tts_matey.mp3', -3.0, 1.0, 24, {'pre': 0.02}),
    'pocket_open':  ('pocket_open_raw_b.mp3', -3.0, 0.4, 20, {}),
    'shade_tick':   ('shade_tick_raw_a.mp3', -6.0, 0.12, 20, {'fade': 0.07}),
    'check':        ('check_raw_a.mp3', -3.0, 0.55, 20, {}),
    'hiccup':       ('hiccup_raw_a.mp3', -3.0, 0.4, 24, {'pre': 0.02, 'fade': 0.06}),
    'snore':        ('snore_raw_a.mp3', -4.0, 1.25, 24, {'pre': 0.02, 'fade': 0.15}),
    'coin_clink':   ('coin_clink_raw_b.mp3', -3.0, 1.2, 20, {'fade': 0.2}),
    'shell_crack':  ('shell_crack_raw_b.mp3', -2.0, 0.35, 20, {}),
    'tooth_done':   ('tooth_done_raw_a.mp3', -5.0, 0.85, 20, {'fade': 0.3}),
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


def envelope(x, block=441):
    n = len(x) // block
    return np.abs(x[:n * block]).reshape(n, block).max(axis=1)


def trim(x, onset_db=20, max_s=None, pre=0.01, fade=0.03, tail_db=40):
    env = envelope(x)
    peak = env.max()
    on = int(np.argmax(env > peak * 10 ** (-onset_db / 20)))
    start = max(0, on * 441 - int(pre * SR))
    above = np.nonzero(env > peak * 10 ** (-tail_db / 20))[0]
    end = min(len(x), (above[-1] + 1) * 441 + int(0.02 * SR))
    if max_s:
        end = min(end, start + int(max_s * SR))
    y = x[start:end].copy()
    fi = min(len(y), int(0.002 * SR))
    y[:fi] *= np.linspace(0, 1, fi)
    fo = min(len(y), int(fade * SR))
    y[len(y) - fo:] *= np.linspace(1, 0, fo) ** 1.5
    return y


def normalize_peak(x, db):
    return x * (10 ** (db / 20) / max(1e-9, np.max(np.abs(x))))


def biquad(x, kind, f0, q=0.707):
    """RBJ cookbook biquad (lowpass / highpass / bandpass), direct form I."""
    w = 2 * np.pi * f0 / SR
    cw, sw = np.cos(w), np.sin(w)
    a = sw / (2 * q)
    if kind == 'lowpass':
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
    elif kind == 'highpass':
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
    else:
        b = [a, 0.0, -a]
    den = [1 + a, -2 * cw, 1 - a]
    b = [v / den[0] for v in b]
    a1, a2 = den[1] / den[0], den[2] / den[0]
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b[0] * v + b[1] * x1 + b[2] * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, o
        y[i] = o
    return y


def rms_db(x):
    return 20 * np.log10(max(1e-9, np.sqrt(np.mean(x ** 2))))


def build_lamp_loop():
    """Low hum take (b) with soft saturation for harmonics small speakers can play, plus the airy whine
    take (a) band-passed down to a gentle electrical whir. Crossfaded end into start: seamless."""
    hum = decode(os.path.join(RAW, 'lamp_loop_raw_b.mp3'))
    air = decode(os.path.join(RAW, 'lamp_loop_raw_a.mp3'))
    n = min(len(hum), len(air))
    hum, air = hum[:n], air[:n]
    hum = biquad(hum, 'highpass', 45)
    hum = hum / max(1e-9, np.max(np.abs(hum)))
    hum = np.tanh(2.5 * hum) / np.tanh(2.5)          # harmonics at 2x, 3x the hum
    air = biquad(biquad(air, 'lowpass', 4200), 'lowpass', 4200)
    air = biquad(air, 'highpass', 700)
    air *= 10 ** ((rms_db(hum) - 12 - rms_db(air)) / 20)   # whir 12 dB under the hum
    x = hum + air
    fade = int(0.35 * SR)
    L = n - fade
    y = x[:L].copy()
    t = np.linspace(0, np.pi / 2, fade)
    y[:fade] = x[:fade] * np.sin(t) + x[L:L + fade] * np.cos(t)    # equal power (uncorrelated noise)
    y *= 10 ** ((-26.0 - rms_db(y)) / 20)                          # soft, like the other loops
    if np.max(np.abs(y)) > 10 ** (-3 / 20):
        y = normalize_peak(y, -3)
    return y


def main():
    os.makedirs(OUT, exist_ok=True)
    for key, (take, peak, max_s, onset, opt) in ONESHOTS.items():
        x = decode(os.path.join(RAW, take))
        y = trim(x, onset_db=onset, max_s=max_s, pre=opt.get('pre', 0.01), fade=opt.get('fade', 0.04))
        y = normalize_peak(y, peak)
        path = os.path.join(OUT, key + '.mp3')
        encode(y, path)
        print('%-12s %-26s %.2fs  peak %5.1f  rms %6.1f' % (key, take, len(y) / SR, peak, rms_db(y)))
    y = build_lamp_loop()
    encode(y, os.path.join(OUT, 'lamp_loop.mp3'))
    print('%-12s %-26s %.2fs  rms %6.1f  (loop)' % ('lamp_loop', 'lamp_loop_raw_b+a', len(y) / SR, rms_db(y)))


if __name__ == '__main__':
    main()
