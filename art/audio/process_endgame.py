#!/usr/bin/env python3
"""
Floss Boss: post-process the ElevenLabs takes for the end-game round (DESIGN 11) into
public/audio/<key>.mp3.

    python art/audio/process_endgame.py

Raw takes live in art/audio/raw/endgame/ (gitignored, see generation_endgame.md for the prompts
and which take won). Eight keys: bling, ayy, grill_pop (the Grill Glow-Up case) and crowd_cheer,
fanfare_gala, ribbon_snip, milestone, promotion (the end-game ceremonies).

Same pipeline as process_fixes.py (trim at the first transient, trailing silence cut below -40 dB
of the peak, fades, peak-normalize, mono 44.1 kHz MP3 96 kbps), plus:
  - an optional 2-stage low-pass (the audit's EQ) for the naturally bright foley takes,
  - a loudness cap: the gain is the smaller of "peak to X dBFS" and "RMS to Y dBFS", so a dense
    take (the crowd, the fanfare) never ends up louder than the rest of the set,
  - grill_pop is a layer: the soft "thock" take (b) carries the body and the bright click take (a),
    low-passed, sits under it for the metallic edge.
Needs ffmpeg and numpy.
"""
import os
import sys
import subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(HERE, 'raw', 'endgame')
OUT = os.path.join(ROOT, 'public', 'audio')
SR = 44100

sys.path.insert(0, HERE)
from audit import biquad  # noqa: E402  (same filter the audit measures with)

# key: take, peak dBFS, RMS cap dBFS, max seconds, onset dB below peak, extra options
JOBS = {
    # repeats once per diamond (up to 12 a clean): kept soft and short
    'bling':        ('bling_raw_a.mp3', -8.0, -24.0, 0.5, 20, {'fade': 0.12}),
    'ayy':          ('ayy_raw_tts_will_b.mp3', -6.0, -20.0, 0.7, 24, {'fade': 0.1, 'pre': 0.02, 'lowpass': 7000}),
    'grill_pop':    (None, -6.0, -22.0, 0.35, 20, {'fade': 0.08, 'layer': ('grill_pop_raw_b.mp3', 'grill_pop_raw_a.mp3', 0.35, 4500)}),
    'crowd_cheer':  ('crowd_cheer_raw_a.mp3', -8.0, -22.0, 2.4, 20, {'fade': 0.6, 'pre': 0.02, 'lowpass': 7000}),
    'fanfare_gala': ('fanfare_gala_raw_a.mp3', -4.0, -19.0, 3.7, 20, {'fade': 0.5}),
    'ribbon_snip':  ('ribbon_snip_raw_a.mp3', -8.0, -24.0, 0.3, 18, {'fade': 0.06, 'pre': 0.015, 'lowpass': 6500}),
    'milestone':    ('milestone_raw_c.mp3', -5.0, -20.0, 1.3, 20, {'fade': 0.3}),
    'promotion':    ('promotion_raw_a.mp3', -4.0, -19.0, 2.2, 20, {'fade': 0.4}),
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


def lowpass2(x, f):
    return biquad(biquad(x, 'lowpass', f), 'lowpass', f)


def rms_db(x):
    return 20 * np.log10(max(1e-9, np.sqrt(np.mean(x ** 2))))


def level(x, peak_db, rms_cap_db):
    """Gain so the peak lands on peak_db, reduced if the RMS would then exceed rms_cap_db."""
    g_peak = 10 ** (peak_db / 20) / max(1e-9, np.max(np.abs(x)))
    g_rms = 10 ** (rms_cap_db / 20) / max(1e-9, np.sqrt(np.mean(x ** 2)))
    return x * min(g_peak, g_rms)


def layered(body_take, edge_take, edge_gain, edge_lp):
    """Body take at full level, the edge take low-passed under it, both aligned on their first transient."""
    a = decode(os.path.join(RAW, body_take))
    b = decode(os.path.join(RAW, edge_take))
    a = trim(a, onset_db=20, pre=0.004, fade=0.02)
    b = trim(lowpass2(b, edge_lp), onset_db=20, pre=0.004, fade=0.02)
    a = a / max(1e-9, np.max(np.abs(a)))
    b = b / max(1e-9, np.max(np.abs(b))) * edge_gain
    n = max(len(a), len(b))
    y = np.zeros(n)
    y[:len(a)] += a
    y[:len(b)] += b
    return y


def main():
    os.makedirs(OUT, exist_ok=True)
    for key, (take, peak, rms_cap, max_s, onset, opt) in JOBS.items():
        if 'layer' in opt:
            x = layered(*opt['layer'])
            label = '+'.join(opt['layer'][:2])
        else:
            x = decode(os.path.join(RAW, take))
            label = take
            if opt.get('lowpass'):
                x = lowpass2(x, opt['lowpass'])
        y = trim(x, onset_db=onset, max_s=max_s, pre=opt.get('pre', 0.01), fade=opt.get('fade', 0.04),
                 tail_db=opt.get('tail_db', 40))
        y = level(y, peak, rms_cap)
        path = os.path.join(OUT, key + '.mp3')
        encode(y, path)
        print('%-13s %-44s %.2fs  peak %5.1f  rms %6.1f' % (
            key, label, len(y) / SR, 20 * np.log10(np.max(np.abs(y))), rms_db(y)))


if __name__ == '__main__':
    main()
