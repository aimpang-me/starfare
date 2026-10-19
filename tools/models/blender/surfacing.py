"""Surfacing for the Blender models: procedural materials (painted hull panels, satin alloy, graphite, lit window
cells, light strips) and the bake that turns them into the textures a GLB carries.

The procedural materials read the "detail" UV map, laid by kit.Part in model units. bake() lays a second UV map,
"bake", by smart projection, bakes base colour, ambient occlusion, roughness, metalness, tangent normals (panel
lines and seams) and emission into it with Cycles, then replaces every material on the object with one glTF-ready
material over those maps and drops the detail UVs. Palette after art/2026-10-17/art-direction.md.
"""
import math
import os

import bpy
import numpy as np


def lin(hexstr):
    """An sRGB hex colour as linear RGB for Blender's inputs."""
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# name: base, metallic, roughness, extras. panel = (brick width, row height, line width) in model units.
MATS = {
    "paint": dict(base="#24344f", metal=0.15, rough=0.5, panel=(0.62, 0.31, 0.012), grime=0.25),
    "paint_dark": dict(base="#18233a", metal=0.15, rough=0.55, panel=(0.4, 0.2, 0.01), grime=0.3),
    "alloy": dict(base="#b4c0cf", metal=0.5, rough=0.36, panel=(0.9, 0.45, 0.008), brushed=True, grime=0.15),
    "alloy_dark": dict(base="#6a7586", metal=0.45, rough=0.42, panel=(0.5, 0.25, 0.008), brushed=True, grime=0.2),
    "graphite": dict(base="#2a3340", metal=0.3, rough=0.6, panel=(0.3, 0.15, 0.008), grime=0.3),
    "window": dict(base="#0d0f12", metal=0.0, rough=0.15, cells=("#ffc874", "#5c3a17", 0.16, 0.13)),
    "glass": dict(base="#0b1018", metal=0.2, rough=0.06),
    "rubber": dict(base="#0c0e11", metal=0.0, rough=0.85),
    "light_cyan": dict(base="#0e2630", metal=0.0, rough=0.4, emit="#56cefa"),
    "light_warm": dict(base="#2a1d0e", metal=0.0, rough=0.4, emit="#ffc06a"),
    "light_red": dict(base="#2a0e0e", metal=0.0, rough=0.4, emit="#ff4a3d"),
    "light_green": dict(base="#0e2a14", metal=0.0, rough=0.4, emit="#3dff7a"),
    "fabric": dict(base="#3b4252", metal=0.0, rough=0.9, panel=(0.12, 0.06, 0.006), grime=0.1),
    "fabric_warm": dict(base="#6b5844", metal=0.0, rough=0.9, panel=(0.12, 0.06, 0.006), grime=0.1),
    "floor": dict(base="#2b3038", metal=0.2, rough=0.7, panel=(0.6, 0.6, 0.01), grime=0.2),
    "screen": dict(base="#06121a", metal=0.0, rough=0.2, emit="#2b8fbf"),
}


def _uv(nt, name="detail"):
    n = nt.nodes.new("ShaderNodeUVMap")
    n.uv_map = name
    return n


