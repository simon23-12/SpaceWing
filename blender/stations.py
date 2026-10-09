"""Stations, rocks and the cockpit interior.
Usage: bl.py blender/stations.py cassini|small|rocks|cockpit [--preview-only]"""
import importlib, math, os, json, random
import bpy, bmesh
from mathutils import Vector, Matrix
import swlib, swship
importlib.reload(swlib); importlib.reload(swship)
from swship import loft, wing, lathe, box, cyl, sphere, empty, greebles, mirror_x, apply_all, smooth
from swship import mat_paint, mat_metal, mat_rubber, mat_emit, mat_glass

try:
    REPO
except NameError:
    REPO = swlib.REPO_PATH
swlib.init(REPO)
R = math.radians


def b2t(v):
    """Blender (x, y, z) -> three.js (x, z, -y)."""
    return [round(v[0], 3), round(v[2], 3), round(-v[1], 3)]


def torus_ring(name, mat, R0, w, h, segs=96, n=16, e=4.0):
    """Ring with superellipse cross-section around the Z axis."""
    bm = bmesh.new()
    rings = []
    prof = swship.superellipse(n, w, h, e)
    for i in range(segs):
        a = 2 * math.pi * i / segs
        ca, sa = math.cos(a), math.sin(a)
        ring = []
        for px, pz in prof:
            r = R0 + px
            ring.append(bm.verts.new((r * ca, r * sa, pz)))
        rings.append(ring)
    for i in range(segs):
        a, b = rings[i], rings[(i + 1) % segs]
        for k in range(n):
            j = (k + 1) % n
            bm.faces.new((a[k], a[j], b[j], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = swship._obj_from_bm(bm, name, mat)
    smooth(ob, 30)
    return ob


def bake_groups(groups, outdir, size=4096, ao=128):
    """groups: dict target_name -> list(objs) of baked parts. All are baked into one atlas, then split again."""
    all_objs = []
    for gname, objs in groups.items():
        for o in objs:
            apply_all(o)
        all_objs += [(gname, o) for o in objs if o.type == 'MESH']
    # tag faces with an integer attribute per group
    for gi, gname in enumerate(groups):
        for g2, o in all_objs:
            if g2 != gname:
                continue
            me = o.data
            attr = me.attributes.get('grp') or me.attributes.new('grp', 'INT', 'FACE')
            for i in range(len(me.polygons)):
                attr.data[i].value = gi
    objs = [o for _, o in all_objs]
    joined = swship.join(objs, 'bakeall')
    swship.uv_unwrap(joined, margin=0.002)
    swship.bake_object(joined, outdir, size=size, ao_samples=ao)
    # split by group attribute
    out = []
    names = list(groups)
    for gi, gname in enumerate(names):
        bm = bmesh.new(); bm.from_mesh(joined.data)
        lay = bm.faces.layers.int.get('grp')
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[lay] != gi], context='FACES')
        me = bpy.data.meshes.new(gname); bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new(gname, me)
        bpy.context.scene.collection.objects.link(ob)
        for s in joined.material_slots:
            me.materials.append(s.material)
        out.append(ob)
    bpy.data.objects.remove(joined, do_unlink=True)
    return out


def tube(name, mat, pts, r):
    out = []
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        d = b - a
        c = cyl(f'{name}_{i}', mat, r, d.length * 1.04, tuple((a + b) / 2), rot=(0, 0, 0), n=8)
        c.rotation_mode = 'QUATERNION'
        c.rotation_quaternion = d.to_track_quat('Z', 'Y')
        out.append(c)
    return out


def join_glow(objs, name, color):
    j = swship.join(objs, name)
    j['glow_color'] = color
    return j


# ======================================================================= Hochstation Cassini

