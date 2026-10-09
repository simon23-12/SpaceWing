"""Stylised characters for the station (exported with plain PBR colours) and dialogue portraits.
Usage: bl.py blender/npcs.py [models|portraits|all]"""
import importlib, math, os
import bpy, bmesh
from mathutils import Vector, Matrix
import swlib, swship
importlib.reload(swlib); importlib.reload(swship)
from swlib import G, hexc
from swship import box, cyl, sphere, lathe, loft, empty, apply_all

try:
    REPO
except NameError:
    REPO = swlib.REPO_PATH
swlib.init(REPO)
R = math.radians
WHAT = BL_ARGS[0] if BL_ARGS else 'all'


def mat(name, color, rough=0.6, metal=0.0, emit=None, strength=0.0, sss=0.0):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = swlib.new_mat(name); m.node_tree.nodes.clear(); g = G(m.node_tree)
    bs = g.node('ShaderNodeBsdfPrincipled')
    bs.inputs['Base Color'].default_value = hexc(color)
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Metallic'].default_value = metal
    if sss:
        bs.inputs['Subsurface Weight'].default_value = sss
        bs.inputs['Subsurface Radius'].default_value = (0.8, 0.35, 0.2)
        bs.inputs['Subsurface Scale'].default_value = 0.02
    if emit:
        bs.inputs['Emission Color'].default_value = hexc(emit)
        bs.inputs['Emission Strength'].default_value = strength
    g.output(bs.outputs[0])
    return m


def limb(name, m, a, b, r0, r1=None, n=14):
    a, b = Vector(a), Vector(b)
    d = b - a
    c = cyl(name, m, r0, d.length, tuple((a + b) / 2), rot=(0, 0, 0), n=n, r2=r1 if r1 is not None else r0)
    c.rotation_mode = 'QUATERNION'
    c.rotation_quaternion = d.to_track_quat('Z', 'Y')
    # cylinder axis +Z points from centre to b; create_cone radius1 is at -Z (a), radius2 at +Z (b)
    j = sphere(name + '_j', m, r0 * 1.02, tuple(a), seg=12, rings=8)
    return [c, j]


