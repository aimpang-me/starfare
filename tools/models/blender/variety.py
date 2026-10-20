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
import math
import os
import random
import sys

import bpy
from mathutils import Euler, Vector

TAU = math.pi * 2


# ---------- primitives: each returns the new object, already placed ----------

def _place(o, at, rot):
    o.location = at
    o.rotation_euler = Euler(rot)
    return o


def box(size, at=(0, 0, 0), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.scale = size
    return _place(o, at, rot)


def cyl(r, length, at=(0, 0, 0), rot=(0, 0, 0), n=24, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=n, radius=r, depth=length)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=n, radius1=r, radius2=r2, depth=length)
    return _place(bpy.context.object, at, rot)


def ball(r, at=(0, 0, 0), seg=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r)
    o = bpy.context.object
    bpy.ops.object.shade_smooth()
    return _place(o, at, (0, 0, 0))


def ring(R, r, at=(0, 0, 0), rot=(0, 0, 0), n=48, m=12):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=n, minor_segments=m)
    o = bpy.context.object
    bpy.ops.object.shade_smooth()
    return _place(o, at, rot)


def along(a, b):
    """Rotation that turns a Z-aligned primitive to run from a to b, with its centre and length."""
    a, b = Vector(a), Vector(b)
    d = b - a
    return (a + b) / 2, d.length, d.to_track_quat("Z", "Y").to_euler()


def rod(a, b, r, n=8):
    c, L, e = along(a, b)
    return cyl(r, L, c, e, n)


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


def panel(w, h, at, rot=(0, 0, 0), t=0.3, ribs=0):
    """A flat radiator or solar panel w x h (in its local X and Y), t thick, with optional stiffener ribs along Y."""
    parts = [box((w, h, t), at, rot)]
    if ribs:
        m = Euler(rot).to_matrix()
        for i in range(ribs + 1):
            x = -w / 2 + w * i / ribs
            parts.append(box((t * 1.6, h, t * 1.8), Vector(at) + m @ Vector((x, 0, 0)), rot))
    return parts


def collar(at, axis, r=2.2):
    """A docking berth: a short tunnel and a ring, facing along axis."""
    a = Vector(at)
    ax = Vector(axis).normalized()
    c, L, e = along(a, a + ax * 3)
    return [cyl(r * 0.6, L, c, e, 16), ring(r, r * 0.22, a + ax * 3, e, 24, 8)]