def cassini():
    hull = mat_paint('hull_st', '#b9b7b0', color2='#a7a8a6', wear=0.35, rust=0.05, dirt=0.55, metal=0.35, rough=0.5, scale=0.12,
                     stripe=('z', 0.0, 8.0), stripe_color='#c98a1a')
    hull2 = mat_paint('hull_st2', '#8a8f95', color2='#7f8389', wear=0.4, dirt=0.6, metal=0.4, scale=0.18)
    metal = mat_metal('metal_st', '#6c6f73', 0.45, metal=0.8, scale=0.2)
    dark = mat_rubber('dark_st', '#18191b')
    solar = mat_metal('solar_st', '#14213a', 0.25, metal=0.6, scale=3.0, grime=0.1)
    win = mat_emit('glow_win', '#ffd9a0', 6)
    win2 = mat_emit('glow_win2', '#bfe0ff', 6)
    red = mat_emit('glow_blink_red', '#ff3020', 14)
    bay = mat_emit('glow_bay', '#6fd0ff', 8)
    static, ring, glow_static, glow_ring = [], [], [], []
    # hub spindle
    spindle = lathe('spindle', [(-300, 0), (-296, 30), (-270, 52), (-120, 58), (-110, 70), (-90, 70), (-80, 58), (80, 58), (90, 70),
                                (110, 70), (120, 58), (270, 52), (296, 30), (300, 0)], hull, n=48)
    spindle.rotation_euler = (R(90), 0, 0)
    static.append(spindle)
    # hub bands of windows
    for zc in (-200, -150, 150, 200):
        for i in range(24):
            a = 2 * math.pi * i / 24
            o = box(f'hw{zc}_{i}', win, (4.0, 0.5, 2.2), (59.2 * math.cos(a), 59.2 * math.sin(a), zc), rot=(0, 0, a + math.pi / 2))
            glow_static.append(o)
    # ring
    ring_main = torus_ring('ring_hull', hull, 430, 44, 30, segs=128, n=20, e=4.5)
    ring.append(ring_main)
    for i in range(128):
        a = 2 * math.pi * (i + 0.5) / 128
        for zc in (-6, 6):
            o = box(f'rw{i}_{zc}', win if i % 7 else win2, (0.6, 9.0, 2.0), (452.2 * math.cos(a), 452.2 * math.sin(a), zc), rot=(0, 0, a))
            glow_ring.append(o)
        if i % 4 == 0:
            o = box(f'rib{i}', metal, (50, 4, 34), (430 * math.cos(a), 430 * math.sin(a), 0), rot=(0, 0, a))
            ring.append(o)
    # spokes
    for i in range(4):
        a = 2 * math.pi * i / 4 + math.pi / 4
        sp = cyl(f'spoke{i}', hull2, 9, 345, (235 * math.cos(a), 235 * math.sin(a), 0), rot=(0, R(90), a), n=16)
        ring.append(sp)
        for k in range(8):
            rr = 90 + k * 40
            o = box(f'sw{i}_{k}', win2, (3, 0.6, 1.2), (rr * math.cos(a), rr * math.sin(a), 9.3), rot=(0, 0, a))
            glow_ring.append(o)
    # docking module at the bottom end of the spindle (axis -Z): ships approach along the axis, clear of the ring
    dockm = box('dock_module', hull2, (110, 110, 90), (0, 0, -330), bevel=3)
    static.append(dockm)
    static.append(box('dock_inner', dark, (80, 70, 6), (0, 0, -374)))
    for x in (-41, 41):
        glow_static.append(box(f'bayline{x}', bay, (2, 74, 2), (x, 0, -376)))
    for y in (-36, 36):
        glow_static.append(box(f'baylinev{y}', bay, (84, 2, 2), (0, y, -376)))
    field = box('field_dock', dark, (80, 70, 0.5), (0, 0, -375.6))
    field.data.materials.clear(); field.data.materials.append(mat_emit('glow_field', '#4aa0ff', 1))
    field.name = 'field_dock'
    gm = mat_emit('glow_guide', '#7fe0ff', 10)
    for i in range(8):
        glow_static.append(box(f'guide{i}', gm, (3, 3, 3), (-48, 0, -400 - i * 40)))
        glow_static.append(box(f'guideb{i}', gm, (3, 3, 3), (48, 0, -400 - i * 40)))
    # solar arrays & radiators on the spindle ends
    for zs in (-1, 1):
        for k in range(4):
            a = k * math.pi / 2
            p = box(f'solar{zs}{k}', solar, (140, 3, 46), (130 * math.cos(a), 130 * math.sin(a), zs * 250), rot=(0, 0, a), bevel=0.5)
            static.append(p)
            static.append(cyl(f'solar_arm{zs}{k}', metal, 2.5, 120, (60 * math.cos(a), 60 * math.sin(a), zs * 250), rot=(0, R(90), a), n=10))
    # antenna mast & dishes
    static.append(cyl('mast', metal, 4, 160, (0, 0, 380), rot=(0, 0, 0), n=12))
    for i, (x, y, z) in enumerate(((0, 30, 360), (20, -20, 410), (-25, -5, 440))):
        d = sphere(f'dish{i}', metal, 14, (x, y, z), scale=(1, 1, 0.25))
        static.append(d)
    red_lights = [sphere(f'beacon{i}', red, 3, p) for i, p in enumerate(((0, 0, 462), (58, 58, -378), (-58, -58, -378), (475, 0, 0), (-475, 0, 0), (0, 475, 0), (0, -475, 0)))]
    for o in red_lights:
        glow_static.append(o)
    # greebles
    static += greebles(spindle, metal, count=160, size=(3, 12), height=(1, 4), seed=61)
    static += greebles(dockm, metal, count=60, size=(3, 10), height=(1, 3), seed=62, region=lambda h: h.z > -370)
    ring += greebles(ring_main, metal, count=240, size=(3, 10), height=(1, 3), seed=63)
    return static, ring, glow_static, glow_ring, field


