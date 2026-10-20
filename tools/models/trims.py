"""Tiling trim textures for the station, dock and ship models (tools/models/blender/variety.py).

One small shared set, not a bake per model: every model points its faces at these by material name, and the pages
build one material per name, so every station and ship shares the same maps. Each map tiles seamlessly; the models'
UVs are cube-projected at a fixed size in metres per tile (TILE_M), so detail stays sharp close up and the
same panel reads the same size on every hull.
  python -I tools/models/trims.py            # writes design/assets/models/trim/<name>_{color,orm,normal}.jpg
Outputs are deterministic (fixed seeds). Needs numpy and Pillow (offline tooling only). Everything is original.

ORM follows glTF: red unused (1), green roughness, blue metalness. Normals are tangent space, OpenGL (+Y up).
"""
import json
import os

import numpy as np
from PIL import Image

N = 1024
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
OUT = os.path.join(ROOT, "design", "assets", "models", "trim")
# metres covered by one tile; variety.py reads this file's manifest for its UV sizes
TILE_M = {"hull": 4, "mli": 2, "radiator": 2, "solar": 2, "truss": 1, "dark": 2, "window": 4, "rock": 16}


def periodic_noise(rng, sigma, n=N):
    """White noise low-passed in Fourier space, so it wraps at the tile edges. Returns values in 0..1."""
    w = rng.standard_normal((n, n))
    f = np.fft.fftfreq(n)
    g = np.exp(-(f[:, None] ** 2 + f[None, :] ** 2) * (2 * np.pi * sigma) ** 2 / 2)
    out = np.real(np.fft.ifft2(np.fft.fft2(w) * g))
    out -= out.min()
    return out / max(out.max(), 1e-9)


def fbm(rng, sigmas, weights):
    return sum(w * periodic_noise(rng, s) for s, w in zip(sigmas, weights)) / sum(weights)


def blur(a, sigma):
    f = np.fft.fftfreq(a.shape[0])
    g = np.exp(-(f[:, None] ** 2 + f[None, :] ** 2) * (2 * np.pi * sigma) ** 2 / 2)
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.dstack([-dx, dy, np.ones_like(h)])  # image rows run down, OpenGL +Y up
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def grid_lines(n_cells_x, n_cells_y, width_px, n=N):
    """1 on a seam, 0 inside a cell, for a grid that divides the tile exactly."""
    y, x = np.mgrid[0:n, 0:n]
    cx, cy = n / n_cells_x, n / n_cells_y
    dx = np.minimum(x % cx, cx - x % cx)
    dy = np.minimum(y % cy, cy - y % cy)
    return np.clip(1 - np.minimum(dx, dy) / width_px, 0, 1)