def human(name, skin, top, pants, shoes, hair, hair_style='short', coat=None, coat_len=0.55, seated=False,
          height=1.75, build=1.0, female=False, extra=None, arms='down'):
    """Returns list of parts, figure faces -Y, feet at z=0 (standing) or seated on a 0.46 m chair."""
    s = height / 1.75
    P = []
    hip_z = 0.46 + 0.06 if seated else 0.95 * s
    bw = build
    # torso
    torso = loft(name + '_torso', [
        dict(y=0.0, w=0.33 * bw * (1.08 if female else 1), h=0.21, e=2.4),
        dict(y=0.16 * s, w=0.29 * bw, h=0.19, e=2.4),
        dict(y=0.34 * s, w=0.36 * bw, h=0.23 * (1.1 if female else 1), e=2.6),
        dict(y=0.48 * s, w=0.42 * bw, h=0.21, e=2.8),
        dict(y=0.53 * s, w=0.2, h=0.15, e=2.2),
    ], top, n=20)
    torso.rotation_euler = (R(90), 0, 0)
    torso.location = (0, 0, hip_z)
    P.append(torso)
    sh_z = hip_z + 0.47 * s
    P += limb(name + '_neck', skin, (0, 0, sh_z + 0.03), (0, 0, sh_z + 0.12 * s), 0.05 * s)
    head = sphere(name + '_head', skin, 0.1 * s, (0, -0.005, sh_z + 0.22 * s), scale=(0.86, 0.97, 1.1), seg=28, rings=16)
    P.append(head)
    hz = sh_z + 0.22 * s
    P.append(sphere(name + '_nose', skin, 0.015 * s, (0, -0.097 * s, hz - 0.008 * s), scale=(0.75, 1.1, 1.5), seg=10, rings=6))
    brow = mat('brow', '#2a1e16', 0.7)
    lip = mat('lip', '#7a4a3a', 0.5)
    for sx in (-1, 1):
        P.append(box(name + f'_brow{sx}', brow, (0.03 * s, 0.01 * s, 0.006 * s), (sx * 0.035 * s, -0.091 * s, hz + 0.05 * s), rot=(0, R(-8 * sx), 0)))
    P.append(box(name + '_mouth', lip, (0.035 * s, 0.01 * s, 0.006 * s), (0, -0.093 * s, hz - 0.048 * s)))
    eye = mat('eye', '#101010', 0.2)
    for sx in (-1, 1):
        P.append(sphere(name + f'_eye{sx}', eye, 0.012 * s, (sx * 0.035 * s, -0.088 * s, hz + 0.025 * s), seg=8, rings=6))
        P.append(sphere(name + f'_ear{sx}', skin, 0.022 * s, (sx * 0.088 * s, 0.0, hz + 0.0), scale=(0.5, 1, 1.3), seg=8, rings=6))
    # hair
    if hair_style == 'short':
        P.append(sphere(name + '_hair', hair, 0.105 * s, (0, 0.012, hz + 0.03 * s), scale=(0.92, 1.0, 1.0), seg=24, rings=12))
    elif hair_style == 'bun':
        P.append(sphere(name + '_hair', hair, 0.105 * s, (0, 0.01, hz + 0.03 * s), scale=(0.92, 1.02, 1.02), seg=24, rings=12))
        P.append(sphere(name + '_bun', hair, 0.055 * s, (0, 0.09 * s, hz + 0.08 * s), seg=16, rings=10))
    elif hair_style == 'long':
        P.append(sphere(name + '_hair', hair, 0.108 * s, (0, 0.015, hz + 0.025 * s), scale=(0.95, 1.02, 1.05), seg=24, rings=12))
        P.append(box(name + '_hairback', hair, (0.17 * s, 0.07 * s, 0.24 * s), (0, 0.07 * s, hz - 0.1 * s), bevel=0.03))
    elif hair_style == 'cap':
        P.append(sphere(name + '_hair', hair, 0.106 * s, (0, 0.01, hz + 0.035 * s), scale=(0.93, 1.0, 0.95), seg=24, rings=12))
        P.append(box(name + '_visor', hair, (0.16 * s, 0.09 * s, 0.015 * s), (0, -0.1 * s, hz + 0.06 * s), rot=(R(-12), 0, 0), bevel=0.01))
    # arms
    for sx in (-1, 1):
        shoulder = Vector((sx * 0.21 * bw * s, 0, sh_z - 0.02))
        if seated or arms == 'table':
            elbow = shoulder + Vector((sx * 0.04, -0.12 * s, -0.26 * s))
            hand = elbow + Vector((-sx * 0.05, -0.28 * s, 0.02))
        elif arms == 'counter':
            elbow = shoulder + Vector((sx * 0.05, -0.08 * s, -0.27 * s))
            hand = elbow + Vector((-sx * 0.06, -0.27 * s, 0.03))
        else:
            elbow = shoulder + Vector((sx * 0.05, 0.02, -0.29 * s))
            hand = elbow + Vector((sx * 0.01, -0.06, -0.26 * s))
        P += limb(name + f'_uarm{sx}', top, shoulder, elbow, 0.055 * s * bw, 0.047 * s)
        P += limb(name + f'_farm{sx}', top, elbow, hand, 0.045 * s, 0.038 * s)
        P.append(sphere(name + f'_hand{sx}', skin, 0.042 * s, tuple(hand + (hand - elbow).normalized() * 0.04), scale=(0.8, 1, 1.15), seg=12, rings=8))
    # legs
    for sx in (-1, 1):
        hip = Vector((sx * 0.095 * bw * s, 0, hip_z + 0.02))
        if seated:
            knee = hip + Vector((0, -0.44 * s, -0.02))
            ankle = knee + Vector((0, -0.02, -0.42 * s))
        else:
            knee = hip + Vector((0, -0.01, -0.45 * s))
            ankle = knee + Vector((0, 0.02, -0.43 * s))
        P += limb(name + f'_thigh{sx}', pants, hip, knee, 0.075 * s * bw, 0.058 * s)
        P += limb(name + f'_shin{sx}', pants, knee, ankle, 0.056 * s, 0.045 * s)
        P.append(box(name + f'_shoe{sx}', shoes, (0.1 * s, 0.25 * s, 0.08 * s), (ankle.x, ankle.y - 0.06 * s, max(0.04, ankle.z - 0.035)), bevel=0.03))
    if coat:
        c_len = coat_len * s
        cz = sh_z
        sections = [dict(y=0.0, w=0.47 * bw, h=0.27, e=2.6), dict(y=0.2 * s, w=0.41 * bw, h=0.28, e=2.6), dict(y=0.42 * s, w=0.43 * bw, h=0.3, e=2.4),
                    dict(y=0.42 * s + c_len * (0.4 if seated else 1.0), w=(0.48 if not seated else 0.42) * bw, h=0.32, e=2.2)]
        cl = loft(name + '_coat', sections, coat, n=24, cap_start=False, cap_end=False)
        cl.rotation_euler = (R(-90), 0, 0)
        cl.location = (0, 0.01, cz + 0.02)
        P.append(cl)
        P.append(box(name + '_collar', coat, (0.24 * s, 0.14 * s, 0.07 * s), (0, 0.02, cz + 0.06 * s), bevel=0.03))
    if extra:
        P += extra(sh_z, hz, s)
    return P