def rock(r, at, seed, squash=(1.25, 1.0, 0.85)):
    """A captured asteroid: a noisy, cratered icosphere."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5, radius=r)
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
    return o


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
            P.append(ball(6.5, (x, 10 * math.cos(a), 10 * math.sin(a))))
            P.append(rod((x, 0, 0), (x, 7 * math.cos(a), 7 * math.sin(a)), 0.6))
    P.append(cyl(4.5, 22, (0, 0, 9), (0, 0, 0)))                     # crew module across the truss
    P.append(cyl(4.5, 6, (0, 0, 21), (0, 0, 0), r2=2.5))
    for s in (1, -1):
        P.append(cyl(3.5, 10, (s * 85, 0, 0), (0, math.pi / 2, 0)))  # tug berth hubs
        P += collar((s * 90, 0, 0), (s, 0, 0), 3)
        P += panel(14, 30, (s * 64, 0, -14), (0, 0, 0), 0.25, 6)     # radiators hang under, edge-on to the Sun
        P.append(rod((s * 64, 0, -3), (s * 64, 0, -6), 0.5))
    return join(P, "station-orbital-depot")


def lunar_data_center():
    """Low lunar orbit compute farm: a tower of server blocks inside a star of radiator fins, like a heat sink.
    A data centre is mostly heat to dump, and fins on edge to the Sun see it least."""
    P = []
    for i in range(6):
        P.append(box((16, 16, 9), (0, 0, -25 + i * 10)))
        P.append(box((17, 17, 0.8), (0, 0, -20.5 + i * 10)))
    for k in range(6):                                                # six fins round the tower
        a = TAU * k / 6
        d = Vector((math.cos(a), math.sin(a), 0))
        for z in (-15, 15):
            P += truss(d * 8, d * 20, 2, bay=4) if z < 0 else []
            P.append(rod(d * 8 + Vector((0, 0, z)), d * 18 + Vector((0, 0, z)), 0.6))
        P += panel(40, 52, tuple(d * 40), (math.pi / 2, 0, a), 0.3, 8)
    P.append(cyl(5, 10, (0, 0, 36), (0, 0, 0)))
    P += collar((0, 0, 41), (0, 0, 1), 2.6)
    P.append(cyl(4, 8, (0, 0, -34), (0, 0, 0)))
    P += collar((0, 0, -38), (0, 0, -1), 2.6)
    P.append(cyl(6, 1.5, (9, 0, 33), (0, math.radians(35), 0), 24, r2=1))   # downlink dish, aimed at Earth
    return join(P, "station-lunar-data-center")


def mars_base():
    """Areostationary-ish spin habitat: a fat drum on a short axle, a big square solar array, a cargo spine."""
    P = [cyl(26, 22, (0, 0, 0), (0, math.pi / 2, 0), 64)]
    for x in (-11.5, 11.5):
        P.append(ring(26, 1.2, (x, 0, 0), (0, math.pi / 2, 0), 64, 8))
    P.append(cyl(5, 70, (-10, 0, 0), (0, math.pi / 2, 0)))            # axle
    P.append(cyl(7, 8, (26, 0, 0), (0, math.pi / 2, 0)))              # despun hub
    P += collar((30, 0, 0), (1, 0, 0), 3)
    P += truss((-45, 0, 0), (-95, 0, 0), 5, bay=6)                    # cargo spine
    for i in range(4):
        for s in (1, -1):
            P.append(box((8, 5, 5), (-55 - i * 10, 0, s * 5.5)))
    for s in (1, -1):                                                 # two square arrays at the far end
        P += truss((-100, 0, 0), (-100, s * 12, 0), 2.5)
        P += panel(44, 44, (-100, s * 36, 0), (math.pi / 2, 0, 0), 0.3, 4)
    return join(P, "station-mars-base")


def ceres_port():
    """Belt port: habitats bolted onto a captured rock, with a mass-driver rail."""
    P = [rock(26, (0, 0, 0), 7)]
    for a, z in ((0.3, 1), (2.2, 1), (4.1, 0.8)):
        x, y = 22 * math.cos(a), 20 * math.sin(a)
        P.append(cyl(5, 22, (x, y, z * 20), (0, math.pi / 2, a)))
        P.append(cyl(5.2, 1.2, (x, y, z * 20), (0, math.pi / 2, a)))
        for s in (1, -1):
            P.append(rod((x + s * 6 * math.cos(a), y + s * 6 * math.sin(a), z * 20 - 4),
                         (x + s * 6 * math.cos(a), y + s * 6 * math.sin(a), z * 12), 0.7))
    P.append(box((150, 3, 3), (-100, 0, -6)))                          # mass driver rail
    for i in range(16):
        P.append(ring(4, 0.5, (-35 - i * 9.5, 0, -6), (0, math.pi / 2, 0), 16, 6))
    for i in range(4):
        P.append(rod((-40 - i * 34, 0, -8), (-40 - i * 34, 0, -14 - (3 - i) * 4), 0.6))
    P.append(cyl(4, 14, (0, 0, 34), (0, 0, 0)))                        # port tower
    P += collar((0, 0, 41), (0, 0, 1), 2.8)
    P += collar((32, 0, 6), (1, 0, 0), 2.8)
    return join(P, "station-ceres-port")


def titan_dock():
    """Outer system dock: far from the Sun, so no solar. Twin spin tori on a long reactor boom with radiators."""
    P = []
    for x in (-9, 9):
        P.append(ring(24, 3.6, (x, 0, 0), (0, math.pi / 2, 0), 64, 14))
        for k in range(3):
            a = TAU * k / 3 + (0.5 if x > 0 else 0)
            P.append(rod((x, 0, 0), (x, 24 * math.cos(a), 24 * math.sin(a)), 1.1))
    P.append(cyl(5, 34, (0, 0, 0), (0, math.pi / 2, 0)))
    P += collar((17, 0, 0), (1, 0, 0), 3)
    P += truss((-17, 0, 0), (-140, 0, 0), 4, bay=7)                   # long boom keeps the reactor away
    for k in range(4):                                                # four radiator fins in a cross along the boom
        a = TAU * k / 4 + math.pi / 4
        c, s = math.cos(a), math.sin(a)
        P += panel(60, 16, (-90, 11 * c, 11 * s), (a, 0, 0), 0.25, 10)
    P.append(cyl(6, 6, (-148, 0, 0), (0, math.pi / 2, 0), 24, r2=3))   # shadow shield
    P.append(cyl(3, 10, (-156, 0, 0), (0, math.pi / 2, 0)))           # reactor
    return join(P, "station-titan-dock")


# ---------- docks (Starfare docks parked beside a body; never a model of a real station) ----------

def dock_ring():
    """Beside planets and big moons: a hub, a truss ring and four berth arms."""
    P = [cyl(3, 14, (0, 0, 0), (0, 0, 0)), ring(18, 1.0, (0, 0, 0), (0, 0, 0), 48, 8)]
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
    P = [cyl(3, 9, (0, 0, 0), (0, math.pi / 2, 0)), ball(3.2, (5, 0, 0))]
    P += collar((-4.5, 0, 0), (-1, 0, 0), 2)
    P += collar((0, 0, 4.5), (0, 0, 1), 2)
    P.append(rod((0, 0, -4), (0, 0, -60), 0.25, 6))
    P.append(box((5, 5, 7), (0, 0, -64)))
    for s in (1, -1):
        P += panel(9, 3, (0, s * 7, 0), (0, 0, 0), 0.15, 3)
    return join(P, "dock-tether")


def dock_spar():
    """Busy hubs: a long spar with six berth arms and a control module."""
    P = truss((-48, 0, 0), (48, 0, 0), 4, bay=6)
    P.append(box((10, 8, 8), (0, 0, 0)))
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
    P.append(ring(1.9, 0.35, (0, -4.3, 0.2), (math.pi / 2, 0, 0), 32, 8))  # window band
    P.append(cyl(2.4, 1.6, (0, 4.3, 0), (math.pi / 2, 0, 0), 32, r2=1.8))
    P.append(cyl(1.4, 1.6, (0, 5.6, 0), (math.pi / 2, 0, 0), 24))          # drive
    P.append(cyl(6.5, 0.25, (0, 2.6, 0), (math.pi / 2, 0, 0), 48))      # radiator disc, a flat washer round the hull
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
    P.append(ring(4.6, 1.3, (0, -4, 0), (math.pi / 2, 0, 0), 40, 10))       # cabin ring
    for s in (1, -1):
        P.append(ball(2.6, (s * 4.6, 5, 0)))                               # tanks
        P.append(rod((s * 3, 5, 0), (s * 4.6, 5, 0), 0.35))
        P.append(rod((0, 8, s * 3), (0, 8, s * 5), 0.4))
        P += panel(12, 9, (0, 9, s * 9.5), (0, math.pi / 2, math.radians(90)), 0.15, 5)  # fins, edge-on fore-aft
    P.append(cyl(3.2, 4, (0, 12, 0), (math.pi / 2, 0, 0), 32, r2=2.2))
    P.append(cyl(2.2, 2, (0, 15, 0), (math.pi / 2, 0, 0), 24))
    return join(P, "ship-shuttle")


def liner():
    """Outer long hauls, about 200 t: a long spine, a spin-gravity cabin forward, radiators far larger than the hull."""
    P = truss((0, -40, 0), (0, 60, 0), 4, bay=6)
    P.append(cyl(4, 22, (0, -52, 0), (math.pi / 2, 0, 0), 32))
    P.append(ball(4, (0, -63, 0), 32))
    P.append(ring(16, 2.6, (0, -50, 0), (math.pi / 2, 0, 0), 64, 12))      # spin cabin
    for k in range(4):
        a = TAU * k / 4 + math.pi / 4
        P.append(rod((0, -50, 0), (16 * math.cos(a), -50, 16 * math.sin(a)), 0.9))
    for y in (-24, -10):                                                 # consumables tanks, the real cargo
        for k in range(6):
            a = TAU * k / 6
            P.append(cyl(3, 11, (6 * math.cos(a), y, 6 * math.sin(a)), (math.pi / 2, 0, 0), 20))
    for s in (1, -1):                                                    # radiator wings, edge-on along the spine
        P += truss((s * 2, 25, 0), (s * 70, 25, 0), 2, bay=6)
        for j in range(3):
            P += panel(20, 46, (s * (16 + j * 21), 25, 0), (0, 0, 0), 0.25, 6)
    P.append(cyl(6, 8, (0, 64, 0), (math.pi / 2, 0, 0), 32, r2=4))          # drive
    P.append(cyl(4, 3, (0, 69, 0), (math.pi / 2, 0, 0), 24))
    return join(P, "ship-liner")


MODELS = {
    "station-orbital-depot": orbital_depot, "station-lunar-data-center": lunar_data_center,
    "station-mars-base": mars_base, "station-ceres-port": ceres_port, "station-titan-dock": titan_dock,
    "dock-ring": dock_ring, "dock-tether": dock_tether, "dock-spar": dock_spar,
    "ship-taxi": taxi, "ship-shuttle": shuttle, "ship-liner": liner,
}


# ---------- review renders ----------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def grey():
    m = bpy.data.materials.new("blockout")
    m.diffuse_color = (0.6, 0.6, 0.62, 1)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.55, 0.56, 0.58, 1)
    b.inputs["Roughness"].default_value = 0.6
    return m


def render(o, path, px=640):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 24
    sc.cycles.use_denoising = True
    sc.render.resolution_x = sc.render.resolution_y = px
    sc.render.film_transparent = True
    sc.world = bpy.data.worlds.new("w")
    sc.world.color = (0.02, 0.022, 0.03)
    o.data.materials.append(grey())
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector([min(v[i] for v in bb) for i in range(3)])
    hi = Vector([max(v[i] for v in bb) for i in range(3)])
    c, size = (lo + hi) / 2, (hi - lo).length
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = size * 0.95
    d = Vector((1.0, -1.25, 0.8)).normalized()
    cam.location = c + d * size * 2
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = size * 10
    sc.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-40))
    sc.collection.objects.link(sun)
    fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "SUN"))
    fill.data.energy = 0.6
    fill.rotation_euler = (math.radians(-120), 0, math.radians(140))
    sc.collection.objects.link(fill)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--render")
    ap.add_argument("--export")
    a = ap.parse_args(argv)
    for mid, fn in MODELS.items():
        if a.only and not any(k in mid for k in a.only):
            continue
        reset()
        o = fn()
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        print(f"{mid}: {tris} triangles", flush=True)
        if a.export:
            os.makedirs(a.export, exist_ok=True)
            bpy.ops.export_scene.gltf(filepath=os.path.join(a.export, mid + ".glb"), export_format="GLB",
                                      use_selection=False, export_apply=True)
        if a.render:
            os.makedirs(a.render, exist_ok=True)
            render(o, os.path.join(a.render, mid + ".png"))


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
