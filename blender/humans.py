"""Realistic NPCs from free, CC0-licensed assets.

  Bodies, skins, eyes, hair, clothes : MakeHuman system/skins asset packs (CC0), assembled with the MPFB2
                                       Blender extension (GPL code, CC0 assets) - rig 'game_engine' (UE5 names).
  Animations                         : Quaternius Universal Animation Library 1 + 2, Standard (CC0), retargeted
                                       onto the MPFB rig here (world-space rotation transfer from a T-pose reference).

Downloads live outside the repo in ../SpaceWing_vendor (see README 'Asset-Lizenzen').

Usage:  bl.py blender/humans.py anims            -> public/assets/npcs/anims.glb (skeleton + clips, no mesh)
        bl.py blender/humans.py chars [ids...]   -> public/assets/npcs/<id>.glb (skinned mesh, no clips)
        bl.py blender/humans.py portraits [ids..] -> public/assets/portraits/<id>.jpg
"""
import bpy, os, math, json
import numpy as np
from mathutils import Vector, Matrix, Quaternion
import swlib

try:
    REPO
except NameError:
    REPO = swlib.REPO_PATH
swlib.init(REPO)
from bl_ext.user_default.mpfb.services.humanservice import HumanService

R = math.radians
VENDOR = os.path.join(os.path.dirname(REPO), 'SpaceWing_vendor')
UAL1 = os.path.join(VENDOR, 'ual/u1/Animation Library[Standard]/Unreal Engine/AL_Standard.fbx')
UAL2 = os.path.join(VENDOR, 'ual/u2/Universal Animation Library 2 [Standard]/Unreal-Godot/UAL2_Standard.glb')
MPFB_DATA = os.path.expanduser('~/Library/Application Support/Blender/5.2/extensions/.user/user_default/mpfb/data')
FPS = 30

# clips used in game (UAL clip name -> exported name)
CLIPS = {
    'Idle_Loop': 'idle', 'Idle_Talking_Loop': 'talk', 'Sitting_Idle_Loop': 'sit', 'Sitting_Talking_Loop': 'sit_talk',
    'Walk_Loop': 'walk', 'Walk_Formal_Loop': 'walk_formal', 'Driving_Loop': 'keys', 'Interact': 'interact',
    'Idle_FoldArms_Loop': 'fold', 'Idle_Rail_Loop': 'rail', 'Idle_TalkingPhone_Loop': 'phone', 'Consume': 'drink',
    'Yes': 'yes', 'Idle_No_Loop': 'no', 'Dance_Loop': 'dance',
}