def cells(n_cells_x, n_cells_y, rng, n=N):
    """A random value per cell of the grid, as an image."""
    v = rng.random((n_cells_y, n_cells_x))
    return np.kron(v, np.ones((n // n_cells_y, n // n_cells_x)))


def panels(rng, cols, rows, merge=0.35):
    """Hull panelling: a grid where some neighbouring cells merge into larger plates. Returns (seams, cell id value)."""
    cw, ch = N // cols, N // rows
    ids = np.arange(cols * rows, dtype=float).reshape(rows, cols)
    vert = np.ones((rows, cols), bool)   # seam on the left edge of cell (r, c)
    horz = np.ones((rows, cols), bool)   # seam on the top edge
    for r in range(rows):
        for c in range(cols):
            if rng.random() < merge:
                vert[r, (c + 1) % cols] = False
                ids[r, (c + 1) % cols] = ids[r, c]
            elif rng.random() < merge * 0.6:
                horz[(r + 1) % rows, c] = False
    y, x = np.mgrid[0:N, 0:N]
    r, c = y // ch, x // cw
    lx, ly = x % cw, y % ch
    s = np.zeros((N, N))
    w = 2.2
    s = np.maximum(s, np.where(vert[r, c], np.clip(1 - lx / w, 0, 1), 0))
    s = np.maximum(s, np.where(vert[r, (c + 1) % cols], np.clip(1 - (cw - 1 - lx) / w, 0, 1), 0))
    s = np.maximum(s, np.where(horz[r, c], np.clip(1 - ly / w, 0, 1), 0))
    s = np.maximum(s, np.where(horz[(r + 1) % rows, c], np.clip(1 - (ch - 1 - ly) / w, 0, 1), 0))
    rng_ids = np.random.default_rng(int(rng.integers(1 << 30)))
    tint = rng_ids.random(int(ids.max()) + 1)
    return s, tint[ids.astype(int)][r, c]


def rivets(spacing_px, inset_px, radius, n=N):
    y, x = np.mgrid[0:n, 0:n]
    dx = (x - inset_px) % spacing_px
    dx = np.minimum(dx, spacing_px - dx)
    dy = (y - inset_px) % spacing_px
    dy = np.minimum(dy, spacing_px - dy)
    return np.clip(1 - np.sqrt(dx * dx + dy * dy) / radius, 0, 1)


def save(name, color, rough, metal, height, strength):
    os.makedirs(OUT, exist_ok=True)
    rgb = np.clip(color, 0, 1)
    Image.fromarray((rgb * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, name + "_color.jpg"), quality=88)
    orm = np.dstack([np.ones_like(rough), np.clip(rough, 0, 1), np.clip(metal, 0, 1)])
    Image.fromarray((orm * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, name + "_orm.jpg"), quality=90)
    nm = normal_from_height(height, strength)
    Image.fromarray((nm * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, name + "_normal.jpg"), quality=92)


def tint(base, v):
    return np.dstack([base[i] * v for i in range(3)])


def hull(rng):
    # 4 m tile: 1 m x 0.5 m plates, merged in places, hairline seams, rivet rows, light grime and wear.
    s, t = panels(rng, 4, 8)
    grime = fbm(rng, [60, 14, 3], [1, 0.5, 0.25])
    riv = rivets(N / 32, N / 64, 2.0) * (1 - s)
    v = 0.86 + 0.06 * (t - 0.5) - 0.12 * grime ** 2 - 0.45 * s - 0.08 * riv
    color = tint((0.93, 0.93, 0.91), v)
    rough = 0.48 + 0.18 * grime + 0.08 * (t - 0.5) + 0.3 * s
    metal = 0.15 + 0.1 * t
    height = 0.6 * (1 - s) + 0.05 * t + 0.3 * riv + 0.02 * grime
    save("hull", color, rough, metal, blur(height, 0.8), 6)


def mli(rng):
    # 2 m tile: multi-layer insulation blanket, crinkled foil quilted every 0.5 m. Silver-white beta cloth outer.
    crinkle = fbm(rng, [2.5, 6, 18], [0.5, 0.35, 0.3])
    stretch = periodic_noise(rng, 40)
    q = grid_lines(4, 4, 3)
    stitch = q * (np.sin(np.mgrid[0:N, 0:N][1] * 0.9) > 0)
    v = 0.78 + 0.18 * crinkle - 0.25 * q
    color = np.dstack([v * 0.95, v * 0.94, v * 0.9])
    rough = 0.35 + 0.4 * (1 - crinkle) + 0.2 * q
    metal = 0.55 - 0.3 * q
    height = crinkle + 0.4 * stretch - 0.8 * q - 0.2 * stitch
    save("mli", color, rough, metal, blur(height, 0.6), 4)


def radiator(rng):
    # 2 m tile: white radiator panel, coolant tubes every 0.125 m, panel seams every 1 m, scuffs.
    x = np.mgrid[0:N, 0:N][1]
    tube = 0.5 + 0.5 * np.cos((x % (N / 16)) / (N / 16) * 2 * np.pi)
    tube = tube ** 6
    seam = grid_lines(2, 2, 2.5)
    scuff = fbm(rng, [30, 6], [1, 0.4])
    v = 0.84 - 0.06 * tube - 0.4 * seam - 0.1 * scuff ** 3
    color = tint((0.95, 0.95, 0.96), v)
    rough = 0.6 + 0.15 * scuff - 0.2 * tube
    metal = 0.05 + 0.2 * tube
    height = 0.5 * tube - 0.9 * seam
    save("radiator", color, rough, metal, blur(height, 0.8), 5)


def solar(rng):
    # 2 m tile: 125 mm cells (real cells are about 156 mm; 16 per tile divides the map exactly), silver busbars.
    gaps = grid_lines(16, 16, 1.6)
    bus = grid_lines(64, 1, 0.7) * 0.6
    tilev = cells(16, 16, rng)
    shimmer = periodic_noise(rng, 50)
    v = 0.16 + 0.05 * tilev + 0.04 * shimmer
    color = np.dstack([v * 0.55, v * 0.75, v * 1.6]) * (1 - gaps)[..., None] + gaps[..., None] * 0.72
    color = color * (1 - bus)[..., None] + bus[..., None] * 0.55
    rough = 0.22 + 0.4 * gaps + 0.05 * tilev
    metal = 0.08 + 0.5 * gaps
    height = -gaps * 0.8 + 0.1 * bus
    save("solar", color, rough, metal, blur(height, 0.5), 3)


def truss(rng):
    # 1 m tile: brushed aluminium-lithium, streaks along U, a few scratches.
    lines = np.repeat(periodic_noise(rng, 3)[:, :1], N, 1)
    grime = fbm(rng, [40, 8], [1, 0.5])
    v = 0.62 + 0.1 * lines - 0.12 * grime
    color = tint((0.86, 0.87, 0.9), v)
    rough = 0.32 + 0.2 * lines + 0.2 * grime
    metal = 0.85 + 0 * v
    save("truss", color, rough, metal, lines * 0.3, 2)


def dark(rng):
    # 2 m tile: dark anodised fittings: docking collars, hatches, tanks' end caps; hazard chevrons on a band.
    s, t = panels(rng, 4, 4, 0.2)
    grime = fbm(rng, [30, 6], [1, 0.4])
    y, x = np.mgrid[0:N, 0:N]
    band = ((y % (N // 2)) < N // 32).astype(float)
    chev = band * (((x + y) // (N // 64)) % 2)
    v = 0.16 + 0.05 * t + 0.05 * grime - 0.08 * s
    color = tint((0.9, 0.92, 1.0), v)
    color = color * (1 - chev)[..., None] + chev[..., None] * np.array([0.95, 0.72, 0.18]) * 0.9
    rough = 0.45 + 0.2 * grime + 0.2 * s
    metal = 0.6 - 0.4 * chev
    height = 0.5 * (1 - s) + 0.1 * chev
    save("dark", color, rough, metal, blur(height, 0.8), 5)


def window(rng):
    # 4 m tile: a deck band of windows. Emission (in the colour map's lit cells) is picked up by the page as emissive.
    y, x = np.mgrid[0:N, 0:N]
    cols, rows = 8, 4                      # 0.5 m x 1 m window bays
    cx, cy = N // cols, N // rows
    lx, ly = x % cx, y % cy
    pane = (lx > cx * 0.18) & (lx < cx * 0.82) & (ly > cy * 0.3) & (ly < cy * 0.75)
    lit = cells(cols, rows, rng) > 0.35
    warm = 0.75 + 0.25 * cells(cols, rows, rng)
    frame = tint((0.88, 0.88, 0.86), 0.8 - 0.1 * fbm(rng, [20], [1]))
    glow = np.dstack([warm * 1.0, warm * 0.78, warm * 0.48])
    glass = np.where((pane & lit)[..., None], glow, np.array([0.05, 0.06, 0.08]))
    color = np.where(pane[..., None], glass, frame)
    rough = np.where(pane, 0.08, 0.55)
    metal = np.where(pane, 0.0, 0.2)
    save("window", color, rough, metal, blur((~pane).astype(float), 1.0), 4)
    em = np.where((pane & lit)[..., None], glow, 0.0)
    Image.fromarray((np.clip(em, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "window_emissive.jpg"), quality=85)


def rock(rng):
    # 16 m tile: carbonaceous regolith (Ceres is dark, albedo about 0.09), boulders and fine grit.
    h = fbm(rng, [90, 30, 10, 3, 1], [1, 0.6, 0.35, 0.2, 0.12])
    pits = np.clip((periodic_noise(rng, 6) - 0.62) * 6, 0, 1)
    v = 0.2 + 0.25 * h - 0.08 * pits
    color = np.dstack([v * 1.02, v * 0.98, v * 0.92])
    rough = 0.92 + 0 * h
    metal = 0 * h
    save("rock", color, rough, metal, h - 0.3 * pits, 10)


def main():
    rng = np.random.default_rng(20261020)
    for f in (hull, mli, radiator, solar, truss, dark, window, rock):
        f(rng)
        print("trim:", f.__name__, flush=True)
    with open(os.path.join(OUT, "trim.json"), "w") as fh:
        json.dump({"generator": "tools/models/trims.py", "px": N, "tile_m": TILE_M}, fh, indent=1)


if __name__ == "__main__":
    main()
