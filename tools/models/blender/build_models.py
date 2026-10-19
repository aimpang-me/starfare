"""Builds Starfare's dock, station and cabin models in Blender and exports them as GLB to design/assets/models/.

Everything is modelled here in code, so the files can be rebuilt and nothing is hand-edited:
  pip install bpy                                    # Blender as a Python module (5.2 LTS was used), or run inside
  python -I tools/models/blender/build_models.py     # Blender: blender -b -P tools/models/blender/build_models.py --
  python -I tools/models/blender/build_models.py --only cabin --seats 24 --abreast 4

Models (all fictional, original to Starfare; not modelled on any real station or vehicle):
  dock-orbital.glb  the generic Starfare dock: a hub with berth arms. Used beside planets, moons, small bodies
                    and real stations (it is a Starfare dock parked near them, never a model of ISS or Tiangong).
  station-<id>.glb  the five fictional stations, one family after the Wayfarer concept (art/2026-10-17): an open
                    C concourse with warm window bands and alloy collars, and an offset service spine.
  cabin-<n>.glb     a passenger cabin, cut away from above, with n seats. The seat count is a parameter because
                    the per-ship capacity is still being decided; the default follows the engine's current spec.

Conventions, for the page loader in design/assets/sol-art.js:
  Up is +Y after export (Blender +Z). Each model fits a unit cube centred on the origin, longest side 1.
  Docks and stations carry berth_1..berth_4 nodes (collar meshes). The page shows as many as the engine gives the
  place (SOLE.R.BERTHS) and hides the rest, so a berth count change needs no re-export.
  Cabins carry seat_1..seat_n nodes so a manifest can mark taken seats.
  Colours are written as display values: the pages render without output encoding, so a factor is shown as is.
  No textures, so each file stays small. Propulsion is not modelled: docks and stations have none, and ships keep
  their own hulls, so engine details stay swappable per class.
"""
import argparse
import hashlib
import json
import math
import os
import sys

import bpy  # first: bmesh and mathutils come with it
import bmesh
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "design", "assets", "models")
CABIN_SEATS = 4  # world/engine ship classes give every Starseeker 4 seats today (docs/OPEN-QUESTIONS.md)

# The art direction's palette (art/2026-10-17/art-direction.md), as display values. Hull and graphite are lifted a
# little from the plates so the models still read at the map's 15 px size under its dim ambient light.
PALETTE = {
    "hull": ((0.10, 0.15, 0.24), 0.35, 0.55, None),
    "alloy": ((0.64, 0.70, 0.78), 0.70, 0.38, None),
    "graphite": ((0.16, 0.19, 0.24), 0.40, 0.60, None),
    "window": ((0.35, 0.22, 0.1), 0.0, 0.5, (1.0, 0.66, 0.3)),
    "seam": ((0.34, 0.81, 0.98), 0.0, 0.5, (0.34, 0.81, 0.98)),
    "glass": ((0.03, 0.05, 0.09), 0.1, 0.08, None),
    "fabric": ((0.33, 0.36, 0.42), 0.0, 0.9, None),
    "floor": ((0.22, 0.24, 0.28), 0.1, 0.8, None),
}


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    col, metal, rough, emit = PALETTE[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*col, 1.0)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        b.inputs["Emission Strength"].default_value = 1.0
    return m


