"""Builds Starfare's dock, station and cabin models in Blender and exports them as GLB to design/assets/models/.

Everything is modelled and surfaced here in code, so the files can be rebuilt and nothing is hand-edited:
  pip install bpy                                    # Blender as a Python module (5.2 LTS was used), or run inside
  python -I tools/models/blender/build_models.py     # Blender: blender -b -P tools/models/blender/build_models.py --
  python -I tools/models/blender/build_models.py --only cabin --seats 24 --abreast 4
  python -I tools/models/blender/build_models.py --only station --render out/   # also writes Cycles review renders
then  cd tools/models && npm ci && node pack-docks.mjs                         # quantize, re-hash docks.json

Models (all fictional, original to Starfare; not modelled on any real station or vehicle):
  dock-orbital.glb  the generic Starfare dock: a hub, a truss ring and berth arms. Used beside planets, moons, small
                    bodies and real stations (it is a Starfare dock parked near them, never a model of ISS or Tiangong).
  station-<id>.glb  the five fictional stations, one family after the Wayfarer concept (art/2026-10-17): an open C
                    concourse with two recessed window decks and alloy collar bands, and an offset service spine.
  cabin-<n>.glb     a passenger cabin, cut away from above, with n seats. The seat count is a parameter because the
                    per-ship capacity is still being decided; the default follows the engine's current spec.

Surfacing: procedural materials (surfacing.py) are baked per model into base colour (with ambient occlusion),
roughness/metalness, tangent normal and emission maps on a second UV set. The GLB carries those maps as JPEG.

Conventions, for the page loader in design/assets/sol-art.js:
  Up is +Y after export (Blender +Z). Each model fits a unit cube centred on the origin, longest side 1.
  Docks and stations carry berth_1..berth_4 nodes (collars sharing one mesh). The page shows as many as the engine
  gives the place (SOLE.R.BERTHS) and hides the rest, so a berth count change needs no re-export.
  Cabins carry seat_1..seat_n nodes so a manifest can mark taken seats.
  Maps are stored as display colours; the pages read them without decoding, as they do the ship hulls.
  Propulsion is not modelled: docks and stations have none, and ships keep their own hulls, so engine details stay
  swappable per class.
"""
import argparse
import hashlib
import json
import math
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I leaves this folder off the path

import bpy  # first: bmesh and mathutils come with it
from mathutils import Euler, Matrix, Vector

import surfacing
from kit import Part, arc_frame, frame_to, rrect, span

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "design", "assets", "models")
CABIN_SEATS = 4  # world/engine ship classes give every Starseeker 4 seats today (docs/OPEN-QUESTIONS.md)


def new_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    surfacing.materials(*surfacing.MATS)
    # AO rays stop after about 9 m (0.35 units), so contact shadow in seams, not whole panels shaded by the far ring
    world = bpy.data.worlds.new("space")
    world.light_settings.distance = 0.35
    bpy.context.scene.world = world
    root = bpy.data.objects.new("root", None)
    bpy.context.scene.collection.objects.link(root)
    return root


# ------------------------------------------------------------------ berth collar

def collar_part():
    """A docking collar facing +Y from the origin: flange, pressurised throat with ribs, alloy ring, latches,
    a cyan approach light round the mouth and a dark seal."""
    p = Part("collar")
    Y = (0, 1, 0)
    p.cyl((0, 0.03, 0), Y, 0.4, 0.06, "alloy_dark", 32, bevel=0.012)
    p.cyl((0, 0.22, 0), Y, 0.27, 0.34, "paint", 32, bevel=0.01)
    for y in (0.12, 0.26):
        p.torus((0, y, 0), Y, 0.275, 0.018, "alloy", 32, 8)
    p.cyl((0, 0.42, 0), Y, 0.34, 0.09, "alloy", 32, bevel=0.015)
    p.torus((0, 0.475, 0), Y, 0.3, 0.012, "light_cyan", 32, 6)
    p.cyl((0, 0.47, 0), Y, 0.24, 0.012, "rubber", 32)
    p.cyl((0, 0.474, 0), Y, 0.16, 0.012, "alloy_dark", 24)
    for k in range(8):
        a = 2 * math.pi * k / 8
        c = Vector((math.cos(a) * 0.37, 0.42, math.sin(a) * 0.37))
        p.box(c, (0.06, 0.12, 0.05), "alloy_dark", rot=Matrix.Rotation(-a, 4, "Y"), bevel=0.01)
    return p