# ------------------------------------------------------------------------------------------------ cast
# phenotype: gender 0=female..1=male, age 0.5=25 y .. 1.0=90 y, race weights. clothes: (asset, tint hex, tint amount)
CHARS = {
    'mags': dict(gender=0.0, age=0.74, muscle=0.62, weight=0.62, height=0.38, proportions=0.6,
                 race=(0.85, 0.05, 0.10), skin='middleage_african_female', eyes='brown', brows='eyebrow001', lashes='eyelashes02',
                 hair=('short02', '#8e8a84', 0.85),
                 clothes=[('male_casualsuit05', ('#5e4330', '#3a3d34'), 0.8), ('shoes03', None, 0)]),
    'oduya': dict(gender=1.0, age=0.62, muscle=0.6, weight=0.55, height=0.56, proportions=0.6,
                  race=(0.9, 0.0, 0.1), skin='middleage_african_male', eyes='brown', brows='eyebrow010', lashes='eyelashes01',
                  hair=('short04', '#141210', 0.9),
                  clothes=[('male_elegantsuit01', '#2a3442', 0.55), ('shoes04', None, 0)]),
    'haendler': dict(gender=0.0, age=0.56, muscle=0.7, weight=0.5, height=0.5, proportions=0.55,
                     race=(0.0, 0.0, 1.0), skin='toigo_light_skin_female_freckles', eyes='green', brows='eyebrow002', lashes='eyelashes02',
                     hair=('ponytail01', '#8a3a1a', 0.8),
                     clothes=[('male_worksuit01', '#c46a28', 0.85), ('shoes03', None, 0)]),
    'juno': dict(gender=0.0, age=0.6, muscle=0.45, weight=0.45, height=0.42, proportions=0.7,
                 race=(0.1, 0.7, 0.2), skin='middleage_asian_female', eyes='brownlight', brows='eyebrow003', lashes='eyelashes03',
                 hair=('braid01', '#141210', 0.9),
                 clothes=[('male_elegantsuit01', '#3e3052', 0.8), ('shoes04', None, 0)]),
    # hologram band (shaded with the holo shader in game, textures kept small)
    'band_bass': dict(gender=1.0, age=0.55, muscle=0.6, weight=0.55, height=0.55, race=(0.9, 0.0, 0.1), skin='young_african_male',
                      eyes='brown', brows='eyebrow010', hair=('short01', None, 0), clothes=[('male_casualsuit03', None, 0), ('shoes01', None, 0)], small=True),
    'band_sax': dict(gender=0.0, age=0.52, muscle=0.5, weight=0.45, height=0.55, race=(0.0, 0.1, 0.9), skin='young_caucasian_female',
                     eyes='blue', brows='eyebrow002', hair=('long01', None, 0), clothes=[('female_elegantsuit01', None, 0), ('shoes04', None, 0)], small=True),
    'band_keys': dict(gender=1.0, age=0.5, muscle=0.5, weight=0.5, height=0.5, race=(0.0, 0.9, 0.1), skin='young_asian_male',
                      eyes='brown', brows='eyebrow001', hair=('short03', None, 0), clothes=[('male_casualsuit06', None, 0), ('shoes05', None, 0)], small=True),
    # bar patrons / station crowd
    'gast_kesh': dict(gender=1.0, age=0.85, muscle=0.5, weight=0.7, height=0.5, race=(0.1, 0.0, 0.9), skin='old_caucasian_male',
                      eyes='grey', brows='eyebrow011', lashes='eyelashes01', hair=('fedora01', None, 0),
                      clothes=[('male_casualsuit01', ('#3d4a3a', '#2a2c30'), 0.75), ('shoes02', None, 0)]),
    'gast_ilse': dict(gender=0.0, age=0.5, muscle=0.6, weight=0.4, height=0.45, race=(0.8, 0.0, 0.2), skin='young_african_female',
                      eyes='brown', brows='eyebrow004', lashes='eyelashes03', hair=('afro01', '#1c1612', 0.5),
                      clothes=[('female_sportsuit01', '#2c5a5e', 0.8), ('shoes06', None, 0)]),
    'gast_tomas': dict(gender=1.0, age=0.6, muscle=0.75, weight=0.6, height=0.5, race=(0.0, 0.8, 0.2), skin='middleage_asian_male',
                       eyes='brown', brows='eyebrow009', lashes='eyelashes01', hair=('short02', '#1a1612', 0.9),
                       clothes=[('male_worksuit01', '#5a6068', 0.85), ('shoes03', None, 0)]),
    'gast_rana': dict(gender=0.0, age=0.58, muscle=0.5, weight=0.5, height=0.48, race=(0.2, 0.2, 0.6), skin='onlytheghosts_middle_aged_eurasian_female',
                      eyes='bluegreen', brows='eyebrow005', lashes='eyelashes04', hair=('bob02', '#3a2418', 0.7),
                      clothes=[('female_casualsuit01', ('#3a2b44', '#22242a'), 0.85), ('shoes04', None, 0)]),
    'crew_a': dict(gender=1.0, age=0.52, muscle=0.6, weight=0.5, height=0.5, race=(0.3, 0.1, 0.6), skin='young_caucasian_male2',
                   eyes='blue', brows='eyebrow008', lashes='eyelashes01', hair=('short01', '#4a3020', 0.6),
                   clothes=[('male_worksuit01', '#2f5a8a', 0.85), ('shoes03', None, 0)]),
    'crew_b': dict(gender=0.0, age=0.54, muscle=0.6, weight=0.45, height=0.5, race=(0.1, 0.6, 0.3), skin='young_asian_female',
                   eyes='brown', brows='eyebrow006', lashes='eyelashes02', hair=('ponytail01', '#141210', 0.85),
                   clothes=[('female_sportsuit01', '#5a4a30', 0.8), ('shoes05', None, 0)]),
    'crew_c': dict(gender=0.0, age=0.6, muscle=0.65, weight=0.55, height=0.5, race=(0.9, 0.0, 0.1), skin='middleage_african_female',
                   eyes='brown', brows='eyebrow005', lashes='eyelashes02', hair=('braid01', '#1a1410', 0.8),
                   clothes=[('male_casualsuit05', ('#5f7f94', '#2c3640'), 0.8), ('shoes03', None, 0)]),
    'crew_d': dict(gender=0.0, age=0.55, muscle=0.75, weight=0.5, height=0.52, race=(0.0, 0.0, 1.0), skin='young_caucasian_female2',
                   eyes='blue', brows='eyebrow002', lashes='eyelashes02', hair=('short04', '#c8a060', 0.75),
                   clothes=[('male_worksuit01', '#8a6a2a', 0.85), ('shoes03', None, 0)]),
    'crew_e': dict(gender=1.0, age=0.58, muscle=0.55, weight=0.5, height=0.52, race=(0.0, 0.9, 0.1), skin='middleage_asian_male',
                   eyes='brown', brows='eyebrow009', lashes='eyelashes01', hair=('short03', '#141210', 0.85),
                   clothes=[('male_elegantsuit01', '#2c3a5a', 0.8), ('shoes04', None, 0)]),
    # portrait-only leaders (also usable as NPCs at other stations)
    'varga': dict(gender=0.0, age=0.68, muscle=0.45, weight=0.45, height=0.62, proportions=0.8, race=(0.0, 0.1, 0.9), skin='toigo_light_skin_female_with_violet_makeup',
                  eyes='grey', brows='eyebrow003', lashes='eyelashes04', hair=('bob01', '#141210', 0.8),
                  clothes=[('female_elegantsuit01', '#b8913d', 0.75), ('shoes04', None, 0)]),
    'morrow': dict(gender=1.0, age=0.6, muscle=0.75, weight=0.55, height=0.58, race=(0.0, 0.0, 1.0), skin='young_caucasian_male',
                   eyes='lightblue', brows='eyebrow007', lashes='eyelashes01', hair=('short03', '#c8a060', 0.75),
                   clothes=[('male_elegantsuit01', '#e8e4d8', 0.85), ('shoes04', None, 0)]),
    'brandt': dict(gender=1.0, age=0.78, muscle=0.6, weight=0.62, height=0.52, race=(0.0, 0.0, 1.0), skin='middleage_caucasian_male',
                   eyes='grey', brows='eyebrow011', lashes='eyelashes01', hair=('short04', '#8a8884', 0.85),
                   clothes=[('male_elegantsuit01', '#23345a', 0.8), ('shoes04', None, 0)]),
    'noor': dict(gender=0.0, age=0.6, muscle=0.5, weight=0.45, height=0.55, race=(0.15, 0.25, 0.6), skin='cutoff3d_indian_female_enhanced',
                 eyes='brown', brows='eyebrow002', lashes='eyelashes03', hair=('long01', '#141210', 0.85),
                 clothes=[('male_casualsuit05', ('#2f5a8a', '#1c2430'), 0.8), ('shoes03', None, 0)]),
    'vesper': dict(gender=0.85, age=0.86, muscle=0.35, weight=0.4, height=0.5, race=(0.0, 0.2, 0.8), skin='old_caucasian_male',
                   eyes='ice', brows='eyebrow012', lashes='eyelashes01', hair=('short02', '#e8e6e0', 0.9),
                   clothes=[('male_casualsuit05', ('#5a4a6e', '#2a2530'), 0.8), ('shoes04', None, 0)]),
    'rook': dict(gender=1.0, age=0.64, muscle=0.85, weight=0.6, height=0.6, race=(0.85, 0.0, 0.15), skin='mindfront_skin_male_african_middleage',
                 eyes='brown', brows='eyebrow010', lashes='eyelashes01', hair=None,
                 clothes=[('male_casualsuit05', ('#2a2a2e', '#18181a'), 0.85), ('shoes03', None, 0)]),
    'saffi': dict(gender=0.0, age=0.52, muscle=0.45, weight=0.42, height=0.48, race=(0.0, 0.0, 1.0), skin='toigo_light_skin_female_ginger_with_makeup',
                  eyes='green', brows='eyebrow004', lashes='eyelashes04', hair=('long01', '#8a3a1a', 0.75),
                  clothes=[('female_elegantsuit01', '#b8406a', 0.85), ('shoes04', None, 0)]),
}

