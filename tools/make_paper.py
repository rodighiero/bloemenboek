#!/usr/bin/env python3
"""Generate a seamless, hand-made-paper texture for the site background (docs/paper.webp).

Layers: large soft mottling, paper 'formation' (flocs), fine grain, light and dark fibres,
a few specks. Noise is made in the frequency domain, so it tiles perfectly; fibres are
drawn with wrap-around for the same reason.
"""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

N = 1600
SEED = 11
BASE = np.array([233, 222, 201], dtype=np.float32)   # warm beige
TINT = np.array([1.0, 0.93, 0.80], dtype=np.float32) # darker tones go warmer/browner

rng = np.random.default_rng(SEED)
fy = np.fft.fftfreq(N)[:, None]
fx = np.fft.fftfreq(N)[None, :]
fr = np.sqrt(fx**2 + fy**2)
fr[0, 0] = 1e-9


def noise(spectrum):
    w = rng.standard_normal((N, N))
    out = np.real(np.fft.ifft2(np.fft.fft2(w) * spectrum))
    return (out - out.mean()) / out.std()


def band(center, width):
    return np.exp(-((np.log(fr) - math.log(center)) ** 2) / (2 * width**2))


mottle = noise(fr ** -1.6 * (fr < 1 / 60))          # big, soft clouds
formation = noise(band(1 / 22, 0.7))                # flocs of fibre, ~20 px
grain = noise(band(1 / 2.5, 0.6))                    # fine tooth
stain = noise(fr ** -2.0 * (fr < 1 / 200))           # very large, faint tone shifts


def fibres(count, rng):
    im = Image.new("L", (N, N), 0)
    d = ImageDraw.Draw(im)
    for _ in range(count):
        x, y = rng.uniform(0, N, 2)
        ang = rng.uniform(0, math.pi)
        length = rng.uniform(12, 70)
        steps = int(length / 6) + 2
        pts = [(x, y)]
        for _ in range(steps):
            ang += rng.normal(0, 0.25)
            x += math.cos(ang) * length / steps
            y += math.sin(ang) * length / steps
            pts.append((x, y))
        shade = int(rng.uniform(90, 255))
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                d.line([(px + ox, py + oy) for px, py in pts], fill=shade, width=1)
    return np.asarray(im.filter(ImageFilter.GaussianBlur(0.55)), dtype=np.float32) / 255


dark_f = fibres(2600, rng)
light_f = fibres(2000, rng)

specks = Image.new("L", (N, N), 0)
d = ImageDraw.Draw(specks)
for _ in range(60):
    x, y = rng.uniform(0, N, 2)
    r = rng.uniform(0.5, 1.6)
    for ox in (-N, 0, N):
        for oy in (-N, 0, N):
            d.ellipse([x + ox - r, y + oy - r, x + ox + r, y + oy + r], fill=int(rng.uniform(120, 255)))
specks = np.asarray(specks.filter(ImageFilter.GaussianBlur(0.6)), dtype=np.float32) / 255

lum = (
    2.0 * mottle
    + 2.0 * formation
    + 2.4 * grain
    + 1.8 * stain
    - 12.0 * dark_f
    + 9.0 * light_f
    - 26.0 * specks
)
rgb = BASE[None, None, :] + lum[..., None] * TINT[None, None, :]
# slight foxing tint where the paper is darker in the large stains
rgb[..., 2] -= np.clip(-stain, 0, None) * 2.5
img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")

out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "docs" / "paper.webp"
img.save(out, "WEBP", quality=92, method=6)
print(out, f"{out.stat().st_size / 1024:.0f} KB")