def add_berths(root, mesh_ob, spots, scale=1.0):
    """Four berth nodes sharing mesh_ob's mesh. spots: (position, outward direction)."""
    mesh_ob.parent = root
    obs = []
    for i, (pos, out) in enumerate(spots):
        ob = mesh_ob if i == 0 else bpy.data.objects.new("berth", mesh_ob.data)
        if i:
            bpy.context.scene.collection.objects.link(ob)
            ob.parent = root
        ob.name = "berth_%d" % (i + 1)
        q = Vector((0, 1, 0)).rotation_difference(Vector(out))
        ob.matrix_basis = Matrix.Translation(Vector(pos)) @ q.to_matrix().to_4x4() @ Matrix.Scale(scale, 4)
        obs.append(ob)
    return obs


# ------------------------------------------------------------------ the Wayfarer station family

R0, W, H = 3.6, 1.5, 1.0  # concourse radius, tube width (radial) and height


def concourse_profile(w=W, h=H, r=0.22, d=0.07):
    """The concourse section, anticlockwise from the outer face's foot: two recessed window decks on the outer and
    the inner face, rounded shoulders. Returns points and the material of each edge (point i to i+1)."""
    W2, H2 = w / 2, h / 2
    decks = [(-0.36 * h, -0.08 * h), (0.08 * h, 0.36 * h)]
    pts, mats = [], []

    def go(p, m):
        pts.append(p)
        mats.append(m)

    def corner(cx, cy, a0, n=3):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            yield (cx + r * math.cos(a), cy + r * math.sin(a))

    # outer face, going up
    go((W2, -H2 + r), "paint")
    for lo, hi in decks:
        go((W2, lo), "graphite")
        go((W2 - d, lo), "window")
        go((W2 - d, hi), "graphite")
        go((W2, hi), "paint")
    for q in list(corner(W2 - r, H2 - r, 0))[:-1]:
        go(q, "paint")
    for q in list(corner(-W2 + r, H2 - r, 90))[:-1]:
        go(q, "paint")
    # inner face, going down
    go((-W2, H2 - r), "paint")
    for lo, hi in reversed(decks):
        go((-W2, hi), "graphite")
        go((-W2 + d, hi), "window")
        go((-W2 + d, lo), "graphite")
        go((-W2, lo), "paint")
    for q in list(corner(-W2 + r, -H2 + r, 180))[:-1]:
        go(q, "paint_dark")
    for q in list(corner(W2 - r, -H2 + r, 270))[:-1]:
        go(q, "paint_dark")
    # the edge leaving each point carries that point's material
    return pts, mats