def kix():
    body = mat('kix_body', '#c9c4b8', 0.35, 0.8)
    dark = mat('kix_dark', '#2a2c30', 0.5, 0.6)
    eye = mat('kix_eye', '#5fe0ff', 0.2, 0.0, '#5fe0ff', 12)
    orange = mat('kix_orange', '#d07a2a', 0.45, 0.4)
    P = []
    P.append(cyl('kix_base', dark, 0.3, 0.5, (0, 0, 0.25), rot=(0, 0, 0), n=24))
    t = lathe('kix_torso', [(0.5, 0.0), (0.5, 0.26), (0.9, 0.3), (1.3, 0.28), (1.45, 0.22), (1.5, 0.0)], body, n=28)
    t.rotation_euler = (R(-90), 0, 0); P.append(t)
    P.append(box('kix_stripe', orange, (0.5, 0.05, 0.12), (0, -0.29, 1.1), bevel=0.02))
    P.append(sphere('kix_head', body, 0.2, (0, 0, 1.7), scale=(1, 1, 0.8), seg=28, rings=14))
    P.append(cyl('kix_neck', dark, 0.07, 0.2, (0, 0, 1.52), rot=(0, 0, 0), n=12))
    P.append(cyl('kix_eye', eye, 0.07, 0.05, (0, -0.18, 1.72), rot=(R(90), 0, 0), n=20))
    P.append(cyl('kix_eyering', dark, 0.09, 0.04, (0, -0.165, 1.72), rot=(R(90), 0, 0), n=20))
    P.append(cyl('kix_antenna', dark, 0.01, 0.25, (0.1, 0.05, 1.95), rot=(R(-10), R(10), 0), n=6))
    for k, (sx, z, fw) in enumerate(((-1, 1.32, -0.35), (1, 1.32, -0.25), (-1, 1.0, -0.4), (1, 1.0, -0.45))):
        sh = Vector((sx * 0.3, 0, z))
        el = sh + Vector((sx * 0.15, -0.1, -0.18))
        hd = el + Vector((-sx * 0.05, fw, 0.05 * (k % 2)))
        P += limb(f'kix_arm{k}a', dark, sh, el, 0.045)
        P += limb(f'kix_arm{k}b', body, el, hd, 0.04, 0.035)
        P.append(sphere(f'kix_claw{k}', orange, 0.05, tuple(hd), seg=10, rings=6))
    glass = mat('kix_glass', '#e8f4ff', 0.05, 0.0, '#ffb060', 0.5)
    P.append(cyl('kix_tumbler', glass, 0.04, 0.09, (0.15, -0.65, 1.06), rot=(0, 0, 0), n=14))
    return P


def instrument(kind):
    m = mat('inst', '#888888', 0.5)
    if kind == 'bass':
        return lambda sh, hz, s: [box('bass_body', m, (0.42, 0.2, 0.75), (0.25, -0.3, 0.7), rot=(0, R(-8), 0), bevel=0.08),
                                   cyl('bass_neck', m, 0.025, 0.9, (0.2, -0.32, 1.45), rot=(0, R(-8), 0), n=8)]
    if kind == 'sax':
        return lambda sh, hz, s: [cyl('sax_body', m, 0.045, 0.55, (0.02, -0.2, sh - 0.25), rot=(R(15), 0, 0), n=12, r2=0.025),
                                   cyl('sax_bell', m, 0.075, 0.12, (0.03, -0.27, sh - 0.5), rot=(R(-60), 0, 0), n=16, r2=0.04)]
    return lambda sh, hz, s: [box('keys', m, (0.95, 0.32, 0.08), (0, -0.48, 0.95), bevel=0.01), cyl('keys_stand', m, 0.025, 0.9, (0, -0.48, 0.47), rot=(0, 0, 0), n=8)]


