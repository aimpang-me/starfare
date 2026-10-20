"""Geometry kit for the Blender models: one bmesh per part, with a "detail" UV map in model units that the procedural
materials read (panel lines, brushing, window cells), bevels on hard parts, and smooth-by-angle normals.

Units: about 1 unit = 25 m on a station, before the export scales the model to a longest side of 1.
"""
import math

import bpy
import bmesh
from mathutils import Matrix, Vector

Z = Vector((0, 0, 1))


def frame_to(axis, up=None):
    """A rotation taking +Z to `axis`, with +Y towards `up` where it can."""
    a = Vector(axis).normalized()
    return a.to_track_quat("Z", "Y" if up is None else "Y").to_matrix().to_4x4()


class Part:
    """A mesh under construction. Every add_* call tags its faces with a material slot and lays detail UVs."""

    def __init__(self, name):
        self.name, self.bm, self.mats = name, bmesh.new(), []
        self.uv = self.bm.loops.layers.uv.new("detail")

    def mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _box_uv(self, faces, k=1.0):
        # Planar projection per face along its dominant axis, in model units: a box-projected panel layout.
        for f in faces:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            a, b = [i for i in range(3) if i != ax]
            for l in f.loops:
                co = l.vert.co
                l[self.uv].uv = (co[a] * k, co[b] * k)

    def _finish_faces(self, faces, mat, recalc=True):
        i = self.mi(mat)
        for f in faces:
            f.material_index = i
            f.smooth = True
        if recalc:
            bmesh.ops.recalc_face_normals(self.bm, faces=list(faces))
        self._box_uv(faces)

    def _bevel(self, verts, width, segs=2):
        edges = list({e for v in verts for e in v.link_edges})
        if width > 0 and edges:
            r = bmesh.ops.bevel(self.bm, geom=edges, offset=width, offset_type="OFFSET", segments=segs,
                                profile=0.5, affect="EDGES", clamp_overlap=True)
            return set(r["faces"]) | {f for v in verts if v.is_valid for f in v.link_faces}
        return {f for v in verts for f in v.link_faces}

    def box(self, centre, size, mat, rot=None, bevel=0.0):
        m = Matrix.Translation(Vector(centre)) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*size, 1.0))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        faces = self._bevel(r["verts"], min(bevel, min(size) * 0.45))
        self._finish_faces({f for f in faces if f.is_valid}, mat)

    def cyl(self, centre, axis, radius, depth, mat, segs=24, r2=None, bevel=0.0, caps=True):
        m = Matrix.Translation(Vector(centre)) @ frame_to(axis)
        r = bmesh.ops.create_cone(self.bm, cap_ends=caps, segments=segs, radius1=radius,
                                  radius2=radius if r2 is None else r2, depth=depth, matrix=m)
        verts = r["verts"]
        if bevel > 0 and caps:
            rim = [e for e in {e for v in verts for e in v.link_edges} if len(e.link_faces) == 2 and
                   abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.5]
            if rim:
                res = bmesh.ops.bevel(self.bm, geom=rim, offset=min(bevel, depth * 0.3, radius * 0.3), offset_type="OFFSET",
                                      segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
                faces = set(res["faces"]) | {f for v in verts if v.is_valid for f in v.link_faces}
                self._finish_faces(faces, mat)
                return
        self._finish_faces({f for v in verts for f in v.link_faces}, mat)

    def sphere(self, centre, radius, mat, scale=(1, 1, 1), segs=24, rings=12):
        m = Matrix.Translation(Vector(centre)) @ Matrix.Diagonal((*scale, 1.0))
        r = bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=radius, matrix=m)
        self._finish_faces({f for v in r["verts"] for f in v.link_faces}, mat)

    def torus(self, centre, axis, R, r, mat, segs=48, tube=10):
        m = Matrix.Translation(Vector(centre)) @ frame_to(axis)
        prof = [(r * math.cos(2 * math.pi * k / tube), r * math.sin(2 * math.pi * k / tube)) for k in range(tube)]
        mats = [mat] * tube

        def fr(a):
            d = Vector((math.cos(a), math.sin(a), 0))
            return (m @ (d * R), (m.to_3x3() @ d).normalized(), (m.to_3x3() @ Z).normalized())
        self.sweep(prof, mats, fr, [2 * math.pi * k / segs for k in range(segs + 1)], closed=True)

    def strut(self, a, b, radius, mat, segs=6):
        a, b = Vector(a), Vector(b)
        self.cyl((a + b) / 2, b - a, radius, (b - a).length, mat, segs)

    def truss(self, a, b, w, bay, mat, rod=None):
        """A square lattice truss from a to b, w across, bays about `bay` long: four chords, frames and diagonals."""
        a, b = Vector(a), Vector(b)
        d = b - a
        L = d.length
        n = max(1, round(L / bay))
        R = frame_to(d).to_3x3()
        ux, uy = R @ Vector((1, 0, 0)), R @ Vector((0, 1, 0))
        rod = rod or w * 0.06
        corners = [(ux * s + uy * t) * (w / 2) for s, t in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
        for c in corners:
            self.strut(a + c, b + c, rod, mat)
        for i in range(n + 1):
            p = a + d * (i / n)
            for k in range(4):
                self.strut(p + corners[k], p + corners[(k + 1) % 4], rod * 0.8, mat)
            if i < n:
                q = a + d * ((i + 1) / n)
                for k in range(4):
                    self.strut(p + corners[k], q + corners[(k + 1) % 4], rod * 0.6, mat)

    def sweep(self, profile, mats, frame, ts, caps=None, closed=False, cap_mat=None):
        """Sweeps a closed 2D profile (u, v) along frame(t) -> (origin, u axis, v axis). mats[i] is the material of
        the profile edge from point i to i+1. Detail UVs run along the path (u) and round the profile (v)."""
        rings, centres, frames, n = [], [], [], len(profile)
        area = sum(profile[i][0] * profile[(i + 1) % n][1] - profile[(i + 1) % n][0] * profile[i][1] for i in range(n))
        orient = 1 if area > 0 else -1
        for t in ts:
            o, u, v = frame(t)
            centres.append(Vector(o))
            frames.append((Vector(o), Vector(u), Vector(v)))
            rings.append([self.bm.verts.new(o + u * a + v * b) for a, b in profile])
        per = [0.0]
        for i in range(n):
            a, b = profile[i], profile[(i + 1) % n]
            per.append(per[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
        along = [[0.0] * n]
        for r0, r1 in zip(rings, rings[1:]):
            along.append([along[-1][i] + (r1[i].co - r0[i].co).length for i in range(n)])
        for k in range(len(rings) - 1):
            r0, r1 = rings[k], rings[k + 1]
            for i in range(n):
                j = (i + 1) % n
                f = self.bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
                # face out of the profile: the outward normal of edge i of an anticlockwise polygon is (dy, -dx)
                (ax_, ay_), (bx_, by_) = profile[i], profile[j]
                o_ = (frames[k][1] * (by_ - ay_) - frames[k][2] * (bx_ - ax_)) * orient
                f.normal_update()  # a new face's normal is zero until updated
                if f.normal.dot(o_) < 0:
                    f.normal_flip()
                f.material_index, f.smooth = self.mi(mats[i]), True
                vj = per[i + 1]
                for l, (s, vv) in zip(f.loops, ((along[k][i], per[i]), (along[k][j], vj), (along[k + 1][j], vj), (along[k + 1][i], per[i]))):
                    l[self.uv].uv = (s, vv)
        if caps if caps is not None else not closed:
            for ring, nxt in ((rings[0], centres[1] - centres[0]), (rings[-1], centres[-2] - centres[-1])):
                f = self.bm.faces.new(ring)
                f.normal_update()
                if f.normal.dot(nxt) > 0:
                    f.normal_flip()
                self._finish_faces([f], cap_mat or mats[0], recalc=False)

    def finish(self, sharp_deg=40):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(bpy.data.materials[m])
        me.set_sharp_from_angle(angle=math.radians(sharp_deg))
        me.validate()
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def rrect(w, h, r, n=3):
    """A rounded rectangle, w by h, corner radius r, n segments per corner, anticlockwise from +u."""
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def arc_frame(R, z=0.0):
    return lambda a: (Vector((R * math.cos(a), R * math.sin(a), z)), Vector((math.cos(a), math.sin(a), 0)), Z)


def span(a0, a1, step):
    n = max(1, math.ceil(abs(a1 - a0) / step))
    return [a0 + (a1 - a0) * i / n for i in range(n + 1)]
