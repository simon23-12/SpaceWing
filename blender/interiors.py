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
    """Delete faces that can never be seen from inside the room (outer wall skins, floor underside, roof)."""
    if not interior:
        return
    bm = bmesh.new(); bm.from_mesh(ob.data)
    kind = interior[0]
    dead = []
    for f in bm.faces:
        c = f.calc_center_median()
        if kind == 'box':
            x0, x1, y0, y1, z0, z1 = interior[1:]
            e = 0.03
            if c.x < x0 - e or c.x > x1 + e or c.y < y0 - e or c.y > y1 + e or c.z < z0 - e or c.z > z1 + e:
                dead.append(f)
        elif kind == 'dome':
            r0, z0 = interior[1:]
            if math.hypot(c.x, c.y) > r0 + 0.35 or c.z < z0 - 0.03:
                dead.append(f)
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
    doorsS = [(-10.5, 'BAR „CASSINI-SPALT“', 'bar', 2.8, 3.3), (-5.0, 'QUARTIERE', 'kabine', 2.4, 3.2)]
    S += wall('wS', wallm, (X1, Y0), (X0, Y0), H, openings=[(X1 - x, w, 0.0, h) for x, _, _, w, h in doorsS])
    def door(k, x, y, ang, label, target, dw, dh, inward):
        dpos = Vector((x, y, 0)) - inward * 0.2
        S.append(box(f'door{k}', hazard if target == 'hangar' else trim, (dw, 0.1, dh), (dpos.x, dpos.y, dh / 2), rot=(0, 0, ang)))
        S.append(box(f'doorframe{k}', dark, (dw + 0.6, 0.4, 0.3), (x, y, dh + 0.15), rot=(0, 0, ang)))
        for sx in (-1, 1):
            off = Vector((math.cos(ang), math.sin(ang), 0)) * (dw / 2 + 0.2) * sx
            S.append(box(f'doorjamb{k}{sx}', dark, (0.3, 0.4, dh), (x + off.x, y + off.y, dh / 2), rot=(0, 0, ang)))
        Gl.append(box(f'doorled{k}', mat_emit('glow_door', '#7fdcff', 6), (dw + 0.3, 0.05, 0.06), (x + inward.x * 0.25, y + inward.y * 0.25, dh + 0.35), rot=(0, 0, ang)))
        sign_col = '#ff5ad0' if target == 'bar' else '#ffd36a' if target == 'hangar' else '#9fe0ff'
        Gl.append(text_mesh(f'sign{k}', label, mat_emit('glow_sign_' + target, sign_col, 8), 0.38 if target != 'bar' else 0.34,
                            (x + inward.x * 0.25, y + inward.y * 0.25, dh + 0.9), rot=(R(90), 0, ang + R(180))))
        marker('door', target, (x + inward.x * 1.3, y + inward.y * 1.3, 0), math.atan2(-inward.y, -inward.x), label=label)
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
    doorsE = [(-2.0, 'HANGAR', 'hangar', 4.6, 4.8), (5.5, 'AUSSICHT', 'aussicht', 2.4, 3.2)]
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
                S += figure(f'pat{i}{k}', [coatA, coatB, coatC][(i + k) % 3], skin, (cx, cy, 0), rot=a + R(90), seated=True, hat=hat if k == 2 else None)
    # Mags' table = table 0 near the window
    marker('npc', 'mags', (-1.5, 3.8 + 0.85, 0), R(-90), seated=True)
    marker('npc', 'kix', (6.3, -0.5, 0), R(180))
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
    # door
    S.append(box('door', trim, (2.4, 0.1, 3.0), (-5.0, -6.2, 1.5)))
    Gl.append(box('door_led', mat_emit('glow_door', '#7fdcff', 6), (2.6, 0.05, 0.06), (-5.0, -5.85, 3.25)))
    marker('door', 'bruecke', (-5.0, -4.9, 0), R(-90), label='Zum Kommandodeck')
    marker('spawn', 'default', (-5.0, -4.6, 0), R(90))
    marker('terminal', 'bar_order', (4.2, -1.0, 0), R(0), label='Drink bestellen')
    INFO['window_dir'] = b2t((0, 1, 0))
    return S, Gl, Gs, X


