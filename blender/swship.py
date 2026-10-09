"""SpaceWing ship kit: procedural hull geometry, materials, PBR bake and GLB export.
Conventions (Blender): nose = +Y, up = +Z, right = +X, metres. glTF export turns this into three.js -Z forward."""
import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
import swlib
from swlib import G, hexc

MATS = {}   # material name -> dict of channel sockets


# ====================================================================== geometry

def _obj_from_bm(bm, name, mat=None, coll=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(ob)
    if mat:
        me.materials.append(bpy.data.materials[mat] if isinstance(mat, str) else mat)
    return ob


def superellipse(n, w, h, e=2.0, flat=1.0, top=1.0):
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        c, s = math.cos(t), math.sin(t)
        x = w / 2 * math.copysign(abs(c) ** (2 / e), c)
        z = h / 2 * math.copysign(abs(s) ** (2 / e), s)
        z *= top if z > 0 else flat
        pts.append((x, z))
    return pts


def loft(name, sections, mat, n=32, cap_start=True, cap_end=True, sharp=35):
    """sections: list of dicts {y, w, h, z=0, x=0, e=2, flat=1, top=1}. Builds a closed hull along +Y."""
    bm = bmesh.new()
    rings = []
    for s in sections:
        pts = superellipse(n, max(s['w'], 1e-4), max(s['h'], 1e-4), s.get('e', 2.0), s.get('flat', 1.0), s.get('top', 1.0))
        ring = [bm.verts.new((s.get('x', 0) + px, s['y'], s.get('z', 0) + pz)) for px, pz in pts]
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap_start:
        bm.faces.new(list(reversed(rings[0])))
    if cap_end:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj_from_bm(bm, name, mat)
    smooth(ob, sharp)
    return ob


def wing(name, mat, root_y, root_chord, tip_chord, span, sweep, dihedral=0.0, thick=0.25, x0=0.6, z0=0.0,
         sections=6, mirror=True, tip_thick=None, twist=0.0):
    """Lofted wing along +X. root at x0. sweep = y offset of tip leading edge (negative = swept back)."""
    bm = bmesh.new()
    rings = []
    prof = []
    m = 10
    for i in range(m):
        t = i / (m - 1)
        prof.append((t, math.sin(math.pi * t) ** 0.7))
    for k in range(sections + 1):
        f = k / sections
        chord = root_chord + (tip_chord - root_chord) * f
        th = (thick + ((tip_thick if tip_thick is not None else thick * 0.5) - thick) * f) * chord * 0.5
        lead = root_y + root_chord / 2 + sweep * f
        x = x0 + span * f
        z = z0 + dihedral * f
        ring = []
        for t, s in prof:  # top surface, leading -> trailing
            ring.append(bm.verts.new((x, lead - t * chord, z + s * th)))
        for t, s in reversed(prof[1:-1]):  # bottom
            ring.append(bm.verts.new((x, lead - t * chord, z - s * th * 0.6)))
        rings.append(ring)
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], b[i], b[j], a[j]))
    bm.faces.new(rings[0]); bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj_from_bm(bm, name, mat)
    smooth(ob, 40)
    if mirror:
        mirror_x(ob)
    return ob


def lathe(name, profile, mat, n=32, axis_pos=(0, 0, 0), cap=True, rot=None):
    """profile: list of (y, r) along +Y. Builds a solid of revolution around a Y-parallel axis."""
    bm = bmesh.new()
    rings = []
    for y, r in profile:
        ring = []
        for i in range(n):
            t = 2 * math.pi * i / n
            ring.append(bm.verts.new((r * math.cos(t), y, r * math.sin(t))))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap:
        bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj_from_bm(bm, name, mat)
    if rot:
        ob.rotation_euler = rot
    ob.location = axis_pos
    smooth(ob, 50)
    return ob


