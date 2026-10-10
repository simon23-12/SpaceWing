"""Walkable station interiors with Cycles-baked lighting, plus the bridge overview render.
Usage: bl.py blender/interiors.py <room> [--preview-only] [--no-bake] [--samples N]
rooms: bruecke, bar, hangar, kabine, aussicht, overview"""
import importlib, math, os, json
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix
import swlib, swship
importlib.reload(swlib); importlib.reload(swship)
from swlib import G, hexc
from swship import box, cyl, sphere, lathe, loft, empty, apply_all, smooth
from swship import mat_paint, mat_metal, mat_rubber, mat_emit, mat_glass

try:
    REPO
except NameError:
    REPO = swlib.REPO_PATH
swlib.init(REPO)
R = math.radians
ROOMS = {}
INFO = {}   # per-room metadata gathered while building (interactables, spawns, lights)


def room(fn):
    ROOMS[fn.__name__] = fn
    return fn


def b2t(v):
    return [round(v[0], 3), round(v[2], 3), round(-v[1], 3)]


# ------------------------------------------------------------------------------- materials

def mat_floor(name, color='#3a3d42', scale=1.0, grate=False):
    m = swlib.new_mat(name); m.node_tree.nodes.clear(); g = G(m.node_tree)
    tc = g.node('ShaderNodeTexCoord'); p = tc.outputs['Object']
    px, py, pz = g.sep(p)
    # floor tiles
    tx = g.math('FRACT', g.mul(px, 0.5 * scale)); ty = g.math('FRACT', g.mul(py, 0.5 * scale))
    gap = g.mx(g.smooth(g.mn(tx, g.sub(1.0, tx)), 0.012, 0.004), g.smooth(g.mn(ty, g.sub(1.0, ty)), 0.012, 0.004))
    n1, _ = g.noise(g.vscale(p, 3.0), 1.0, 6, 0.6)
    n2, _ = g.noise(g.vscale(p, 0.4), 1.0, 3, 0.5)
    cell = g.combine(g.math('FLOOR', g.mul(px, 0.5 * scale)), g.math('FLOOR', g.mul(py, 0.5 * scale)), 0.0)
    rv, _ = g.white(cell)
    base = g.mix(g.add(g.mul(rv, 0.25), g.mul(n2, 0.3)), g.rgb(color), g.rgb('#55595f'))
    if grate:
        gx = g.math('FRACT', g.mul(px, 12.0)); gy = g.math('FRACT', g.mul(py, 12.0))
        holes = g.mul(g.smooth(g.abs(g.sub(gx, 0.5)), 0.3, 0.25), g.smooth(g.abs(g.sub(gy, 0.5)), 0.3, 0.25))
        base = g.mix(g.mul(holes, 0.9), base, g.rgb('#0c0d0e'))
    base = g.mix(g.mul(gap, 0.9), base, g.rgb('#111214'))
    base = g.mix(g.mul(g.smooth(n1, 0.6, 0.8), 0.25), base, g.rgb('#2a2620'))
    bs = g.node('ShaderNodeBsdfPrincipled')
    g._in(bs.inputs['Base Color'], base)
    g._in(bs.inputs['Roughness'], g.add(0.35, g.mul(n1, 0.3)))
    bs.inputs['Metallic'].default_value = 0.3
    g.output(bs.outputs[0])
    return m


def mat_wall(name, color='#8a8d92', color2='#6a6e74', scale=0.8, dirt=0.4):
    return mat_paint(name, color, color2=color2, wear=0.25, rust=0.0, dirt=dirt, metal=0.2, rough=0.55, scale=scale)


def mat_simple(name, color, rough=0.5, metal=0.0, emit=None, strength=0.0):
    m = swlib.new_mat(name); m.node_tree.nodes.clear(); g = G(m.node_tree)
    bs = g.node('ShaderNodeBsdfPrincipled')
    bs.inputs['Base Color'].default_value = hexc(color)
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Metallic'].default_value = metal
    if emit:
        bs.inputs['Emission Color'].default_value = hexc(emit)
        bs.inputs['Emission Strength'].default_value = strength
    g.output(bs.outputs[0])
    return m


def mat_wood(name, color='#5a3a24'):
    m = swlib.new_mat(name); m.node_tree.nodes.clear(); g = G(m.node_tree)
    tc = g.node('ShaderNodeTexCoord'); p = tc.outputs['Object']
    px, py, pz = g.sep(p)
    grain, _ = g.noise(g.combine(g.mul(px, 1.5), g.mul(py, 30.0), g.mul(pz, 30.0)), 1.0, 6, 0.6, dist=1.5)
    base = g.ramp(grain, [(0.3, '#3a2416'), (0.6, color), (0.9, '#7a5234')])
    bs = g.node('ShaderNodeBsdfPrincipled')
    g._in(bs.inputs['Base Color'], base)
    bs.inputs['Roughness'].default_value = 0.35
    bs.inputs['Coat Weight'].default_value = 0.5
    g.output(bs.outputs[0])
    return m


def light_mat(name, color, strength):
    """Emissive surface that lights the bake and is baked itself (stays part of the room mesh)."""
    m = swlib.new_mat(name); m.node_tree.nodes.clear(); g = G(m.node_tree)
    g.output(g.emission(g.rgb(color), strength))
    return m


# ------------------------------------------------------------------------------- geometry helpers

def wall(name, mat, p0, p1, h, z0=0.0, thick=0.25, openings=()):
    """Wall from p0 to p1 (xy) with rectangular openings: list of (center_along, width, z_bottom, z_top)."""
    a, b = Vector((*p0, 0)), Vector((*p1, 0))
    d = b - a; L = d.length; u = d.normalized()
    ang = math.atan2(u.y, u.x)
    segs = []
    ops = sorted(openings)
    cur = 0.0
    for (c, w, zb, zt) in ops:
        s0, s1 = c - w / 2, c + w / 2
        if s0 > cur:
            segs.append((cur, s0, z0, z0 + h))
        if zb > z0:
            segs.append((s0, s1, z0, zb))
        if zt < z0 + h:
            segs.append((s0, s1, zt, z0 + h))
        cur = s1
    if cur < L:
        segs.append((cur, L, z0, z0 + h))
    out = []
    for i, (s0, s1, zb, zt) in enumerate(segs):
        if s1 - s0 < 1e-3 or zt - zb < 1e-3:
            continue
        mid = a + u * ((s0 + s1) / 2)
        o = box(f'{name}_{i}', mat, (s1 - s0, thick, zt - zb), (mid.x, mid.y, (zb + zt) / 2), rot=(0, 0, ang))
        out.append(o)
    return out


def text_mesh(name, txt, mat, size, loc, rot=(R(90), 0, 0), extrude=0.02, align='CENTER', font_bold=True):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = txt
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = 'CENTER'
    try:
        fp = '/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf'
        if os.path.exists(fp):
            cu.font = bpy.data.fonts.load(fp, check_existing=True)
    except Exception:
        pass
    ob = bpy.data.objects.new(name + '_c', cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc; ob.rotation_euler = rot
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    mo = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(mo)
    mo.matrix_world = ob.matrix_world.copy()
    bpy.data.objects.remove(ob, do_unlink=True)
    me.materials.clear(); me.materials.append(mat)
    return mo


def area_light(name, loc, rot, size, energy, color='#ffffff', shape='RECTANGLE', size_y=None):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.shape = shape; ld.size = size; ld.size_y = size_y or size; ld.energy = energy
    c = hexc(color); ld.color = c[:3]
    lo = bpy.data.objects.new(name, ld); bpy.context.scene.collection.objects.link(lo)
    lo.location = loc; lo.rotation_euler = rot
    return lo


def point_light(name, loc, energy, color='#ffffff', radius=0.1):
    ld = bpy.data.lights.new(name, 'POINT'); ld.energy = energy; ld.shadow_soft_size = radius
    ld.color = hexc(color)[:3]
    lo = bpy.data.objects.new(name, ld); bpy.context.scene.collection.objects.link(lo)
    lo.location = loc
    INFO.setdefault('lights', []).append({'pos': b2t(loc), 'color': color, 'energy': energy})
    return lo


def spot_light(name, loc, target, energy, color='#ffffff', angle=60, blend=0.5):
    ld = bpy.data.lights.new(name, 'SPOT'); ld.energy = energy; ld.spot_size = R(angle); ld.spot_blend = blend
    ld.color = hexc(color)[:3]; ld.shadow_soft_size = 0.15
    lo = bpy.data.objects.new(name, ld); bpy.context.scene.collection.objects.link(lo)
    lo.location = loc
    lo.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return lo


def plant(name, mat, base, n=18, length=0.9, seed=1):
    """Potted fern/palm: curved, tapering leaf blades (thin solids so both sides render)."""
    import random
    rnd = random.Random(seed)
    bm = bmesh.new()
    bx, by, bz = base
    for k in range(n):
        a = 2 * math.pi * k / n + rnd.uniform(-0.2, 0.2)
        L = length * rnd.uniform(0.7, 1.15)
        rise = rnd.uniform(0.5, 0.95)
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-math.sin(a), math.cos(a), 0))
        rows = []
        for i in range(9):
            t = i / 8
            c = Vector((bx, by, bz)) + d * (t * L) + Vector((0, 0, math.sin(t * math.pi * 0.75) * L * rise * 0.6 - t * t * L * 0.25))
            w = 0.075 * L * math.sin(math.pi * min(1, t * 1.15 + 0.05)) * (1 - 0.35 * t) + 0.004
            rows.append((bm.verts.new(c - side * w), bm.verts.new(c + Vector((0, 0, 0.012)) ), bm.verts.new(c + side * w)))
        for r0, r1 in zip(rows, rows[1:]):
            bm.faces.new((r0[0], r1[0], r1[1], r0[1])); bm.faces.new((r0[1], r1[1], r1[2], r0[2]))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    for p_ in ob.data.polygons: p_.use_smooth = True
    sd = ob.modifiers.new('thick', 'SOLIDIFY'); sd.thickness = 0.01; sd.offset = 0.0
    return ob


def marker(kind, ident, loc, rot_z=0.0, **props):
    """Interactables, doors, spawns, npc spots. Stored in meta.json (three.js coordinates)."""
    fwd = Vector((math.cos(rot_z), math.sin(rot_z), 0))
    INFO.setdefault('markers', []).append({'kind': kind, 'id': ident, 'pos': b2t(loc), 'dir': b2t(fwd), **props})


def chair(name, mat, mat2, loc, rot=0.0):
    out = []
    x, y, z = loc
    c, s = math.cos(rot), math.sin(rot)
    def L(dx, dy, dz): return (x + dx * c - dy * s, y + dx * s + dy * c, z + dz)
    out.append(box(name + '_seat', mat, (0.48, 0.48, 0.08), L(0, 0, 0.46), rot=(0, 0, rot), bevel=0.02))
    out.append(box(name + '_back', mat, (0.48, 0.07, 0.5), L(0, -0.22, 0.75), rot=(R(-8), 0, rot), bevel=0.02))
    out.append(cyl(name + '_leg', mat2, 0.03, 0.44, L(0, 0, 0.22), rot=(0, 0, 0), n=10))
    out.append(cyl(name + '_foot', mat2, 0.2, 0.03, L(0, 0, 0.015), rot=(0, 0, 0), n=16))
    return out


def stool(name, mat, mat2, loc):
    x, y, z = loc
    return [cyl(name + '_top', mat, 0.2, 0.08, (x, y, z + 0.78), rot=(0, 0, 0), n=20),
            cyl(name + '_leg', mat2, 0.03, 0.75, (x, y, z + 0.39), rot=(0, 0, 0), n=10),
            cyl(name + '_ring', mat2, 0.17, 0.02, (x, y, z + 0.3), rot=(0, 0, 0), n=20),
            cyl(name + '_foot', mat2, 0.22, 0.03, (x, y, z + 0.015), rot=(0, 0, 0), n=20)]