def concourse(p, R, gap_deg, bands):
    g = math.radians(gap_deg) / 2
    a0, a1 = g, 2 * math.pi - g
    fr = arc_frame(R)
    prof, mats = concourse_profile()
    step = math.radians(3)
    # the hull between collar bands
    cuts = [a0 + (a1 - a0) * (i + 0.5) / bands for i in range(bands)]
    half = 0.16 / R
    edges = [a0] + [x for c in cuts for x in (c - half, c + half)] + [a1]
    for s0, s1 in zip(edges[::2], edges[1::2]):
        p.sweep(prof, mats, fr, span(s0, s1, step), caps=False)
    for c in cuts:
        band(p, R, c)
    for a, s in ((a0, -1), (a1, 1)):
        end_bay(p, R, a, s)
    # mullions: alloy posts across both window decks on both faces, about every 0.55 units of arc
    for s0, s1 in zip(edges[::2], edges[1::2]):
        for side in (1, -1):
            rr = R + side * (W / 2 - 0.035)
            n = max(2, int((s1 - s0) * rr / 0.55))
            for k in range(1, n):
                a = s0 + (s1 - s0) * k / n
                o, u, v = fr(a)
                t = Vector((-math.sin(a), math.cos(a), 0))
                for lo, hi in ((-0.36, -0.08), (0.08, 0.36)):
                    c = o + u * side * (W / 2 - 0.035) + v * ((lo + hi) / 2 * H)
                    rot = Matrix((t, u, v)).transposed().to_4x4()
                    p.box(c, (0.035, 0.07, (hi - lo) * H), "alloy_dark", rot=rot)
    # roof rail, utility conduit underneath, roof modules and masts with red tip lights
    p.sweep(rrect(0.16, 0.06, 0.02, 1), ["alloy"] * 8, arc_frame(R, H / 2 + 0.02), span(a0 + 0.02, a1 - 0.02, step))
    p.sweep(rrect(0.22, 0.1, 0.04, 1), ["graphite"] * 8, arc_frame(R + 0.25, -H / 2 - 0.04), span(a0 + 0.05, a1 - 0.05, step))
    for i, (s0, s1) in enumerate(zip(edges[::2], edges[1::2])):
        m = (s0 + s1) / 2
        o, u, v = fr(m)
        t = Vector((-math.sin(m), math.cos(m), 0))
        rot = Matrix((t, u, v)).transposed().to_4x4()
        p.box(o + u * -0.35 + v * (H / 2 + 0.06), (0.5, 0.3, 0.1), "paint_dark", rot=rot, bevel=0.02)
        p.box(o + u * 0.35 + v * (H / 2 + 0.05), (0.36, 0.22, 0.08), "graphite", rot=rot, bevel=0.02)
        if i % 2 == 0:
            base = o + u * 0.35 + v * (H / 2 + 0.09)
            p.strut(base, base + v * 0.55, 0.012, "alloy")
            p.sphere(base + v * 0.57, 0.025, "light_red", segs=10, rings=6)


def band(p, R, a):
    """A collar band round the concourse: a graphite under-ring, a chamfered alloy ring, a cyan light strip on the
    outer face and clamp blocks on the roof."""
    fr = arc_frame(R)
    w = 0.2 / R
    p.sweep(rrect(W + 0.06, H + 0.06, 0.24, 2), ["graphite"] * 12, fr, span(a - w * 1.6, a + w * 1.6, w))
    p.sweep(rrect(W + 0.16, H + 0.16, 0.26, 1), ["alloy"] * 8, fr, span(a - w, a + w, w), cap_mat="alloy")
    o, u, v = fr(a)
    t = Vector((-math.sin(a), math.cos(a), 0))
    rot = Matrix((t, u, v)).transposed().to_4x4()
    p.box(o + u * (W / 2 + 0.085), (0.05, 0.02, H * 0.55), "light_cyan", rot=rot)
    p.box(o + u * -(W / 2 + 0.085), (0.05, 0.02, H * 0.55), "light_cyan", rot=rot)
    for s in (-0.35, 0.35):
        p.box(o + u * s + v * (H / 2 + 0.11), (0.3, 0.18, 0.08), "alloy_dark", rot=rot, bevel=0.015)


def end_bay(p, R, a, s):
    """An open end of the C: an alloy frame and a glazed observation face with a mullion grid."""
    fr = arc_frame(R)
    w = 0.1 / R
    p.sweep(rrect(W + 0.12, H + 0.12, 0.26, 1), ["alloy"] * 8, fr, span(a - s * w, a + s * w * 0.2, w), cap_mat="alloy")
    o, u, v = fr(a)
    t = Vector((-math.sin(a), math.cos(a), 0)) * s
    rot = Matrix((u, v, t)).transposed().to_4x4()
    face = o + t * (w * R * 0.2 + 0.01)
    p.box(face, (W * 0.78, H * 0.72, 0.02), "window", rot=rot)
    for k in (-1, 0, 1):
        p.box(face + u * (k * W * 0.26) + t * 0.012, (0.035, H * 0.74, 0.03), "alloy_dark", rot=rot)
    p.box(face + t * 0.012, (W * 0.8, 0.035, 0.03), "alloy_dark", rot=rot)