def characters():
    skin1 = mat('skin_dark', '#6a4632', 0.55, sss=0.15)
    skin2 = mat('skin_light', '#d8a88a', 0.55, sss=0.15)
    skin3 = mat('skin_mid', '#a5714e', 0.55, sss=0.15)
    grey = mat('hair_grey', '#9a9894', 0.7)
    black = mat('hair_black', '#141210', 0.6)
    brown = mat('hair_brown', '#4a2e1c', 0.6)
    red = mat('hair_red', '#8a3a1a', 0.6)
    jacket = mat('mags_jacket', '#5a4030', 0.75)
    pants = mat('cargo', '#3a3d34', 0.8)
    boots = mat('boots', '#1e1a16', 0.6)
    shirt = mat('shirt_dark', '#2d3138', 0.8)
    suit = mat('suit', '#23262c', 0.55)
    vest = mat('vest', '#3a5068', 0.6)
    overall = mat('overall', '#c46a28', 0.7)
    purple = mat('purple_coat', '#4b3a6b', 0.6)
    beige = mat('beige', '#b9ab90', 0.8)
    out = {}
    out['mags'] = human('mags', skin1, shirt, pants, boots, grey, 'short', coat=jacket, coat_len=0.25, height=1.68, build=1.05, female=True)
    out['mags_seated'] = human('mags_seated', skin1, shirt, pants, boots, grey, 'short', coat=jacket, coat_len=0.25, height=1.68, build=1.05, female=True, seated=True)
    out['oduya'] = human('oduya', skin1, vest, suit, boots, black, 'short', height=1.86, arms='counter',
                         extra=lambda sh, hz, s: [cyl('headset', mat('headset', '#202020', 0.4, 0.5), 0.012, 0.12, (0.1 * s, -0.05, hz), rot=(R(90), 0, R(30)), n=6)])
    out['haendler'] = human('haendler', skin2, overall, overall, boots, red, 'cap', height=1.7, female=True, arms='counter',
                            extra=lambda sh, hz, s: [box('toolbelt', mat('belt', '#2a2018', 0.7), (0.36, 0.24, 0.08), (0, 0, 0.95 * s), bevel=0.02)])
    out['juno'] = human('juno', skin3, mat('juno_top', '#d9d4e8', 0.7), suit, boots, black, 'bun', coat=purple, coat_len=0.7, height=1.66, female=True, build=0.92)
    out['kix'] = kix()
    out['band_bass'] = human('band_bass', skin1, shirt, pants, boots, black, 'short', height=1.8, extra=instrument('bass'))
    out['band_sax'] = human('band_sax', skin2, shirt, pants, boots, brown, 'long', female=True, height=1.7, extra=instrument('sax'), arms='counter')
    out['band_keys'] = human('band_keys', skin3, shirt, pants, boots, black, 'short', height=1.75, extra=instrument('keys'), arms='counter')
    return out


def portrait_only():
    skin1 = mat('skin_dark', '#6a4632', 0.55, sss=0.15)
    skin2 = mat('skin_light', '#d8a88a', 0.55, sss=0.15)
    skin3 = mat('skin_mid', '#a5714e', 0.55, sss=0.15)
    skin4 = mat('skin_pale', '#e6c0a8', 0.55, sss=0.15)
    gold = mat('gold_coat', '#b8913d', 0.35, 0.8)
    white = mat('white_uni', '#e8e4d8', 0.5)
    navy = mat('navy_uni', '#23345a', 0.55)
    blue = mat('blue_coat', '#2f5a8a', 0.6)
    black = mat('black_coat', '#18181a', 0.5)
    pink = mat('pink_dress', '#b8406a', 0.5)
    robe = mat('robe', '#4b3a6b', 0.7)
    hb = mat('hair_black', '#141210', 0.6); hg = mat('hair_grey', '#9a9894', 0.7); hblond = mat('hair_blond', '#c8a060', 0.6)
    hred = mat('hair_red', '#8a3a1a', 0.6); hwhite = mat('hair_white', '#e8e6e0', 0.7)
    boots = mat('boots', '#1e1a16', 0.6)
    out = {}
    out['varga'] = human('varga', skin4, gold, black, boots, hb, 'bun', coat=gold, coat_len=0.8, height=1.78, female=True, build=0.95)
    out['morrow'] = human('morrow', skin2, white, white, boots, hblond, 'short', height=1.85, build=1.1)
    out['brandt'] = human('brandt', skin2, navy, navy, boots, hg, 'cap', height=1.8, build=1.08)
    out['noor'] = human('noor', skin3, blue, black, boots, hb, 'long', coat=blue, coat_len=0.5, female=True, height=1.7)
    out['vesper'] = human('vesper', skin4, robe, robe, boots, hwhite, 'short', coat=robe, coat_len=0.9, height=1.72, build=0.95)
    out['rook'] = human('rook', skin1, black, black, boots, skin1, 'short', coat=black, coat_len=0.7, height=1.88, build=1.12)
    out['saffi'] = human('saffi', skin4, pink, pink, boots, hred, 'long', female=True, height=1.68, build=0.92)
    return out