def figure(name, coat, skin, loc, rot=0.0, seated=True, scale=1.0, hat=None):
    """Stylised seated/standing person for background patrons (baked into the room)."""
    x, y, z = loc
    c, s = math.cos(rot), math.sin(rot)
    def L(dx, dy, dz): return (x + (dx * c - dy * s) * scale, y + (dx * s + dy * c) * scale, z + dz * scale)
    out = []
    hz = 0.46 if seated else 0.95
    torso = loft(name + '_torso', [dict(y=0, w=0.34, h=0.22, e=2.5), dict(y=0.3, w=0.4, h=0.24, e=2.5), dict(y=0.55, w=0.44, h=0.24, e=2.6), dict(y=0.62, w=0.2, h=0.16, e=2)], coat, n=16)
    torso.rotation_euler = (R(90 - (8 if seated else 0)), 0, rot)
    torso.location = L(0, 0, hz)
    torso.scale = (scale, scale, scale)
    out.append(torso)
    out.append(sphere(name + '_head', skin, 0.11 * scale, L(0, 0.02, hz + 0.78), scale=(0.9, 1.0, 1.15), seg=20, rings=12))
    if hat:
        out.append(cyl(name + '_hat', hat, 0.12 * scale, 0.08 * scale, L(0, 0.02, hz + 0.9), rot=(0, 0, 0), n=16))
    for sx in (-1, 1):
        if seated:
            out.append(cyl(name + f'_thigh{sx}', coat, 0.075 * scale, 0.45 * scale, L(sx * 0.1, 0.2, hz), rot=(R(90), 0, rot), n=10))
            out.append(cyl(name + f'_shin{sx}', coat, 0.065 * scale, 0.46 * scale, L(sx * 0.1, 0.42, hz - 0.23), rot=(0, 0, 0), n=10))
            out.append(cyl(name + f'_arm{sx}', coat, 0.06 * scale, 0.5 * scale, L(sx * 0.24, 0.15, hz + 0.42), rot=(R(60), 0, rot), n=10))
        else:
            out.append(cyl(name + f'_leg{sx}', coat, 0.075 * scale, 0.92 * scale, L(sx * 0.1, 0, 0.46), rot=(0, 0, 0), n=10))
            out.append(cyl(name + f'_arm{sx}', coat, 0.06 * scale, 0.6 * scale, L(sx * 0.26, 0.02, hz + 0.3), rot=(R(8 * sx), 0, rot), n=10))
    return out


# ------------------------------------------------------------------------------- outside: sky + Saturn for renders

def setup_world_space(strength=1.0, saturn=True, sat_dir=(0.0, 1.0, 0.25), sat_dist=3000.0, sat_size=900.0):
    sc = bpy.context.scene
    w = sc.world
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree; nt.nodes.clear(); g = G(nt)
    img = bpy.data.images.load(os.path.join(REPO, 'public/assets/sky/milkyway.jpg'), check_existing=True)
    tex = g.node('ShaderNodeTexEnvironment'); tex.image = img
    # rotate so three.js equirect convention matches roughly (cosmetic only)
    bg = g.node('ShaderNodeBackground'); g.l.new(tex.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = strength
    out = g.node('ShaderNodeOutputWorld'); g.l.new(bg.outputs[0], out.inputs['Surface'])
    made = []
    if saturn:
        d = Vector(sat_dir).normalized()
        c = d * sat_dist
        sm = swlib.new_mat('saturn_render'); sm.node_tree.nodes.clear(); sg = G(sm.node_tree)
        timg = bpy.data.images.load(os.path.join(REPO, 'public/assets/planets/saturn.jpg'), check_existing=True)
        tn = sg.node('ShaderNodeTexImage'); tn.image = timg
        bs = sg.node('ShaderNodeBsdfDiffuse'); sg.l.new(tn.outputs['Color'], bs.inputs['Color'])
        sg.output(bs.outputs[0])
        bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=sat_size, location=c)
        sat = bpy.context.active_object; sat.name = 'SATURN_BG'; sat.scale = (1, 1, 0.902)
        sat.data.materials.append(sm)
        for p in sat.data.polygons: p.use_smooth = True
        sat.visible_shadow = False
        made.append(sat)
        # rings
        rm = swlib.new_mat('rings_render'); rm.node_tree.nodes.clear(); rg = G(rm.node_tree)
        rimg = bpy.data.images.load(os.path.join(REPO, 'public/assets/planets/rings.png'), check_existing=True)
        tc = rg.node('ShaderNodeTexCoord')
        x, y, z = rg.sep(tc.outputs['Object'])
        r = rg.math('SQRT', rg.add(rg.mul(x, x), rg.mul(y, y)))
        u = rg.div(rg.sub(r, 66900 / 60268), (141000 - 66900) / 60268)
        rt = rg.node('ShaderNodeTexImage'); rt.image = rimg; rt.extension = 'EXTEND'
        rg._in(rt.inputs['Vector'], rg.combine(u, 0.5, 0.0))
        dif0 = rg.node('ShaderNodeBsdfDiffuse'); rg.l.new(rt.outputs['Color'], dif0.inputs['Color'])
        tl = rg.node('ShaderNodeBsdfTranslucent'); rg.l.new(rt.outputs['Color'], tl.inputs['Color'])
        dif = rg.node('ShaderNodeMixShader'); dif.inputs[0].default_value = 0.45
        rg.l.new(dif0.outputs[0], dif.inputs[1]); rg.l.new(tl.outputs[0], dif.inputs[2])
        tr = rg.node('ShaderNodeBsdfTransparent')
        mx = rg.node('ShaderNodeMixShader')
        inside = rg.mul(rg.math('GREATER_THAN', u, 0.0), rg.math('LESS_THAN', u, 1.0))
        rg._in(mx.inputs[0], rg.mul(rt.outputs['Alpha'], inside))
        rg.l.new(tr.outputs[0], mx.inputs[1]); rg.l.new(dif.outputs[0], mx.inputs[2])
        rg.output(mx.outputs[0])
        bpy.ops.mesh.primitive_circle_add(vertices=256, radius=141000 / 60268, fill_type='NGON', location=(0, 0, 0))
        ring = bpy.context.active_object; ring.name = 'RINGS_BG'
        ring.data.materials.append(rm)
        ring.parent = sat; ring.location = (0, 0, 0); ring.scale = (sat_size, sat_size, sat_size / 0.902)
        ring.visible_shadow = False
        made.append(ring)
        sat.rotation_euler = (R(16), R(-8), R(25))
        sun = bpy.data.lights.new('SUN_BG', 'SUN'); sun.energy = 4.0; sun.angle = R(0.5); sun.color = (1, 0.96, 0.9)
        so = bpy.data.objects.new('SUN_BG', sun); bpy.context.scene.collection.objects.link(so)
        so.rotation_euler = (R(60), R(10), R(-140))
        made.append(so)
    return made


# ------------------------------------------------------------------------------- bake + export

def denoise(rgb, passes=2, sigma=0.06):
    """Edge-aware 3x3 smoothing of the baked radiance (cheap stand-in for a real denoiser)."""
    rgb = rgb.astype(np.float32)
    for _ in range(passes):
        acc = rgb.copy(); wsum = np.ones(rgb.shape[:2], np.float32)
        lum = rgb.mean(-1)
        for dy, dx, k in ((-1, 0, 1), (1, 0, 1), (0, -1, 1), (0, 1, 1), (-1, -1, .6), (1, 1, .6), (-1, 1, .6), (1, -1, .6)):
            sh = np.roll(np.roll(rgb, dy, 0), dx, 1)
            d = sh.mean(-1) - lum
            rel = d / (np.abs(lum) * 0.5 + sigma)
            w = (k * np.exp(-rel * rel)).astype(np.float32)
            acc += sh * w[..., None]; wsum += w
        rgb = acc / wsum[..., None]
    return rgb


def cull_hidden(ob, interior):
    """Delete faces that can never be seen: undersides below the floor. Outer walls and roofs stay, because on
    the continuous deck rooms are seen from corridors and from the observation dome."""
    if not interior:
        return
    bm = bmesh.new(); bm.from_mesh(ob.data)
    kind = interior[0]
    z0 = interior[5] if kind == 'box' else interior[2]
    dead = [f for f in bm.faces if f.normal.z < -0.7 and f.calc_center_median().z < z0 - 0.03]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(ob.data); bm.free()
    ob.data.update()


