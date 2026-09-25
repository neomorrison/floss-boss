#!/usr/bin/env python3
"""
Floss Boss: audio audit. Measures every file in public/audio (decoded with ffmpeg) for duration,
peak dBFS, RMS dBFS, an approximate K-weighted integrated loudness (LUFS, simplified BS.1770:
60 Hz highpass + a +4 dB high shelf above 1.5 kHz, no gating -- short game SFX don't need it),
spectral centroid, and the share of spectral energy above 2.5 kHz. Flags anything harsh, piercing,
beep-like, too loud or too long for how often it plays. Writes a markdown table to art/audio/audit.md.

    python art/audio/audit.py

Needs ffmpeg and numpy.
"""
import os
import subprocess
import sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
AUDIO = os.path.join(ROOT, 'public', 'audio')
SR = 44100

# How often each key plays, for context on the flag (not a hard rule): the frequent ones matter
# most because a slightly bright file becomes fatiguing at that frequency.
FREQUENCY = {
    'scrape_1': 'very frequent (every scaler stroke)', 'scrape_2': 'very frequent (every scaler stroke)',
    'scrape_3': 'very frequent (every scaler stroke)', 'flake': 'very frequent (every flake shed)',
    'ui_click': 'very frequent (every button)', 'ui_tab': 'very frequent (every tab switch)',
    'coins': 'frequent (every payout)', 'cash': 'frequent (every payout)', 'check': 'frequent (every objective tick)',
    'tooth_done': 'frequent (every snapped tooth)', 'star': 'frequent (every star awarded)',
    'combo': 'frequent (every combo)', 'sparkle': 'frequent (every sparkle cue)',
    'notify': 'frequent (every toast)', 'door_chime': 'frequent (every patient seated)',
    'tooth_ding': 'frequent (tooth contact)', 'shade_tick': 'frequent while curing (every 1.2 s)',
    'squish': 'frequent (every sugar bug squash)',
    'bling': 'frequent (every diamond buffed, up to 12 a grill)',
}


def decode(path):
    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
        capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def biquad(x, kind, f0, q=0.707, gain_db=0.0):
    w = 2 * np.pi * f0 / SR
    cw, sw = np.cos(w), np.sin(w)
    a = sw / (2 * q)
    if kind == 'lowpass':
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        den = [1 + a, -2 * cw, 1 - a]
    elif kind == 'highpass':
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        den = [1 + a, -2 * cw, 1 - a]
    elif kind == 'highshelf':
        A = 10 ** (gain_db / 40)
        beta = np.sqrt(A) / q
        b = [A * ((A + 1) + (A - 1) * cw + beta * sw),
             -2 * A * ((A - 1) + (A + 1) * cw),
             A * ((A + 1) + (A - 1) * cw - beta * sw)]
        den = [(A + 1) - (A - 1) * cw + beta * sw,
               2 * ((A - 1) - (A + 1) * cw),
               (A + 1) - (A - 1) * cw - beta * sw]
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


def db(x, ref=1.0):
    return 20 * np.log10(max(1e-9, x / ref))


def approx_lufs(x):
    """Simplified BS.1770 K-weighting (60 Hz highpass RLB approximation + a high shelf above
    ~1.5 kHz) then ungated mean-square loudness. Not certified LUFS, close enough to compare files."""
    y = biquad(x, 'highpass', 60, q=0.5)
    y = biquad(y, 'highshelf', 1500, q=0.71, gain_db=4.0)
    ms = np.mean(y ** 2)
    return -0.691 + 10 * np.log10(max(1e-12, ms))


N_BANDS = 40
BAND_EDGES = np.geomspace(40, 20000, N_BANDS + 1)  # log-spaced like critical bands: fair for both a
                                                    # bell's overtone spacing and a noise burst's slope


def spectral_stats(x):
    """Whole-file magnitude spectrum (single FFT is fine for these short, mostly-stationary-ish
    game SFX), then summed into 40 log-spaced bands (raw per-bin flatness is meaningless: at these
    lengths almost every bin outside the signal's true content sits at the numerical noise floor,
    so bin-level geometric/arithmetic mean collapses to ~0 for every file alike). From the bands:
    spectral centroid in Hz, the share of energy above 2.5 kHz, band flatness (geometric mean /
    arithmetic mean of band power: near 0 = tonal/peaky, energy piled into one or two bands like a
    pure beep or bell; near 1 = broadband/noisy, spread across bands like a filtered-noise crunch,
    pop or hiss) and the share of total energy in the single loudest band (how alarm/whistle-like
    the sound is, literally)."""
    n = len(x)
    if n < 4:
        return 0.0, 0.0, 1.0, 0.0
    win = np.hanning(n)
    spec = np.abs(np.fft.rfft(x * win))
    freqs = np.fft.rfftfreq(n, d=1 / SR)
    power = spec ** 2
    total = power.sum()
    if total <= 0:
        return 0.0, 0.0, 1.0, 0.0
    centroid = float((freqs * power).sum() / total)
    hi = float(power[freqs > 2500].sum() / total * 100)
    band_power = np.array([power[(freqs >= lo) & (freqs < hi_e)].sum()
                            for lo, hi_e in zip(BAND_EDGES[:-1], BAND_EDGES[1:])])
    band_power = band_power[band_power > 0]
    if len(band_power) == 0:
        return centroid, hi, 1.0, 0.0
    eps = 1e-12
    flatness = float(np.exp(np.mean(np.log(band_power + eps))) / (np.mean(band_power) + eps))
    dom = float(band_power.max() / band_power.sum())
    return centroid, hi, flatness, dom