def export_models():
    swlib.fresh()
    chars = characters()
    roots = []
    for i, (name, parts) in enumerate(chars.items()):
        for p in parts:
            apply_all(p)
        j = swship.join(parts, name)
        bpy.ops.object.select_all(action='DESELECT')
        md = j.modifiers.new('sub', 'SUBSURF'); md.levels = 1
        apply_all(j)
        for poly in j.data.polygons:
            poly.use_smooth = True
        roots.append(j)
    path = swlib.out('npcs', 'model.glb')
    for o in bpy.context.scene.objects:
        o.select_set(o in roots)
    bpy.context.view_layer.objects.active = roots[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_materials='EXPORT')
    return path


PORTRAITS = {
    'mags': ('#ffcf7a', '#2a1a10'), 'kix': ('#7fd4ff', '#08141c'), 'oduya': ('#8fd18f', '#0c1a10'), 'haendler': ('#d39a6a', '#1c120a'),
    'juno': ('#d7b8ff', '#140c1e'),
    'varga': ('#f2c35a', '#1c1406'), 'morrow': ('#f2c35a', '#14100a'), 'brandt': ('#9fb4ff', '#0a0e1c'), 'noor': ('#6fc3ff', '#06121c'),
    'vesper': ('#d7b8ff', '#100a1a'), 'rook': ('#ff5a4a', '#1a0806'), 'saffi': ('#ff8ad8', '#1a0814'),
}


def portraits():
    """Cycles head-and-shoulders portraits for the dialogue box."""
    swlib.fresh()
    chars = characters()
    chars.update(portrait_only())
    sc = swlib.cycles(samples=96, w=512, h=512, transform='AgX', look='AgX - Punchy', denoise=True)
    keep = {}
    for name, parts in chars.items():
        for p in parts:
            p.hide_render = True
        keep[name] = parts
    nt = sc.world.node_tree; nt.nodes.clear(); wg = G(nt)
    bgn = wg.node('ShaderNodeBackground'); out = wg.node('ShaderNodeOutputWorld'); wg.l.new(bgn.outputs[0], out.inputs['Surface'])
    cam_d = bpy.data.cameras.new('pc'); cam_d.lens = 85
    cam = bpy.data.objects.new('pc', cam_d); sc.collection.objects.link(cam); sc.camera = cam
    def light(nm, kind, e, loc, col, size=1.0):
        ld = bpy.data.lights.new(nm, kind); ld.energy = e; ld.color = hexc(col)[:3]
        if kind == 'AREA': ld.size = size
        lo = bpy.data.objects.new(nm, ld); sc.collection.objects.link(lo); lo.location = loc
        return lo
    made = []
    for name, (col, bg) in PORTRAITS.items():
        parts = keep[name]
        for p in parts:
            p.hide_render = False
        head = [p for p in parts if p.name.endswith('_head')]
        hz = head[0].location.z if head else 1.7
        tgt = Vector((0, 0, hz - 0.08))
        cam.location = tgt + Vector((0.35, -1.3, 0.12))
        cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
        bgn.inputs['Color'].default_value = hexc(bg); bgn.inputs['Strength'].default_value = 1.0
        ls = [light('k', 'AREA', 60, tgt + Vector((0.8, -0.8, 0.6)), '#ffe6cc', 0.8), light('r', 'AREA', 90, tgt + Vector((-0.7, 0.6, 0.4)), col, 0.6),
              light('f', 'AREA', 12, tgt + Vector((-0.6, -1.0, -0.2)), '#9fb4d8', 1.0)]
        for l in ls:
            l.rotation_euler = (tgt - l.location).to_track_quat('-Z', 'Y').to_euler()
        made.append(swlib.save_render(swlib.out('portraits', name + '.jpg'), fmt='JPEG', quality=88))
        for l in ls:
            bpy.data.objects.remove(l, do_unlink=True)
        for p in parts:
            p.hide_render = True
    return made


res = {}
if WHAT in ('models', 'all'):
    res['models'] = export_models()
if WHAT in ('portraits', 'all'):
    res['portraits'] = portraits()
result = res