def material(name):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    spec = MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N["Principled BSDF"]
    base = lin(spec["base"]) + (1.0,)
    bsdf.inputs["Metallic"].default_value = spec["metal"]
    bsdf.inputs["Roughness"].default_value = spec["rough"]
    bsdf.inputs["Base Color"].default_value = base
    m["metal"] = spec["metal"]
    color_out, rough_out = None, None
    if "panel" in spec:
        w, h, line = spec["panel"]
        uv = _uv(nt)
        br = N.new("ShaderNodeTexBrick")
        br.offset, br.squash = 0.5, 1.0
        br.inputs["Scale"].default_value = 1.0
        br.inputs["Brick Width"].default_value = w
        br.inputs["Row Height"].default_value = h
        br.inputs["Mortar Size"].default_value = line
        br.inputs["Mortar Smooth"].default_value = 0.2
        br.inputs["Color1"].default_value = base
        br.inputs["Color2"].default_value = tuple(c * 0.86 for c in base[:3]) + (1,)
        br.inputs["Mortar"].default_value = tuple(c * 0.45 for c in base[:3]) + (1,)
        L.new(uv.outputs["UV"], br.inputs["Vector"])
        color_out = br.outputs["Color"]
        bump = N.new("ShaderNodeBump")
        bump.invert = True
        bump.inputs["Strength"].default_value = 0.6
        bump.inputs["Distance"].default_value = 0.004
        L.new(br.outputs["Fac"], bump.inputs["Height"])
        L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    if spec.get("grime"):
        tc = N.new("ShaderNodeTexCoord")
        nz = N.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 1.6
        nz.inputs["Detail"].default_value = 8.0
        nz.inputs["Roughness"].default_value = 0.6
        L.new(tc.outputs["Object"], nz.inputs["Vector"])
        ramp = N.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[1].position = 0.35, 0.75
        g = spec["grime"]
        ramp.color_ramp.elements[0].color = (1 - g, 1 - g, 1 - g * 0.9, 1)
        L.new(nz.outputs["Fac"], ramp.inputs["Fac"])
        mul = N.new("ShaderNodeMixRGB")
        mul.blend_type, mul.inputs["Fac"].default_value = "MULTIPLY", 1.0
        if color_out is not None:
            L.new(color_out, mul.inputs["Color1"])
        else:
            mul.inputs["Color1"].default_value = base
        L.new(ramp.outputs["Color"], mul.inputs["Color2"])
        color_out = mul.outputs["Color"]
        rmap = N.new("ShaderNodeMapRange")
        rmap.inputs["To Min"].default_value = spec["rough"] + 0.12
        rmap.inputs["To Max"].default_value = spec["rough"] - 0.05
        L.new(nz.outputs["Fac"], rmap.inputs["Value"])
        rough_out = rmap.outputs["Result"]
    if spec.get("brushed"):
        uv = _uv(nt)
        mp = N.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (2.0, 70.0, 2.0)
        L.new(uv.outputs["UV"], mp.inputs["Vector"])
        nz = N.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 3.0
        nz.inputs["Detail"].default_value = 4.0
        L.new(mp.outputs["Vector"], nz.inputs["Vector"])
        add = N.new("ShaderNodeMath")
        add.operation = "MULTIPLY_ADD"
        add.inputs[1].default_value = 0.16
        L.new(nz.outputs["Fac"], add.inputs[0])
        if rough_out is not None:
            L.new(rough_out, add.inputs[2])
        else:
            add.inputs[2].default_value = spec["rough"] - 0.08
        rough_out = add.outputs["Value"]
    if "cells" in spec:
        # Lit cabins behind the glass: cells of warm light at random strengths, dark frames between them.
        hi, lo, w, h = spec["cells"]
        uv = _uv(nt)
        br = N.new("ShaderNodeTexBrick")
        br.offset, br.squash = 0.0, 1.0
        br.inputs["Scale"].default_value = 1.0
        br.inputs["Brick Width"].default_value = w
        br.inputs["Row Height"].default_value = h
        br.inputs["Mortar Size"].default_value = 0.012
        br.inputs["Bias"].default_value = -0.2
        br.inputs["Color1"].default_value = lin(hi) + (1,)
        br.inputs["Color2"].default_value = lin(lo) + (1,)
        br.inputs["Mortar"].default_value = (0.004, 0.004, 0.005, 1)
        L.new(uv.outputs["UV"], br.inputs["Vector"])
        L.new(br.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0
    if "emit" in spec:
        bsdf.inputs["Emission Color"].default_value = lin(spec["emit"]) + (1,)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    if color_out is not None:
        L.new(color_out, bsdf.inputs["Base Color"])
    if rough_out is not None:
        L.new(rough_out, bsdf.inputs["Roughness"])
    return m


def materials(*names):
    for n in names:
        material(n)


def _select_only(ob):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def unwrap(ob, margin=0.003):
    _select_only(ob)
    me = ob.data
    uvb = me.uv_layers.get("bake") or me.uv_layers.new(name="bake")
    me.uv_layers.active = uvb
    uvb.active_render = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(50), island_margin=margin, area_weight=0.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")


def _image(name, size, data=False):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color" if data else "sRGB"
    return img


def _targets(ob, img):
    for m in ob.data.materials:
        nt = m.node_tree
        t = nt.nodes.get("bake_target") or nt.nodes.new("ShaderNodeTexImage")
        t.name = "bake_target"
        t.image = img
        uv = nt.nodes.get("bake_uv") or _uv(nt, "bake")
        uv.name = "bake_uv"
        if not t.inputs["Vector"].links:
            nt.links.new(uv.outputs["UV"], t.inputs["Vector"])
        for n in nt.nodes:
            n.select = False
        t.select = True
        nt.nodes.active = t


def _bake(ob, kind, img, samples=1, **kw):
    _targets(ob, img)
    bpy.context.scene.cycles.samples = samples
    _select_only(ob)
    bpy.ops.object.bake(type=kind, margin=8, margin_type="EXTEND", use_clear=True, **kw)


def _swap_emit(ob, value_of):
    """Temporarily drives each material's output with an emission of value_of(material); returns an undo."""
    undo = []
    for m in ob.data.materials:
        nt = m.node_tree
        out = nt.nodes["Material Output"]
        old = out.inputs["Surface"].links[0].from_socket
        em = nt.nodes.new("ShaderNodeEmission")
        v = value_of(m)
        em.inputs["Color"].default_value = (v, v, v, 1)
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
        undo.append((nt, old, out, em))

    def restore():
        for nt, old, out, em in undo:
            nt.links.new(old, out.inputs["Surface"])
            nt.nodes.remove(em)
    return restore


def _px(img):
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def bake(ob, tmp, size=2048, aux=1024, ao_samples=24, ao_strength=0.8):
    """Bakes ob's procedural materials to textures and gives it one glTF material over them."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.render.bake.use_selected_to_active = False
    unwrap(ob)
    name = ob.name
    albedo = _image(name + "_albedo", size)
    _bake(ob, "DIFFUSE", albedo, pass_filter={"COLOR"})
    ao = _image(name + "_ao", size, True)
    _bake(ob, "AO", ao, samples=ao_samples)
    normal = _image(name + "_normal", size, True)
    _bake(ob, "NORMAL", normal, normal_space="TANGENT")
    rough = _image(name + "_rough", aux, True)
    _bake(ob, "ROUGHNESS", rough)
    emit = _image(name + "_emit", aux)
    _bake(ob, "EMIT", emit)
    metal = _image(name + "_metal", aux, True)
    restore = _swap_emit(ob, lambda m: float(m.get("metal", 0.0)))
    _bake(ob, "EMIT", metal)
    restore()

    # Ambient occlusion goes into the base colour (three r128's aoMap would need a second UV set).
    a, o = _px(albedo), _px(ao)
    a[..., :3] *= (1 - ao_strength) + ao_strength * o[..., :1]
    albedo.pixels.foreach_set(a.ravel())
    orm = _image(name + "_orm", aux, True)
    r, mt = _px(rough), _px(metal)
    p = np.ones_like(r)
    p[..., 1], p[..., 2] = r[..., 0], mt[..., 0]
    orm.pixels.foreach_set(p.ravel())

    files = {}
    for key, img in (("albedo", albedo), ("normal", normal), ("orm", orm), ("emit", emit), ("ao", ao)):
        path = os.path.join(tmp, "%s_%s.png" % (name, key))
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        files[key] = img

    m = bpy.data.materials.new(name + "_baked")
    m.use_nodes = True
    nt, N, L = m.node_tree, m.node_tree.nodes, m.node_tree.links
    bsdf = N["Principled BSDF"]

    def tex(img):
        t = N.new("ShaderNodeTexImage")
        t.image = img
        return t
    L.new(tex(files["albedo"]).outputs["Color"], bsdf.inputs["Base Color"])
    sep = N.new("ShaderNodeSeparateColor")
    L.new(tex(files["orm"]).outputs["Color"], sep.inputs["Color"])
    L.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    L.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    nm = N.new("ShaderNodeNormalMap")
    nm.uv_map = "bake"
    L.new(tex(files["normal"]).outputs["Color"], nm.inputs["Color"])
    L.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    L.new(tex(files["emit"]).outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0

    me = ob.data
    me.materials.clear()
    me.materials.append(m)
    for poly in me.polygons:
        poly.material_index = 0
    me.uv_layers.remove(me.uv_layers["detail"])
    return m