class Part:
    """One mesh object built with bmesh; each add_* call tags its faces with a palette material."""

    def __init__(self, name):
        self.name, self.bm, self.mats = name, bmesh.new(), []

    def _mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _tag(self, faces, mat, smooth=False):
        i = self._mi(mat)
        for f in faces:
            f.material_index, f.smooth = i, smooth

    def box(self, centre, size, mat, rot=None):
        m = Matrix.Translation(Vector(centre)) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*size, 1.0))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        self._tag({f for v in r["verts"] for f in v.link_faces}, mat)

    def cyl(self, centre, axis, radius, depth, mat, segs=16, r2=None, smooth=True):
        q = Vector(axis).normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
        m = Matrix.Translation(Vector(centre)) @ q
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=segs, radius1=radius,
                                  radius2=radius if r2 is None else r2, depth=depth, matrix=m)
        self._tag({f for v in r["verts"] for f in v.link_faces}, mat, smooth)

    def sphere(self, centre, radius, mat, scale=(1, 1, 1)):
        m = Matrix.Translation(Vector(centre)) @ Matrix.Diagonal((*scale, 1.0))
        r = bmesh.ops.create_uvsphere(self.bm, u_segments=16, v_segments=10, radius=radius, matrix=m)
        self._tag({f for v in r["verts"] for f in v.link_faces}, mat, True)

    def sweep(self, profile, frame, ts, mat, caps=True, smooth=True):
        """Sweeps a closed 2D profile (u, v) along a path: frame(t) -> (origin, u axis, v axis)."""
        rings = []
        for t in ts:
            o, u, v = frame(t)
            rings.append([self.bm.verts.new(o + u * a + v * b) for a, b in profile])
        faces, n = [], len(profile)
        for r0, r1 in zip(rings, rings[1:]):
            for i in range(n):
                j = (i + 1) % n
                faces.append(self.bm.faces.new((r0[i], r0[j], r1[j], r1[i])))
        if caps:
            faces.append(self.bm.faces.new(list(reversed(rings[0]))))
            faces.append(self.bm.faces.new(rings[-1]))
        self._tag(faces, mat, smooth)

    def finish(self, parent=None):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(material(m))
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = parent
        return ob


def rrect(w, h, r, n=3):
    """A rounded rectangle, w by h, corner radius r, n segments per corner, anticlockwise."""
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def rect(u0, u1, v0, v1):
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


def arc_frame(R):
    Z = Vector((0, 0, 1))
    return lambda a: (Vector((R * math.cos(a), R * math.sin(a), 0)), Vector((math.cos(a), math.sin(a), 0)), Z)


def span(a0, a1, step):
    n = max(1, math.ceil(abs(a1 - a0) / step))
    return [a0 + (a1 - a0) * i / n for i in range(n + 1)]


def new_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = bpy.data.objects.new("root", None)
    bpy.context.scene.collection.objects.link(root)
    return root


def collar(name, root, at, out, size, depth=None):
    """A berth: a short alloy docking collar facing `out`, a dark mouth and a cyan ring light. Its own node."""
    p, o = Part(name), Vector(out).normalized()
    d = depth or size * 0.9
    p.cyl(Vector(at) + o * d / 2, o, size, d, "alloy", 16, smooth=False)
    p.cyl(Vector(at) + o * (d + 0.004), o, size * 0.74, 0.01, "graphite", 16, smooth=False)
    p.cyl(Vector(at) + o * (d * 0.62), o, size * 1.12, d * 0.16, "seam", 16, smooth=False)
    return p.finish(root)


