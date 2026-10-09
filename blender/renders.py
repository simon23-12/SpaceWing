"""Beauty renders for menus and cutscenes. Usage: bl.py blender/renders.py title|hangar|bar|kraken|vault|dock [--samples N]"""
import importlib, math, os
import bpy
from mathutils import Vector
import swlib
importlib.reload(swlib)
swlib.init(REPO)
import swship, ships, stations, interiors
for m in (swship, ships, stations, interiors):
    importlib.reload(m)
from swlib import G, hexc
R = math.radians
what = BL_ARGS[0]
flags = BL_ARGS[1:]
samples = int(flags[flags.index('--samples') + 1]) if '--samples' in flags else 160


def camera(loc, target, lens=35):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new('cam'); cd.lens = lens; cd.clip_end = 1e6; cd.clip_start = 0.05
    c = bpy.data.objects.new('cam', cd); sc.collection.objects.link(c)
    c.location = loc
    c.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = c
    return c


def sun(rot, energy=4.0, color='#fff2e0', direction=None):
    """rot: euler, or pass direction=(x,y,z) = direction the light travels."""
    l = bpy.data.lights.new('sun', 'SUN'); l.energy = energy; l.angle = R(0.6); l.color = hexc(color)[:3]
    o = bpy.data.objects.new('sun', l); bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = Vector(direction).normalized().to_track_quat('-Z', 'Y').to_euler() if direction else rot
    return o


def hide_fields():
    for o in bpy.data.objects:
        if o.name.startswith('field'):
            o.visible_camera = False


def moon(name, tex, radius, loc, rot=(0, 0, 0)):
    m = swlib.new_mat('moon_' + name); m.node_tree.nodes.clear(); g = G(m.node_tree)
    t = g.node('ShaderNodeTexImage'); t.image = bpy.data.images.load(os.path.join(REPO, f'public/assets/planets/{tex}.jpg'), check_existing=True)
    h = g.node('ShaderNodeTexImage'); h.image = bpy.data.images.load(os.path.join(REPO, f'public/assets/planets/{tex}_h.jpg'), check_existing=True)
    h.image.colorspace_settings.name = 'Non-Color'
    bp = g.node('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.6; g.l.new(h.outputs['Color'], bp.inputs['Height'])
    bs = g.node('ShaderNodeBsdfDiffuse'); g.l.new(t.outputs['Color'], bs.inputs['Color']); g.l.new(bp.outputs['Normal'], bs.inputs['Normal'])
    g.output(bs.outputs[0])
    bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=64, radius=radius, location=loc)
    o = bpy.context.active_object; o.name = name; o.data.materials.append(m); o.rotation_euler = rot
    for p in o.data.polygons: p.use_smooth = True
    return o


def save(name, w=1920, h=1080, look='AgX - Punchy'):
    sc = swlib.cycles(samples=samples, w=w, h=h, transform='AgX', look=look, denoise=True)
    sc.cycles.max_bounces = 6
    return swlib.save_render(swlib.out('ui', name + '.jpg'), fmt='JPEG', quality=90)


swlib.fresh(); swship.MATS.clear(); interiors.INFO.clear()
for l in list(bpy.data.lights):
    bpy.data.lights.remove(l)
res = {}
if what == 'title':
    P, E, _ = ships.spacewing()
    interiors.setup_world_space(strength=0.7, saturn=True, sat_dir=(-0.62, 1.0, 0.28), sat_dist=2400, sat_size=560)
    for o in [o for o in bpy.data.objects if o.name == 'SUN_BG']:
        bpy.data.objects.remove(o, do_unlink=True)
    sat = bpy.data.objects.get('SATURN_BG')
    if sat:
        sat.rotation_euler = (R(-28), R(12), R(28))
    sun(None, 5.0, direction=(-0.55, 0.75, -0.35))
    rim = bpy.data.lights.new('rim', 'AREA'); rim.energy = 3000; rim.size = 10; rim.color = (0.55, 0.7, 1.0)
    ro = bpy.data.objects.new('rim', rim); bpy.context.scene.collection.objects.link(ro); ro.location = (-8, 14, 6)
    ro.rotation_euler = (Vector((0, 0, 0)) - ro.location).to_track_quat('-Z', 'Y').to_euler()
    camera((9.5, -15.0, 2.2), (-6.5, 2.0, 2.2), lens=30)
    res['r'] = save('title')
