#!/usr/bin/env python3
"""
Floss Boss: post-process the ElevenLabs takes for the playtest-fix round (DESIGN 10) into
public/audio/<key>.mp3.

    python art/audio/process_fixes.py

Two batches, both in art/audio/raw/ (gitignored, see generation_fixes.md for the prompts and which
take won):
  - raw/manager/: the 7 new manager-layer SFX keys (event_card, event_good, event_bad,
    campaign_start, perk_pick, huddle, interview), which also fixes the RECIPES exhaustiveness
    error in src/audio/synthSfx.ts once a synthesized fallback is added there too.
  - raw/fixes/: warmer replacement takes for five existing keys the audit (art/audio/audit.py)
    flagged as still too bright/tonal after EQ alone (scrape_2, scrape_3, cash, tooth_ding,
    sparkle): the owner's playtest note was "sounds like a fire alarm", so these went back to
    ElevenLabs with prompts asking for warm, low, rounded, non-metallic, non-electronic takes
    rather than fighting the original bright takes with more EQ.

Same pipeline as art/audio/process_cases.py: trim (leading silence cut at the first real
transient, trailing silence cut below -40 dB of the peak), fades, peak-normalize, mono 44.1 kHz
MP3 96 kbps.
Needs ffmpeg and numpy.
"""
import os
import subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW_MANAGER = os.path.join(HERE, 'raw', 'manager')
RAW_FIXES = os.path.join(HERE, 'raw', 'fixes')
OUT = os.path.join(ROOT, 'public', 'audio')
SR = 44100

# key: (raw dir, take, peak dBFS, max seconds, onset threshold dB below peak, extra options)
JOBS = {
    # -------- new manager-layer keys --------
    'event_card':     (RAW_MANAGER, 'event_card_raw_a.mp3', -9.0, 0.5, 20, {}),
    'event_good':      (RAW_MANAGER, 'event_good_raw_a.mp3', -5.0, 0.55, 20, {'fade': 0.1}),
    'event_bad':       (RAW_MANAGER, 'event_bad_raw_a.mp3', -6.0, 0.4, 20, {'fade': 0.06}),
    'campaign_start':  (RAW_MANAGER, 'campaign_start_raw_a.mp3', -5.0, 0.75, 20, {'fade': 0.12}),
    'perk_pick':       (RAW_MANAGER, 'perk_pick_raw_b.mp3', -6.0, 0.55, 20, {'fade': 0.08}),
    'huddle':          (RAW_MANAGER, 'huddle_raw_a.mp3', -7.0, 0.65, 14, {'pre': 0.02}),
    # take a's trailing "paper shuffle" turned out to be near-silent (just the pen click survived
    # trim); take b has a soft rustle just before the click. onset/tail loosened to keep it.
    'interview':       (RAW_MANAGER, 'interview_raw_b.mp3', -6.0, 0.5, 36, {'pre': 0.04, 'fade': 0.15, 'tail_db': 45}),
    # -------- warmer replacement takes for still-flagged keys --------
    'scrape_2':  (RAW_FIXES, 'scrape_2_raw_v2.mp3', -6.0, 0.55, 20, {}),
    'scrape_3':  (RAW_FIXES, 'scrape_3_raw_v2.mp3', -5.0, 0.6, 20, {}),
    'cash':      (RAW_FIXES, 'cash_raw_v2.mp3', -7.0, 0.65, 20, {'fade': 0.15}),
    'tooth_ding': (RAW_FIXES, 'tooth_ding_raw_v2.mp3', -6.0, 0.55, 20, {'fade': 0.1}),
    'sparkle':   (RAW_FIXES, 'sparkle_raw_v3.mp3', -7.0, 0.5, 18, {'fade': 0.1}),
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


def rms_db(x):
    return 20 * np.log10(max(1e-9, np.sqrt(np.mean(x ** 2))))


def main():
    os.makedirs(OUT, exist_ok=True)
    for key, (raw_dir, take, peak, max_s, onset, opt) in JOBS.items():
        x = decode(os.path.join(raw_dir, take))
        y = trim(x, onset_db=onset, max_s=max_s, pre=opt.get('pre', 0.01), fade=opt.get('fade', 0.04),
                 tail_db=opt.get('tail_db', 40))
        y = normalize_peak(y, peak)
        path = os.path.join(OUT, key + '.mp3')
        encode(y, path)
        print('%-14s %-26s %.2fs  peak %5.1f  rms %6.1f' % (key, take, len(y) / SR, peak, rms_db(y)))


if __name__ == '__main__':
    main()