def box(name, mat, size, loc, rot=(0, 0, 0), bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    ob = _obj_from_bm(bm, name, mat)
    ob.location = loc; ob.rotation_euler = rot
    if bevel > 0:
        md = ob.modifiers.new('bev', 'BEVEL'); md.width = bevel; md.segments = 2; md.limit_method = 'ANGLE'
    return ob


def cyl(name, mat, r, length, loc, rot=(math.pi / 2, 0, 0), n=20, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=n, radius1=r, radius2=r if r2 is None else r2, depth=length)
    ob = _obj_from_bm(bm, name, mat)
    ob.location = loc; ob.rotation_euler = rot
    smooth(ob, 40)
    return ob


def sphere(name, mat, radius, loc, scale=(1, 1, 1), seg=32, rings=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=radius)
    ob = _obj_from_bm(bm, name, mat)
    ob.location = loc; ob.scale = scale
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def smooth(ob, angle_deg=35):
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(angle_deg))
    except Exception:
        pass


def mirror_x(ob):
    md = ob.modifiers.new('mir', 'MIRROR')
    md.use_axis[0] = True
    md.use_clip = False
    return md


def apply_all(ob):
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        for md in list(ob.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=md.name)
            except Exception as ex:
                print('modifier apply failed', ob.name, md.name, ex)
    # bake transforms into mesh
    ob.data.transform(ob.matrix_basis)
    ob.matrix_basis = Matrix.Identity(4)


