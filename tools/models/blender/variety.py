"""Blockouts for Starfare's station, dock and ship variety (docs: /mnt/project-files/art/variety/PLAN.md).

Each station, dock type and ship class gets its own silhouette, from what it does and where it is. This stage is
grey geometry only, for the 15 px silhouette test; surfacing comes after sign-off.
  pip install bpy                                          # Blender as a Python module (5.2 LTS)
  python -I tools/models/blender/variety.py --render DIR    # renders every model to DIR/<id>.png
  python -I tools/models/blender/variety.py --only liner --render DIR
  python -I tools/models/blender/variety.py --export DIR    # also writes DIR/<id>.glb (grey, unscaled metres)

Everything is fictional and original to Starfare, not modelled on any real station or vehicle. Units are metres,
Blender Z up, ships with the bow on -Y (glTF +Z after export, the engine's ship convention).
"""
import argparse
import json
import math
import os
import random
import sys
from contextlib import contextmanager

import bpy
from mathutils import Euler, Matrix, Vector

TAU = math.pi * 2


# ---------- materials ----------
# Faces carry a material name from tools/models/trims.py (hull, hull2, mli, radiator, solar, truss, dark, window, rock) or
# "accent" (light livery plates, tinted per ship by the page). A primitive takes an explicit mat, else the
# innermost `with M(...)`, else its own default.

STACK = []


@contextmanager
def M(name):
    STACK.append(name)
    try:
        yield
    finally:
        STACK.pop()


def tag(o, mat, default):
    name = mat or (STACK[-1] if STACK else default)
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    o.data.materials.clear()
    o.data.materials.append(m)
    return o


# ---------- primitives: each returns the new object, already placed ----------

def _place(o, at, rot):
    o.location = at
    o.rotation_euler = Euler(rot)
    return o


def box(size, at=(0, 0, 0), rot=(0, 0, 0), mat=None):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.scale = size
    return tag(_place(o, at, rot), mat, "hull")


def cyl(r, length, at=(0, 0, 0), rot=(0, 0, 0), n=24, r2=None, mat=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=n, radius=r, depth=length)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=n, radius1=r, radius2=r2, depth=length)
    return tag(_place(bpy.context.object, at, rot), mat, "hull")


def ball(r, at=(0, 0, 0), seg=24, mat=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r)
    o = bpy.context.object
    bpy.ops.object.shade_smooth()
    return tag(_place(o, at, (0, 0, 0)), mat, "hull")


def ring(R, r, at=(0, 0, 0), rot=(0, 0, 0), n=48, m=12, mat=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=n, minor_segments=m)
    o = bpy.context.object
    bpy.ops.object.shade_smooth()
    return tag(_place(o, at, rot), mat, "hull")


def along(a, b):
    """Rotation that turns a Z-aligned primitive to run from a to b, with its centre and length."""
    a, b = Vector(a), Vector(b)
    d = b - a
    return (a + b) / 2, d.length, d.to_track_quat("Z", "Y").to_euler()


def rod(a, b, r, n=8, mat=None):
    c, L, e = along(a, b)
    return cyl(r, L, c, e, n, mat=mat or (STACK[-1] if STACK else "truss"))