elif what == 'hangar':
    S, Gl, Gs, X = interiors.hangar()
    interiors.setup_world_space(strength=0.8, saturn=True, sat_dir=(1.0, -0.15, 0.12), sat_dist=2600, sat_size=420)
    P, E, _ = ships.spacewing()
    for o in P:
        o.rotation_euler.z += R(90)
        o.location = Vector(o.location)
    from mathutils import Matrix
    for o in P:
        if o.type == 'MESH':
            swship.apply_all(o)
            o.data.transform(Matrix.Rotation(R(90), 4, 'Z'))
            o.data.transform(Matrix.Translation((2, 0, 2.3)))
    hide_fields()
    camera((-14, -10, 3.2), (4, 1, 2.6), lens=22)
    res['r'] = save('hangar')
elif what == 'bar':
    S, Gl, Gs, X = interiors.bar()
    interiors.setup_world_space(strength=0.8, saturn=True, sat_dir=(0.3, 1.0, 0.1), sat_dist=2600, sat_size=380)
    for o in [o for o in bpy.data.objects if o.name == 'SUN_BG']:
        bpy.data.objects.remove(o, do_unlink=True)
    camera((5.5, -5.2, 1.65), (-3.5, 3.0, 1.2), lens=20)
    res['r'] = save('bar')
elif what == 'kraken':
    interiors.setup_world_space(strength=0.6, saturn=True, sat_dir=(0.8, 1.0, 0.25), sat_dist=60000, sat_size=3000)
    for o in [o for o in bpy.data.objects if o.name == 'SUN_BG']:
        bpy.data.objects.remove(o, do_unlink=True)
    t = moon('titan', 'titan', 2575, (0, 3600, -1400))
    atm = swlib.new_mat('atm'); atm.node_tree.nodes.clear(); ag = G(atm.node_tree)
    vol = ag.node('ShaderNodeVolumeScatter'); vol.inputs['Color'].default_value = hexc('#ffb060'); vol.inputs['Density'].default_value = 0.004
    out = ag.node('ShaderNodeOutputMaterial'); ag.l.new(vol.outputs[0], out.inputs['Volume'])
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=2575 * 1.04, location=(0, 3600, -1400))
    bpy.context.active_object.data.materials.append(atm)
    sun((R(80), R(30), R(-30)), 4.0, '#ffe8c8')
    P, E, _ = ships.lanze()
    from mathutils import Matrix
    meshes = [o for o in P if o.type == 'MESH']
    camera((18, -30, 6), (0, 0, 0), lens=40)
    res['r'] = save('kraken')
elif what == 'vault':
    interiors.setup_world_space(strength=0.7, saturn=True, sat_dir=(-0.6, 1.0, 0.3), sat_dist=400000, sat_size=8000)
    for o in [o for o in bpy.data.objects if o.name == 'SUN_BG']:
        bpy.data.objects.remove(o, do_unlink=True)
    moon('iapetus', 'iapetus', 735, (0, 1300, -500), rot=(0, 0, R(-70)))
    sun((R(75), R(-40), R(20)), 4.5)
    glow = swship.mat_emit('vaultglow', '#c8a0ff', 40)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=6, location=(0, 1300 - 735 * 0.7, -500 + 735 * 0.71))
    bpy.context.active_object.data.materials.append(glow)
    camera((0, -260, 160), (0, 1300, -380), lens=35)
    res['r'] = save('vault')
elif what == 'dock':
    P, G2, field = stations.small()
    interiors.setup_world_space(strength=0.8, saturn=True, sat_dir=(-1.0, 1.0, 0.2), sat_dist=30000, sat_size=4500)
    for o in [o for o in bpy.data.objects if o.name == 'SUN_BG']:
        bpy.data.objects.remove(o, do_unlink=True)
    sun((R(60), R(20), R(-60)), 4.0)
    hide_fields()
    camera((380, -260, 90), (0, 0, 0), lens=28)
    res['r'] = save('dock')
result = res