def empty(name, loc, rot=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.location = loc; e.rotation_euler = rot
    e.empty_display_size = 0.3
    bpy.context.scene.collection.objects.link(e)
    return e


def greebles(target, mat, count=60, size=(0.15, 0.6), seed=1, zmin=-99, region=None, height=(0.03, 0.12)):
    """Scatter small boxes on the surface of target (raycast from random directions)."""
    rnd = random.Random(seed)
    dg = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(target, dg)
    bb = [target.matrix_world @ Vector(c) for c in target.bound_box]
    mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    ctr = (mn + mx) / 2
    made = []
    tries = 0
    while len(made) < count and tries < count * 20:
        tries += 1
        p = Vector((rnd.uniform(mn.x, mx.x), rnd.uniform(mn.y, mx.y), rnd.uniform(mn.z, mx.z)))
        d = Vector((rnd.uniform(-1, 1), 0, rnd.uniform(-0.3, 1))).normalized()
        origin = Vector((p.x, p.y, ctr.z)) + d * 50
        hit, nrm, idx, dist = tree.ray_cast(origin, -d)
        if hit is None or hit.z < zmin:
            continue
        if region and not region(hit):
            continue
        sx = rnd.uniform(*size); sy = rnd.uniform(*size) * rnd.choice((1, 1.5, 2.5)); sz = rnd.uniform(*height)
        rot = nrm.to_track_quat('Z', 'Y').to_euler()
        b = box(f"greeble_{target.name}_{len(made)}", mat, (sx, sy, sz), hit + nrm * sz * 0.3, rot)
        made.append(b)
    return made


# ====================================================================== materials

def _principled(g):
    return g.node('ShaderNodeBsdfPrincipled')


def _finish(mat, g, base, rough, metal, emit=None, bump_h=None, bump_strength=0.6, extra=None):
    bs = _principled(g)
    g._in(bs.inputs['Base Color'], base)
    g._in(bs.inputs['Roughness'], rough)
    g._in(bs.inputs['Metallic'], metal)
    if emit is not None:
        g._in(bs.inputs['Emission Color'], emit)
        bs.inputs['Emission Strength'].default_value = 1.0
    nrm = None
    if bump_h is not None:
        bp = g.node('ShaderNodeBump')
        bp.inputs['Strength'].default_value = bump_strength
        bp.inputs['Distance'].default_value = 0.02
        g._in(bp.inputs['Height'], bump_h)
        g.l.new(bp.outputs['Normal'], bs.inputs['Normal'])
        nrm = bp.outputs['Normal']
    out = g.node('ShaderNodeOutputMaterial')
    g.l.new(bs.outputs[0], out.inputs['Surface'])
    MATS[mat.name] = dict(base=base, rough=rough, metal=metal, emit=emit, out=out, bsdf=bs, g=g, mask=(extra or {}).get('mask', 0.0))
    return mat


def _panel_lines(g, p, nrm, scale, width):
    """Rectangular panel-line mask from a 3D grid, faded on axes parallel to the surface normal."""
    q = g.vscale(p, scale)
    qx, qy, qz = g.sep(q)
    nx, ny, nz = g.sep(nrm)
    # brick-offset rows so lines don't all align
    qy = g.add(qy, g.mul(g.math('FLOOR', qx), 0.5))
    qz = g.add(qz, g.mul(g.math('FLOOR', qy), 0.37))
    lines = None
    for qa, na in ((qx, nx), (qy, ny), (qz, nz)):
        f = g.math('FRACT', qa)
        d = g.mn(f, g.sub(1.0, f))
        ln = g.smooth(d, width, width * 0.35)
        ln = g.mul(ln, g.smooth(g.abs(na), 0.75, 0.55))
        lines = ln if lines is None else g.mx(lines, ln)
    cell = g.combine(g.math('FLOOR', qx), g.math('FLOOR', qy), g.math('FLOOR', qz))
    rnd, _ = g.white(cell)
    return lines, rnd


def mat_paint(name, color, color2=None, scale=1.0, wear=0.5, rust=0.0, dirt=0.5, metal=0.25, rough=0.45,
              stripe=None, stripe_color='#d8a21a', panel=1.0):
    """Painted hull plating: panel lines, per-panel tint, edge wear to bare metal, dirt in cavities, optional rust.
    stripe: (axis 'x'|'y'|'z', center, width) for a coloured band (in object space)."""
    m = swlib.new_mat(name); m.node_tree.nodes.clear(); g = G(m.node_tree)
    tc = g.node('ShaderNodeTexCoord')
    p = tc.outputs['Object']
    geo = g.node('ShaderNodeNewGeometry')
    nrm = geo.outputs['Normal']
    lines1, rnd1 = _panel_lines(g, p, nrm, 0.55 * scale, 0.012)
    lines2, rnd2 = _panel_lines(g, g.vadd(p, (0.31, 0.17, 0.53)), nrm, 1.7 * scale, 0.018)
    lines2 = g.mul(lines2, g.math('GREATER_THAN', rnd1, 0.45))
    lines = g.mul(g.mx(lines1, g.mul(lines2, 0.8)), panel)
    paint = g.rgb(color)
    if color2:
        paint = g.mix(g.math('GREATER_THAN', rnd1, 0.72), paint, g.rgb(color2))
    tint = g.add(0.9, g.mul(rnd2, 0.16))
    paint = g.mix(1.0, paint, g.combine(tint, tint, tint), blend='MULTIPLY')
    if stripe:
        ax, c0, wdt = stripe
        comp = g.sep(p)['xyz'.index(ax)]
        sm = g.smooth(g.abs(g.sub(comp, c0)), wdt * 0.5, wdt * 0.5 - 0.02)
        # hazard diagonal pattern
        px, py, pz = g.sep(p)
        diag = g.math('FRACT', g.mul(g.add(g.add(px, py), pz), 2.2))
        hz = g.math('GREATER_THAN', diag, 0.5)
        sc = g.mix(hz, g.rgb(stripe_color), g.rgb('#1b1b1b'))
        paint = g.mix(sm, paint, sc)
    # fine surface noise
    n1, _ = g.noise(g.vscale(p, 6.0 * scale), 1.0, 6, 0.6)
    n2, _ = g.noise(g.vscale(p, 0.8 * scale), 1.0, 4, 0.6)
    # edge wear via bevel normal deviation
    bev = g.node('ShaderNodeBevel'); bev.samples = 8
    bev.inputs['Radius'].default_value = 0.035
    edge = g.sub(1.0, g.dot(bev.outputs['Normal'], nrm))
    edge = g.clamp01(g.mul(edge, 18.0))
    wearm = g.clamp01(g.mul(g.mul(edge, g.add(0.4, n1)), wear * 1.6))
    wearm = g.mx(wearm, g.mul(g.smooth(n1, 0.72, 0.8), wear * 0.6))
    bare = g.mix(n1, g.rgb('#6d6e70'), g.rgb('#9a9b9c'))
    base = g.mix(wearm, paint, bare)
    # cavity dirt
    ao = g.node('ShaderNodeAmbientOcclusion'); ao.samples = 16; ao.only_local = True
    ao.inputs['Distance'].default_value = 0.6
    cav = g.sub(1.0, ao.outputs['AO'])
    dirtm = g.clamp01(g.mul(g.add(g.mul(cav, 1.6), g.mul(g.smooth(n2, 0.55, 0.8), 0.4)), dirt))
    px_, py_, pz_ = g.sep(p)
    streak, _ = g.noise(g.combine(g.mul(px_, 9.0 * scale), g.mul(py_, 0.7 * scale), g.mul(pz_, 9.0 * scale)), 1.0, 5, 0.6)
    dirtm = g.clamp01(g.add(dirtm, g.mul(g.smooth(streak, 0.55, 0.75), dirt * 0.45)))
    base = g.mix(g.mul(dirtm, 0.75), base, g.rgb('#2a241d'))
    base = g.mix(g.mul(lines, 0.85), base, g.rgb('#141414'))
    r = g.add(rough, g.mul(g.sub(n1, 0.5), 0.2))
    r = g.mix(wearm, g.combine(r, r, r), (0.32, 0.32, 0.32))
    r = g.sep(g.mix(dirtm, r, (0.85, 0.85, 0.85)))[0]
    mt = g.add(g.mul(wearm, 1.0 - metal), metal)
    if rust > 0:
        rn, _ = g.noise(g.vscale(p, 1.6 * scale), 1.0, 8, 0.7, dist=0.4)
        rustm = g.clamp01(g.mul(g.add(g.smooth(rn, 0.62 - rust * 0.3, 0.72), g.mul(edge, 0.8)), g.add(0.65, g.mul(cav, 2.0))))
        rustm = g.clamp01(g.mul(rustm, 1.0 + rust))
        rc = g.ramp(n1, [(0.2, '#3d1d0e'), (0.5, '#6e3416'), (0.8, '#9c5426')])
        base = g.mix(rustm, base, rc)
        r = g.add(r, g.mul(rustm, 0.4))
        mt = g.mul(mt, g.sub(1.0, rustm))
    h = g.add(g.mul(lines, -1.0), g.mul(n1, 0.15))
    return _finish(m, g, base, g.clamp01(r), g.clamp01(mt), bump_h=h, bump_strength=0.5, extra={'mask': g.sub(1.0, g.mx(wearm, lines))})


def mat_metal(name, color='#5b5d60', rough=0.35, metal=0.9, scale=1.0, grime=0.4):
    m = swlib.new_mat(name); m.node_tree.nodes.clear(); g = G(m.node_tree)
    tc = g.node('ShaderNodeTexCoord'); p = tc.outputs['Object']
    n1, _ = g.noise(g.vscale(p, 4.0 * scale), 1.0, 8, 0.6)
    brushed, _ = g.noise(g.combine(*[g.mul(c, f) for c, f in zip(g.sep(p), (40.0 * scale, 2.0 * scale, 40.0 * scale))]), 1.0, 4, 0.5)
    ao = g.node('ShaderNodeAmbientOcclusion'); ao.samples = 16; ao.only_local = True
    ao.inputs['Distance'].default_value = 0.4
    cav = g.sub(1.0, ao.outputs['AO'])
    base = g.mix(g.mul(n1, 0.3), g.rgb(color), g.rgb('#2b2b2b'))
    base = g.mix(g.clamp01(g.mul(cav, grime * 2)), base, g.rgb('#1a1612'))
    r = g.add(rough, g.mul(g.sub(brushed, 0.5), 0.15))
    return _finish(m, g, base, g.clamp01(r), metal, bump_h=g.mul(brushed, 0.05), bump_strength=0.2)


def mat_rubber(name, color='#202124', rough=0.75):
    m = swlib.new_mat(name); m.node_tree.nodes.clear(); g = G(m.node_tree)
    tc = g.node('ShaderNodeTexCoord'); p = tc.outputs['Object']
    n1, _ = g.noise(g.vscale(p, 10.0), 1.0, 6, 0.6)
    base = g.mix(g.mul(n1, 0.25), g.rgb(color), g.rgb('#3a3a3a'))
    return _finish(m, g, base, rough, 0.0, bump_h=g.mul(n1, 0.1), bump_strength=0.2)


def mat_emit(name, color, strength=8.0):
    """Unbaked: exported as a separate 'glow' mesh. Colour stored in the material for the runtime."""
    m = swlib.new_mat(name); m.node_tree.nodes.clear(); g = G(m.node_tree)
    em = g.emission(g.rgb(color), strength)
    g.output(em)
    m['glow_color'] = color
    return m


def mat_glass(name, color='#0e1620'):
    m = swlib.new_mat(name); m.node_tree.nodes.clear(); g = G(m.node_tree)
    bs = _principled(g)
    bs.inputs['Base Color'].default_value = hexc(color)
    bs.inputs['Roughness'].default_value = 0.05
    bs.inputs['Metallic'].default_value = 0.0
    bs.inputs['Coat Weight'].default_value = 1.0
    g.output(bs.outputs[0])
    return m


# ====================================================================== bake & export

def _ensure_bake_image(name, size, noncolor):
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color' if noncolor else 'sRGB'
    return img


def _set_active_image(obj, img):
    nodes = []
    for slot in obj.material_slots:
        mt = slot.material
        nt = mt.node_tree
        n = nt.nodes.get('__bake_target') or nt.nodes.new('ShaderNodeTexImage')
        n.name = '__bake_target'
        n.image = img
        for x in nt.nodes:
            x.select = False
        n.select = True
        nt.nodes.active = n
        nodes.append(n)
    return nodes


def _route(obj, channel):
    """Route a channel of each material into an emission shader on the material output."""
    for slot in obj.material_slots:
        info = MATS.get(slot.material.name)
        g = info['g']; out = info['out']
        for lk in list(out.inputs['Surface'].links):
            g.l.remove(lk)
        if channel == 'pbr':
            g.l.new(info['bsdf'].outputs[0], out.inputs['Surface'])
            continue
        src = info[channel]
        if channel == 'emit' and src is None:
            src = (0, 0, 0, 1)
        em = g.node('ShaderNodeEmission')
        em.inputs['Strength'].default_value = 1.0
        g._in(em.inputs['Color'], src)
        g.l.new(em.outputs[0], out.inputs['Surface'])


def _save_img(img, path, fmt='JPEG', quality=92):
    img.filepath_raw = path
    img.file_format = fmt
    try:
        img.save(filepath=path, quality=quality)
    except TypeError:
        img.save()


def bake_object(obj, outdir, size=2048, ao_samples=128, channels=('base', 'orm', 'normal', 'emit', 'mask')):
    sc = bpy.context.scene
    swlib.cycles(samples=16, transform='Standard', denoise=False)
    sc.render.bake.margin = 12
    sc.render.bake.use_clear = True
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    os.makedirs(outdir, exist_ok=True)
    res = {}
    import numpy as np

    def bake_emit(channel, noncolor):
        img = _ensure_bake_image('bake_' + channel, size, noncolor)
        _set_active_image(obj, img)
        _route(obj, channel)
        sc.cycles.samples = 4
        bpy.ops.object.bake(type='EMIT')
        return img

    def px(img):
        a = np.empty(size * size * 4, np.float32); img.pixels.foreach_get(a); return a.reshape(size, size, 4)

    if 'base' in channels:
        img = bake_emit('base', False)
        _save_img(img, os.path.join(outdir, 'base.jpg')); res['base'] = True
    if 'orm' in channels:
        r = px(bake_emit('rough', True)); m = px(bake_emit('metal', True))
        _route(obj, 'pbr')
        img = _ensure_bake_image('bake_ao', size, True)
        _set_active_image(obj, img)
        sc.cycles.samples = ao_samples
        bpy.ops.object.bake(type='AO')
        a = px(img)
        orm = np.stack([a[..., 0], r[..., 0], m[..., 0], np.ones_like(a[..., 0])], -1)
        out = _ensure_bake_image('bake_orm', size, True)
        out.pixels.foreach_set(orm.ravel())
        _save_img(out, os.path.join(outdir, 'orm.jpg')); res['orm'] = True
    if 'normal' in channels:
        _route(obj, 'pbr')
        img = _ensure_bake_image('bake_normal', size, True)
        _set_active_image(obj, img)
        sc.cycles.samples = 4
        sc.render.bake.normal_space = 'TANGENT'
        bpy.ops.object.bake(type='NORMAL')
        _save_img(img, os.path.join(outdir, 'normal.jpg'), quality=95); res['normal'] = True
    if 'emit' in channels and any(MATS[s.material.name]['emit'] is not None for s in obj.material_slots):
        img = bake_emit('emit', False)
        _save_img(img, os.path.join(outdir, 'emit.jpg')); res['emit'] = True
    if 'mask' in channels:
        img = bake_emit('mask', True)
        _save_img(img, os.path.join(outdir, 'mask.jpg'), quality=85); res['mask'] = True
    _route(obj, 'pbr')
    for s in obj.material_slots:
        n = s.material.node_tree.nodes.get('__bake_target')
        if n:
            s.material.node_tree.nodes.remove(n)
    return res


def join(objs, name):
    objs = [o for o in objs if o.type == 'MESH']
    if not objs:
        return None
    for o in objs:
        apply_all(o)
    ctx = dict(object=objs[0], active_object=objs[0], selected_objects=objs, selected_editable_objects=objs)
    with bpy.context.temp_override(**ctx):
        bpy.ops.object.join()
    ob = objs[0]
    ob.name = name; ob.data.name = name
    cleanup(ob)
    return ob


def cleanup(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    bmesh.ops.dissolve_degenerate(bm, dist=0.0005, edges=bm.edges)
    bm.to_mesh(ob.data); bm.free()
    ob.data.update()


def uv_unwrap(ob, margin=0.004):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    try:
        bpy.ops.uv.pack_islands(margin=margin, rotate=True)
    except Exception:
        pass
    bpy.ops.object.mode_set(mode='OBJECT')


def export_glb(objs, path):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_tangents=True, export_materials='PLACEHOLDER',
                              export_extras=True, export_cameras=False, export_lights=False)
    return path


def finalize_ship(ship_id, parts, empties, outdir_rel=('ships',), tex_size=2048, ao_samples=128):
    """parts: list of objects. Materials decide the group: glow (mat_emit), glass (mat_glass) or hull (baked)."""
    hull, glass, glow = [], [], []
    for o in parts:
        if o.type != 'MESH':
            continue
        mn = o.material_slots[0].material.name if o.material_slots else ''
        if mn.startswith('glow'):
            glow.append(o)
        elif mn.startswith('glass'):
            glass.append(o)
        else:
            hull.append(o)
    hull_ob = join(hull, 'hull')
    uv_unwrap(hull_ob)
    outdir = swlib.out(*outdir_rel, ship_id, 'x').rsplit(os.sep, 1)[0]
    bake_object(hull_ob, outdir, size=tex_size, ao_samples=ao_samples)
    final = [hull_ob]
    # glow parts: keep each glow colour as its own mesh
    groups = {}
    for o in glow:
        groups.setdefault(o.material_slots[0].material.name, []).append(o)
    for mname, objs in groups.items():
        j = join(objs, mname)
        j['glow_color'] = bpy.data.materials[mname].get('glow_color', '#ffffff')
        final.append(j)
    if glass:
        final.append(join(glass, 'glass'))
    for e in empties:
        final.append(e)
    path = os.path.join(outdir, 'model.glb')
    export_glb(final, path)
    return path, hull_ob


# ====================================================================== preview render

def studio_preview(path, objs_center=(0, 0, 0), dist=24.0, w=1600, h=900, samples=96, cam_dir=(1.0, 1.15, 0.55), lens=55, bg='#06080c'):
    sc = swlib.cycles(samples=samples, w=w, h=h, transform='AgX', look='AgX - Punchy', denoise=True)
    sc.world.color = (0, 0, 0)
    try:
        sc.world.use_nodes = True
    except Exception:
        pass
    nt = sc.world.node_tree
    nt.nodes.clear()
    wg = G(nt)
    lp = wg.node('ShaderNodeLightPath')
    b1 = wg.node('ShaderNodeBackground'); b1.inputs['Color'].default_value = hexc(bg)
    b2 = wg.node('ShaderNodeBackground')
    tc = wg.node('ShaderNodeTexCoord')
    _, _, gz = wg.sep(tc.outputs['Generated'])
    b2.inputs['Color'].default_value = (0.05, 0.06, 0.08, 1)
    wg._in(b2.inputs['Color'], wg.mix(wg.smooth(gz, 0.3, 0.9), hexc('#0a0b0d'), hexc('#3a4458')))
    b2.inputs['Strength'].default_value = 1.0
    mx = wg.node('ShaderNodeMixShader')
    wg.l.new(lp.outputs['Is Camera Ray'], mx.inputs[0])
    wg.l.new(b2.outputs[0], mx.inputs[1]); wg.l.new(b1.outputs[0], mx.inputs[2])
    wo = wg.node('ShaderNodeOutputWorld'); wg.l.new(mx.outputs[0], wo.inputs['Surface'])
    c = Vector(objs_center)
    d = Vector(cam_dir).normalized()
    cam_d = bpy.data.cameras.new('prev_cam'); cam_d.lens = lens; cam_d.clip_end = 5000
    cam = bpy.data.objects.new('prev_cam', cam_d); sc.collection.objects.link(cam)
    cam.location = c + d * dist
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    made = [cam]
    def light(name, kind, energy, loc, color=(1, 1, 1), size=5.0):
        ld = bpy.data.lights.new(name, kind); ld.energy = energy; ld.color = color
        if kind == 'AREA':
            ld.size = size
        if kind == 'SUN':
            ld.angle = math.radians(1.0)
        lo = bpy.data.objects.new(name, ld); sc.collection.objects.link(lo)
        lo.location = c + Vector(loc)
        lo.rotation_euler = (c - lo.location).to_track_quat('-Z', 'Y').to_euler()
        made.append(lo)
        return lo
    light('key', 'SUN', 4.0, (14, 6, 12), (1.0, 0.95, 0.88))
    light('rim', 'AREA', 4000, (-10, -14, 6), (0.55, 0.7, 1.0), 12)
    light('fill', 'AREA', 700, (-8, 10, -6), (1.0, 0.75, 0.45), 10)
    swlib.save_render(path, fmt='JPEG', quality=90)
    for o in made:
        bpy.data.objects.remove(o, do_unlink=True)
    return path