def pressure_module(p, a, b, r, mat="paint"):
    """A cylindrical module from a to b with end domes, alloy ribs and a row of small windows each side."""
    a, b = Vector(a), Vector(b)
    d = (b - a)
    L = d.length
    ax = d.normalized()
    p.cyl((a + b) / 2, ax, r, L, mat, 32, bevel=0.03)
    for k in range(4):
        p.torus(a + d * (0.1 + 0.8 * k / 3), ax, r + 0.005, 0.025, "alloy", 32, 8)
    side = ax.cross(Vector((0, 0, 1))).normalized()
    n = int(L / 0.28)
    for s in (1, -1):
        for k in range(1, n):
            c = a + d * (k / n) + side * s * (r - 0.01) + Vector((0, 0, 0.08))
            p.box(c, (0.1, 0.04, 0.12), "window")


def node_block(p, c, size):
    """A boxy junction node with bevelled edges, a window strip and service panels."""
    c = Vector(c)
    p.box(c, size, "paint", bevel=0.06)
    p.box(c + Vector((0, 0, size[2] / 2 + 0.02)), (size[0] * 0.7, size[1] * 0.6, 0.05), "alloy_dark", bevel=0.015)
    for s in (1, -1):
        p.box(c + Vector((0, s * (size[1] / 2 + 0.005), size[2] * 0.22)), (size[0] * 0.75, 0.02, 0.1), "window")
        p.box(c + Vector((size[0] * 0.25, s * (size[1] / 2 + 0.01), -size[2] * 0.15)), (0.22, 0.03, 0.22), "graphite", bevel=0.01)


def dish(p, c, axis, r):
    c, ax = Vector(c), Vector(axis).normalized()
    p.strut(c, c + ax * 0.3, 0.03, "alloy_dark")
    p.cyl(c + ax * 0.34, ax, r, 0.06, "alloy", 32, r2=r * 0.3, bevel=0.0)
    p.strut(c + ax * 0.34, c + ax * (0.34 + r * 0.8), 0.012, "alloy_dark")


def spine(p, R, length, extra):
    """The service spine running out from the back of the C (towards -X): a neck tunnel, two junction nodes with
    the berths on their flanks, pressurised modules and a truss, ending at a comms node."""
    x0 = -R - W / 2 + 0.05
    X = Vector((-1, 0, 0))
    seg = length / 5.0
    xs = [x0 - seg * k for k in range(6)]
    pressure_module(p, (xs[0] + 0.2, 0, 0), (xs[1] + 0.6, 0, 0), 0.45)
    node_block(p, (xs[1], 0, 0), (1.2, 1.5, 1.1))
    pressure_module(p, (xs[1] - 0.6, 0, 0), (xs[2] + 0.6, 0, 0), 0.62)
    node_block(p, (xs[2], 0, 0), (1.2, 1.5, 1.1))
    p.truss((xs[2] - 0.6, 0, 0), (xs[4] + 0.45, 0, 0), 0.75, 0.5, "alloy")
    p.cyl((xs[3], 0, 0), X, 0.12, seg * 1.6, "graphite", 12)
    node_block(p, (xs[4], 0, 0), (0.9, 1.0, 0.9))
    p.cyl((xs[4] - 0.6, 0, 0), X, 0.32, 0.36, "alloy_dark", 24, bevel=0.03)
    dish(p, (xs[4], 0, 0.45), (0.3, 0.2, 1), 0.5)
    p.strut((xs[4] - 0.3, 0, 0.45), (xs[4] - 0.3, 0, 1.3), 0.02, "alloy")
    p.sphere((xs[4] - 0.3, 0, 1.32), 0.035, "light_red", segs=10, rings=6)
    # nav lights at the outer end, port red, starboard green
    p.sphere((xs[4] - 0.45, 0.52, 0), 0.035, "light_red", segs=10, rings=6)
    p.sphere((xs[4] - 0.45, -0.52, 0), 0.035, "light_green", segs=10, rings=6)
    if extra:
        extra(p, xs, seg)
    # berths on the flanks of the two junction nodes
    return [((xs[1], 0.75, 0), (0, 1, 0)), ((xs[1], -0.75, 0), (0, -1, 0)),
            ((xs[2], 0.75, 0), (0, 1, 0)), ((xs[2], -0.75, 0), (0, -1, 0))]