def truss(a, b, w, bay=None, r=None):
    """A square lattice truss from a to b, w wide: four longerons, frames and diagonals every bay."""
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    q = d.to_track_quat("Z", "Y")
    r = r or w * 0.04
    bay = bay or w
    parts = []
    corners = [Vector((sx * w / 2, sy * w / 2, 0)) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    for c in corners:
        parts.append(rod(a + q @ c, b + q @ c, r))
    k = max(1, round(L / bay))
    for i in range(k + 1):
        z = Vector((0, 0, L * i / k))
        for j in range(4):
            parts.append(rod(a + q @ (corners[j] + z), a + q @ (corners[(j + 1) % 4] + z), r * 0.7, 6))
        if i < k:
            z2 = Vector((0, 0, L * (i + 1) / k))
            for j in range(4):
                parts.append(rod(a + q @ (corners[j] + z), a + q @ (corners[(j + 1) % 4] + z2), r * 0.5, 6))
    return parts


def panel(w, h, at, rot=(0, 0, 0), t=0.3, ribs=0, kind="radiator"):
    """A flat radiator or solar panel w x h (in its local X and Y), t thick, with optional stiffener ribs along Y."""
    parts = [box((w, h, t), at, rot, mat=kind)]
    if ribs:
        m = Euler(rot).to_matrix()
        for i in range(ribs + 1):
            x = -w / 2 + w * i / ribs
            parts.append(box((t * 1.6, h, t * 1.8), Vector(at) + m @ Vector((x, 0, 0)), rot, mat="truss"))
    return parts


def collar(at, axis, r=2.2):
    """A docking berth: a short tunnel and a ring, facing along axis."""
    a = Vector(at)
    ax = Vector(axis).normalized()
    c, L, e = along(a, a + ax * 3)
    return [cyl(r * 0.6, L, c, e, 16, mat="dark"), ring(r, r * 0.22, a + ax * 3, e, 24, 8, mat="dark")]


def rock(r, at, seed, squash=(1.25, 1.0, 0.85), subdiv=5):
    """A captured asteroid: a noisy, cratered icosphere."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=r)
    o = bpy.context.object
    rng = random.Random(seed)
    craters = [(Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized(), rng.uniform(0.15, 0.45))
               for _ in range(14)]
    lobes = [(Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized(), rng.uniform(-0.18, 0.22))
             for _ in range(6)]
    for v in o.data.vertices:
        n = v.co.normalized()
        k = 1.0
        for d, h in lobes:
            k += h * max(0.0, n.dot(d)) ** 3
        for d, s in craters:
            ang = math.acos(max(-1, min(1, n.dot(d))))
            if ang < s:
                x = ang / s
                k -= 0.09 * s * (1 - x * x) - (0.03 * s if x > 0.8 else 0)
        k += 0.015 * math.sin(n.x * 23 + seed) * math.sin(n.y * 19) * math.sin(n.z * 17)
        v.co = Vector((n.x * squash[0], n.y * squash[1], n.z * squash[2])) * r * k
    o.location = at
    return tag(o, None, "rock")


def join(parts, name):
    flat = []
    for p in parts:
        flat.extend(p if isinstance(p, list) else [p])
    bpy.ops.object.select_all(action="DESELECT")
    for p in flat:
        p.select_set(True)
    bpy.context.view_layer.objects.active = flat[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o


# ---------- stations (fictional) ----------

def orbital_depot():
    """Earth orbit fuel farm: a long truss with clustered propellant tanks and a tug berth at each end."""
    P = truss((-80, 0, 0), (80, 0, 0), 6, bay=8)
    for x in (-48, -16, 16, 48):
        for k in range(4):
            a = TAU * k / 4 + math.pi / 4
            P.append(ball(6.5, (x, 10 * math.cos(a), 10 * math.sin(a)), mat="mli"))
            P.append(rod((x, 0, 0), (x, 7 * math.cos(a), 7 * math.sin(a)), 0.6))
    P.append(cyl(4.5, 22, (0, 0, 9), (0, 0, 0)))                     # crew module across the truss
    P.append(cyl(4.5, 6, (0, 0, 21), (0, 0, 0), r2=2.5))
    P.append(cyl(4.58, 3, (0, 0, 13), (0, 0, 0), 24, mat="window"))
    P.append(cyl(4.58, 1.2, (0, 0, 5), (0, 0, 0), 24, mat="accent"))
    for s in (1, -1):
        P.append(cyl(3.5, 10, (s * 85, 0, 0), (0, math.pi / 2, 0), mat="hull2"))  # tug berth hubs
        P.append(cyl(3.56, 1.4, (s * 82, 0, 0), (0, math.pi / 2, 0), mat="accent"))
        P += collar((s * 90, 0, 0), (s, 0, 0), 3)
        P += panel(14, 30, (s * 64, 0, -14), (0, 0, 0), 0.25, 6)     # radiators hang under, edge-on to the Sun
        P.append(rod((s * 64, 0, -3), (s * 64, 0, -6), 0.5))
    return join(P, "station-orbital-depot")


def lunar_data_center():
    """Low lunar orbit compute farm: a tower of server blocks inside a star of radiator fins, like a heat sink.
    A data centre is mostly heat to dump, and fins on edge to the Sun see it least."""
    P = []
    for i in range(6):
        P.append(box((16, 16, 9), (0, 0, -25 + i * 10), mat="hull2" if i % 2 else "hull"))
        P.append(box((17, 17, 0.8), (0, 0, -20.5 + i * 10), mat="dark"))
    for k in range(6):                                                # six fins round the tower
        a = TAU * k / 6
        d = Vector((math.cos(a), math.sin(a), 0))
        for z in (-15, 15):
            P += truss(d * 8, d * 20, 2, bay=4) if z < 0 else []
            P.append(rod(d * 8 + Vector((0, 0, z)), d * 18 + Vector((0, 0, z)), 0.6))
        P += panel(40, 52, tuple(d * 40), (math.pi / 2, 0, a), 0.3, 8)
    P.append(cyl(5, 10, (0, 0, 36), (0, 0, 0)))
    P.append(cyl(5.06, 2, (0, 0, 33), (0, 0, 0), mat="accent"))
    P += collar((0, 0, 41), (0, 0, 1), 2.6)
    P.append(cyl(4, 8, (0, 0, -34), (0, 0, 0)))
    P += collar((0, 0, -38), (0, 0, -1), 2.6)
    P.append(cyl(6, 1.5, (9, 0, 33), (0, math.radians(35), 0), 24, r2=1))   # downlink dish, aimed at Earth
    return join(P, "station-lunar-data-center")


def mars_base():
    """Areostationary-ish spin habitat: a fat drum on a short axle, a big square solar array, a cargo spine."""
    P = [cyl(26, 22, (0, 0, 0), (0, math.pi / 2, 0), 64)]
    for x in (-11.5, 11.5):
        P.append(ring(26, 1.2, (x, 0, 0), (0, math.pi / 2, 0), 64, 8, mat="dark"))
    P.append(cyl(26.12, 6, (0, 0, 0), (0, math.pi / 2, 0), 64, mat="window"))
    for x in (-7, 7):
        P.append(cyl(26.1, 1.5, (x, 0, 0), (0, math.pi / 2, 0), 64, mat="accent"))
    P.append(cyl(5, 70, (-10, 0, 0), (0, math.pi / 2, 0), mat="hull2"))  # axle
    P.append(cyl(7, 8, (26, 0, 0), (0, math.pi / 2, 0)))              # despun hub
    P += collar((30, 0, 0), (1, 0, 0), 3)
    P += truss((-45, 0, 0), (-95, 0, 0), 5, bay=6)                    # cargo spine
    for i in range(4):
        for s in (1, -1):
            P.append(box((8, 5, 5), (-55 - i * 10, 0, s * 5.5), mat="mli"))
    for s in (1, -1):                                                 # two square arrays at the far end
        P += truss((-100, 0, 0), (-100, s * 12, 0), 2.5)
        P += panel(44, 44, (-100, s * 36, 0), (math.pi / 2, 0, 0), 0.3, 4, kind="solar")
    return join(P, "station-mars-base")


def ceres_port():
    """Belt port: habitats bolted onto a captured rock, with a mass-driver rail."""
    P = [rock(26, (0, 0, 0), 7)]
    for a, z in ((0.3, 1), (2.2, 1), (4.1, 0.8)):
        x, y = 22 * math.cos(a), 20 * math.sin(a)
        P.append(cyl(5, 22, (x, y, z * 20), (0, math.pi / 2, a)))
        P.append(cyl(5.12, 4, (x, y, z * 20), (0, math.pi / 2, a), mat="window"))
        for s in (1, -1):
            P.append(rod((x + s * 6 * math.cos(a), y + s * 6 * math.sin(a), z * 20 - 4),
                         (x + s * 6 * math.cos(a), y + s * 6 * math.sin(a), z * 12), 0.7))
    P.append(box((150, 3, 3), (-100, 0, -6), mat="truss"))                          # mass driver rail
    for i in range(16):
        P.append(ring(4, 0.5, (-35 - i * 9.5, 0, -6), (0, math.pi / 2, 0), 16, 6, mat="dark"))
    for i in range(4):
        P.append(rod((-40 - i * 34, 0, -8), (-40 - i * 34, 0, -14 - (3 - i) * 4), 0.6))
    P.append(cyl(4, 14, (0, 0, 34), (0, 0, 0), mat="hull2"))           # port tower
    P.append(cyl(4.06, 1.6, (0, 0, 38), (0, 0, 0), mat="accent"))
    P += collar((0, 0, 41), (0, 0, 1), 2.8)
    P += collar((32, 0, 6), (1, 0, 0), 2.8)
    return join(P, "station-ceres-port")


def titan_dock():
    """Outer system dock: far from the Sun, so no solar. Twin spin tori on a long reactor boom with radiators."""
    P = []
    for x in (-9, 9):
        P.append(ring(24, 3.6, (x, 0, 0), (0, math.pi / 2, 0), 64, 14, mat="hull2" if x > 0 else "hull"))
        for k in range(3):
            a = TAU * k / 3 + (0.5 if x > 0 else 0)
            P.append(rod((x, 0, 0), (x, 24 * math.cos(a), 24 * math.sin(a)), 1.1))
    P.append(cyl(5, 34, (0, 0, 0), (0, math.pi / 2, 0)))
    P.append(cyl(5.1, 8, (0, 0, 0), (0, math.pi / 2, 0), 24, mat="window"))
    for x in (-13, 13):
        P.append(cyl(5.1, 1.6, (x, 0, 0), (0, math.pi / 2, 0), 24, mat="accent"))
    P += collar((17, 0, 0), (1, 0, 0), 3)
    P += truss((-17, 0, 0), (-140, 0, 0), 4, bay=7)                   # long boom keeps the reactor away
    for k in range(4):                                                # four radiator fins in a cross along the boom
        a = TAU * k / 4 + math.pi / 4
        c, s = math.cos(a), math.sin(a)
        P += panel(60, 16, (-90, 11 * c, 11 * s), (a, 0, 0), 0.25, 10)
    P.append(cyl(6, 6, (-148, 0, 0), (0, math.pi / 2, 0), 24, r2=3, mat="dark"))   # shadow shield
    P.append(cyl(3, 10, (-156, 0, 0), (0, math.pi / 2, 0), mat="dark"))           # reactor
    return join(P, "station-titan-dock")


# ---------- docks (Starfare docks parked beside a body; never a model of a real station) ----------

def dock_ring():
    """Beside planets and big moons: a hub, a truss ring and four berth arms."""
    P = [cyl(3, 14, (0, 0, 0), (0, 0, 0), mat="hull2"), cyl(3.05, 1.5, (0, 0, 3), (0, 0, 0), mat="accent"),
         ring(18, 1.0, (0, 0, 0), (0, 0, 0), 48, 8)]
    for k in range(4):
        a = TAU * k / 4
        d = Vector((math.cos(a), math.sin(a), 0))
        P += truss(d * 3, d * 18, 1.6, bay=3)
        P.append(box((5, 5, 4), d * 18))
        P += collar(d * 20.5, d, 1.8)
    P += panel(10, 22, (0, 0, -9), (0, math.pi / 2, 0), 0.2, 4)
    return join(P, "dock-ring")


def dock_tether():
    """Beside small bodies and small moons: a hub with two berths on a long tether to a counterweight."""
    P = [cyl(3, 9, (0, 0, 0), (0, math.pi / 2, 0), mat="hull2"), ball(3.2, (5, 0, 0), mat="mli"),
         cyl(3.05, 1.4, (-1.5, 0, 0), (0, math.pi / 2, 0), mat="accent")]
    P += collar((-4.5, 0, 0), (-1, 0, 0), 2)
    P += collar((0, 0, 4.5), (0, 0, 1), 2)
    P.append(rod((0, 0, -4), (0, 0, -60), 0.25, 6))
    P.append(box((5, 5, 7), (0, 0, -64), mat="dark"))
    for s in (1, -1):
        P += panel(9, 3, (0, s * 7, 0), (0, 0, 0), 0.15, 3)
    return join(P, "dock-tether")


def dock_spar():
    """Busy hubs: a long spar with six berth arms and a control module."""
    P = truss((-48, 0, 0), (48, 0, 0), 4, bay=6)
    P.append(box((10, 8, 8), (0, 0, 0), mat="hull2"))
    P.append(box((10.1, 8.1, 1.2), (0, 0, -2.5), mat="accent"))
    P.append(box((10.1, 8.1, 2), (0, 0, 1), mat="window"))
    P.append(cyl(2.5, 6, (0, 0, 7), (0, 0, 0)))
    for i, x in enumerate((-36, -18, 18, 36, -27, 27)):
        s = 1 if i < 4 else -1
        y = s * (2 if i < 4 else 2)
        P.append(rod((x, y, 0), (x, s * 12, 0), 0.6))
        P += collar((x, s * 12, 0), (0, s, 0), 2)
    P += panel(30, 8, (0, 0, -8), (0, 0, 0), 0.2, 6)
    return join(P, "dock-spar")


# ---------- ships (bow -Y) ----------

def taxi():
    """Quick hops, about 6 t: a short stubby pod with a flat radiator disc round its waist."""
    P = [cyl(2.4, 7, (0, 0, 0), (math.pi / 2, 0, 0), 32), ball(2.4, (0, -3.5, 0), 32)]
    P.append(ring(1.9, 0.35, (0, -4.3, 0.2), (math.pi / 2, 0, 0), 32, 8, mat="window"))  # window band
    P.append(cyl(2.45, 1.2, (0, -1.2, 0), (math.pi / 2, 0, 0), 32, mat="accent"))
    P.append(cyl(2.4, 1.6, (0, 4.3, 0), (math.pi / 2, 0, 0), 32, r2=1.8))
    P.append(cyl(1.4, 1.6, (0, 5.6, 0), (math.pi / 2, 0, 0), 24, mat="dark"))  # drive
    P.append(cyl(6.5, 0.25, (0, 2.6, 0), (math.pi / 2, 0, 0), 48, mat="radiator"))  # radiator disc, a flat washer round the hull
    P.append(ring(6.5, 0.3, (0, 2.6, 0), (math.pi / 2, 0, 0), 48, 8))
    for k in range(6):
        a = TAU * k / 6
        P.append(rod((2.4 * math.cos(a), 1.2, 2.4 * math.sin(a)), (6.3 * math.cos(a), 2.6, 6.3 * math.sin(a)), 0.15, 6))
    for s in (1, -1):
        P.append(box((0.6, 2, 0.6), (s * 2.5, -1.5, -1.4)))                # RCS quads
    return join(P, "ship-taxi")


def shuttle():
    """Inner long hauls, about 25 t: a mid body with a cabin ring, twin tanks and radiator fins above and below."""
    P = [cyl(3.2, 20, (0, 0, 0), (math.pi / 2, 0, 0), 32), ball(3.2, (0, -10, 0), 32)]
    P.append(ring(4.6, 1.3, (0, -4, 0), (math.pi / 2, 0, 0), 40, 10, mat="window"))  # cabin ring
    P.append(cyl(3.25, 1.6, (0, -8, 0), (math.pi / 2, 0, 0), 32, mat="accent"))
    for s in (1, -1):
        P.append(ball(2.6, (s * 4.6, 5, 0), mat="mli"))                    # tanks
        P.append(rod((s * 3, 5, 0), (s * 4.6, 5, 0), 0.35))
        P.append(rod((0, 8, s * 3), (0, 8, s * 5), 0.4))
        P += panel(12, 9, (0, 9, s * 9.5), (0, math.pi / 2, math.radians(90)), 0.15, 5)  # fins, edge-on fore-aft
    P.append(cyl(3.2, 4, (0, 12, 0), (math.pi / 2, 0, 0), 32, r2=2.2))
    P.append(cyl(2.2, 2, (0, 15, 0), (math.pi / 2, 0, 0), 24, mat="dark"))
    return join(P, "ship-shuttle")


def liner():
    """Outer long hauls, about 200 t: a long spine, a spin-gravity cabin forward, radiators far larger than the hull."""
    P = truss((0, -40, 0), (0, 60, 0), 4, bay=6)
    P.append(cyl(4, 22, (0, -52, 0), (math.pi / 2, 0, 0), 32))
    P.append(ball(4, (0, -63, 0), 32))
    P.append(ring(16, 2.6, (0, -50, 0), (math.pi / 2, 0, 0), 64, 12, mat="window"))  # spin cabin
    P.append(cyl(4.05, 2, (0, -57, 0), (math.pi / 2, 0, 0), 32, mat="accent"))
    for k in range(4):
        a = TAU * k / 4 + math.pi / 4
        P.append(rod((0, -50, 0), (16 * math.cos(a), -50, 16 * math.sin(a)), 0.9))
    for y in (-24, -10):                                                 # consumables tanks, the real cargo
        for k in range(6):
            a = TAU * k / 6
            P.append(cyl(3, 11, (6 * math.cos(a), y, 6 * math.sin(a)), (math.pi / 2, 0, 0), 20, mat="mli"))
    for s in (1, -1):                                                    # radiator wings, edge-on along the spine
        P += truss((s * 2, 25, 0), (s * 70, 25, 0), 2, bay=6)
        for j in range(3):
            P += panel(20, 46, (s * (16 + j * 21), 25, 0), (0, 0, 0), 0.25, 6)
    P.append(cyl(6, 8, (0, 64, 0), (math.pi / 2, 0, 0), 32, r2=4))          # drive
    P.append(cyl(4, 3, (0, 69, 0), (math.pi / 2, 0, 0), 24, mat="dark"))
    return join(P, "ship-liner")


# ---------- debris (generic, fictional; small budgets, they are many and small) ----------

def cut(o, keep):
    """Delete the vertices of o (in its local frame after placement) where keep(co) is false: torn and halved parts."""
    import bmesh
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v.co)], context="VERTS")
    bm.to_mesh(o.data)
    bm.free()
    return o


def adrift(fn):
    """Debris hulls take the worn trim (bleached, pitted, scorched) wherever a part doesn't name its own material."""
    def build():
        with M("worn"):
            return fn()
    build.__doc__ = fn.__doc__
    return build


def debris_stage():
    """A spent upper stage: a tank cylinder, an open interstage ring, a dead nozzle, a snapped strut."""
    P = [cyl(1.6, 7, (0, 0, 0), (math.pi / 2, 0, 0), 20), ball(1.6, (0, -3.5, 0), 16, mat="mli")]
    P.append(cyl(1.65, 1.2, (0, 3.2, 0), (math.pi / 2, 0, 0), 20, mat="accent"))
    P.append(cyl(1.7, 1.6, (0, 4.4, 0), (math.pi / 2, 0, 0), 20, r2=1.9, mat="dark"))   # interstage skirt
    P.append(cyl(0.35, 1.0, (0, 4.6, 0), (math.pi / 2, 0, 0), 12, mat="dark"))
    P.append(cyl(0.4, 1.6, (0, 5.6, 0), (-math.pi / 2, 0, 0), 16, r2=1.0, mat="dark"))  # nozzle, cold
    P.append(rod((1.2, -2, 1.0), (2.6, -2.6, 2.2), 0.08))
    return join(P, "debris-stage")


def debris_husk():
    """A dead satellite: a box bus, one solar wing torn short, a bent dish, foil peeling."""
    P = [box((1.6, 1.6, 2.0), (0, 0, 0), mat="mli"), box((1.62, 1.62, 0.25), (0, 0, 0.7), mat="dark")]
    P.append(rod((0.8, 0, 0), (1.6, 0, 0), 0.06))
    P += panel(3.2, 1.4, (3.3, 0, 0), (0, math.radians(12), math.radians(8)), 0.04, 3, kind="solar")
    P += panel(1.1, 1.4, (-1.6, 0, 0.1), (0, math.radians(-30), math.radians(-20)), 0.04, 1, kind="solar")  # stub
    P.append(cyl(0.9, 0.25, (0, 0.6, 1.5), (math.radians(65), math.radians(20), 0), 16, r2=0.15))
    P.append(box((0.9, 0.04, 0.7), (0.4, 0.85, -0.6), (0.3, 0.2, 0.5), mat="mli"))  # peeled foil
    return join(P, "debris-husk")


def debris_fairing():
    """Half a payload fairing shell, curled and open: the hollow side reads at any angle."""
    o = cyl(2.2, 5, (0, 0, 0), (0, 0, 0), 24)
    t = cyl(2.2, 3, (0, 0, 4), (0, 0, 0), 24, r2=0.4)
    o = join([o, t], "debris-fairing")
    cut(o, lambda v: v.x > -0.05)
    o.rotation_euler = (0.4, 0.2, 0.9)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o


def debris_panels():
    """A loose cluster of torn panel shards and a bent truss stub, from a breakup."""
    rng = random.Random(11)
    P = []
    for i in range(7):
        w, h = rng.uniform(0.6, 2.2), rng.uniform(0.4, 1.4)
        at = (rng.uniform(-3, 3), rng.uniform(-3, 3), rng.uniform(-2, 2))
        rot = (rng.uniform(0, math.pi), rng.uniform(0, math.pi), rng.uniform(0, math.pi))
        P.append(box((w, h, 0.05), at, rot, mat=rng.choice(["worn", "radiator", "solar", "mli"])))
    P += truss((-1, -1, -1), (1.8, 0.4, 0.9), 0.4, bay=0.5)
    return join(P, "debris-panels")


def debris_rock():
    """A small rock: a boulder or shard from a captured body, a few metres across."""
    o = rock(2.5, (0, 0, 0), 23, squash=(1.6, 0.9, 0.7), subdiv=2)
    rng = random.Random(5)
    planes = [(Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized(), rng.uniform(1.0, 1.9))
              for _ in range(9)]
    for v in o.data.vertices:                     # cleave it flat on a few planes: a broken shard, not a pebble
        for n, d in planes:
            h = v.co.dot(n)
            if h > d:
                v.co -= n * (h - d)
    return join([o], "debris-rock")


# What the pages show where (written into variety.json). The engine's ship classes are real reference hulls with
# placeholder seats; until the taxi/shuttle/liner ladder is decided, each maps to the look that fits its job: DS1 hops
# like a taxi, Dawn is the mid hull, RTG ships fly the outer system like liners. Seats are not drawn, so this is
# only a look. display_scale sizes a hull against the others on the map (the true lengths would hide a taxi).
PLACEMENT = {
    "classes": {"ds1": "ship-taxi", "dawn": "ship-shuttle", "shuttle": "ship-shuttle", "rtg": "ship-liner",
                "star-taxi": "ship-taxi", "star-shuttle": "ship-shuttle", "star-liner": "ship-liner"},
    "display_scale": {"ship-taxi": 0.7, "ship-shuttle": 0.9, "ship-liner": 1.35},
    "stations": {"orbital-depot": "station-orbital-depot", "lunar-data-center": "station-lunar-data-center",
                 "mars-base": "station-mars-base", "ceres-port": "station-ceres-port", "titan-dock": "station-titan-dock"},
    "docks": {"default": "dock-ring", "small": "dock-tether", "smallMoonKm": 600,
              "byKind": {"planet": "dock-spar", "moon": "dock-ring", "station": "dock-ring"}, "byPlace": {}},
    "debris": ["debris-stage", "debris-husk", "debris-fairing", "debris-panels", "debris-rock"],
}

MODELS = {
    "station-orbital-depot": orbital_depot, "station-lunar-data-center": lunar_data_center,
    "station-mars-base": mars_base, "station-ceres-port": ceres_port, "station-titan-dock": titan_dock,
    "dock-ring": dock_ring, "dock-tether": dock_tether, "dock-spar": dock_spar,
    "ship-taxi": taxi, "ship-shuttle": shuttle, "ship-liner": liner,
    "debris-stage": adrift(debris_stage), "debris-husk": adrift(debris_husk), "debris-fairing": adrift(debris_fairing),
    "debris-panels": adrift(debris_panels), "debris-rock": debris_rock,
}


# ---------- surfacing, export ----------

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")
TRIM = os.path.join(ROOT, "design", "assets", "models", "trim")
TILE_M = json.load(open(os.path.join(TRIM, "trim.json")))["tile_m"] if os.path.exists(os.path.join(TRIM, "trim.json")) else {}
ACCENT = (1.0, 0.62, 0.22)    # default livery for renders; the page picks one per callsign


def surface(o):
    """Cube-project UVs per material at its trim's metres per tile. (A vertex AO bake was tried and dropped: on
    8-vertex panels it darkened whole faces.)"""
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT")
    for i, slot in enumerate(o.material_slots):
        name = slot.material.name.split(".")[0]
        bpy.ops.mesh.select_all(action="DESELECT")
        o.active_material_index = i
        bpy.ops.object.material_slot_select()
        bpy.ops.uv.cube_project(cube_size=TILE_M.get("hull" if name == "accent" else name, 4), correct_aspect=False,
                                scale_to_bounds=False)
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")


def normalise(o):
    """Centre on the bounding box and scale so the longest side is 1. Returns the size in metres."""
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector([min(v[i] for v in bb) for i in range(3)])
    hi = Vector([max(v[i] for v in bb) for i in range(3)])
    size = max(hi - lo)
    o.data.transform(Matrix.Translation(-(lo + hi) / 2))
    o.data.transform(Matrix.Scale(1 / size, 4))
    o.location = (0, 0, 0)
    o.data.update()
    bpy.context.view_layer.update()
    return [round(x, 1) for x in (hi - lo)]


def mounts(o):
    """Nav lights on the outermost vertex each side (+X port, -X starboard), the beacon on top; glTF axes (Y up)."""
    vs = [v.co for v in o.data.vertices]
    port = max(vs, key=lambda v: v.x)
    star = min(vs, key=lambda v: v.x)
    top = max(vs, key=lambda v: v.z)
    g = lambda v: [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]
    return {"port_light": g(port), "starboard_light": g(star), "beacon": g(top)}


def export(o, path):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_vertex_color="NONE", export_normals=True, export_texcoords=True,
                              export_materials="EXPORT", export_image_format="NONE")