def bake_room(name, static, glows, glass, extra_exports, outdir, size=4096, samples=384, scale=0.5):
    """Bake combined (diffuse+emit, no glossy) lighting into one atlas, then export.
    scale: stored = value*scale (so values up to 1/scale survive 8-bit). Runtime multiplies by 1/scale."""
    sc = swlib.cycles(samples=samples, transform='Standard', denoise=False)
    sc.cycles.max_bounces = 6; sc.cycles.diffuse_bounces = 4
    for o in static:
        apply_all(o)
    joined = swship.join(static, 'room')
    cull_hidden(joined, INFO.get('interior'))
    swship.uv_unwrap(joined, margin=0.0015)
    for o in sc.objects:
        o.select_set(False)
    joined.select_set(True)
    bpy.context.view_layer.objects.active = joined
    img = bpy.data.images.new('lightmap', size, size, alpha=False, float_buffer=True)
    try:
        img.colorspace_settings.name = 'Linear Rec.709'
    except Exception:
        img.colorspace_settings.name = 'Non-Color'
    swship._set_active_image(joined, img)
    bk = sc.render.bake
    bk.margin = 6; bk.use_clear = True
    bk.use_pass_direct = True; bk.use_pass_indirect = True
    bk.use_pass_diffuse = True; bk.use_pass_glossy = False; bk.use_pass_transmission = True; bk.use_pass_emit = True
    sc.cycles.samples = samples
    bpy.ops.object.bake(type='COMBINED')
    px = np.empty(size * size * 4, np.float32); img.pixels.foreach_get(px)
    px = px.reshape(size, size, 4)
    rgb = denoise(px[..., :3])
    rgb = np.clip(rgb * scale, 0, 1)
    # denoise-lite: edge-aware 3x3 blur on the low bits keeps grain from showing in 8-bit
    srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    out = bpy.data.images.new('lightmap8', size, size, alpha=False, float_buffer=False)
    out.colorspace_settings.name = 'Non-Color'
    o4 = np.concatenate([srgb, np.ones((size, size, 1), np.float32)], -1)
    out.pixels.foreach_set(o4.ravel())
    swship._save_img(out, os.path.join(outdir, 'lightmap.jpg'), quality=93)
    for s in joined.material_slots:
        n = s.material.node_tree.nodes.get('__bake_target')
        if n: s.material.node_tree.nodes.remove(n)
    finals = [joined]
    groups = {}
    for o in glows:
        groups.setdefault(o.material_slots[0].material.name, []).append(o)
    for mname, objs in groups.items():
        j = swship.join(objs, mname)
        j['glow_color'] = bpy.data.materials[mname].get('glow_color', '#ffffff')
        finals.append(j)
    for o in glass:
        apply_all(o); finals.append(o)
    for o in extra_exports:
        apply_all(o); finals.append(o)
    path = os.path.join(outdir, 'model.glb')
    swship.export_glb(finals, path)
    meta = dict(INFO)
    meta['lightScale'] = 1.0 / scale
    meta['signsFixed'] = True
    with open(os.path.join(outdir, 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    return path


# =============================================================================== ROOMS

@room
def bruecke():
    """Kommandodeck: long hall, panorama window to the north, all exits on the south and east walls."""
    floor = mat_floor('floor_br', '#2e3136', 1.0)
    wallm = mat_wall('wall_br', '#9a9ca0', '#7a7e84', scale=0.9)
    trim = mat_metal('trim_br', '#6a6d72', 0.35, metal=0.9, scale=2)
    dark = mat_rubber('dark_br', '#1a1b1e')
    hazard = mat_paint('haz_br', '#c8901a', wear=0.6, dirt=0.4, stripe=('z', 0.0, 50.0), stripe_color='#d8a020', scale=2, panel=0.0)
    led_w = light_mat('led_warm', '#ffd8a8', 18)
    led_c = light_mat('led_cool', '#a8d8ff', 14)
    glass = mat_glass('glass_br'); glass.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 1.0
    S, Gl, Gs, X = [], [], [], []
    X0, X1, Y0, Y1, H = -15.0, 15.0, -9.0, 9.0, 8.0
    INFO['interior'] = ('box', X0, X1, Y0, Y1, 0.0, H)
    S.append(box('floor', floor, (X1 - X0, Y1 - Y0, 0.3), (0, 0, -0.15)))
    ceil = box('ceiling', wallm, (X1 - X0, Y1 - Y0, 0.3), (0, 0, H + 0.15)); S.append(ceil)
    # north: panorama window
    S += wall('wN', wallm, (X0, Y1), (X1, Y1), H, openings=[(15.0, 26.0, 0.8, H - 0.8)])
    Gs.append(box('glassN', glass, (26.0, 0.05, H - 1.6), (0, Y1, H / 2)))
    for x in (-13, -8.66, -4.33, 0, 4.33, 8.66, 13):
        S.append(box(f'mull{x}', trim, (0.22, 0.4, H - 1.6), (x, Y1, H / 2)))
    S.append(box('sill', trim, (26.4, 0.7, 0.12), (0, Y1 - 0.3, 0.78)))
    S.append(box('sill_led', led_c, (26.0, 0.04, 0.04), (0, Y1 - 0.66, 0.7)))
    # south wall: bar door, quarters door, two counters
    doorsS = [(-10.5, 'RINGGANG · BAR', 'bar', 2.8, 3.3), (-5.0, 'RINGGANG · QUARTIERE', 'kabine', 2.4, 3.2)]
    S += wall('wS', wallm, (X1, Y0), (X0, Y0), H, openings=[(X1 - x, w, 0.0, h) for x, _, _, w, h in doorsS])
    def door(k, x, y, ang, label, target, dw, dh, inward):
        dpos = Vector((x, y, 0)) - inward * 0.2
        S.append(box(f'doorframe{k}', dark, (dw + 0.6, 0.4, 0.3), (x, y, dh + 0.15), rot=(0, 0, ang)))
        for sx in (-1, 1):
            off = Vector((math.cos(ang), math.sin(ang), 0)) * (dw / 2 + 0.2) * sx
            S.append(box(f'doorjamb{k}{sx}', dark, (0.3, 0.4, dh), (x + off.x, y + off.y, dh / 2), rot=(0, 0, ang)))
        Gl.append(box(f'doorled{k}', mat_emit('glow_door', '#7fdcff', 6), (dw + 0.3, 0.05, 0.06), (x + inward.x * 0.25, y + inward.y * 0.25, dh + 0.35), rot=(0, 0, ang)))
        sign_col = '#ff5ad0' if target == 'bar' else '#ffd36a' if target == 'hangar' else '#9fe0ff'
        Gl.append(text_mesh(f'sign{k}', label, mat_emit('glow_sign_' + target, sign_col, 8), 0.38 if target != 'bar' else 0.34,
                            (x + inward.x * 0.25, y + inward.y * 0.25, dh + 0.9), rot=(R(90), 0, ang + R(180))))
        INFO.setdefault('hotspots', []).append({'id': target, 'label': label, 'objs': [f'door{k}', f'sign{k}', f'doorframe{k}']})
    for k, (x, label, target, w, h) in enumerate(doorsS):
        door(k, x, Y0, 0.0, label, target, w, h, Vector((0, 1, 0)))
    for k, (x, label, target) in enumerate(((1.5, 'SÖLDNERBÖRSE', 'boerse'), (9.5, 'WERFT & MARKT', 'werft'))):
        inward = Vector((0, 1, 0))
        cpos = Vector((x, Y0 + 1.8, 0))
        S.append(box(f'counter{k}', trim, (5.0, 0.9, 1.1), (cpos.x, cpos.y, 0.55), bevel=0.03))
        S.append(box(f'countertop{k}', dark, (5.2, 1.05, 0.06), (cpos.x, cpos.y, 1.12)))
        S.append(box(f'counterled{k}', led_c, (4.9, 0.04, 0.04), (cpos.x, cpos.y + 0.47, 1.02)))
        bpy.ops.mesh.primitive_plane_add(size=1.0)
        scr = bpy.context.active_object
        scr.name = f'screen_{target}'
        scr.scale = (4.6, 2.4, 1)
        scr.rotation_euler = (R(90), 0, R(180))
        scr.location = (x, Y0 + 0.24, 3.6)
        scr.data.materials.append(light_mat('screen_lit_' + target, '#2f6f9c', 2.5))
        X.append(scr)
        S.append(box(f'screenframe{k}', dark, (4.9, 0.12, 2.7), (x, Y0 + 0.1, 3.6)))
        Gl.append(text_mesh(f'csign{k}', label, mat_emit('glow_sign_' + target, '#9fe0ff', 8), 0.42, (x, Y0 + 0.2, 5.45), rot=(R(90), 0, R(180))))
        marker('terminal', target, (x, Y0 + 2.9, 0), R(-90), label=label)
        marker('npc', 'oduya' if target == 'boerse' else 'haendler', (x, Y0 + 0.85, 0), R(90))
        INFO.setdefault('hotspots', []).append({'id': target, 'label': label, 'objs': [f'counter{k}', f'screen_{target}', f'csign{k}', f'screenframe{k}']})
    # east wall: hangar (big) + lift to the observation deck
    doorsE = [(-2.0, 'HANGAR', 'hangar', 3.0, 3.4), (5.5, 'AUSSICHT · LIFT', 'aussicht', 2.4, 3.2)]
    S += wall('wE', wallm, (X1, Y1), (X1, Y0), H, openings=[(Y1 - y, w, 0.0, h) for y, _, _, w, h in doorsE])
    for k, (y, label, target, w, h) in enumerate(doorsE):
        door(10 + k, X1, y, R(90), label, target, w, h, Vector((-1, 0, 0)))
    # west wall with station emblem
    S += wall('wW', wallm, (X0, Y0), (X0, Y1), H)
    Gl.append(text_mesh('emblem', 'HOCHSTATION CASSINI', mat_emit('glow_emblem', '#ffe2b0', 6), 0.8, (X0 + 0.2, 0, 5.6), rot=(R(90), 0, R(90))))
    Gl.append(text_mesh('emblem2', 'RHEA-ORBIT · FREIHAFEN SEIT 2198', mat_emit('glow_emblem2', '#9fe0ff', 6), 0.3, (X0 + 0.2, 0, 4.7), rot=(R(90), 0, R(90))))
    # pilasters, baseboards, coves
    for x in (-15, -10, -5, 0, 5, 10, 15):
        S.append(box(f'pilS{x}', trim, (0.5, 0.5, H), (x, Y0 + 0.2, H / 2), bevel=0.04))
    S.append(box('baseS', led_c, (30, 0.04, 0.04), (0, Y0 + 0.5, 0.07)))
    S.append(box('coveS', led_w, (30, 0.05, 0.05), (0, Y0 + 0.5, H - 0.3)))
    S.append(box('coveE', led_w, (0.05, 18, 0.05), (X1 - 0.5, 0, H - 0.3)))
    S.append(box('coveW', led_w, (0.05, 18, 0.05), (X0 + 0.5, 0, H - 0.3)))
    # ceiling beams + light troughs
    for x in range(-14, 15, 4):
        S.append(box(f'beam{x}', trim, (0.45, 18, 0.6), (x, 0, H - 0.3)))
    for x in range(-12, 13, 4):
        S.append(box(f'trough{x}', led_w, (2.4, 0.5, 0.04), (x, -3.5, H - 0.04)))
        S.append(box(f'trough2{x}', led_w, (2.4, 0.5, 0.04), (x, 3.5, H - 0.04)))
    # raised walkway along the window
    S.append(box('window_deck', trim, (28, 3.2, 0.35), (0, Y1 - 1.9, 0.17)))
    S.append(box('window_deck_led', led_c, (28, 0.04, 0.04), (0, Y1 - 3.52, 0.32)))
    for x in (-9, -3, 3, 9):
        S.append(box(f'bench{x}', trim, (3.2, 0.7, 0.45), (x, Y1 - 2.2, 0.57), bevel=0.05))
    # holo table
    S.append(cyl('holo_base', trim, 1.8, 0.95, (0, 0.5, 0.48), rot=(0, 0, 0), n=48))
    S.append(cyl('holo_top', dark, 1.9, 0.08, (0, 0.5, 0.98), rot=(0, 0, 0), n=48))
    S.append(lathe('holo_rim', [(1.0, 1.84), (1.04, 1.84), (1.04, 1.93), (1.0, 1.93)], led_c, n=64))
    S[-1].rotation_euler = (R(90), 0, 0); S[-1].location = (0, 0.5, 0)
    INFO['holo'] = b2t((0, 0.5, 1.05))
    marker('terminal', 'karte', (0, -2.0, 0), R(90), label='Systemkarte')
    INFO.setdefault('hotspots', []).append({'id': 'karte', 'label': 'Systemkarte', 'objs': ['holo_base', 'holo_top']})
    # background people
    coat1 = mat_simple('coat1', '#3b4350', 0.8); coat2 = mat_simple('coat2', '#5a3f2e', 0.8); coat3 = mat_simple('coat3', '#2f3a2c', 0.8)
    skin = mat_simple('skin', '#b88a6a', 0.6)
    # lights for the bake
    for x in (-10, 0, 10):
        area_light(f'key{x}', (x, 0, H - 0.2), (0, 0, 0), 4.0, 600, '#ffe6c8', shape='RECTANGLE', size_y=10)
    point_light('holo_l', (0, 0.5, 1.6), 60, '#5fd0ff', 0.4)
    for x in (1.5, 9.5):
        point_light(f'scr{x}', (x, Y0 + 1.2, 3.6), 80, '#5fb0ff', 1.0)
    marker('spawn', 'default', (-11.0, -1.0, 0), R(0))
    marker('spawn', 'from_bar', (-10.5, Y0 + 1.8, 0), R(90))
    marker('spawn', 'from_kabine', (-5.0, Y0 + 1.8, 0), R(90))
    marker('spawn', 'from_hangar', (X1 - 2.0, -2.0, 0), R(180))
    marker('spawn', 'from_aussicht', (X1 - 2.0, 5.5, 0), R(180))
    INFO['window_dir'] = b2t((0, 1, 0))
    return S, Gl, Gs, X


@room
def bar():
    floor = mat_floor('floor_bar', '#2a2522', 2.0)
    wallm = mat_wall('wall_bar', '#4a3e38', '#3a302b', scale=1.2, dirt=0.5)
    trim = mat_metal('trim_bar', '#8a6a4a', 0.35, metal=0.9, scale=2)
    dark = mat_rubber('dark_bar', '#141213')
    wood = mat_wood('wood_bar', '#5a3a24')
    leather = mat_simple('leather', '#5a2a22', 0.55)
    led_amb = light_mat('led_amber', '#ffb070', 20)
    led_pink = light_mat('led_pink', '#ff5ad0', 14)
    led_blue = light_mat('led_blue', '#6ab8ff', 14)
    glass = mat_glass('glass_bar'); glass.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 1.0
    S, Gl, Gs, X = [], [], [], []
    W, D, H = 16.0, 12.0, 4.4   # x in [-8, 8], y in [-6, 6]
    INFO['interior'] = ('box', -8, 8, -6, 6, 0.0, H)
    S.append(box('floor', floor, (W, D, 0.2), (0, 0, -0.1)))
    S.append(box('ceiling', wallm, (W, D, 0.2), (0, 0, H + 0.1)))
    # window wall +Y with a long strip window
    S += wall('wN', wallm, (-8, 6), (8, 6), H, openings=[(8.0, 12.0, 1.0, 3.4)])
    Gs.append(box('glassN', glass, (12, 0.04, 2.4), (0, 6, 2.2)))
    for x in (-4, 0, 4):
        S.append(box(f'mullN{x}', trim, (0.14, 0.3, 2.4), (x, 6, 2.2)))
    S += wall('wS', wallm, (8, -6), (-8, -6), H, openings=[(13.0, 2.4, 0, 3.0)])   # door near x=-5
    S += wall('wE', wallm, (8, 6), (8, -6), H)
    S += wall('wW', wallm, (-8, -6), (-8, 6), H)
    # wood wainscoting
    for nm, p0, p1 in (('wainE', (7.85, 6), (7.85, -6)), ('wainW', (-7.85, -6), (-7.85, 6))):
        S.append(box(nm, wood, (0.08, 12, 1.2), (p0[0], 0, 0.6)))
    # bar counter along the east wall (x ~ 5.2)
    S.append(box('bar_body', wood, (0.9, 7.0, 1.1), (5.0, -0.5, 0.55), bevel=0.03))
    S.append(box('bar_top', trim, (1.15, 7.3, 0.07), (4.95, -0.5, 1.13), bevel=0.02))
    S.append(box('bar_led', led_amb, (0.03, 6.9, 0.04), (4.53, -0.5, 1.0)))
    S.append(box('bar_foot', trim, (0.08, 7.0, 0.06), (4.4, -0.5, 0.25)))
    # back shelves with bottles
    S.append(box('shelf_back', dark, (0.3, 6.5, 2.6), (7.75, -0.5, 2.1)))
    for z in (1.5, 2.2, 2.9):
        S.append(box(f'shelf{z}', trim, (0.45, 6.4, 0.04), (7.55, -0.5, z)))
        S.append(box(f'shelf_led{z}', led_amb, (0.02, 6.3, 0.02), (7.4, -0.5, z - 0.03)))
        import random
        rnd = random.Random(int(z * 10))
        y = -3.5
        while y < 2.5:
            col = rnd.choice(['#2a6b3a', '#6b3a1a', '#8a8a5a', '#3a2a6b', '#a85a2a', '#2a5a6b'])
            h = rnd.uniform(0.25, 0.4)
            bm = mat_simple('bottle_' + col, col, 0.1, 0.0)
            S.append(cyl(f'bottle{z}{y:.2f}', bm, 0.045, h, (7.5, y, z + h / 2 + 0.02), rot=(0, 0, 0), n=10))
            y += rnd.uniform(0.12, 0.22)
    for i, y in enumerate((-3.4, -2.2, -1.0, 0.2, 1.4, 2.6)):
        S += stool(f'stool{i}', leather, trim, (4.1, y - 0.5, 0))
    # stage (north-west corner)
    S.append(cyl('stage', wood, 2.6, 0.35, (-5.4, 3.4, 0.175), rot=(0, 0, 0), n=48))
    S.append(lathe('stage_rim', [(0.33, 2.56), (0.37, 2.56), (0.37, 2.63), (0.33, 2.63)], led_blue, n=64))
    S[-1].rotation_euler = (R(90), 0, 0); S[-1].location = (-5.4, 3.4, 0)
    S.append(lathe('stage_ring', [(-0.08, 2.4), (0.08, 2.4), (0.08, 2.55), (-0.08, 2.55)], trim, n=48))
    S[-1].rotation_euler = (R(90), 0, 0); S[-1].location = (-5.4, 3.4, H - 0.4)
    S.append(lathe('stage_ring_led', [(-0.02, 2.42), (0.02, 2.42), (0.02, 2.5), (-0.02, 2.5)], led_pink, n=48))
    S[-1].rotation_euler = (R(90), 0, 0); S[-1].location = (-5.4, 3.4, H - 0.48)
    INFO['stage'] = b2t((-5.4, 3.4, 0.36))
    # tables with lamps
    tables = [(-1.5, 3.8), (1.5, 3.8), (-1.0, 0.2), (1.8, -0.4), (-2.0, -3.4), (1.2, -3.8), (-6.2, -2.0)]
    coatA = mat_simple('coatA', '#33363d', 0.8); coatB = mat_simple('coatB', '#6a4a30', 0.8); coatC = mat_simple('coatC', '#2e4038', 0.8)
    skin = mat_simple('skin_bar', '#a87a5a', 0.6); hat = mat_simple('hat', '#222222', 0.7)
    lamp = light_mat('lamp_warm', '#ffc890', 30)
    for i, (x, y) in enumerate(tables):
        S.append(cyl(f'tbl{i}', wood, 0.55, 0.05, (x, y, 0.74), rot=(0, 0, 0), n=32))
        S.append(cyl(f'tblleg{i}', trim, 0.05, 0.72, (x, y, 0.36), rot=(0, 0, 0), n=10))
        S.append(cyl(f'tblfoot{i}', trim, 0.3, 0.03, (x, y, 0.015), rot=(0, 0, 0), n=20))
        S.append(sphere(f'lamp{i}', lamp, 0.06, (x, y, 0.84), scale=(1, 1, 1.4)))
        point_light(f'tl{i}', (x, y, 1.0), 14, '#ffc080', 0.05)
        for k in range(3):
            a = R(120 * k + 30) if i != 0 else R(120 * k + 90)
            cx, cy = x + 0.85 * math.cos(a), y + 0.85 * math.sin(a)
            S += chair(f'ch{i}{k}', leather, trim, (cx, cy, 0), rot=a + R(90))
            if (i * 3 + k) % 4 == 1 and i != 0:
                marker('patron', f'seat{i}{k}', (cx, cy, 0), a + math.pi, seated=True)
    # Mags' table = table 0 near the window
    marker('npc', 'mags', (-1.5, 3.8 + 0.85, 0), R(-90), seated=True)
    marker('npc', 'kix', (6.3, -0.5, 0), R(180))
    marker('patron', 'counter0', (3.75, -2.6, 0), R(0), seated=False)
    marker('patron', 'counter1', (3.8, 1.3, 0), R(-10), seated=False)
    marker('band', 'band', (-5.4, 3.4, 0.36), R(-45))
    # neon sign above bar
    Gl.append(text_mesh('neon_bar', 'CASSINI-SPALT', mat_emit('glow_neon_pink', '#ff4ac8', 10), 0.55, (7.55, -0.5, 3.75), rot=(R(90), 0, R(-90))))
    Gl.append(text_mesh('neon_sub', 'live · jeden Abend · Roche-Grenze', mat_emit('glow_neon_blue', '#5ab8ff', 10), 0.22, (-7.85, 3.4, 3.4), rot=(R(90), 0, R(90))))
    # ceiling pendants + cove lights
    for x in (-4.5, -1.5, 1.5):
        for y in (-3.5, 0.0, 3.5):
            S.append(cyl(f'pend{x}{y}', dark, 0.01, 1.2, (x, y, H - 0.6), rot=(0, 0, 0), n=6))
            S.append(sphere(f'pendb{x}{y}', lamp, 0.09, (x, y, H - 1.25)))
    S.append(box('cove_w', led_amb, (0.04, 11.5, 0.04), (-7.7, 0, H - 0.2)))
    S.append(box('cove_e', led_pink, (0.04, 11.5, 0.04), (7.7, 0, H - 0.2)))
    area_light('fill', (0, 0, H - 0.1), (0, 0, 0), 8, 180, '#ffc8a0')
    point_light('bar_l', (6.0, -0.5, 2.6), 90, '#ffb070', 0.3)
    point_light('stage_l', (-5.4, 3.4, 3.2), 140, '#c070ff', 0.4)
    spot_light('stage_spot', (-3.5, 1.5, H - 0.3), (-5.4, 3.4, 0.4), 260, '#ffd0ff', 45)
    # doorway to the Ringgang (sliding door is dynamic, see deck())
    Gl.append(box('door_led', mat_emit('glow_door', '#7fdcff', 6), (2.6, 0.05, 0.06), (-5.0, -5.85, 3.25)))
    marker('spawn', 'default', (-5.0, -4.6, 0), R(90))
    marker('terminal', 'bar_order', (4.2, -1.0, 0), R(0), label='Drink bestellen')
    INFO['window_dir'] = b2t((0, 1, 0))
    return S, Gl, Gs, X


@room
def kabine():
    """Kabine 4-117: small but lived-in quarters with a panorama window to space (Saturn swings past as the ring turns)."""
    floor = mat_floor('floor_cab', '#2c2e31', 3.0)
    wallm = mat_wall('wall_cab', '#8c8f93', '#73777c', scale=2.0, dirt=0.5)
    trim = mat_metal('trim_cab', '#6a6d72', 0.4, metal=0.8, scale=4)
    dark = mat_rubber('dark_cab', '#1c1d20')
    wood = mat_wood('wood_cab', '#6a4428')
    fabric = mat_simple('blanket', '#3d4a5c', 0.9)
    fabric2 = mat_simple('blanket2', '#8a4a2c', 0.85)
    pillow = mat_simple('pillow', '#c8c4b8', 0.9)
    olive = mat_simple('duffel', '#4a5236', 0.8)
    leather = mat_simple('jacket', '#5a3a26', 0.6)
    rug = mat_simple('rug_cab', '#6a3a30', 0.95)
    ceramic = mat_simple('mug', '#d8d2c4', 0.3)
    pot = mat_simple('pot_cab', '#3a3c40', 0.5)
    leaf = mat_simple('leaf_cab', '#3f6a2e', 0.6)
    poster = mat_simple('poster_cab', '#1a1430', 0.7)
    led = light_mat('led_cab', '#ffe0b8', 10)
    led_cool = light_mat('led_cab_cool', '#bfe4ff', 6)
    glass = mat_glass('glass_cab')
    S, Gl, Gs, X = [], [], [], []
    W, H = 5.0, 2.6
    X0, X1, Y0, Y1 = -2.5, 2.5, -2.3, 3.7   # door in the south wall (y0), window in the north wall (y1)
    INFO['interior'] = ('box', X0, X1, Y0, Y1, 0.0, H)
    cy = (Y0 + Y1) / 2
    S.append(box('floor', floor, (W, Y1 - Y0, 0.1), (0, cy, -0.05)))
    S.append(box('ceil', wallm, (W, Y1 - Y0, 0.1), (0, cy, H + 0.05)))
    # ---- panorama window
    S += wall('wN', wallm, (X0, Y1), (X1, Y1), H, openings=[(2.5, 4.2, 0.55, 2.3)])
    Gs.append(box('glass_window', glass, (4.2, 0.03, 1.75), (0, Y1 + 0.02, 1.425)))
    for x in (-1.4, 1.4):
        S.append(box(f'mullion{x}', trim, (0.07, 0.22, 1.75), (x, Y1 - 0.02, 1.425)))
    S.append(box('sill', trim, (4.5, 0.5, 0.07), (0, Y1 - 0.2, 0.52), bevel=0.01))
    S.append(box('header', trim, (4.5, 0.26, 0.12), (0, Y1 - 0.1, 2.36)))
    for x in (-2.18, 2.18):
        S.append(box(f'jamb{x}', trim, (0.12, 0.3, 1.9), (x, Y1 - 0.08, 1.43)))
    S.append(box('cove_led', led_cool, (4.0, 0.04, 0.02), (0, Y1 - 0.24, 2.29)))
    # window bench with cushions
    S.append(box('bench', trim, (3.0, 0.6, 0.42), (0.35, Y1 - 0.55, 0.21), bevel=0.02))
    S.append(box('bench_cushion', fabric, (2.9, 0.56, 0.1), (0.35, Y1 - 0.55, 0.47), bevel=0.04))
    S.append(box('bench_pillow0', fabric2, (0.42, 0.14, 0.36), (1.45, Y1 - 0.38, 0.68), rot=(R(-12), 0, R(8)), bevel=0.05))
    S.append(box('bench_pillow1', pillow, (0.38, 0.13, 0.32), (1.0, Y1 - 0.36, 0.66), rot=(R(-14), 0, R(-6)), bevel=0.05))
    S.append(box('bench_glow', led, (2.8, 0.02, 0.02), (0.35, Y1 - 0.86, 0.04)))
    # plants: one on the sill, one big in the corner
    S.append(cyl('sillpot', pot, 0.1, 0.16, (-1.75, Y1 - 0.2, 0.64), rot=(0, 0, 0), n=16, r2=0.08))
    S.append(plant('sill_plant', leaf, (-1.75, Y1 - 0.2, 0.7), n=12, length=0.32, seed=4))
    S.append(cyl('floorpot', pot, 0.22, 0.45, (-2.1, Y1 - 0.45, 0.225), rot=(0, 0, 0), n=20, r2=0.17))
    S.append(plant('floor_plant', leaf, (-2.1, Y1 - 0.45, 0.42), n=16, length=0.75, seed=9))
    # ---- south wall with the door, west/east walls
    S += wall('wS', wallm, (X1, Y0), (X0, Y0), H, openings=[(2.5, 1.0, 0, 2.1)])
    S += wall('wE', wallm, (X1, Y1), (X1, Y0), H)
    S += wall('wW', wallm, (X0, Y0), (X0, Y1), H)
    S.append(box('door_frame_l', trim, (0.08, 0.14, 2.15), (-0.54, Y0 + 0.1, 1.07)))
    S.append(box('door_frame_r', trim, (0.08, 0.14, 2.15), (0.54, Y0 + 0.1, 1.07)))
    S.append(box('door_frame_t', trim, (1.16, 0.14, 0.08), (0, Y0 + 0.1, 2.14)))
    # ---- bunk along the west wall
    by0, by1 = 0.25, 2.45
    bc = (by0 + by1) / 2
    S.append(box('bunk', trim, (1.05, by1 - by0, 0.4), (-1.95, bc, 0.22), bevel=0.02))
    S.append(box('bunk_glow', led, (0.02, by1 - by0 - 0.2, 0.02), (-1.42, bc, 0.03)))
    S.append(box('mattress', pillow, (1.0, by1 - by0 - 0.06, 0.16), (-1.95, bc, 0.5), bevel=0.05))
    S.append(box('blanket', fabric, (1.04, 1.35, 0.06), (-1.94, bc - 0.38, 0.6), bevel=0.03))
    S.append(box('blanket_fold', fabric2, (0.9, 0.34, 0.09), (-1.92, by0 + 0.3, 0.66), rot=(0, 0, R(4)), bevel=0.04))
    S.append(box('pillow', pillow, (0.62, 0.36, 0.13), (-1.95, by1 - 0.28, 0.65), rot=(R(-8), 0, R(-3)), bevel=0.06))
    S.append(box('headboard', wood, (1.1, 0.06, 0.7), (-1.95, by1 + 0.02, 0.85), bevel=0.01))
    S.append(box('bed_shelf', wood, (0.26, by1 - by0, 0.04), (-2.36, bc, 1.45)))
    import random
    rnd = random.Random(17)
    yb = by0 + 0.15
    for i in range(11):
        th = rnd.uniform(0.03, 0.06); hh = rnd.uniform(0.17, 0.25)
        col = rnd.choice(['#7a2a24', '#2a4a6a', '#c8b07a', '#3a5a3a', '#d8d0c0', '#5a3a6a'])
        S.append(box(f'book{i}', mat_simple(f'book{i}', col, 0.7), (0.17, th, hh), (-2.38, yb, 1.47 + hh / 2), rot=(R(rnd.choice([0, 0, 0, 8])), 0, 0)))
        yb += th + 0.004
    S.append(box('speaker', dark, (0.16, 0.22, 0.14), (-2.36, yb + 0.25, 1.54), bevel=0.02))
    S.append(box('model_ship', trim, (0.12, 0.3, 0.05), (-2.37, by1 - 0.4, 1.5)))
    S.append(box('reading_lamp', trim, (0.1, 0.12, 0.1), (-2.38, by1 - 0.15, 1.75), bevel=0.02))
    S.append(sphere('reading_bulb', led, 0.035, (-2.3, by1 - 0.15, 1.72)))
    S.append(cyl('duffel', olive, 0.2, 0.72, (-1.55, -0.25, 0.2), rot=(0, R(90), R(20)), n=18))
    S.append(box('duffel_strap', dark, (0.05, 0.42, 0.02), (-1.55, -0.25, 0.4), rot=(0, 0, R(20))))
    # galley niche: counter, water dispenser, kettle
    S.append(box('galley', trim, (0.6, 0.75, 0.9), (-2.18, -0.95, 0.45), bevel=0.02))
    S.append(box('galley_top', wood, (0.62, 0.78, 0.04), (-2.18, -0.95, 0.92)))
    S.append(box('dispenser', trim, (0.3, 0.3, 0.45), (-2.3, -1.12, 1.17), bevel=0.02))
    S.append(box('dispenser_glow', led_cool, (0.01, 0.12, 0.05), (-2.14, -1.12, 1.3)))
    S.append(cyl('kettle', ceramic, 0.07, 0.16, (-2.15, -0.72, 1.02), rot=(0, 0, 0), n=16))
    S.append(cyl('cup0', ceramic, 0.04, 0.09, (-2.0, -0.88, 0.985), rot=(0, 0, 0), n=12))
    # jacket on a hook and boots by the door
    S.append(cyl('hook', trim, 0.015, 0.1, (-2.43, -1.75, 1.75), rot=(0, R(90), 0), n=8))
    S.append(box('jacket', leather, (0.12, 0.5, 0.75), (-2.38, -1.75, 1.36), rot=(R(3), R(4), 0), bevel=0.05))
    S.append(box('jacket_collar', leather, (0.14, 0.34, 0.1), (-2.37, -1.75, 1.72), bevel=0.04))
    for k, x in enumerate((-1.95, -1.75)):
        S.append(box(f'boot{k}', dark, (0.12, 0.3, 0.12), (x, -1.95, 0.06), rot=(0, 0, R(8 * k)), bevel=0.03))
        S.append(box(f'boot_shaft{k}', dark, (0.11, 0.12, 0.24), (x, -1.86, 0.2), rot=(0, 0, R(8 * k)), bevel=0.03))
    # ---- desk and terminal along the east wall
    S.append(box('desk', wood, (0.72, 1.5, 0.05), (2.12, 1.4, 0.76), bevel=0.01))
    S.append(box('desk_side', trim, (0.68, 0.05, 0.74), (2.12, 0.67, 0.37)))
    S.append(box('desk_drawers', trim, (0.6, 0.45, 0.6), (2.15, 1.9, 0.38), bevel=0.01))
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    scr = bpy.context.active_object; scr.name = 'screen_kabine'
    scr.scale = (0.78, 0.46, 1); scr.rotation_euler = (R(84), 0, R(90)); scr.location = (2.4, 1.4, 1.2)
    scr.data.materials.append(light_mat('screen_lit_cab', '#3a7fb0', 3))
    X.append(scr)
    S.append(box('screen_bezel', dark, (0.04, 0.84, 0.52), (2.44, 1.4, 1.2), rot=(R(-6), 0, 0)))
    S.append(box('keyboard', dark, (0.18, 0.45, 0.015), (2.05, 1.4, 0.79), rot=(0, 0, 0), bevel=0.005))
    S.append(cyl('mug', ceramic, 0.045, 0.1, (1.95, 0.85, 0.835), rot=(0, 0, 0), n=14))
    S.append(box('datapad', dark, (0.16, 0.24, 0.012), (1.98, 1.85, 0.79), rot=(0, 0, R(18))))
    S.append(box('photo_frame', trim, (0.03, 0.16, 0.12), (2.33, 0.85, 0.85), rot=(0, R(-12), 0)))
    S.append(cyl('lamp_base', trim, 0.07, 0.02, (2.3, 2.0, 0.79), rot=(0, 0, 0), n=14))
    S.append(cyl('lamp_arm', trim, 0.012, 0.42, (2.3, 2.0, 1.0), rot=(R(-12), 0, 0), n=8))
    S.append(sphere('lamp_head', led, 0.05, (2.3, 1.95, 1.2), scale=(1, 1, 0.7)))
    S += chair('desk_chair', fabric, trim, (1.6, 1.3, 0), rot=R(-90))
    S.append(box('photo_wall', mat_simple('photo', '#d0c0a0', 0.6), (0.01, 0.3, 0.22), (2.43, 1.0, 1.75)))
    S.append(box('chart_wall', mat_simple('chart', '#a8b8c0', 0.7), (0.01, 0.42, 0.3), (2.43, 1.75, 1.78)))
    # locker by the door
    S.append(box('locker', trim, (0.62, 0.9, 2.2), (2.17, -1.5, 1.1), bevel=0.02))
    S.append(box('locker_seam', dark, (0.01, 0.02, 2.1), (1.855, -1.5, 1.1)))
    for y in (-1.6, -1.4):
        S.append(box(f'locker_handle{y}', trim, (0.03, 0.02, 0.22), (1.84, y, 1.1)))
    S.append(box('locker_tag', mat_simple('tag', '#d8c890', 0.6), (0.01, 0.2, 0.08), (1.85, -1.5, 1.7)))
    # poster next to the door (holo print)
    S.append(box('poster', poster, (0.62, 0.01, 0.86), (1.55, Y0 + 0.14, 1.45)))
    Gl.append(text_mesh('poster_t1', 'ROCHE-GRENZE', mat_emit('glow_neon_pink', '#ff4ac8', 10), 0.075, (1.55, Y0 + 0.155, 1.62), rot=(R(90), 0, R(180))))
    Gl.append(text_mesh('poster_t2', 'LIVE · KRAKEN-HAFEN', mat_emit('glow_poster_c', '#7fdcff', 6), 0.04, (1.55, Y0 + 0.155, 1.5), rot=(R(90), 0, R(180))))
    S.append(sphere('poster_saturn', mat_simple('poster_sat', '#d8b070', 0.5), 0.12, (1.55, Y0 + 0.16, 1.25), scale=(1, 0.1, 1)))
    S.append(box('poster_ring', mat_simple('poster_ring', '#c8a060', 0.5), (0.4, 0.012, 0.025), (1.55, Y0 + 0.165, 1.25), rot=(0, R(-14), 0)))
    S.append(box('rug', rug, (1.5, 2.1, 0.012), (0.15, 0.7, 0.006)))
    # ceiling: light panel, conduits, vent
    S.append(box('ceil_led', led, (0.7, 1.6, 0.02), (0, 0.7, H - 0.02)))
    for k, x in enumerate((2.3, 2.38)):
        S.append(cyl(f'conduit{k}', trim, 0.025, Y1 - Y0 - 0.2, (x, cy, H - 0.12 - k * 0.05), n=8))
    S.append(box('vent', dark, (0.5, 0.5, 0.02), (-1.2, -1.2, H - 0.01)))
    for k in range(5):
        S.append(box(f'vent_slat{k}', trim, (0.46, 0.02, 0.03), (-1.2, -1.4 + k * 0.1, H - 0.03)))
    S.append(box('panel_door', dark, (0.18, 0.02, 0.26), (0.85, Y0 + 0.14, 1.25)))
    Gl.append(box('door_led', mat_emit('glow_door', '#7fdcff', 6), (1.1, 0.04, 0.04), (0, Y0 + 0.1, 2.24)))
    Gl.append(box('panel_led', mat_emit('glow_lock_green', '#3aff6a', 6), (0.04, 0.012, 0.04), (0.85, Y0 + 0.155, 1.3)))
    # lights: ceiling, bed and desk lamps, and the cold light through the window
    point_light('cl', (0, 0.7, H - 0.3), 26, '#ffe0c0', 0.3)
    point_light('bl', (-2.2, by1 - 0.2, 1.65), 7, '#ffd0a0', 0.05)
    point_light('dl', (2.25, 1.9, 1.12), 6, '#ffd8a8', 0.05)
    area_light('win_space', (0, Y1 + 0.6, 1.5), (R(-90), 0, 0), 4.0, 45, '#a8c0ff', size_y=1.6)
    area_light('win_saturn', (1.2, Y1 + 0.8, 2.2), (R(-110), 0, R(-20)), 2.0, 18, '#ffd8a0')
    marker('terminal', 'kabine_terminal', (1.6, 1.4, 0), R(0), label='Terminal (Speichern · Logbuch)')
    marker('terminal', 'bett', (-1.2, 1.3, 0), R(180), label='Schlafen (neuer Tag)')
    marker('spawn', 'default', (0, -1.4, 0), R(90))
    INFO['window_dir'] = b2t((0, 1, 0))
    return S, Gl, Gs, X


@room
def hangar():
    floor = mat_floor('floor_hg', '#33363a', 0.35)
    wallm = mat_wall('wall_hg', '#7d8085', '#5d6066', scale=0.35, dirt=0.7)
    trim = mat_metal('trim_hg', '#5d6064', 0.4, metal=0.9, scale=0.6)
    hazard = mat_paint('haz_hg', '#c8901a', wear=0.7, dirt=0.5, stripe=('z', 0.0, 80.0), stripe_color='#d8a020', scale=1, panel=0.0)
    dark = mat_rubber('dark_hg')
    crate1 = mat_paint('crate1', '#3a5a7a', color2='#a8692a', wear=0.6, dirt=0.6, scale=2.5)
    crate2 = mat_paint('crate2', '#6a3a22', color2='#7a7a6a', wear=0.6, dirt=0.6, scale=2.5)
    led = light_mat('led_hg', '#e8f0ff', 22)
    amber = light_mat('led_hg_amber', '#ffb050', 18)
    S, Gl, Gs, X = [], [], [], []
    W, D, H = 44.0, 34.0, 16.0   # x [-22, 22]: bay opening at +X
    INFO['interior'] = ('box', -22, 22, -17, 17, 0.0, H)
    S.append(box('floor', floor, (W, D, 0.3), (0, 0, -0.15)))
    S.append(box('ceil', wallm, (W, D, 0.3), (0, 0, H + 0.15)))
    S += wall('wN', wallm, (-22, 17), (22, 17), H)
    S += wall('wS', wallm, (22, -17), (-22, -17), H)
    S += wall('wW', wallm, (-22, -17), (-22, 17), H, openings=[(26.0, 2.6, 0, 3.2)])
    S += wall('wE', wallm, (22, 17), (22, -17), H, openings=[(17.0, 30.0, 0.5, 13.5)])
    # bay frame with hazard
    S.append(box('bayframe_top', hazard, (1.2, 31, 1.0), (22, 0, 14.0)))
    S.append(box('bayframe_bot', hazard, (1.2, 31, 0.6), (22, 0, 0.2)))
    field = box('field_bay', dark, (0.1, 30, 13.0), (22.2, 0, 7.0))
    field.data.materials.clear(); field.data.materials.append(mat_emit('glow_field', '#4aa0ff', 1)); field.name = 'field_bay'
    X.append(field)
    # landing pad
    S.append(cyl('pad', trim, 9.0, 0.2, (2, 0, 0.1), rot=(0, 0, 0), n=64))
    S.append(lathe('pad_ring', [(-0.03, 8.6), (0.03, 8.6), (0.03, 8.9), (-0.03, 8.9)], amber, n=64))
    S[-1].rotation_euler = (R(90), 0, 0); S[-1].location = (2, 0, 0.23)
    INFO['pad'] = b2t((2, 0, 0.2))
    # catwalk along north wall + stairs
    S.append(box('catwalk', mat_floor('grate_hg', '#2a2c2f', 3.0, grate=True), (40, 2.4, 0.12), (0, 15.6, 6.0)))
    S.append(box('rail', trim, (40, 0.06, 0.06), (0, 14.45, 7.05)))
    for x in range(-19, 21, 3):
        S.append(box(f'post{x}', trim, (0.06, 0.06, 1.05), (x, 14.45, 6.55)))
        S.append(box(f'strut{x}', trim, (0.2, 0.2, 6.0), (x, 16.6, 3.0)))
    # control booth
    S.append(box('booth', wallm, (6, 4, 3.2), (-17, 14.8, 7.7), bevel=0.1))
    Gs.append(box('glass_booth', mat_glass('glass_hg'), (5.6, 0.05, 1.6), (-17, 12.78, 8.0)))
    # crates and fuel tanks
    import random
    rnd = random.Random(5)
    for i in range(16):
        x = rnd.uniform(-19, -8) if i % 2 else rnd.uniform(10, 19)
        y = (-1 if x < 0 else rnd.choice([-1, 1])) * rnd.uniform(10, 15)
        sz = rnd.choice([(2.4, 2.4, 2.4), (2.4, 4.8, 2.4), (1.2, 1.2, 1.2)])
        stack = rnd.random() < 0.3
        S.append(box(f'crate{i}', crate1 if i % 3 else crate2, sz, (x, y, sz[2] / 2), rot=(0, 0, R(rnd.choice([0, 90, 3, -4]))), bevel=0.04))
        if stack:
            S.append(box(f'crateb{i}', crate2, (1.2, 1.2, 1.2), (x, y, sz[2] + 0.6), rot=(0, 0, R(rnd.uniform(-10, 10))), bevel=0.03))
    for i, y in enumerate((-12, -8)):
        S.append(cyl(f'tank{i}', mat_paint(f'tankm{i}', '#b8b4a8', wear=0.4, dirt=0.6, scale=1.5), 1.6, 7, (-19.5, y, 3.5), rot=(0, 0, 0), n=32))
    # overhead gantry crane
    S.append(box('gantry', hazard, (1.2, 32, 1.2), (6, 0, 13.5)))
    S.append(box('gantry_hook', trim, (1.5, 1.5, 0.8), (6, 4, 12.5)))
    S.append(cyl('cable', dark, 0.05, 4, (6, 4, 10.5), rot=(0, 0, 0), n=6))
    # ceiling light panels
    for x in (-15, -5, 5, 15):
        for y in (-9, 0, 9):
            S.append(box(f'cl{x}{y}', led, (5, 1.0, 0.05), (x, y, H - 0.05)))
    for x in (-15, 0, 15):
        point_light(f'hl{x}', (x, 0, H - 2), 2400, '#e8f0ff', 1.0)
    area_light('bay_spill', (20, 0, 7), (0, R(-90), 0), 12, 600, '#a8c8ff')
    for y in (-13.5, 13.5):
        for x in (-12, 0, 12):
            S.append(box(f'wl{x}{y}', amber, (2.0, 0.05, 0.15), (x, y * 1.255, 3.0)))
    # door to the bridge
    Gl.append(box('door_led', mat_emit('glow_door', '#7fdcff', 6), (0.05, 2.8, 0.06), (-21.8, 9.0, 3.45)))
    Gl.append(text_mesh('sign_hg', 'HANGAR 7 · BUCHT C', mat_emit('glow_sign_hg', '#ffd36a', 8), 1.2, (-21.8, 0, 10), rot=(R(90), 0, R(90))))
    marker('ship', 'ship', (2, 0, 0.2), R(0), label='Einsteigen und starten')
    marker('terminal', 'hangar_werft', (-17, 10.5, 0), R(90), label='Werft-Terminal')
    marker('spawn', 'default', (-19.5, 9.0, 0), R(0))
    INFO['window_dir'] = b2t((1, 0, 0))
    return S, Gl, Gs, X


@room
def aussicht():
    floor = mat_floor('floor_au', '#26282b', 1.5)
    trim = mat_metal('trim_au', '#7a7d82', 0.3, metal=0.9, scale=2)
    wood = mat_wood('wood_au', '#6a4a30')
    plant_m = mat_simple('plant', '#2e5a26', 0.7)
    plant_m2 = mat_simple('plant2', '#4a7a32', 0.7)
    soil = mat_simple('soil', '#2a1e16', 0.95)
    led = light_mat('led_au', '#a8d8ff', 25)
    glass = mat_glass('glass_au'); glass.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 1.0
    S, Gl, Gs, X = [], [], [], []
    Rr = 11.0
    INFO['interior'] = ('dome', Rr, 0.0)
    S.append(cyl('floor', floor, Rr, 0.3, (0, 0, -0.15), rot=(0, 0, 0), n=96))
    hole = cyl('floor_hole', floor, 1.55, 1.0, (0, -8.6, 0), rot=(0, 0, 0), n=40)
    bm_ = S[-1].modifiers.new('hole', 'BOOLEAN'); bm_.object = hole; bm_.operation = 'DIFFERENCE'
    apply_all(S[-1]); bpy.data.objects.remove(hole)
    # dome ribs and glass
    for k in range(16):
        a = R(22.5 * k)
        pts = []
        for i in range(12):
            th = R(90 * i / 11)
            pts.append(Vector((math.cos(a) * Rr * math.cos(th), math.sin(a) * Rr * math.cos(th), Rr * 0.75 * math.sin(th))))
        for i in range(11):
            p0, p1 = pts[i], pts[i + 1]
            d = p1 - p0
            c = cyl(f'rib{k}_{i}', trim, 0.08, d.length * 1.05, tuple((p0 + p1) / 2), rot=(0, 0, 0), n=8)
            c.rotation_mode = 'QUATERNION'; c.rotation_quaternion = d.to_track_quat('Z', 'Y')
            S.append(c)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=Rr, location=(0, 0, 0))
    dome = bpy.context.active_object; dome.name = 'glass_dome'
    bm = bmesh.new(); bm.from_mesh(dome.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.01], context='VERTS')
    bm.to_mesh(dome.data); bm.free()
    dome.scale = (1, 1, 0.75)
    dome.data.materials.append(glass)
    Gs.append(dome)
    S.append(lathe('base_ring', [(0, Rr - 0.1), (0.6, Rr - 0.1), (0.6, Rr + 0.3), (0, Rr + 0.3)], trim, n=96))
    S[-1].rotation_euler = (R(-90), 0, 0)
    S.append(lathe('base_led', [(0.62, Rr - 0.12), (0.66, Rr - 0.12), (0.66, Rr), (0.62, Rr)], led, n=96))
    S[-1].rotation_euler = (R(-90), 0, 0)
    # railing
    S.append(lathe('rail', [(1.05, Rr - 1.2), (1.1, Rr - 1.2), (1.1, Rr - 1.15), (1.05, Rr - 1.15)], trim, n=96))
    S[-1].rotation_euler = (R(-90), 0, 0)
    for k in range(32):
        a = R(11.25 * k)
        S.append(cyl(f'rp{k}', trim, 0.025, 1.1, ((Rr - 1.18) * math.cos(a), (Rr - 1.18) * math.sin(a), 0.55), rot=(0, 0, 0), n=6))
    # benches + planters
    for k in range(6):
        a = R(60 * k)
        S.append(box(f'bench{k}', wood, (2.4, 0.6, 0.08), (6.0 * math.cos(a), 6.0 * math.sin(a), 0.45), rot=(0, 0, a + R(90)), bevel=0.02))
        S.append(box(f'benchl{k}', trim, (2.2, 0.4, 0.42), (6.0 * math.cos(a), 6.0 * math.sin(a), 0.21), rot=(0, 0, a + R(90))))
    for k in range(3):
        a = R(120 * k)
        x, y = 3.0 * math.cos(a), 3.0 * math.sin(a)
        S.append(cyl(f'planter{k}', trim, 0.9, 0.7, (x, y, 0.35), rot=(0, 0, 0), n=32))
        S.append(cyl(f'soil{k}', soil, 0.85, 0.05, (x, y, 0.7), rot=(0, 0, 0), n=32))
        S.append(plant(f'fern{k}', plant_m, (x, y, 0.72), n=22, length=1.25, seed=k + 3))
        S.append(plant(f'fern_in{k}', plant_m2, (x, y, 0.72), n=10, length=0.75, seed=k + 11))
    # lift at the south edge, so you enter looking across the dome
    # glass lift enclosure (the cabin itself is dynamic); opening faces north into the dome
    S.append(lathe('lift_collar', [(-0.02, 1.55), (0.02, 1.55), (0.02, 1.8), (-0.02, 1.8)], trim, n=48))
    S[-1].rotation_euler = (R(90), 0, 0); S[-1].location = (0, -8.6, 0)
    S.append(lathe('lift_cap', [(2.95, 0.0), (3.1, 0.0), (3.1, 1.75), (2.95, 1.75)], trim, n=48))
    S[-1].rotation_euler = (R(90), 0, 0); S[-1].location = (0, -8.6, 0)
    for k in range(10):
        a = R(36 * k + 18)
        if abs(math.sin(a) - 1) < 0.35:
            continue
        S.append(box(f'lift_post{k}', trim, (0.08, 0.08, 2.95), (1.62 * math.cos(a), -8.6 + 1.62 * math.sin(a), 1.47)))
    Gl.append(text_mesh('sign_lift', 'LIFT · KOMMANDODECK', mat_emit('glow_sign_au', '#9fe0ff', 8), 0.18, (0, -8.6, 3.3), rot=(R(90), 0, R(180))))
    point_light('fill1', (0, 0, 3.6), 80, '#cfe0ff', 1.0)
    for k in range(6):
        a = R(60 * k)
        point_light(f'up{k}', (8.5 * math.cos(a), 8.5 * math.sin(a), 0.3), 35, '#ffd8b0', 0.2)
    area_light('saturnshine', (0, 6, 7), (R(-50), 0, 0), 8, 250, '#ffe2b8')
    marker('spawn', 'default', (0, -5.6, 0), R(90))
    INFO['window_dir'] = b2t((0, 1, 0.3))
    return S, Gl, Gs, X