def concourse(root, R, w, h, gap_deg, bands, decks=2):
    """The Wayfarer C: a rounded concourse arc open on +X, alloy collar bands, warm window decks on both faces."""
    g = math.radians(gap_deg) / 2
    a0, a1 = g, 2 * math.pi - g
    fr, step = arc_frame(R), math.radians(7.5)
    body = Part("concourse")
    body.sweep(rrect(w, h, min(w, h) * 0.3), fr, span(a0, a1, step), "hull")
    # end caps: alloy frames with a glazed face
    for a, s in ((a0, -1), (a1, 1)):
        o, u, v = fr(a)
        t = Vector((-math.sin(a), math.cos(a), 0)) * s
        body.box(o + t * 0.012, (w * 1.08, h * 1.1, 0.024), "alloy", rot=Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X"))
        body.box(o + t * 0.026, (w * 0.66, h * 0.62, 0.006), "window", rot=Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X"))
    # collar bands, evenly spaced, and window decks between them
    cuts = [a0 + (a1 - a0) * (i + 0.5) / bands for i in range(bands)]
    bw = math.radians(2.4)
    for c in cuts:
        body.sweep(rrect(w * 1.14, h * 1.16, min(w, h) * 0.3), fr, span(c - bw, c + bw, bw), "alloy", smooth=False)
    edges = [a0 + math.radians(1.5)] + [x for c in cuts for x in (c - bw * 1.6, c + bw * 1.6)] + [a1 - math.radians(1.5)]
    deck_h = h * 0.22
    vs = [h * 0.17, -h * 0.15] if decks == 2 else [0.0]
    for s0, s1 in zip(edges[::2], edges[1::2]):
        for v in vs:
            for side in (1, -1):
                u0 = side * (w / 2 + 0.0015)
                body.sweep(rect(min(u0, u0 + side * 0.004), max(u0, u0 + side * 0.004), v - deck_h / 2, v + deck_h / 2),
                           fr, span(s0, s1, step), "window", smooth=False)
        # a thin cyan seam along the top
        body.sweep(rect(-w * 0.04, w * 0.04, h / 2 - 0.001, h / 2 + 0.003), fr, span(s0, s1, step), "seam", smooth=False)
    body.finish(root)
    return a0, a1


def spine(root, R, length, w, extra=None):
    """The offset service spine: modules running out from the back of the C (on -X) with berths on its sides."""
    p = Part("spine")
    x0 = -R - 0.04
    p.box((x0 - length / 2, 0, 0), (length, w, w * 0.8), "graphite")
    n = 4
    for i in range(n):
        x = x0 - length * (i + 0.5) / n
        p.box((x, 0, 0), (length / n * 0.7, w * 1.25, w * 1.0), "alloy" if i % 2 else "hull")
        p.box((x, 0, w * 0.52), (length / n * 0.5, w * 0.5, 0.004), "window")
    p.cyl((x0 - length - 0.02, 0, 0), (1, 0, 0), w * 0.45, 0.04, "alloy", 12)
    p.cyl((x0 - length * 0.18, 0, w * 0.7), (0, 0, 1), w * 0.32, w * 0.5, "alloy", 12)  # control dome
    p.sphere((x0 - length * 0.18, 0, w * 0.98), w * 0.3, "glass", (1, 1, 0.5))
    if extra:
        extra(p, x0, length, w)
    p.finish(root)
    # four berths along the spine, alternating sides, nearest the C first
    size = w * 0.38
    for i in range(4):
        x = x0 - length * (0.3 + 0.2 * i)
        s = 1 if i % 2 == 0 else -1
        collar("berth_%d" % (i + 1), root, (x, s * w * 0.62, 0), (0, s, 0), size)


def tanks(p, x0, length, w):
    for i, x in enumerate((0.42, 0.62)):
        for s in (1, -1):
            p.cyl((x0 - length * x, 0, s * w * 0.95), (1, 0, 0), w * 0.38, length * 0.16, "alloy", 16)
            p.sphere((x0 - length * x - length * 0.08, 0, s * w * 0.95), w * 0.38, "alloy")
            p.sphere((x0 - length * x + length * 0.08, 0, s * w * 0.95), w * 0.38, "alloy")


def radiators(p, x0, length, w):
    for s in (1, -1):
        for k in range(2):
            x = x0 - length * (0.55 + 0.3 * k)
            p.box((x, s * w * 2.0, 0), (length * 0.2, w * 2.4, 0.006), "alloy")
            p.box((x, s * w * 2.0, 0.004), (length * 0.17, w * 2.2, 0.003), "graphite")
            p.box((x, s * w * 2.0, 0.006), (length * 0.02, w * 2.2, 0.002), "seam")
            p.box((x, s * w * 0.8, 0), (0.02, w * 0.6, 0.02), "graphite")


def containers(p, x0, length, w):
    for k in range(5):
        x = x0 - length * (0.2 + 0.15 * k)
        for s in (1, -1):
            p.box((x, 0, s * w * 0.78), (length * 0.11, w * 0.7, w * 0.42), "graphite" if k % 2 else "hull")


def floodlights(p, x0, length, w):
    for s in (1, -1):
        p.box((x0 - length * 0.5, 0, s * w * 1.05), (length * 0.8, w * 0.12, w * 0.12), "alloy")
        for k in range(4):
            p.cyl((x0 - length * (0.2 + 0.2 * k), 0, s * w * 1.18), (0, 0, s), w * 0.1, 0.01, "window", 10)


# The five fictional stations: one family, varied by the C's size and gap and what rides on the spine.
STATIONS = {
    "orbital-depot": dict(R=0.36, gap=70, bands=6, spine=0.5, extra=tanks),
    "lunar-data-center": dict(R=0.30, gap=80, bands=5, spine=0.42, extra=radiators),
    "mars-base": dict(R=0.36, gap=65, bands=6, spine=0.46, extra=None),
    "ceres-port": dict(R=0.32, gap=100, bands=4, spine=0.5, extra=containers),
    "titan-dock": dict(R=0.40, gap=60, bands=7, spine=0.6, extra=floodlights),
}


def build_station(key):
    s = STATIONS[key]
    root = new_scene()
    concourse(root, s["R"], 0.15, 0.1, s["gap"], s["bands"])
    spine(root, s["R"], s["spine"], 0.1, s["extra"])
    return root


def build_dock():
    """The generic Starfare dock: a hexagonal hub, four berth arms, a beacon mast and a small glazed control ring."""
    root = new_scene()
    p = Part("hub")
    p.cyl((0, 0, 0), (0, 0, 1), 0.13, 0.12, "hull", 6, smooth=False)
    p.cyl((0, 0, 0.065), (0, 0, 1), 0.135, 0.012, "alloy", 6, smooth=False)
    p.cyl((0, 0, -0.065), (0, 0, 1), 0.135, 0.012, "alloy", 6, smooth=False)
    p.cyl((0, 0, 0), (0, 0, 1), 0.1325, 0.03, "window", 6, smooth=False)
    p.cyl((0, 0, 0.1), (0, 0, 1), 0.02, 0.12, "alloy", 8)
    p.sphere((0, 0, 0.165), 0.016, "seam")
    p.sweep(rect(0.3, 0.34, -0.012, 0.012), lambda a: (Vector((0, 0, 0)), Vector((math.cos(a), math.sin(a), 0)), Vector((0, 0, 1))),
            span(0, 2 * math.pi, math.radians(10)), "alloy", caps=False, smooth=False)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        d = Vector((math.cos(a), math.sin(a), 0))
        p.box(d * 0.24, (0.2, 0.035, 0.03), "graphite", rot=Matrix.Rotation(a, 4, "Z"))
    p.finish(root)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        d = Vector((math.cos(a), math.sin(a), 0))
        collar("berth_%d" % (k + 1), root, d * 0.33, d, 0.05, 0.06)
    return root


def build_cabin(seats, abreast):
    """A cut-away passenger cabin: floor, low side walls with a window band, a front bulkhead screen, an aisle down
    the middle and `seats` seats, `abreast` to a row, bow towards +X. Real-ish metres before normalising."""
    root = new_scene()
    rows = math.ceil(seats / abreast)
    pitch, seat_w, aisle = 0.9, 0.5, 0.55
    left = abreast // 2
    width = abreast * seat_w + aisle + 0.3
    length = rows * pitch + 1.4
    shell = Part("shell")
    shell.box((0, 0, -0.05), (length, width, 0.1), "floor")
    shell.box((0, 0, -0.002), (length, aisle * 0.5, 0.004), "seam")
    for s in (1, -1):
        shell.box((0, s * width / 2, 0.45), (length, 0.08, 0.9), "hull")
        shell.box((0, s * (width / 2 - 0.045), 0.62), (length * 0.94, 0.012, 0.22), "glass")
        for k in range(rows + 1):
            shell.box((length / 2 - 0.7 - k * pitch, s * (width / 2 - 0.05), 0.62), (0.06, 0.02, 0.26), "alloy")
    shell.box((length / 2, 0, 0.55), (0.08, width, 1.1), "hull")
    shell.box((length / 2 - 0.045, 0, 0.7), (0.012, width * 0.5, 0.36), "seam")
    shell.box((-length / 2, 0, 0.55), (0.08, width, 1.1), "hull")
    shell.box((-length / 2 + 0.045, 0, 0.45), (0.012, aisle, 0.9), "graphite")  # aft door
    shell.finish(root)
    n = 0
    for r in range(rows):
        x = length / 2 - 0.95 - r * pitch
        for c in range(abreast):
            if n >= seats:
                break
            n += 1
            y = (c - (abreast - 1) / 2) * seat_w + (aisle / 2 - seat_w / 2) * (1 if c >= left else -1) * (1 if abreast > 1 else 0)
            st = Part("seat_%d" % n)
            st.box((x, y, 0.22), (0.46, seat_w * 0.84, 0.12), "fabric")
            st.box((x - 0.24, y, 0.5), (0.1, seat_w * 0.84, 0.58), "fabric", rot=None)
            st.box((x - 0.24, y, 0.83), (0.1, seat_w * 0.5, 0.12), "fabric")
            for s in (1, -1):
                st.box((x - 0.02, y + s * seat_w * 0.45, 0.32), (0.4, 0.04, 0.05), "alloy")
            st.box((x - 0.05, y, 0.08), (0.2, 0.08, 0.16), "graphite")
            st.box((x + 0.2, y, 0.282), (0.04, seat_w * 0.7, 0.006), "seam")
            st.finish(root)
    return root


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
                              export_texcoords=False, export_normals=True)
    tris = sum(len(p.vertices) - 2 for ob in root.children_recursive if ob.type == "MESH" for p in ob.data.polygons)
    data = open(path, "rb").read()
    return {"file": file, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "triangles": tris}


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["dock", "stations", "cabin"])
    ap.add_argument("--seats", type=int, default=CABIN_SEATS)
    ap.add_argument("--abreast", type=int, default=2)
    a = ap.parse_args(argv)
    os.makedirs(OUT, exist_ok=True)
    man_path = os.path.join(OUT, "docks.json")
    man = json.load(open(man_path)) if os.path.exists(man_path) else {}
    man.update({
        "generator": "tools/models/blender/build_models.py (Blender %s)" % bpy.app.version_string,
        "productionApproved": False,
        "note": "Fictional, original models built in code. berth_N and seat_N are named nodes; up +Y, longest side 1.",
    })
    man.pop("packed", None)  # set again by tools/models/pack-docks.mjs
    man.setdefault("models", {})
    if a.only in (None, "dock"):
        man["models"]["dock-orbital"] = export(build_dock(), "dock-orbital.glb")
        man["default"] = "dock-orbital"
    if a.only in (None, "stations"):
        man.setdefault("places", {})
        for key in STATIONS:
            man["models"]["station-" + key] = export(build_station(key), "station-%s.glb" % key)
            man["places"][key] = "station-" + key
    if a.only in (None, "cabin"):
        name = "cabin-%d" % a.seats
        man["models"][name] = dict(export(build_cabin(a.seats, a.abreast), name + ".glb"), seats=a.seats, abreast=a.abreast)
    with open(man_path, "w") as f:
        json.dump(man, f, indent=2, sort_keys=True)
        f.write("\n")
    for k, v in sorted(man["models"].items()):
        print("%-28s %7d bytes %6d triangles" % (k, v["bytes"], v["triangles"]))


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