def tanks(p, xs, seg):
    """Orbital Depot: a propellant farm of strapped spherical-end tanks either side of the truss."""
    for s in (1, -1):
        for k, x in enumerate((xs[3] + 0.25, xs[3] - 0.45)):
            c = Vector((x, s * 0.75, 0))
            p.cyl(c, (1, 0, 0), 0.26, 0.5, "alloy", 32)
            p.sphere(c + Vector((0.25, 0, 0)), 0.26, "alloy", segs=32, rings=12)
            p.sphere(c - Vector((0.25, 0, 0)), 0.26, "alloy", segs=32, rings=12)
            for dx in (-0.15, 0.15):
                p.torus(c + Vector((dx, 0, 0)), (1, 0, 0), 0.265, 0.018, "graphite", 32, 6)
            p.strut(c - Vector((0, s * 0.26, 0)), Vector((x, s * 0.25, 0)), 0.03, "alloy_dark")


def radiators(p, xs, seg):
    """Lunar Data Center: two wings of ribbed radiator panels on booms, for the servers' heat."""
    for s in (1, -1):
        root = Vector((xs[3], s * 0.25, 0))
        p.truss(root, root + Vector((0, s * 0.7, 0)), 0.16, 0.2, "alloy_dark")
        for k in range(3):
            c = Vector((xs[3] + 0.55 - 0.55 * k, s * 1.55, 0))
            p.box(c, (0.5, 1.2, 0.025), "alloy", bevel=0.005)
            for j in range(6):
                p.box(c + Vector((0, (j - 2.5) * 0.19, 0.016)), (0.46, 0.02, 0.012), "graphite")
        p.strut(Vector((xs[3] + 0.6, s * 0.95, 0)), Vector((xs[3] - 0.6, s * 0.95, 0)), 0.025, "alloy_dark")


def containers(p, xs, seg):
    """Ceres Port: racks of ribbed cargo containers along the truss."""
    for k in range(4):
        x = xs[2] - 0.75 - k * 0.42
        for s in (1, -1):
            for z in (-0.2, 0.2):
                c = Vector((x, s * 0.62, z))
                p.box(c, (0.36, 0.42, 0.34), "paint_dark" if (k + (z > 0)) % 2 else "graphite", bevel=0.02)
                for j in range(3):
                    p.box(c + Vector(((j - 1) * 0.11, s * 0.215, 0)), (0.025, 0.02, 0.3), "alloy_dark")


def floodlights(p, xs, seg):
    """Titan Dock: lamp booms that light the berths through the haze."""
    for s in (1, -1):
        for x in (xs[1], xs[2]):
            base = Vector((x, s * 0.45, 0.55))
            top = base + Vector((0, s * 0.3, 0.5))
            p.strut(base, top, 0.025, "alloy_dark")
            p.box(top, (0.18, 0.1, 0.08), "graphite", bevel=0.01)
            p.box(top + Vector((0, s * 0.055, -0.01)), (0.15, 0.01, 0.05), "light_warm")


# The five fictional stations: one family, varied by the C's size and gap and what rides on the spine.
STATIONS = {
    "orbital-depot": dict(R=3.6, gap=70, bands=6, spine=5.0, extra=tanks),
    "lunar-data-center": dict(R=3.1, gap=80, bands=5, spine=4.6, extra=radiators),
    "mars-base": dict(R=3.6, gap=65, bands=6, spine=4.8, extra=None),
    "ceres-port": dict(R=3.3, gap=95, bands=5, spine=5.0, extra=containers),
    "titan-dock": dict(R=4.0, gap=60, bands=7, spine=5.4, extra=floodlights),
}


def build_station(key, tmp, quick=False):
    s = STATIONS[key]
    root = new_scene()
    p = Part("station")
    concourse(p, s["R"], s["gap"], s["bands"])
    spots = spine(p, s["R"], s["spine"], s["extra"])
    body = p.finish()
    body.parent = root
    c = collar_part().finish()
    add_berths(root, c, spots, 1.3)
    sz = (512, 256) if quick else (1024, 512)
    surfacing.bake(body, tmp, *sz)
    surfacing.bake(c, tmp, 512, 256)
    return root