def finalize_cassini(static, ring, glow_static, glow_ring, field, outdir):
    baked = bake_groups({'hull': static, 'ring': ring}, outdir, size=4096, ao=96)
    hullo, ringo = baked
    # glow groups by material
    finals = [hullo]
    def by_mat(objs):
        g = {}
        for o in objs:
            g.setdefault(o.material_slots[0].material.name, []).append(o)
        return g
    pivot = empty('ring_pivot', (0, 0, 0))
    ringo.parent = pivot
    finals += [pivot, ringo]
    for mname, objs in by_mat(glow_static).items():
        finals.append(join_glow(objs, mname, bpy.data.materials[mname].get('glow_color', '#ffffff')))
    for mname, objs in by_mat(glow_ring).items():
        j = join_glow(objs, mname + '_ring', bpy.data.materials[mname].get('glow_color', '#ffffff'))
        j.parent = pivot
        finals.append(j)
    apply_all(field); finals.append(field)
    path = os.path.join(outdir, 'model.glb')
    swship.export_glb(finals, path)
    meta = {
        'dock': {'pos': b2t((0, 0, -376)), 'dir': b2t((0, 0, -1))},
        'spin': [{'n': 'ring_pivot', 'rate': 0.05}],
        'radius': 520,
        'colliders': [
            {'t': 's', 'c': b2t((0, 0, -200)), 'r': 70}, {'t': 's', 'c': b2t((0, 0, -80)), 'r': 72}, {'t': 's', 'c': b2t((0, 0, 40)), 'r': 72},
            {'t': 's', 'c': b2t((0, 0, 160)), 'r': 70}, {'t': 's', 'c': b2t((0, 0, 260)), 'r': 55},
            {'t': 'torus', 'c': [0, 0, 0], 'R': 430, 'r': 26},
            {'t': 'b', 'c': b2t((0, 0, -330)), 'h': [55, 45, 55]},
        ],
    }
    # three.js: Blender box (x:170, y:130, z:100) half extents -> (85, 50, 65) after axis swap
    with open(os.path.join(outdir, 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    return path


# ======================================================================= small outpost

def small():
    hull = mat_paint('hull_out', '#a9a69e', color2='#9a9b9a', wear=0.5, rust=0.2, dirt=0.65, metal=0.35, scale=0.3,
                     stripe=('z', 0.0, 3.0), stripe_color='#c98a1a')
    metal = mat_metal('metal_out', '#64676b', 0.45, metal=0.8, scale=0.4)
    dark = mat_rubber('dark_out')
    solar = mat_metal('solar_out', '#16233c', 0.25, metal=0.6, scale=3.0, grime=0.1)
    win = mat_emit('glow_win', '#ffd9a0', 6)
    red = mat_emit('glow_blink_red', '#ff3020', 14)
    bay = mat_emit('glow_bay', '#6fd0ff', 8)
    P, G = [], []
    core = sphere('core', hull, 45, (0, 0, 0), seg=48, rings=24)
    P.append(core)
    for i, (d, rot) in enumerate((((1, 0, 0), (0, R(90), 0)), ((-1, 0, 0), (0, R(90), 0)), ((0, 1, 0), (R(90), 0, 0)), ((0, -1, 0), (R(90), 0, 0)))):
        L = 70 if i != 0 else 50
        c = Vector(d) * (45 + L / 2 - 6)
        P.append(cyl(f'mod{i}', hull, 16, L, tuple(c), rot=rot, n=24))
        for k in range(5):
            pos = Vector(d) * (50 + k * 12) + Vector((0, 0, 16.2))
            G.append(box(f'mw{i}{k}', win, (2.5, 2.5, 0.4) if d[0] == 0 else (2.5, 2.5, 0.4), tuple(pos)))
    P.append(cyl('tower', hull, 10, 120, (0, 0, 60), rot=(0, 0, 0), n=20))
    P.append(cyl('tower_b', hull, 14, 60, (0, 0, -60), rot=(0, 0, 0), n=20))
    for s in (-1, 1):
        P.append(box(f'solar{s}', solar, (16, 160, 2), (0, s * 160, 0), bevel=0.3))
        P.append(cyl(f'arm{s}', metal, 1.5, 60, (0, s * 100, 0), rot=(R(90), 0, 0), n=8))
    # dock on +X end
    P.append(box('dock', hull, (40, 60, 44), (100, 0, 0), bevel=2))
    P.append(box('dock_in', dark, (6, 46, 30), (118, 0, 0)))
    for z in (-16, 16):
        G.append(box(f'bay{z}', bay, (1, 48, 1), (121, 0, z)))
    field = box('field_dock', dark, (0.4, 46, 30), (120.5, 0, 0))
    field.data.materials.clear(); field.data.materials.append(mat_emit('glow_field', '#4aa0ff', 1))
    G.append(sphere('beacon0', red, 2, (0, 0, 122))); G.append(sphere('beacon1', red, 2, (0, 0, -92)))
    P += greebles(core, metal, count=80, size=(2, 6), height=(0.5, 2), seed=71)
    return P, G, field


def finalize_small(P, G, field, outdir):
    hullo = bake_groups({'hull': P}, outdir, size=2048, ao=96)[0]
    finals = [hullo]
    groups = {}
    for o in G:
        groups.setdefault(o.material_slots[0].material.name, []).append(o)
    for mname, objs in groups.items():
        finals.append(join_glow(objs, mname, bpy.data.materials[mname].get('glow_color', '#ffffff')))
    apply_all(field); finals.append(field)
    path = os.path.join(outdir, 'model.glb')
    swship.export_glb(finals, path)
    meta = {'dock': {'pos': b2t((121, 0, 0)), 'dir': b2t((1, 0, 0))}, 'spin': [], 'radius': 200,
            'colliders': [{'t': 's', 'c': [0, 0, 0], 'r': 48}, {'t': 'b', 'c': b2t((40, 0, 0)), 'h': [80, 22, 22]},
                          {'t': 'b', 'c': b2t((-50, 0, 0)), 'h': [40, 18, 18]}, {'t': 'b', 'c': b2t((0, 0, 0)), 'h': [18, 120, 18]},
                          {'t': 'b', 'c': b2t((0, 70, 0)), 'h': [18, 18, 50]}, {'t': 'b', 'c': b2t((0, -70, 0)), 'h': [18, 18, 50]},
                          {'t': 'b', 'c': b2t((0, 160, 0)), 'h': [9, 3, 82]}, {'t': 'b', 'c': b2t((0, -160, 0)), 'h': [9, 3, 82]}]}
    with open(os.path.join(outdir, 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    return path


# ======================================================================= rocks

def rocks():
    P = []
    for i in range(5):
        m = mat_paint(f'rock_{i}', '#8a857d', color2='#6c6863', wear=0.0, rust=0.0, dirt=0.9, metal=0.0, rough=0.9, panel=0.0, scale=0.6)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)
        ob = swship._obj_from_bm(bm, f'rock_{i}', m)
        tex = bpy.data.textures.new(f'rocknoise{i}', 'VORONOI')
        tex.noise_scale = 0.6 + i * 0.1
        tex2 = bpy.data.textures.new(f'rocknoise2{i}', 'CLOUDS'); tex2.noise_scale = 0.35; tex2.noise_depth = 4
        d1 = ob.modifiers.new('d1', 'DISPLACE'); d1.texture = tex2; d1.strength = 0.5; d1.mid_level = 0.5
        d2 = ob.modifiers.new('d2', 'DISPLACE'); d2.texture = tex; d2.strength = -0.25; d2.mid_level = 0.0
        ob.scale = (1.0 + 0.2 * i % 3, 0.8 + 0.1 * i, 0.75 + 0.05 * i)
        ob.location = (i * 4.0, 0, 0)
        for p in ob.data.polygons:
            p.use_smooth = True
        P.append(ob)
    return P


def finalize_rocks(P, outdir):
    groups = {f'rock_{i}': [o] for i, o in enumerate(P)}
    outs = bake_groups(groups, outdir, size=2048, ao=64)
    for o in outs:
        # recentre each variant
        bb = [Vector(c) for c in o.bound_box]
        ctr = sum(bb, Vector()) / 8
        o.data.transform(Matrix.Translation(-ctr))
    path = os.path.join(outdir, 'model.glb')
    swship.export_glb(outs, path)
    return path


# ======================================================================= cockpit interior

def cockpit():
    """Generic fighter cockpit. Eye at origin looking +Y (Blender) == -Z (three)."""
    shell = mat_paint('hull_ck', '#3a3d42', color2='#2b2d31', wear=0.5, rust=0.0, dirt=0.5, metal=0.4, rough=0.55, scale=6.0, panel=0.5)
    metal = mat_metal('metal_ck', '#6d7075', 0.35, metal=0.9, scale=5.0)
    dark = mat_rubber('dark_ck', '#151618')
    amber = mat_emit('glow_btn_amber', '#ffb040', 6)
    cyan = mat_emit('glow_btn_cyan', '#5fe0ff', 6)
    red = mat_emit('glow_btn_red', '#ff3a2a', 6)
    P, G, S = [], [], []
    # dashboard
    dash = loft('dash', [dict(y=0.35, w=1.25, h=0.25, z=-0.42, e=4), dict(y=0.7, w=1.35, h=0.32, z=-0.36, e=4), dict(y=0.95, w=1.15, h=0.16, z=-0.3, e=4)], shell, n=24)
    P.append(dash)
    # screen housings
    for i, (x, rz) in enumerate(((-0.42, 20), (0.0, 0), (0.42, -20))):
        hb = box(f'mfd_house{i}', dark, (0.3, 0.05, 0.24), (x, 0.56, -0.2), rot=(R(-62), 0, R(rz)))
        P.append(hb)
        # screen plane with its own UVs
        bpy.ops.mesh.primitive_plane_add(size=1.0)
        sc = bpy.context.active_object
        sc.name = ['screen_l', 'screen_c', 'screen_r'][i]
        sc.scale = (0.26, 0.2, 1)
        sc.rotation_euler = (R(28), 0, R(rz))
        sc.location = (x, 0.53, -0.19)
        sc.location += Vector((0, -0.028, 0.012))
        sc.data.materials.append(mat_emit('screen_' + str(i), '#0a1a24', 1))
        S.append(sc)
    # canopy frame: front arch, centre spine and side rails as tubes
    def arc_pts(f, n=14):
        return [f(i / (n - 1)) for i in range(n)]
    front = arc_pts(lambda t: Vector((math.cos(math.pi * t) * -0.66, 0.98 - math.sin(math.pi * t) * 0.18, -0.24 + math.sin(math.pi * t) * 0.78)))
    spine = arc_pts(lambda t: Vector((0, 0.8 - t * 1.6, 0.54 + math.sin(math.pi * (0.2 + t * 0.6)) * 0.08)), 10)
    railL = arc_pts(lambda t: Vector((-0.66 - t * 0.06, 0.98 - t * 1.7, -0.24 + t * 0.2)), 6)
    railR = [Vector((-v.x, v.y, v.z)) for v in railL]
    for k, pts in enumerate((front, spine, railL, railR)):
        P += tube(f'frame{k}', metal, pts, 0.024)
    # bow frame across the top
    P.append(box('bow', metal, (1.4, 0.06, 0.05), (0, 0.55, 0.62), rot=(R(10), 0, 0)))
    # side consoles
    for s in (-1, 1):
        P.append(box(f'console{s}', shell, (0.28, 0.9, 0.25), (s * 0.62, 0.05, -0.55), rot=(0, R(s * -12), 0), bevel=0.02))
        P.append(box(f'throttle{s}', dark, (0.05, 0.12, 0.18), (s * 0.58, 0.0, -0.36)))
        for k in range(6):
            mt = [amber, cyan, red][k % 3]
            G.append(box(f'btn{s}{k}', mt, (0.025, 0.025, 0.008), (s * 0.6 + (k % 2) * 0.05 * s, -0.25 + k * 0.08, -0.42)))
    for k in range(10):
        mt = [amber, cyan, cyan, red, amber][k % 5]
        G.append(box(f'dbtn{k}', mt, (0.02, 0.01, 0.012), (-0.45 + k * 0.1, 0.8, -0.215)))
    # control stick
    P.append(cyl('stick', dark, 0.02, 0.3, (0, 0.18, -0.6), rot=(R(10), 0, 0), n=10))
    P.append(sphere('stick_top', dark, 0.04, (0, 0.2, -0.45), scale=(1, 1.3, 1.6)))
    return P, G, S


def finalize_cockpit(P, G, S, outdir):
    hullo = bake_groups({'hull': P}, outdir, size=2048, ao=128)[0]
    finals = [hullo]
    groups = {}
    for o in G:
        groups.setdefault(o.material_slots[0].material.name, []).append(o)
    for mname, objs in groups.items():
        finals.append(join_glow(objs, mname, bpy.data.materials[mname].get('glow_color', '#ffffff')))
    for s in S:
        apply_all(s); finals.append(s)
    path = os.path.join(outdir, 'model.glb')
    swship.export_glb(finals, path)
    return path


if __name__ != 'stations':  # executed via the bridge (not imported)
    what = BL_ARGS[0]
    flags = BL_ARGS[1:]
    swlib.fresh(); swship.MATS.clear()
    res = {}
    if what == 'cassini':
        parts = cassini()
        outdir = swlib.out('stations', 'station_cassini', 'x').rsplit(os.sep, 1)[0]
        if '--no-preview' not in flags:
            res['preview'] = swship.studio_preview(os.path.join(outdir, 'preview.jpg'), (0, 0, 0), 1500, samples=96, cam_dir=(1.0, -0.6, 0.45), lens=50)
        if '--preview-only' not in flags:
            res['glb'] = finalize_cassini(*parts, outdir)
    elif what == 'small':
        parts = small()
        outdir = swlib.out('stations', 'station_small', 'x').rsplit(os.sep, 1)[0]
        if '--no-preview' not in flags:
            res['preview'] = swship.studio_preview(os.path.join(outdir, 'preview.jpg'), (0, 0, 0), 520, samples=96, cam_dir=(1.0, -0.7, 0.5), lens=50)
        if '--preview-only' not in flags:
            res['glb'] = finalize_small(*parts, outdir)
    elif what == 'rocks':
        P = rocks()
        outdir = swlib.out('rocks', 'x').rsplit(os.sep, 1)[0]
        if '--no-preview' not in flags:
            res['preview'] = swship.studio_preview(os.path.join(outdir, 'preview.jpg'), (8, 0, 0), 26, samples=64)
        if '--preview-only' not in flags:
            res['glb'] = finalize_rocks(P, outdir)
    elif what == 'cockpit':
        P, G, S = cockpit()
        outdir = swlib.out('cockpit', 'x').rsplit(os.sep, 1)[0]
        if '--no-preview' not in flags:
            res['preview'] = swship.studio_preview(os.path.join(outdir, 'preview.jpg'), (0, 0.6, -0.2), 2.0, samples=64, cam_dir=(0.0, -1.0, 0.25), lens=24)
        if '--preview-only' not in flags:
            res['glb'] = finalize_cockpit(P, G, S, outdir)
    result = res