@room
def kabine():
    floor = mat_floor('floor_cab', '#2c2e31', 3.0)
    wallm = mat_wall('wall_cab', '#8c8f93', '#73777c', scale=2.0, dirt=0.6)
    trim = mat_metal('trim_cab', '#6a6d72', 0.4, metal=0.8, scale=4)
    fabric = mat_simple('blanket', '#3d4a5c', 0.9)
    pillow = mat_simple('pillow', '#c8c4b8', 0.9)
    led = light_mat('led_cab', '#ffe0b8', 10)
    glass = mat_glass('glass_cab')
    S, Gl, Gs, X = [], [], [], []
    W, D, H = 3.2, 4.6, 2.5   # x [-1.6,1.6], y [-2.3, 2.3]
    INFO['interior'] = ('box', -1.6, 1.6, -2.3, 2.3, 0.0, H)
    S.append(box('floor', floor, (W, D, 0.1), (0, 0, -0.05)))
    S.append(box('ceil', wallm, (W, D, 0.1), (0, 0, H + 0.05)))
    S += wall('wN', wallm, (-1.6, 2.3), (1.6, 2.3), H, openings=[(1.6, 0.6, 1.2, 1.8)])
    Gs.append(cyl('glass_porthole', glass, 0.32, 0.04, (0, 2.3, 1.5), rot=(R(90), 0, 0), n=32))
    S.append(lathe('porthole_ring', [(-0.12, 0.33), (0.12, 0.33), (0.12, 0.42), (-0.12, 0.42)], trim, n=32))
    S[-1].location = (0, 2.3, 1.5)
    S += wall('wS', wallm, (1.6, -2.3), (-1.6, -2.3), H, openings=[(1.6, 1.0, 0, 2.1)])
    S += wall('wE', wallm, (1.6, 2.3), (1.6, -2.3), H)
    S += wall('wW', wallm, (-1.6, -2.3), (-1.6, 2.3), H)
    # bunk along west wall
    S.append(box('bunk', trim, (1.0, 2.1, 0.45), (-1.05, 1.0, 0.25), bevel=0.02))
    S.append(box('mattress', fabric, (0.95, 2.0, 0.16), (-1.05, 1.0, 0.55), bevel=0.05))
    S.append(box('pillow', pillow, (0.6, 0.35, 0.12), (-1.05, 1.8, 0.68), bevel=0.05))
    S.append(box('bunk_hood', trim, (1.05, 2.1, 0.06), (-1.05, 1.0, 1.9)))
    S.append(box('bunk_led', led, (0.03, 1.9, 0.03), (-0.56, 1.0, 1.86)))
    # locker + desk with terminal
    S.append(box('locker', trim, (0.6, 0.7, 2.1), (1.25, 1.8, 1.05), bevel=0.02))
    S.append(box('desk', trim, (0.6, 1.1, 0.06), (1.25, 0.4, 0.78)))
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    scr = bpy.context.active_object; scr.name = 'screen_kabine'
    scr.scale = (0.6, 0.38, 1); scr.rotation_euler = (R(80), 0, R(-90)); scr.location = (1.5, 0.4, 1.15)
    scr.data.materials.append(light_mat('screen_lit_cab', '#3a7fb0', 3))
    X.append(scr)
    S.append(box('photo', mat_simple('photo', '#d0c0a0', 0.6), (0.01, 0.2, 0.15), (1.55, -0.3, 1.5)))
    S.append(box('ceil_led', led, (0.6, 1.4, 0.02), (0, 0, H - 0.02)))
    point_light('cl', (0, 0.3, H - 0.3), 25, '#ffe0c0', 0.3)
    point_light('bl', (-1.0, 1.0, 1.7), 6, '#ffd0a0', 0.1)
    S.append(box('door', trim, (1.0, 0.1, 2.1), (0, -2.38, 1.05)))
    Gl.append(box('door_led', mat_emit('glow_door', '#7fdcff', 6), (1.1, 0.04, 0.04), (0, -2.2, 2.2)))
    marker('door', 'bruecke', (0, -1.9, 0), R(-90), label='Zum Kommandodeck')
    marker('terminal', 'kabine_terminal', (0.9, 0.4, 0), R(0), label='Terminal (Speichern · Logbuch)')
    marker('terminal', 'bett', (-0.6, 1.0, 0), R(180), label='Schlafen (neuer Tag)')
    marker('spawn', 'default', (0, -1.5, 0), R(90))
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
    S.append(box('door', hazard, (2.6, 0.12, 3.2), (-22.2, 9.0, 1.6), rot=(0, 0, R(90))))
    Gl.append(box('door_led', mat_emit('glow_door', '#7fdcff', 6), (0.05, 2.8, 0.06), (-21.8, 9.0, 3.45)))
    Gl.append(text_mesh('sign_hg', 'HANGAR 7 · BUCHT C', mat_emit('glow_sign_hg', '#ffd36a', 8), 1.2, (-21.8, 0, 10), rot=(R(90), 0, R(90))))
    marker('door', 'bruecke', (-20.5, 9.0, 0), R(180), label='Zum Kommandodeck')
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
    plant = mat_simple('plant', '#2f5a2a', 0.7)
    soil = mat_simple('soil', '#2a1e16', 0.95)
    led = light_mat('led_au', '#a8d8ff', 25)
    glass = mat_glass('glass_au'); glass.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 1.0
    S, Gl, Gs, X = [], [], [], []
    Rr = 11.0
    INFO['interior'] = ('dome', Rr, 0.0)
    S.append(cyl('floor', floor, Rr, 0.3, (0, 0, -0.15), rot=(0, 0, 0), n=96))
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
        for j in range(9):
            b = R(40 * j)
            S.append(sphere(f'leaf{k}{j}', plant, 0.35, (x + 0.45 * math.cos(b), y + 0.45 * math.sin(b), 1.0 + 0.2 * (j % 3)), scale=(1, 0.6, 1.4)))
    # lift at the south edge, so you enter looking across the dome
    S.append(cyl('lift', trim, 1.4, 3.0, (0, -8.6, 1.5), rot=(0, 0, 0), n=32))
    Gl.append(text_mesh('sign_lift', 'LIFT · KOMMANDODECK', mat_emit('glow_sign_au', '#9fe0ff', 8), 0.18, (0, -7.18, 2.4), rot=(R(90), 0, R(180))))
    S.append(box('lift_door', mat_rubber('dark_au'), (1.2, 0.05, 2.2), (0, -7.19, 1.1)))
    point_light('fill1', (0, 0, 3.6), 80, '#cfe0ff', 1.0)
    for k in range(6):
        a = R(60 * k)
        point_light(f'up{k}', (8.5 * math.cos(a), 8.5 * math.sin(a), 0.3), 35, '#ffd8b0', 0.2)
    area_light('saturnshine', (0, 6, 7), (R(-50), 0, 0), 8, 250, '#ffe2b8')
    marker('door', 'bruecke', (0, -6.4, 0), R(-90), label='Lift zum Kommandodeck')
    marker('spawn', 'default', (0, -5.6, 0), R(90))
    INFO['window_dir'] = b2t((0, 1, 0.3))
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
            res['glb'] = bake_room(name, S, Gl, Gs, X, outdir, size={'kabine': 2048, 'bar': 3072, 'aussicht': 3072}.get(name, 4096), samples=samples)
    result = res