# ------------------------------------------------------------------ the generic dock

def build_dock(tmp, quick=False):
    """A hexagonal hub with a glazed control ring and beacon mast, four truss arms out to a ring rail, and a berth
    at the end of each arm."""
    root = new_scene()
    p = Part("dock")
    Zv = (0, 0, 1)
    p.cyl((0, 0, 0), Zv, 0.9, 0.9, "paint", 6, bevel=0.06)
    p.cyl((0, 0, 0.05), Zv, 0.915, 0.18, "window", 6)
    for k in range(6):
        a = math.pi / 6 + k * math.pi / 3
        p.box((math.cos(a) * 0.86, math.sin(a) * 0.86, 0.05), (0.06, 0.06, 0.2), "alloy_dark")
    p.cyl((0, 0, 0.5), Zv, 0.7, 0.12, "alloy", 6, bevel=0.03)
    p.cyl((0, 0, -0.5), Zv, 0.7, 0.12, "alloy", 6, bevel=0.03)
    p.sphere((0, 0, 0.56), 0.45, "glass", scale=(1, 1, 0.45), segs=32, rings=12)
    p.cyl((0, 0, -0.62), Zv, 0.4, 0.15, "graphite", 24, bevel=0.02)
    p.strut((0, 0, 0.7), (0, 0, 1.5), 0.025, "alloy")
    p.sphere((0, 0, 1.52), 0.04, "light_red", segs=10, rings=6)
    dish(p, (0.35, 0.35, 0.5), (0.4, 0.4, 1), 0.28)
    p.sweep(rrect(0.2, 0.14, 0.04, 1), ["alloy"] * 8, arc_frame(2.6), span(0, 2 * math.pi, math.radians(4)), closed=True)
    p.sweep(rrect(0.06, 0.03, 0.01, 1), ["light_cyan"] * 8, arc_frame(2.6, 0.085), span(0, 2 * math.pi, math.radians(4)), closed=True)
    spots = []
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        d = Vector((math.cos(a), math.sin(a), 0))
        p.truss(d * 0.85, d * 2.5, 0.28, 0.32, "alloy_dark")
        p.box(d * 2.6, (0.36, 0.36, 0.3), "paint", rot=Matrix.Rotation(a, 4, "Z"), bevel=0.03)
        spots.append((d * 2.78, tuple(d)))
    for k in range(4):
        a = k * math.pi / 2
        d = Vector((math.cos(a), math.sin(a), 0))
        p.strut(d * 0.9, d * 2.55, 0.03, "graphite")
    body = p.finish()
    body.parent = root
    c = collar_part().finish()
    add_berths(root, c, spots)
    surfacing.bake(body, tmp, *((512, 256) if quick else (1024, 512)))
    surfacing.bake(c, tmp, 512, 256)
    return root


# ------------------------------------------------------------------ the cabin

def seat_part(name):
    """One passenger seat facing +X: frame and pedestal, cushion, reclined back with a headrest, armrests."""
    p = Part(name)
    p.box((0, 0, 0.12), (0.12, 0.12, 0.24), "alloy_dark", bevel=0.01)
    p.box((0, 0, 0.26), (0.5, 0.46, 0.06), "alloy_dark", bevel=0.01)
    p.box((0.02, 0, 0.33), (0.5, 0.44, 0.1), "fabric", bevel=0.04)
    back = Matrix.Translation(Vector((-0.24, 0, 0.62))) @ Matrix.Rotation(math.radians(-12), 4, "Y")
    p.box(back.to_translation(), (0.11, 0.44, 0.62), "fabric", rot=back.to_3x3().to_4x4(), bevel=0.04)
    p.box((-0.29, 0, 0.98), (0.1, 0.3, 0.14), "fabric_warm", rot=back.to_3x3().to_4x4(), bevel=0.04)
    for s in (1, -1):
        p.box((0.0, s * 0.24, 0.45), (0.42, 0.05, 0.05), "alloy", bevel=0.015)
        p.box((0.16, s * 0.24, 0.36), (0.04, 0.04, 0.16), "alloy_dark")
    return p