ROUGH = {'body': 0.52, 'eyes': 0.08, 'brows': 0.8, 'lashes': 0.8, 'hair': 0.55, 'cloth': 0.82, 'shoes': 0.55}


# ------------------------------------------------------------------------------------------------ helpers
def mhmat(path):
    out = {}
    for line in open(path, encoding='utf-8', errors='ignore'):
        p = line.strip().split(None, 1)
        if len(p) == 2:
            out[p[0]] = p[1]
    return out


def asset_dir(kind, name):
    return os.path.join(MPFB_DATA, kind, name)


def process_image(path, size, tint=None, amount=0.0, name=None):
    """Load, downscale and optionally re-tint (desaturate towards a colour, keep luminance detail)."""
    src = bpy.data.images.load(path, check_existing=True)
    w, h = src.size
    px = np.empty(w * h * 4, dtype=np.float32)
    src.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    f = max(1, max(w, h) // size)
    if f > 1:   # box-filter downscale
        px = px[:h - h % f, :w - w % f].reshape(h // f, f, w // f, f, 4).mean(axis=(1, 3))
    hh, ww = px.shape[:2]
    px = px.reshape(-1, 4).copy()
    img = bpy.data.images.new(name or os.path.basename(path), ww, hh, alpha=True)
    if src.colorspace_settings.name != 'sRGB':
        img.colorspace_settings.name = src.colorspace_settings.name
    if tint and amount > 0:
        # tint = '#top' or ('#top', '#denim'): blue denim areas of the MakeHuman outfits get their own colour
        rgb = px[:, :3]
        lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        valid = (px[:, 3] > 0.5) & (lum > 0.035)
        tints = tint if isinstance(tint, (tuple, list)) else (tint, None)
        denim = valid & ((rgb[:, 2] - rgb[:, 0]) > 0.06) if tints[1] else np.zeros(len(lum), bool)

        def apply(mask, hexcol):
            if not mask.any():
                return
            t = np.array([int(hexcol.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)  # display space
            m = float(np.median(lum[mask]))
            target = np.clip((lum[mask, None] / max(m, 0.02)) * t[None, :], 0, 1)
            rgb[mask] = rgb[mask] * (1 - amount) + target * amount

        apply(denim, tints[1]) if tints[1] else None
        apply((lum > 0.0) & ~denim, tints[0])
    img.pixels.foreach_set(px.ravel())
    img.pack()
    bpy.data.images.remove(src)
    return img


def make_mat(name, kind, diffuse, normal=None, alpha=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(bs.outputs[0], out.inputs[0])
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = diffuse
    nt.links.new(tx.outputs['Color'], bs.inputs['Base Color'])
    if alpha:
        nt.links.new(tx.outputs['Alpha'], bs.inputs['Alpha'])
        m.surface_render_method = 'DITHERED'
    bs.inputs['Roughness'].default_value = ROUGH.get(kind, 0.7)
    bs.inputs['Specular IOR Level'].default_value = 0.35 if kind in ('cloth', 'hair') else 0.5
    if normal is not None:
        nx = nt.nodes.new('ShaderNodeTexImage'); nx.image = normal; normal.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(nx.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
    return m


def tex_of(kind_dir, asset, key):
    d = asset_dir(kind_dir, asset)
    files = [f for f in os.listdir(d) if f.endswith('.mhmat')]
    mm = mhmat(os.path.join(d, files[0])) if files else {}
    f = mm.get(key)
    return os.path.join(d, os.path.basename(f)) if f else None


# ------------------------------------------------------------------------------------------------ build one human
def build(cid, spec):
    hi = HumanService._create_default_human_info_dict()
    hi['name'] = cid
    af, asn, ca = spec['race']
    hi['phenotype'].update({k: spec[k] for k in ('gender', 'age', 'muscle', 'weight', 'height') if k in spec})
    hi['phenotype']['proportions'] = spec.get('proportions', 0.6)
    hi['phenotype']['race'] = {'african': af, 'asian': asn, 'caucasian': ca}
    if spec['gender'] < 0.5:
        hi['phenotype']['cupsize'] = 0.5; hi['phenotype']['firmness'] = 0.5
    hi['rig'] = 'game_engine'
    hi['eyes'] = 'low-poly/low-poly.mhclo'
    hi['eyebrows'] = f"{spec.get('brows', 'eyebrow001')}/{spec.get('brows', 'eyebrow001')}.mhclo"
    if spec.get('lashes'):
        hi['eyelashes'] = f"{spec['lashes']}/{spec['lashes']}.mhclo"
    if spec.get('hair') and spec['hair'][0] not in ('fedora01', 'fedora_cocked'):
        hi['hair'] = f"{spec['hair'][0]}/{spec['hair'][0]}.mhclo"
    clothes = [c for c in spec['clothes']]
    if spec.get('hair') and spec['hair'][0].startswith('fedora'):
        clothes.append(spec['hair'])
    hi['clothes'] = [f'{c[0]}/{c[0]}.mhclo' for c in clothes]
    hi['skin_mhmat'] = f"{spec['skin']}/{spec['skin']}.mhmat"
    hi['skin_material_type'] = 'GAMEENGINE'
    st = HumanService.get_default_deserialization_settings()
    st['subdiv_levels'] = 0
    body = HumanService.deserialize_from_dict(hi, st)
    rig = bpy.data.objects[cid]
    parts = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith(cid + '.')]
    small = spec.get('small')
    tsize = 512 if small else 1024
    # ---- materials
    for o in parts:
        suffix = o.name[len(cid) + 1:]
        if o == body:
            kind, d, n = 'body', tex_of('skins', spec['skin'], 'diffuseTexture'), None
            img = process_image(d, 512 if small else 2048, name=f'{cid}_skin')
            mat = make_mat(f'{cid}_skin', 'body', img)
        elif suffix.startswith('low-poly'):
            d = os.path.join(MPFB_DATA, 'eyes/materials', f"{spec.get('eyes', 'brown')}_eye.png")
            mat = make_mat(f'{cid}_eyes', 'eyes', process_image(d, 256, name=f'{cid}_eyes'))
        elif suffix.startswith('eyebrow'):
            mat = make_mat(f'{cid}_brows', 'brows', process_image(tex_of('eyebrows', suffix, 'diffuseTexture'), 256, name=f'{cid}_brows'), alpha=True)
        elif suffix.startswith('eyelashes'):
            mat = make_mat(f'{cid}_lashes', 'lashes', process_image(tex_of('eyelashes', suffix, 'diffuseTexture'), 256, name=f'{cid}_lashes'), alpha=True)
        else:
            entry = next((c for c in clothes + ([spec['hair']] if spec.get('hair') else []) if c[0] == suffix), (suffix, None, 0))
            is_hair = os.path.isdir(asset_dir('hair', suffix))
            kd = 'hair' if is_hair else 'clothes'
            dpath = tex_of(kd, suffix, 'diffuseTexture')
            npath = tex_of(kd, suffix, 'normalmapTexture')
            img = process_image(dpath, tsize, entry[1], entry[2], name=f'{cid}_{suffix}')
            nimg = process_image(npath, tsize // 2 if not small else 256, name=f'{cid}_{suffix}_n') if (npath and not is_hair and not small) else None
            kind = 'hair' if is_hair else ('shoes' if suffix.startswith('shoes') else 'cloth')
            mat = make_mat(f'{cid}_{"hair" if is_hair else suffix}', kind, img, nimg, alpha=is_hair or suffix.startswith('fedora'))
        o.data.materials.clear()
        o.data.materials.append(mat)
    # ---- bake shape keys, apply masks, join into one skinned mesh
    for o in parts:
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = o; o.select_set(True)
        if o.data.shape_keys:
            bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
        for md in list(o.modifiers):
            if md.type == 'MASK':
                bpy.ops.object.modifier_apply(modifier=md.name)
            elif md.type == 'SUBSURF':
                o.modifiers.remove(md)
        # drop helper vertex groups that are not bones
        bones = set(rig.data.bones.keys())
        for vg in list(o.vertex_groups):
            if vg.name not in bones:
                o.vertex_groups.remove(vg)
        for p in o.data.polygons:
            p.use_smooth = True
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.name = cid + '_mesh'
    # drop unused armature modifiers duplicated by the join
    arms = [m for m in body.modifiers if m.type == 'ARMATURE']
    for m in arms[1:]:
        body.modifiers.remove(m)
    arms[0].object = rig
    return rig, body


# ------------------------------------------------------------------------------------------------ retargeting
LIMB = ('clavicle', 'upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky', 'thigh', 'calf', 'foot', 'ball')


def _assign(arm, act):
    arm.animation_data_create()
    arm.animation_data.action = act
    if act is not None and getattr(act, 'slots', None) and len(act.slots):
        arm.animation_data.action_slot = act.slots[0]


def import_sources():
    sc = bpy.context.scene
    sc.render.fps = FPS
    out = []
    for path in (UAL1, UAL2):
        before_o, before_a = set(bpy.data.objects), set(bpy.data.actions)
        if path.endswith('.fbx'):
            bpy.ops.import_scene.fbx(filepath=path)
        else:
            bpy.ops.import_scene.gltf(filepath=path)
        newo = [o for o in bpy.data.objects if o not in before_o]
        arm = next(o for o in newo if o.type == 'ARMATURE')
        for o in newo:
            if o.type == 'MESH':
                bpy.data.objects.remove(o)
        acts = {a.name.split('|')[-1]: a for a in bpy.data.actions if a not in before_a}
        if arm.animation_data:
            for t in list(arm.animation_data.nla_tracks):
                arm.animation_data.nla_tracks.remove(t)
        out.append((arm, acts))
    return out


def world_q(arm, pb):
    return (arm.matrix_world @ pb.matrix).to_quaternion()


def retarget(src, act, dst, clip):
    sc = bpy.context.scene
    smap = {b.name.lower(): b.name for b in src.pose.bones}
    order = sorted(dst.pose.bones, key=lambda pb: len(pb.parent_recursive))
    pairs = {pb.name: smap[pb.name.lower()] for pb in order if pb.name.lower() in smap and pb.name.lower() != 'root'}
    # references: source rest (a T-pose) and the target posed into the same T-pose (limbs direction-matched)
    _assign(src, None)
    for pb in src.pose.bones:
        pb.matrix_basis.identity()
    bpy.context.view_layer.update()
    smw = src.matrix_world
    src_rest = {s: world_q(src, src.pose.bones[s]) for s in pairs.values()}
    src_dir = {s: (smw.to_3x3() @ (src.pose.bones[s].tail - src.pose.bones[s].head)).normalized() for s in pairs.values()}
    dmw = dst.matrix_world
    dst_ref = {}
    for d, s in pairs.items():
        b = dst.data.bones[d]
        rest = (dmw @ b.matrix_local).to_quaternion()
        if d.lower().startswith(LIMB):
            ddir = (dmw.to_3x3() @ (b.tail_local - b.head_local)).normalized()
            dst_ref[d] = ddir.rotation_difference(src_dir[s]) @ rest
        else:
            dst_ref[d] = rest
    sp = pairs['pelvis']
    s_pel0 = smw @ src.data.bones[sp].head_local
    d_pel0 = dmw @ dst.data.bones['pelvis'].head_local
    ratio = d_pel0.z / max(s_pel0.z, 1e-3)
    new = bpy.data.actions.new(clip)
    _assign(dst, new)
    for pb in dst.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    _assign(src, act)
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    inv_q = dmw.inverted().to_quaternion()
    inv_m = dmw.inverted()
    prev = {}
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        posemat = {}
        ps = smw @ src.pose.bones[sp].head
        for pb in order:
            b = pb.bone
            if b.parent:
                M0 = posemat[b.parent.name] @ (b.parent.matrix_local.inverted() @ b.matrix_local)
            else:
                M0 = b.matrix_local.copy()
            if pb.name in pairs:
                s = pairs[pb.name]
                D = world_q(src, src.pose.bones[s]) @ src_rest[s].inverted()
                q = inv_q @ (D @ dst_ref[pb.name])
                loc = M0.to_translation()
                if pb.name == 'pelvis':
                    loc = inv_m @ (d_pel0 + (ps - s_pel0) * ratio)
                M = Matrix.LocRotScale(loc, q, Vector((1, 1, 1)))
            else:
                M = M0
            posemat[pb.name] = M
            basis = M0.inverted() @ M
            bq = basis.to_quaternion()
            if pb.name in prev:
                bq.make_compatible(prev[pb.name])
            prev[pb.name] = bq
            pb.rotation_quaternion = bq
            pb.keyframe_insert('rotation_quaternion', frame=f - f0)
            if pb.name == 'pelvis':
                pb.location = basis.to_translation()
                pb.keyframe_insert('location', frame=f - f0)
    _assign(dst, None)
    new.use_fake_user = True
    return new


def build_anims():
    swlib.fresh()
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    ref = dict(gender=0.5, age=0.5, muscle=0.5, weight=0.5, height=0.5, race=(0.33, 0.33, 0.34), skin='young_caucasian_male',
               eyes='brown', brows='eyebrow001', hair=None, clothes=[], small=True)
    rig, mesh = build('ref', ref)
    bpy.data.objects.remove(mesh)
    rig.name = 'Armature'
    srcs = import_sources()
    made = []
    for arm, acts in srcs:
        for nm, act in acts.items():
            if nm in CLIPS:
                made.append(retarget(arm, act, rig, CLIPS[nm]))
    for arm, acts in srcs:
        bpy.data.objects.remove(arm)
    # one NLA track per clip so the exporter emits each as its own animation
    rig.animation_data_create()
    for a in made:
        tr = rig.animation_data.nla_tracks.new(); tr.name = a.name
        st = tr.strips.new(a.name, 0, a)
        if getattr(a, 'slots', None) and len(a.slots):
            st.action_slot = a.slots[0]
    _assign(rig, None)
    # rest heights for runtime pelvis scaling
    meta = {'pelvis': list(rig.data.bones['pelvis'].head_local), 'clips': [a.name for a in made], 'fps': FPS}
    path = swlib.out('npcs', 'anims.glb')
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=True,
                              export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_frame_step=2,
                              export_optimize_animation_size=True, export_skins=True, export_yup=True)
    json.dump(meta, open(swlib.out('npcs', 'anims.json'), 'w'))
    return {'clips': meta['clips'], 'size': os.path.getsize(path)}


def export_char(cid):
    swlib.fresh()
    for img in list(bpy.data.images):
        if img.users == 0:
            bpy.data.images.remove(img)
    rig, mesh = build(cid, CHARS[cid])
    if rig.animation_data:
        rig.animation_data.action = None
    path = swlib.out('npcs', f'{cid}.glb')
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True); mesh.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=False,
                              export_skins=True, export_morph=False, export_yup=True, export_apply=True,
                              export_image_format='WEBP', export_image_quality=82, export_materials='EXPORT')
    tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    return {'id': cid, 'tris': tris, 'kb': os.path.getsize(path) // 1024, 'height': round(max((mesh.matrix_world @ v.co).z for v in mesh.data.vertices), 3)}



# comm-only faces: speakers you only ever see on the radio screen (portrait only, never exported as game characters)
CHARS.update({
    'c_schakal1': dict(comm=True, gender=1.0, age=0.42, muscle=0.8, weight=0.5, height=0.55, race=(0.1, 0.0, 0.9), skin='young_caucasian_male2',
                       eyes='grey', brows='eyebrow011', lashes='eyelashes01', hair=('short01', '#2a2420', 0.9),
                       clothes=[('male_casualsuit05', ('#3a2a22', '#1a1614'), 0.85), ('shoes03', None, 0)]),
    'c_schakal2': dict(comm=True, gender=0.0, age=0.4, muscle=0.7, weight=0.45, height=0.5, race=(0.3, 0.2, 0.5), skin='young_caucasian_female2',
                       eyes='ice', brows='eyebrow006', lashes='eyelashes02', hair=('bob02', '#a8261c', 0.85),
                       clothes=[('female_casualsuit01', ('#2a2a2e', '#18181a'), 0.85), ('shoes04', None, 0)]),
    'c_lotse': dict(comm=True, gender=0.0, age=0.5, muscle=0.5, weight=0.45, height=0.5, race=(0.2, 0.6, 0.2), skin='young_asian_female',
                    eyes='brown', brows='eyebrow003', lashes='eyelashes03', hair=('ponytail01', '#181412', 0.9),
                    clothes=[('female_elegantsuit01', '#2f5a8a', 0.8), ('shoes04', None, 0)]),
    'c_kollektiv': dict(comm=True, gender=1.0, age=0.55, muscle=0.6, weight=0.6, height=0.55, race=(0.5, 0.1, 0.4), skin='young_african_male',
                        eyes='brown', brows='eyebrow009', lashes='eyelashes01', hair=('short03', '#1a1614', 0.9),
                        clothes=[('male_worksuit01', '#2f6aa8', 0.85), ('shoes03', None, 0)]),
    'c_frachter': dict(comm=True, gender=1.0, age=0.7, muscle=0.55, weight=0.7, height=0.5, race=(0.0, 0.1, 0.9), skin='old_caucasian_male',
                       eyes='blue', brows='eyebrow005', lashes='eyelashes01', hair=('short02', '#9a948c', 0.8),
                       clothes=[('male_worksuit01', '#5a6068', 0.85), ('shoes03', None, 0)]),
    'c_wache': dict(comm=True, gender=1.0, age=0.48, muscle=0.75, weight=0.5, height=0.6, race=(0.1, 0.4, 0.5), skin='middleage_asian_male',
                    eyes='brown', brows='eyebrow012', lashes='eyelashes01', hair=('short04', '#141210', 0.9),
                    clothes=[('male_elegantsuit01', '#e8e4d8', 0.85), ('shoes04', None, 0)]),
})

PORTRAITS = {
    'c_schakal1': ('#ff5a4a', '#1a0806'), 'c_schakal2': ('#ff5a4a', '#1a0806'), 'c_lotse': ('#8fd18f', '#08140c'),
    'c_kollektiv': ('#6fc3ff', '#06121c'), 'c_frachter': ('#c8c8c8', '#101214'), 'c_wache': ('#f2c35a', '#14100a'),
    'mags': ('#ffcf7a', '#2a1a10'), 'oduya': ('#8fd18f', '#0c1a10'), 'haendler': ('#d39a6a', '#1c120a'), 'juno': ('#d7b8ff', '#140c1e'),
    'varga': ('#f2c35a', '#1c1406'), 'morrow': ('#f2c35a', '#14100a'), 'brandt': ('#9fb4ff', '#0a0e1c'), 'noor': ('#6fc3ff', '#06121c'),
    'vesper': ('#d7b8ff', '#100a1a'), 'rook': ('#ff5a4a', '#1a0806'), 'saffi': ('#ff8ad8', '#1a0814'),
    'gast_kesh': ('#9fd18f', '#0c140a'), 'gast_rana': ('#c8a0ff', '#120c1a'), 'gast_tomas': ('#d8b07a', '#16100a'), 'gast_ilse': ('#7fe0d8', '#061414'),
    'crew_a': ('#9fc4ff', '#0a0e16'), 'crew_b': ('#9fc4ff', '#0a0e16'), 'crew_c': ('#bfe6ff', '#08121a'), 'crew_d': ('#ffd36a', '#16120a'), 'crew_e': ('#9fb4ff', '#0a0c18'),
}


def portraits(ids):
    """Cycles head-and-shoulders portraits of the MakeHuman cast for the dialogue box."""
    swlib.fresh()
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    srcs = import_sources()
    talk = next((arm, acts['Idle_Talking_Loop']) for arm, acts in srcs if 'Idle_Talking_Loop' in acts)
    sc = swlib.cycles(samples=128, w=512, h=512, transform='AgX', look='AgX - Punchy', denoise=True)
    sc.world = sc.world or bpy.data.worlds.new('pw')
    sc.world.use_nodes = True
    nt = sc.world.node_tree; nt.nodes.clear()
    bgn = nt.nodes.new('ShaderNodeBackground'); out = nt.nodes.new('ShaderNodeOutputWorld'); nt.links.new(bgn.outputs[0], out.inputs['Surface'])
    cam_d = bpy.data.cameras.new('pc'); cam_d.lens = 90
    cam = bpy.data.objects.new('pc', cam_d); sc.collection.objects.link(cam); sc.camera = cam

    def light(nm, e, loc, col, size, tgt):
        ld = bpy.data.lights.new(nm, 'AREA'); ld.energy = e; ld.color = swlib.hexc(col)[:3]; ld.size = size
        lo = bpy.data.objects.new(nm, ld); sc.collection.objects.link(lo); lo.location = loc
        lo.rotation_euler = (tgt - lo.location).to_track_quat('-Z', 'Y').to_euler()
        return lo
    made = []
    for cid in ids:
        if cid not in PORTRAITS:
            continue
        col, bg = PORTRAITS[cid]
        rig, mesh = build(cid, CHARS[cid])
        act = retarget(talk[0], talk[1], rig, 'p_' + cid)
        _assign(rig, act)
        sc.frame_set(int(act.frame_range[0] + (act.frame_range[1] - act.frame_range[0]) * 0.35))
        bpy.context.view_layer.update()
        head = rig.matrix_world @ rig.pose.bones['head'].head
        tgt = head + Vector((0, 0, 0.02))
        cam.location = tgt + Vector((0.32, -1.25, 0.06))
        cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
        bgn.inputs['Color'].default_value = swlib.hexc(bg); bgn.inputs['Strength'].default_value = 1.0
        ls = [light('k', 55, tgt + Vector((0.8, -0.9, 0.6)), '#ffe6cc', 0.9, tgt), light('r', 110, tgt + Vector((-0.7, 0.6, 0.35)), col, 0.6, tgt),
              light('f', 10, tgt + Vector((-0.7, -1.0, -0.2)), '#9fb4d8', 1.2, tgt)]
        made.append(swlib.save_render(swlib.out('portraits', cid + '.jpg'), fmt='JPEG', quality=88))
        for l in ls:
            bpy.data.objects.remove(l, do_unlink=True)
        for o in [rig, mesh]:
            bpy.data.objects.remove(o, do_unlink=True)
    return made

if __name__ == '__main__' or True:
    what = BL_ARGS[0] if BL_ARGS else 'chars'
    ids = BL_ARGS[1:] if len(BL_ARGS) > 1 else [c for c in CHARS if not CHARS[c].get('comm')]
    if what == 'anims':
        result = build_anims()
    elif what == 'chars':
        result = {"chars": [export_char(c) for c in ids]}
    elif what == 'portraits':
        result = {'portraits': portraits(ids if len(BL_ARGS) > 1 else list(PORTRAITS))}