# =============================================================================== the continuous deck
# Room placement in Blender world coordinates: (translation, rotation about Z in degrees).
LAYOUT = {'bruecke': ((0.0, 0.0, 0.0), 0), 'bar': ((-28.0, -3.25, 0.0), 0), 'kabine': ((-20.0, -15.05, 0.0), 180),
          'hangar': ((45.0, -11.0, 0.0), 0), 'aussicht': ((21.0, 14.1, 17.0), 0)}
LIFT = dict(x=21.0, y=5.5, z0=0.0, z1=17.0, r=1.45)


def hull_box(name, mat, x0, x1, y0, y1, z0, z1, cuts):
    """Outer skin of a module (faces point outwards, invisible from inside). Doorways are cut out."""
    b = box(name, mat, (x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    apply_all(b)
    for i, (cx, cy, cz, sx, sy, sz) in enumerate(cuts):
        if x0 - 1 < cx < x1 + 1 and y0 - 1 < cy < y1 + 1 and z0 - 1 < cz < z1 + 1:
            c = box(f'{name}_cut{i}', mat, (sx, sy, sz), (cx, cy, cz))
            md = b.modifiers.new('cut', 'BOOLEAN'); md.object = c; md.operation = 'DIFFERENCE'; md.solver = 'EXACT'
            apply_all(b)
            bpy.data.objects.remove(c)
    return b


@room
def deck():
    """Corridors that join all rooms into one walkable deck: the Ringgang (bar, quarters), the hangar
    corridor and the lift lobby with the glass lift up to the observation dome. Also the station's outer skin."""
    floor = mat_floor('floor_dk', '#2c2f33', 1.5)
    wallm = mat_wall('wall_dk', '#8e9196', '#72767c', scale=1.2, dirt=0.5)
    trim = mat_metal('trim_dk', '#5d6064', 0.4, metal=0.9, scale=2)
    dark = mat_rubber('dark_dk', '#18191b')
    hazard = mat_paint('haz_dk', '#c8901a', wear=0.6, dirt=0.4, stripe=('z', 0.0, 50.0), stripe_color='#d8a020', scale=2, panel=0.0)
    led_w = light_mat('led_dk_warm', '#ffd8a8', 16)
    led_c = light_mat('led_dk_cool', '#a8d8ff', 14)
    glass = mat_glass('glass_dk'); glass.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 1.0
    hullm = mat_simple('hull_ext', '#4a4e55', 0.55, 0.5)
    S, Gl, Gs, X = [], [], [], []
    INFO['interior'] = None
    sgn = lambda t, col: mat_emit('glow_sign_dk_' + col.strip('#'), col, 8)
    # ---------------------------------------------------------------- Ringgang (x -35.8..-2.2, y -12.9..-9.4)
    RX0, RX1, H = -35.8, -2.2, 3.4
    S.append(box('rg_floor', floor, (RX1 - RX0, 3.5, 0.2), ((RX0 + RX1) / 2, -11.15, -0.1)))
    S.append(box('rg_ceil', wallm, (RX1 - RX0, 3.5, 0.2), ((RX0 + RX1) / 2, -11.15, H + 0.1)))
    al = lambda x: x - RX0
    S += wall('rgN', wallm, (RX0, -9.55), (RX1, -9.55), H, openings=[(al(-33), 2.4, 0, 3.0), (al(-10.5), 2.8, 0, 3.3), (al(-5.0), 2.4, 0, 3.2)])
    # thin south wall in front of the quarters (cabin 4-117's own wall sits right behind it)
    S += wall('rgS', wallm, (RX1, -12.56), (RX0, -12.56), H, thick=0.12, openings=[(RX1 - (-20.0), 1.0, 0, 2.1)])
    S += wall('rgW', wallm, (RX0 + 0.1, -12.9), (RX0 + 0.1, -9.4), H)
    S += wall('rgE', wallm, (RX1 - 0.1, -9.4), (RX1 - 0.1, -12.9), H)
    # jambs filling the gap between the Ringgang wall and the Kommandodeck wall at its two doors
    for x, w, h in ((-10.5, 2.8, 3.3), (-5.0, 2.4, 3.2)):
        for sx in (-1, 1):
            S.append(box(f'rg_jamb{x}{sx}', trim, (0.2, 0.42, h), (x + sx * (w / 2 + 0.1), -9.28, h / 2)))
        S.append(box(f'rg_lintel{x}', trim, (w + 0.4, 0.42, H - h), (x, -9.28, h + (H - h) / 2)))
    for sx in (-1, 1):
        S.append(box(f'rg_jambbar{sx}', trim, (0.2, 0.2, 3.0), (-33 + sx * 1.3, -9.4, 1.5)))
    # wainscot, baseboard LEDs, ceiling lights, ducts
    S.append(box('rg_base_n', led_c, (RX1 - RX0 - 0.4, 0.03, 0.03), ((RX0 + RX1) / 2, -9.7, 0.06)))
    S.append(box('rg_base_s', led_c, (RX1 - RX0 - 0.4, 0.03, 0.03), ((RX0 + RX1) / 2, -12.47, 0.06)))
    for x in range(-34, -2, 4):
        S.append(box(f'rg_light{x}', led_w, (1.6, 0.4, 0.03), (x + 0.5, -11.15, H - 0.01)))
        S.append(box(f'rg_rib{x}', trim, (0.25, 3.3, 0.18), (x - 1.5, -11.15, H - 0.09)))
    for k, y in enumerate((-9.95, -12.35)):
        S.append(cyl(f'rg_duct{k}', trim, 0.11, RX1 - RX0 - 0.4, ((RX0 + RX1) / 2, y, H - 0.35), rot=(0, R(90), 0), n=12))
    for x in range(-34, -2, 8):
        area_light(f'rg_al{x}', (x + 2, -11.15, H - 0.05), (0, 0, 0), 1.2, 140, '#ffe2c0', size_y=0.6)
    # neighbouring quarters (locked) along the south wall + our cabin 4-117
    for k, x in enumerate((-32.5, -28.5, -24.5, -15.5, -11.5, -7.5, -4.0)):
        num = f'4-{109 + 2 * k + (2 if x > -20 else 0)}'
        S.append(box(f'cab_door{k}', trim, (1.0, 0.06, 2.1), (x, -12.44, 1.05), bevel=0.01))
        S.append(box(f'cab_frame{k}', dark, (1.3, 0.06, 2.3), (x, -12.47, 1.15)))
        Gl.append(box(f'cab_led{k}', mat_emit('glow_lock_red', '#ff3a2a', 6), (0.05, 0.02, 0.05), (x + 0.62, -12.4, 1.2)))
        Gl.append(text_mesh(f'cab_num{k}', num, sgn('', '#9fe0ff'), 0.16, (x, -12.42, 2.45), rot=(R(90), 0, R(180))))
    Gl.append(text_mesh('cab_num_own', '4-117', sgn('', '#ffd36a'), 0.18, (-20, -12.42, 2.6), rot=(R(90), 0, R(180))))
    Gl.append(box('cab_led_own', mat_emit('glow_lock_green', '#3aff6a', 6), (0.05, 0.02, 0.05), (-19.38, -12.42, 1.2)))
    # signs on the north wall (read from inside the corridor)
    Gl.append(text_mesh('rg_sign_bar', 'CASSINI-SPALT', mat_emit('glow_neon_pink', '#ff4ac8', 10), 0.24, (-33, -9.4, 3.12), rot=(R(90), 0, 0)))
    Gl.append(text_mesh('rg_sign_hub', 'KOMMANDODECK', sgn('', '#9fe0ff'), 0.16, (-10.5, -9.08, 3.36 - 0.02), rot=(R(90), 0, 0)))
    Gl.append(text_mesh('rg_sign_hub2', 'KOMMANDODECK', sgn('', '#9fe0ff'), 0.16, (-5.0, -9.08, 3.3), rot=(R(90), 0, 0)))
    Gl.append(text_mesh('rg_title', 'RINGGANG · DECK 4 · QUARTIERE 4-109 BIS 4-123', sgn('', '#9fe0ff'), 0.14, (-24.5, -9.43, 2.75), rot=(R(90), 0, 0)))
    # props: benches, vending machine, plants
    for x in (-26.5, -13.5):
        S.append(box(f'rg_bench{x}', trim, (1.8, 0.45, 0.42), (x, -9.95, 0.21), bevel=0.03))
    S.append(box('vending', trim, (0.9, 0.7, 2.0), (-17.2, -9.95, 1.0), bevel=0.03))
    Gl.append(box('vending_front', mat_emit('glow_vend', '#ffb060', 4), (0.75, 0.02, 1.2), (-17.2, -10.31, 1.25)))
    Gl.append(text_mesh('vending_txt', 'KAFFEE · 3 Cr', sgn('', '#fff2d0'), 0.08, (-17.2, -10.33, 1.95), rot=(R(90), 0, 0)))
    plant_dk = mat_simple('plant_dk', '#2f5a2a', 0.7)
    for x in (-30.5, -6.8):
        S.append(cyl(f'rg_pot{x}', trim, 0.3, 0.6, (x, -9.95, 0.3), rot=(0, 0, 0), n=20))
        S.append(plant(f'rg_fern{x}', plant_dk, (x, -9.95, 0.6), n=16, length=0.7, seed=int(-x)))
    # ---------------------------------------------------------------- hangar corridor (x 15.125..22.875, y -3.5..-0.5)
    HX0, HX1, HH = 15.125, 22.875, 3.6
    S.append(box('hc_floor', floor, (HX1 - HX0, 3.5, 0.2), ((HX0 + HX1) / 2, -2.0, -0.1)))
    S.append(box('hc_ceil', wallm, (HX1 - HX0, 3.5, 0.2), ((HX0 + HX1) / 2, -2.0, HH + 0.1)))
    S += wall('hcN', wallm, (HX0, -0.375), (HX1, -0.375), HH)
    S += wall('hcS', wallm, (HX1, -3.625), (HX0, -3.625), HH)
    S.append(box('hc_haz_n', hazard, (HX1 - HX0, 0.03, 0.5), ((HX0 + HX1) / 2, -0.5, 0.25)))
    S.append(box('hc_haz_s', hazard, (HX1 - HX0, 0.03, 0.5), ((HX0 + HX1) / 2, -3.5, 0.25)))
    S.append(box('hc_lintel_h', trim, (0.25, 3.25, HH - 3.2), (HX1 - 0.05, -2.0, 3.2 + (HH - 3.2) / 2)))
    for y in (-3.4, -0.6):    # the hangar doorway is narrower than the corridor
        S.append(box(f'hc_cap{y}', wallm, (0.08, 0.22, HH), (HX1 - 0.04, y, HH / 2)))
    S.append(box('hc_lintel_w', trim, (0.1, 3.25, HH - 3.4), (HX0 + 0.05, -2.0, 3.4 + (HH - 3.4) / 2)))
    for x in (17.0, 19.5, 22.0):
        S.append(box(f'hc_light{x}', led_c, (1.2, 0.5, 0.03), (x, -2.0, HH - 0.01)))
    area_light('hc_al', (19.0, -2.0, HH - 0.05), (0, 0, 0), 2.0, 160, '#d8e8ff', size_y=0.8)
    Gl.append(text_mesh('hc_sign', 'HANGAR 7 · BUCHT C', sgn('', '#ffd36a'), 0.22, (19.0, -0.52, 2.6), rot=(R(90), 0, R(180))))
    Gl.append(text_mesh('hc_sign2', 'ACHTUNG · DRUCKSCHOTT', sgn('', '#ffd36a'), 0.14, (19.0, -3.48, 2.6), rot=(R(90), 0, 0)))
    # ---------------------------------------------------------------- lift corridor + lobby
    L = LIFT
    S.append(box('lc_floor', floor, (22.8 - 15.1, 3.9, 0.2), ((22.8 + 15.1) / 2, 5.5, -0.1)))
    S += wall('lcN', wallm, (15.1, 6.825), (19.4, 6.825), 3.2)
    S += wall('lcS', wallm, (19.4, 4.175), (15.1, 4.175), 3.2)
    S.append(box('lc_ceil', wallm, (19.4 - 15.1, 2.9, 0.2), ((19.4 + 15.1) / 2, 5.5, 3.3)))
    S += wall('lbN', wallm, (19.3, 7.425), (22.8, 7.425), 3.2)
    S += wall('lbS', wallm, (22.8, 3.575), (19.3, 3.575), 3.2)
    S += wall('lbE', wallm, (22.7, 7.5), (22.7, 3.5), 3.2, thick=0.2)
    S += wall('lbWn', wallm, (19.4, 6.7), (19.4, 7.55), 3.2)
    S += wall('lbWs', wallm, (19.4, 3.45), (19.4, 4.3), 3.2)
    lceil = box('lb_ceil', wallm, (3.5, 4.1, 0.2), ((19.3 + 22.8) / 2, 5.5, 3.3))
    cutc = cyl('lb_cut', wallm, 1.66, 1.0, (L['x'], L['y'], 3.3), rot=(0, 0, 0), n=40)
    md = lceil.modifiers.new('hole', 'BOOLEAN'); md.object = cutc; md.operation = 'DIFFERENCE'
    apply_all(lceil); bpy.data.objects.remove(cutc)
    S.append(lceil)
    S.append(box('lc_light', led_c, (2.0, 0.4, 0.03), (17.2, 5.5, 3.19)))
    area_light('lc_al', (17.2, 5.5, 3.15), (0, 0, 0), 1.6, 110, '#d8e8ff', size_y=0.6)
    Gl.append(text_mesh('lc_sign', 'AUSSICHTSKUPPEL · LIFT', sgn('', '#9fe0ff'), 0.16, (17.2, 6.68, 2.6), rot=(R(90), 0, R(180))))
    # glass lift shaft from the lobby floor up to the dome floor
    S.append(lathe('shaft_base', [(-0.02, 1.62), (0.02, 1.62), (0.02, 1.85), (-0.02, 1.85)], trim, n=48))
    S[-1].rotation_euler = (R(90), 0, 0); S[-1].location = (L['x'], L['y'], 0.0)
    for zc in (3.25, 6.0, 8.7, 11.4, 14.1, 16.6):
        S.append(lathe(f'shaft_ring{zc}', [(-0.08, 1.62), (0.08, 1.62), (0.08, 1.74), (-0.08, 1.74)], trim, n=48))
        S[-1].rotation_euler = (R(90), 0, 0); S[-1].location = (L['x'], L['y'], zc)
    for k, a in enumerate((45, 135, 225, 315)):
        S.append(box(f'shaft_rail{k}', trim, (0.1, 0.1, L['z1'] - 0.3), (L['x'] + 1.68 * math.cos(R(a)), L['y'] + 1.68 * math.sin(R(a)), (L['z1'] - 0.3) / 2)))
    tube = lathe('glass_shaft', [(3.35, 1.6), (16.6, 1.6)], glass, n=48, cap=False)
    tube.rotation_euler = (R(90), 0, 0); tube.location = (L['x'], L['y'], 0.0)
    Gs.append(tube)
    for k in range(8):                       # ground floor enclosure, open to the west (door is dynamic)
        a = R(45 * k + 22.5)
        if math.cos(a) < -0.5:
            continue
        Gs.append(box(f'glass_shaftlow{k}', glass, (1.2, 0.03, 3.15), (L['x'] + 1.6 * math.cos(a), L['y'] + 1.6 * math.sin(a), 1.6), rot=(0, 0, a + R(90))))
    # ---------------------------------------------------------------- outer skin (exported, not baked)
    cuts = [(-33, -9.4, 1.5, 2.4, 1.6, 3.0), (-10.5, -9.28, 1.65, 2.8, 1.6, 3.3), (-5.0, -9.28, 1.6, 2.4, 1.6, 3.2),
            (-20, -12.75, 1.05, 1.0, 1.6, 2.1), (15.0, -2.0, 1.7, 1.6, 3.0, 3.4), (23.0, -2.0, 1.6, 1.6, 2.6, 3.2),
            (15.0, 5.5, 1.6, 1.6, 2.4, 3.2), (L['x'], L['y'], 16.0, 3.3, 3.3, 4.0)]
    # (rooms keep their own baked outer walls and roofs; only the dome's underside needs a skin)
    under = cyl('hull_dome', hullm, 11.4, 0.3, (21.0, 14.1, 16.6), rot=(0, 0, 0), n=64)
    md = under.modifiers.new('hole', 'BOOLEAN'); md.object = cyl('cutd', hullm, 1.66, 1.0, (21.0, 5.5, 16.6), rot=(0, 0, 0), n=40); md.operation = 'DIFFERENCE'
    apply_all(under); bpy.data.objects.remove(bpy.data.objects['cutd'])
    X.append(under)
    # ---------------------------------------------------------------- metadata for the runtime
    INFO['layout'] = {k: {'pos': b2t(v[0]), 'rotY': math.radians(v[1])} for k, v in LAYOUT.items()}
    INFO['lift'] = {'pos': b2t((L['x'], L['y'], 0.0)), 'y0': L['z0'], 'y1': L['z1'], 'r': L['r']}
    def door(id_, pos, normal, w, h, label, kind='door', level=None):
        d = {'id': id_, 'pos': b2t(pos), 'normal': b2t(normal), 'w': w, 'h': h, 'label': label, 'kind': kind}
        if level is not None:
            d['level'] = level
        INFO.setdefault('doors', []).append(d)
    door('bar', (-33, -9.4, 0), (0, 1, 0), 2.4, 3.0, 'Bar „Cassini-Spalt“')
    door('hub_bar', (-10.5, -9.28, 0), (0, 1, 0), 2.8, 3.3, 'Kommandodeck')
    door('hub_kab', (-5.0, -9.28, 0), (0, 1, 0), 2.4, 3.2, 'Kommandodeck')
    door('kabine', (-20, -12.75, 0), (0, 1, 0), 1.0, 2.1, 'Kabine 4-117')
    door('hub_hangar', (15.0, -2.0, 0), (1, 0, 0), 3.0, 3.4, 'Hangar 7', kind='heavy')
    door('hangar', (23.0, -2.0, 0), (1, 0, 0), 2.6, 3.2, 'Hangar 7', kind='heavy')
    door('hub_lift', (15.0, 5.5, 0), (1, 0, 0), 2.4, 3.2, 'Lift')
    door('lift_low', (L['x'] - 1.6, L['y'], 0), (1, 0, 0), 1.3, 2.6, 'Lift', kind='lift', level=0)
    door('lift_high', (L['x'], L['y'] + 1.6, L['z1']), (0, 1, 0), 1.3, 2.6, 'Lift', kind='lift', level=1)
    for x in (-30, -24, -16, -9, -4):
        marker('walk', 'rg', (x, -11.0, 0))
    marker('spawn', 'default', (-14.0, -11.0, 0), R(0))
    marker('crew', 'rg0', (-13.6, -10.45, 0), R(-90), seated=True)
    marker('crew', 'hc0', (21.2, -1.0, 0), R(-120), seated=False)
    INFO['window_dir'] = b2t((0, 1, 0))
    return S, Gl, Gs, X


# =============================================================================== overview render (menu)

def overview(samples=256):
    """Cycles beauty render of the bridge from a high corner + hotspot rectangles."""
    S, Gl, Gs, X = bruecke()
    setup_world_space(strength=0.9, saturn=True, sat_dir=(0.897, 0.126, -0.423), sat_dist=2600, sat_size=420)
    sc = swlib.cycles(samples=samples, w=1920, h=1080, transform='AgX', look='AgX - Punchy', denoise=True, exposure=0.35)
    sc.cycles.max_bounces = 8
    # light haze
    vol = swlib.new_mat('haze'); vol.node_tree.nodes.clear(); vg = G(vol.node_tree)
    pv = vg.node('ShaderNodeVolumePrincipled'); pv.inputs['Density'].default_value = 0.012
    out = vg.node('ShaderNodeOutputMaterial'); vg.l.new(pv.outputs[0], out.inputs['Volume'])
    hz = box('haze_box', vol, (29.5, 17.5, 7.8), (0, 0, 3.95))
    cam_d = bpy.data.cameras.new('ov_cam'); cam_d.lens = 18; cam_d.clip_end = 10000
    cam = bpy.data.objects.new('ov_cam', cam_d); sc.collection.objects.link(cam)
    # cutaway: hide ceiling structure from the camera (it still casts light), make the window glass invisible
    for o in bpy.data.objects:
        if o.name == 'ceiling' or o.name.startswith('beam') or o.name.startswith('trough'):
            o.visible_camera = False
    gm = bpy.data.materials.get('glass_br')
    if gm:
        bsdf = gm.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Transmission Weight'].default_value = 1.0; bsdf.inputs['Roughness'].default_value = 0.0
        bsdf.inputs['Coat Weight'].default_value = 0.0; bsdf.inputs['IOR'].default_value = 1.0
        bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
    cam.location = (-13.0, 6.0, 12.5)
    target = Vector((4.0, -6.0, 0.0))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    # screens get placeholder emission for the render
    outdir = swlib.out('ui', 'x').rsplit(os.sep, 1)[0]
    path = os.path.join(outdir, 'overview.jpg')
    swlib.save_render(path, fmt='JPEG', quality=90)
    # hotspot rectangles
    from bpy_extras.object_utils import world_to_camera_view
    hs = []
    for h in INFO.get('hotspots', []):
        xs, ys = [], []
        for on in h['objs']:
            o = bpy.data.objects.get(on)
            if not o:
                continue
            for c in o.bound_box:
                w = o.matrix_world @ Vector(c)
                v = world_to_camera_view(sc, cam, w)
                if v.z > 0:
                    xs.append(v.x); ys.append(1 - v.y)
        if xs:
            hs.append({'id': h['id'], 'label': h['label'], 'x0': max(0, min(xs)), 'x1': min(1, max(xs)), 'y0': max(0, min(ys)), 'y1': min(1, max(ys))})
    # holo table + window as extra hotspots
    def rect_of(points):
        vs = [world_to_camera_view(sc, cam, Vector(p)) for p in points]
        xs = [v.x for v in vs]; ys = [1 - v.y for v in vs]
        return max(0, min(xs)), min(1, max(xs)), max(0, min(ys)), min(1, max(ys))
    with open(os.path.join(outdir, 'overview.json'), 'w') as f:
        json.dump({'hotspots': hs}, f, indent=1)
    return path


# =============================================================================== main

if __name__ != 'interiors':  # executed via the bridge (not imported)
    name = BL_ARGS[0]
    flags = BL_ARGS[1:]
    samples = int(flags[flags.index('--samples') + 1]) if '--samples' in flags else 384
    swlib.fresh(); swship.MATS.clear(); INFO.clear()
    swship.Q.update({'bevel': 4, 'ao': 6})
    for l in list(bpy.data.lights):
        bpy.data.lights.remove(l)
    res = {}
    if name == 'overview':
        res['render'] = overview(samples)
    else:
        S, Gl, Gs, X = ROOMS[name]()
        outdir = swlib.out('rooms', name, 'x').rsplit(os.sep, 1)[0]
        if '--preview-only' in flags:
            setup_world_space(strength=0.6, saturn=False)
            sc = swlib.cycles(samples=64, w=1280, h=720, transform='AgX', denoise=True)
            cam_d = bpy.data.cameras.new('pv'); cam_d.lens = 16
            cam = bpy.data.objects.new('pv', cam_d); sc.collection.objects.link(cam)
            sp = [m for m in INFO['markers'] if m['kind'] == 'spawn'][0]
            p = sp['pos']; d = sp['dir']
            cam.location = (p[0], -p[2], 1.7)
            tgt = Vector((p[0] + d[0] * 5, -p[2] - d[2] * 5, 1.5))
            cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.camera = cam
            res['preview'] = swlib.save_render(os.path.join(outdir, 'preview.jpg'), fmt='JPEG')
        else:
            setup_world_space(strength=0.35, saturn=False)
            res['glb'] = bake_room(name, S, Gl, Gs, X, outdir, size={'kabine': 3072, 'bar': 3072, 'aussicht': 3072, 'deck': 4096}.get(name, 4096), samples=samples)
    result = res