def build_cabin(seats, abreast, tmp, quick=False):
    """A cut-away cabin: a curved hull section with a floor, aisle carpet, recessed windows with warm cove lights,
    a forward bulkhead with a screen and `seats` seats, `abreast` to a row, facing +X."""
    root = new_scene()
    rows = math.ceil(seats / abreast)
    pitch, seat_w, aisle = 0.95, 0.56, 0.6
    width = abreast * seat_w + aisle + 0.5
    length = rows * pitch + 1.6
    p = Part("cabin")
    # hull cross-section: floor, curved walls rising to the cut line
    half = width / 2
    prof = [(-half - 0.1, -0.12), (half + 0.1, -0.12), (half + 0.1, 1.45), (half - 0.02, 1.45), (half - 0.02, 0.0),
            (-half + 0.02, 0.0), (-half + 0.02, 1.45), (-half - 0.1, 1.45)]
    mats = ["paint_dark", "paint", "alloy", "paint", "floor", "paint", "alloy", "paint"]
    fr = lambda x: (Vector((x, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
    p.sweep(prof, mats, fr, [-length / 2, length / 2])
    p.box((0, 0, 0.005), (length - 0.1, aisle * 0.8, 0.01), "fabric_warm")
    # windows: recessed glass in both walls, one per row, with warm cove light above
    for r in range(rows):
        x = length / 2 - 1.1 - r * pitch
        for s in (1, -1):
            y = s * (half - 0.03)
            p.box((x, y, 0.85), (0.42, 0.04, 0.34), "graphite", bevel=0.01)
            p.box((x, y - s * 0.012, 0.85), (0.34, 0.03, 0.26), "glass")
    for s in (1, -1):
        p.box((0, s * (half - 0.05), 1.3), (length - 0.2, 0.06, 0.04), "light_warm")
        p.box((0, s * (half - 0.04), 0.12), (length - 0.2, 0.05, 0.02), "light_cyan")
    # bulkheads: forward with a screen, aft with a door
    p.box((length / 2, 0, 0.72), (0.1, width + 0.2, 1.45), "paint", bevel=0.02)
    p.box((length / 2 - 0.055, 0, 0.95), (0.012, width * 0.45, 0.45), "screen")
    p.box((-length / 2, 0, 0.72), (0.1, width + 0.2, 1.45), "paint", bevel=0.02)
    p.box((-length / 2 + 0.055, 0, 0.62), (0.02, aisle, 1.15), "alloy_dark", bevel=0.01)
    cab = p.finish()
    cab.parent = root
    left = abreast // 2
    proto = seat_part("seat").finish()
    n = 0
    for r in range(rows):
        x = length / 2 - 1.15 - r * pitch
        for c in range(abreast):
            if n >= seats:
                break
            n += 1
            off = aisle / 2 if c >= left else -aisle / 2
            y = (c - (abreast - 1) / 2) * seat_w + (off - (seat_w / 2 if abreast % 2 == 0 else 0) * (1 if c >= left else -1)) * (1 if abreast > 1 else 0)
            ob = proto if n == 1 else bpy.data.objects.new("seat", proto.data)
            if n > 1:
                bpy.context.scene.collection.objects.link(ob)
            ob.name = "seat_%d" % n
            ob.parent = root
            ob.location = (x, y, 0)
    surfacing.bake(cab, tmp, *((512, 256) if quick else (1024, 512)), cull=False)
    surfacing.bake(proto, tmp, 512, 256, cull=False)
    return root


# ------------------------------------------------------------------ export and review

def normalise(root):
    """Scales the root so the model's longest side is 1 and centres it on the origin."""
    bpy.context.view_layer.update()
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for ob in root.children_recursive:
        if ob.type != "MESH":
            continue
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            lo, hi = Vector(map(min, lo, w)), Vector(map(max, hi, w))
    k = 1.0 / max(hi - lo)
    root.scale = (k, k, k)
    root.location = -(lo + hi) / 2 * k
    bpy.context.view_layer.update()


def export(root, file):
    normalise(root)
    for ob in bpy.context.scene.objects:
        ob.select_set(True)
    path = os.path.join(OUT, file)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_cameras=False, export_lights=False, export_extras=False,
                              export_image_format="JPEG", export_jpeg_quality=85)
    meshes = {ob.data for ob in root.children_recursive if ob.type == "MESH"}
    tris = sum(len(p.vertices) - 2 for me in meshes for p in me.polygons)
    data = open(path, "rb").read()
    return {"file": file, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "triangles": tris}


def render(root, path, view=(35, -50), samples=48, size=(1280, 800), dist=2.35, target=(0, 0, 0)):
    """A Cycles review render of the baked model: warm key from the Sun side, cool fill, dark space."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = samples
    try:
        sc.cycles.use_denoising = True
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.film_transparent = False
    world = bpy.data.worlds.new("space")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.012, 0.016, 0.03, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    sc.world = world
    for name, energy, rot, col in (("key", 5.5, (50, 10, 35), (1.0, 0.94, 0.86)), ("fill", 0.9, (110, 0, 220), (0.55, 0.7, 1.0))):
        ld = bpy.data.lights.new(name, "SUN")
        ld.energy, ld.color = energy, col
        ld.angle = math.radians(1.5)
        lo = bpy.data.objects.new(name, ld)
        lo.rotation_euler = Euler([math.radians(v) for v in rot])
        sc.collection.objects.link(lo)
    cam = bpy.data.cameras.new("cam")
    cam.lens = 50
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    el, az = math.radians(view[0]), math.radians(view[1])
    t = Vector(target)
    co.location = t + Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))) * dist
    co.rotation_euler = (t - co.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = co
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["dock", "station", "cabin"])
    ap.add_argument("--station", choices=list(STATIONS), help="build just this station")
    ap.add_argument("--seats", type=int, default=CABIN_SEATS)
    ap.add_argument("--abreast", type=int, default=2)
    ap.add_argument("--render", metavar="DIR", help="also write a Cycles review render of each model here")
    ap.add_argument("--quick", action="store_true", help="half-size bakes, for trying changes")
    ap.add_argument("--keep-maps", action="store_true", help="keep the baked PNG maps and print where")
    a = ap.parse_args(argv)
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="starfare-bake-")
    man_path = os.path.join(OUT, "docks.json")
    man = json.load(open(man_path)) if os.path.exists(man_path) else {}
    man.update({
        "generator": "tools/models/blender/build_models.py (Blender %s)" % bpy.app.version_string,
        "productionApproved": False,
        "note": "Fictional, original models built and surfaced in code. berth_N and seat_N are named nodes; up +Y, longest side 1.",
    })
    man.pop("packed", None)  # set again by tools/models/pack-docks.mjs
    man.setdefault("models", {})
    man.setdefault("places", {})
    jobs = []
    if a.only in (None, "dock"):
        jobs.append(("dock-orbital", lambda: build_dock(tmp, a.quick)))
    if a.only in (None, "station"):
        for key in ([a.station] if a.station else STATIONS):
            jobs.append(("station-" + key, lambda key=key: build_station(key, tmp, a.quick)))
            man["places"][key] = "station-" + key
    if a.only in (None, "cabin"):
        jobs.append(("cabin-%d" % a.seats, lambda: build_cabin(a.seats, a.abreast, tmp, a.quick)))
    for name, build in jobs:
        root = build()
        info = export(root, name + ".glb")
        if name.startswith("cabin"):
            info.update(seats=a.seats, abreast=a.abreast)
        man["models"][name] = info
        if name == "dock-orbital":
            man["default"] = name
        if a.render:
            os.makedirs(a.render, exist_ok=True)
            out = os.path.join(os.path.abspath(a.render), name)
            render(root, out + ".png", view=(55, -60) if name.startswith("cabin") else (35, -50), dist=1.7)
            if name.startswith("station"):
                render(root, out + "-close.png", view=(22, -75), dist=0.55, target=(0.05, -0.28, 0))
        print("%-28s %8d bytes %6d triangles" % (name, info["bytes"], info["triangles"]), flush=True)
    if a.keep_maps:
        print("baked maps kept in", tmp)
    else:
        shutil.rmtree(tmp, ignore_errors=True)
    with open(man_path, "w") as f:
        json.dump(man, f, indent=2, sort_keys=True)
        f.write("\n")


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