def lod(o, target):
    c = o.copy()
    c.data = o.data.copy()
    bpy.context.collection.objects.link(c)
    n = sum(len(p.vertices) - 2 for p in c.data.polygons)
    if n > target:
        m = c.modifiers.new("lod", "DECIMATE")
        m.ratio = target / n
    return c


def triangles(o):
    dg = bpy.context.evaluated_depsgraph_get()
    e = o.evaluated_get(dg)
    return sum(len(p.vertices) - 2 for p in e.data.polygons)


# ---------- review renders ----------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def grey():
    m = bpy.data.materials.new("blockout")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.55, 0.56, 0.58, 1)
    b.inputs["Roughness"].default_value = 0.6
    return m


def textured(mat):
    """Node setup for a review render, from the same trim maps the page uses."""
    name = mat.name.split(".")[0]
    maps = name
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(b.outputs[0], out.inputs[0])

    def img(kind, colour):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(os.path.join(TRIM, f"{maps}_{kind}.jpg"), check_existing=True)
        t.image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
        return t
    col = img("color", True)
    base = col.outputs[0]
    if name == "accent":
        tint = nt.nodes.new("ShaderNodeMix")
        tint.data_type = "RGBA"
        tint.blend_type = "MULTIPLY"
        tint.inputs[0].default_value = 1
        nt.links.new(col.outputs[0], tint.inputs[6])
        tint.inputs[7].default_value = (*ACCENT, 1)
        base = tint.outputs[2]
    nt.links.new(base, b.inputs["Base Color"])
    orm = img("orm", False)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(orm.outputs[0], sep.inputs[0])
    nt.links.new(sep.outputs[1], b.inputs["Roughness"])
    nt.links.new(sep.outputs[2], b.inputs["Metallic"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(img("normal", False).outputs[0], nm.inputs[1])
    nt.links.new(nm.outputs[0], b.inputs["Normal"])
    if name == "window":
        em = img("emissive", True)
        nt.links.new(em.outputs[0], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = 2.5


def studio(w):
    # A soft studio sky for the textured renders: bright overhead, a light band at the horizon, black below, so the
    # polished hulls show reflections the way the page's PMREM sky gives them. Film stays transparent.
    w.use_nodes = True
    n, l = w.node_tree.nodes, w.node_tree.links
    n.clear()
    tc, xyz, ramp = n.new("ShaderNodeTexCoord"), n.new("ShaderNodeSeparateXYZ"), n.new("ShaderNodeValToRGB")
    bg, out = n.new("ShaderNodeBackground"), n.new("ShaderNodeOutputWorld")
    l.new(tc.outputs["Generated"], xyz.inputs[0])
    l.new(xyz.outputs["Z"], ramp.inputs[0])
    ramp.color_ramp.interpolation = "EASE"
    e = ramp.color_ramp.elements
    e[0].position, e[0].color = 0.42, (0.0, 0.0, 0.0, 1)
    e[1].position, e[1].color = 1.0, (0.55, 0.6, 0.7, 1)
    for pos, col in ((0.5, (0.02, 0.022, 0.03, 1)), (0.56, (0.35, 0.37, 0.42, 1)), (0.64, (0.03, 0.035, 0.045, 1))):
        el = e.new(pos)
        el.color = col
    l.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    l.new(bg.outputs[0], out.inputs[0])


def stage(o, px, grey_only):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 24 if grey_only else 32
    sc.cycles.use_denoising = True
    sc.render.resolution_x = sc.render.resolution_y = px
    sc.render.film_transparent = True
    sc.world = bpy.data.worlds.get("w") or bpy.data.worlds.new("w")
    sc.world.color = (0.012, 0.014, 0.02)
    if not grey_only:
        studio(sc.world)
    if grey_only:
        o.data.materials.clear()
        o.data.materials.append(grey())
    else:
        for m in o.data.materials:
            textured(m)
    for name, energy, rot in (("sun", 4.5, (50, 10, -40)), ("fill", 0.35, (-120, 0, 140))):
        if name not in bpy.data.objects:
            L = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN"))
            L.data.energy = energy
            L.rotation_euler = [math.radians(x) for x in rot]
            sc.collection.objects.link(L)


def shoot(o, path, d, frac, ortho, px):
    sc = bpy.context.scene
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector([min(v[i] for v in bb) for i in range(3)])
    hi = Vector([max(v[i] for v in bb) for i in range(3)])
    c, size = (lo + hi) / 2, (hi - lo).length
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    d = Vector(d).normalized()
    if ortho:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = size * 0.95
        cam.location = c + d * size * 2
    else:
        cam.data.lens = 50
        cam.location = c + d * size * frac
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_start = size * 0.001
    cam.data.clip_end = size * 10
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = px
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--render")
    ap.add_argument("--grey", action="store_true", help="grey blockout renders, no surfacing")
    ap.add_argument("--export", action="store_true", help="write design/assets/models/variety/*.glb and variety.json")
    a = ap.parse_args(argv)
    outdir = os.path.join(ROOT, "design", "assets", "models", "variety")
    manifest_path = os.path.join(ROOT, "design", "assets", "models", "variety.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {"models": {}}
    for mid, fn in MODELS.items():
        if a.only and not any(k in mid for k in a.only):
            continue
        reset()
        o = fn()
        if not a.grey:
            surface(o)
        size = normalise(o)
        entry = {"size_m": size}
        if a.export:
            os.makedirs(outdir, exist_ok=True)
            low = lod(o, 300 if mid.startswith("debris") else 1200 if mid.startswith("ship") else 2000)
            export(o, os.path.join(outdir, mid + ".glb"))
            export(low, os.path.join(outdir, mid + "-lod.glb"))
            entry.update({"file": f"variety/{mid}.glb", "lod": f"variety/{mid}-lod.glb", "triangles": triangles(o),
                          "lod_triangles": triangles(low),
                          "bytes": os.path.getsize(os.path.join(outdir, mid + ".glb")),
                          "lod_bytes": os.path.getsize(os.path.join(outdir, mid + "-lod.glb")),
                          "materials": sorted({m.name.split(".")[0] for m in o.data.materials})})
            if mid.startswith("ship"):
                entry["mounts"] = mounts(o)
                entry["display_scale"] = PLACEMENT["display_scale"][mid]
            bpy.data.objects.remove(low)
            manifest["models"][mid] = entry
        print(mid, json.dumps(entry), flush=True)
        if a.render:
            os.makedirs(a.render, exist_ok=True)
            stage(o, 640, a.grey)
            shoot(o, os.path.join(a.render, mid + ".png"), (1.0, -1.25, 0.8), 0, True, (900, 900))
            if not a.grey:
                shoot(o, os.path.join(a.render, mid + "-close.png"), (0.55, -1.0, 0.35), 0.42, False, (1280, 800))
    if a.export:
        manifest.update({k: v for k, v in PLACEMENT.items() if k != "display_scale"})
        manifest["generator"] = "tools/models/blender/variety.py"
        manifest["productionApproved"] = False
        with open(manifest_path, "w") as fh:
            json.dump(manifest, fh, indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