def flag(key, dur, peak, rms, lufs, centroid, hi_pct, flatness, dom):
    reasons = []
    is_loop = key.endswith('_loop')
    freq_note = FREQUENCY.get(key)
    # Tonal + narrow-band + bright = an alarm/whistle/beep, like the old 3 kHz door chime.
    # Broadband-noisy-but-bright (a filtered noise burst) is the "crunch" the owner wants kept.
    if centroid > 2500 and dom > 0.35:
        reasons.append('tonal beep/whine (centroid %.0f Hz, %.0f%% of energy in one band)' % (centroid, dom * 100))
    elif centroid > 3000 and flatness < 0.15 and dom > 0.22:
        reasons.append('bright and peaky (centroid > 3 kHz, flatness %.2f, %.0f%% in one band)' % (flatness, dom * 100))
    if peak > -0.5:
        reasons.append('near clipping (peak %.1f dBFS)' % peak)
    if not is_loop and rms > -12:
        reasons.append('loud for a one-shot (RMS %.1f dBFS)' % rms)
    if is_loop and rms > -18:
        reasons.append('loud for a loop (RMS %.1f dBFS, should sit well under one-shots)' % rms)
    if not is_loop and dur > 1.2 and freq_note and 'very frequent' in freq_note:
        reasons.append('long (%.2fs) for something that frequent' % dur)
    if freq_note and reasons:
        reasons.append('HIGH PRIORITY: ' + freq_note)
    return reasons


def main():
    files = sorted(f for f in os.listdir(AUDIO) if f.endswith('.mp3'))
    rows = []
    for fn in files:
        key = fn[:-4]
        path = os.path.join(AUDIO, fn)
        x = decode(path)
        dur = len(x) / SR
        peak = db(np.max(np.abs(x)) if len(x) else 0.0)
        rms = db(np.sqrt(np.mean(x ** 2)) if len(x) else 0.0)
        lufs = approx_lufs(x) if len(x) else -100.0
        centroid, hi_pct, flatness, dom = spectral_stats(x)
        reasons = flag(key, dur, peak, rms, lufs, centroid, hi_pct, flatness, dom)
        rows.append((key, dur, peak, rms, lufs, centroid, hi_pct, flatness, dom, reasons))
        print('%-16s %6.2fs  peak %6.1f  rms %6.1f  lufs %6.1f  centroid %6.0fHz  hi%% %5.1f  flat %5.3f  dom %5.1f%%  %s' %
              (key, dur, peak, rms, lufs, centroid, hi_pct, flatness, dom * 100, ' | '.join(reasons) if reasons else 'ok'))

    out_path = os.path.join(HERE, 'audit.md')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('# Audio audit (round 2, playtest fix)\n\n')
        f.write('Measured with `python art/audio/audit.py` (ffmpeg decode + numpy). '
                'LUFS is a simplified BS.1770 K-weighting approximation (60 Hz highpass + a 4 dB '
                'high shelf above 1.5 kHz, ungated), close enough to compare files against each '
                'other, not a certified meter. "hi% energy" is the share of spectral power above '
                '2.5 kHz: the beep/hiss band the owner flagged (the old door_chime was a 3 kHz '
                'beep). Flags are heuristic triggers for a listen, not a verdict.\n\n')
        f.write('| key | dur (s) | peak dBFS | RMS dBFS | LUFS (approx) | centroid (Hz) | energy > 2.5kHz | flatness | dominant band | plays | flag |\n')
        f.write('|---|---|---|---|---|---|---|---|---|---|---|\n')
        for key, dur, peak, rms, lufs, centroid, hi_pct, flatness, dom, reasons in rows:
            freq_note = FREQUENCY.get(key, '')
            flag_txt = '; '.join(reasons) if reasons else 'ok'
            f.write('| %s | %.2f | %.1f | %.1f | %.1f | %.0f | %.1f%% | %.3f | %.1f%% | %s | %s |\n' %
                    (key, dur, peak, rms, lufs, centroid, hi_pct, flatness, dom * 100, freq_note, flag_txt))
    print('\nwrote', out_path)
    flagged = [r for r in rows if r[-1]]
    print('%d of %d files flagged' % (len(flagged), len(rows)))


if __name__ == '__main__':
    main()
