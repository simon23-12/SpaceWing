"""Beauty renders for menus and cutscenes. Usage: bl.py blender/renders.py title|hangar|bar|kraken|vault|dock [--samples N]"""
import importlib, math, os
import bpy
from mathutils import Vector, Matrix
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


def moon(name, tex, radius, loc, rot=(0, 0, 0), face=None, cam=None):
    """Moon with the game's texture, mapped exactly like three.js SphereGeometry (so features line up).
    face: a direction in three.js object space (as used in planets.py) that should look at `cam`."""
    m = swlib.new_mat('moon_' + name); m.node_tree.nodes.clear(); g = G(m.node_tree)
    tc = g.node('ShaderNodeTexCoord')
    bx, by, bz = g.sep(tc.outputs['Object'])
    x3, y3, z3 = bx, bz, g.mul(by, -1.0)                      # Blender -> three.js axes
    ln = g.math('SQRT', g.add(g.add(g.mul(x3, x3), g.mul(y3, y3)), g.mul(z3, z3)))
    u = g.math('FRACT', g.add(g.div(g.math('ARCTAN2', z3, g.mul(x3, -1.0)), 2 * math.pi), 1.0))
    v = g.sub(1.0, g.div(g.math('ARCCOSINE', g.div(y3, ln)), math.pi))
    uv = g.combine(u, v, 0.0)
    t = g.node('ShaderNodeTexImage'); t.image = bpy.data.images.load(os.path.join(REPO, f'public/assets/planets/{tex}.jpg'), check_existing=True)
    h = g.node('ShaderNodeTexImage'); h.image = bpy.data.images.load(os.path.join(REPO, f'public/assets/planets/{tex}_h.jpg'), check_existing=True)
    h.image.colorspace_settings.name = 'Non-Color'
    g._in(t.inputs['Vector'], uv); g._in(h.inputs['Vector'], uv)
    bp = g.node('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.6; g.l.new(h.outputs['Color'], bp.inputs['Height'])
    bs = g.node('ShaderNodeBsdfDiffuse'); g.l.new(t.outputs['Color'], bs.inputs['Color']); g.l.new(bp.outputs['Normal'], bs.inputs['Normal'])
    g.output(bs.outputs[0])
    bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=64, radius=radius, location=loc)
    o = bpy.context.active_object; o.name = name; o.data.materials.append(m); o.rotation_euler = rot
    if face is not None and cam is not None:
        fb = Vector((face[0], -face[2], face[1])).normalized()           # three.js dir -> Blender object dir
        want = (Vector(cam) - Vector(loc)).normalized()
        o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = fb.rotation_difference(want)
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
    # Main menu: Hochstation Cassini in Rhea orbit, Saturn behind - no ship (speed streaks are added live in the browser)
    static, ring, gs, gr, field = stations.cassini()
    for o in ring + gr:
        o.rotation_euler.z += R(12)
    hide_fields()
    field.hide_render = True
    piv = bpy.data.objects.new('station_pivot', None); bpy.context.scene.collection.objects.link(piv)
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.parent is None:
            o.parent = piv
    piv.rotation_euler = (R(-62), R(18), 0)
    C = Vector((1250.0, -1900.0, 260.0))
    T = Vector((-520.0, 0.0, 120.0))
    f = (T - C).normalized()
    right = f.cross(Vector((0, 0, 1))).normalized(); up = right.cross(f).normalized()
    sat_d = (f + up * 0.12 + right * 0.12).normalized()
    interiors.setup_world_space(strength=0.55, saturn=True, sat_dir=tuple(sat_d), sat_dist=90000, sat_size=10500)
    satob = bpy.data.objects['SATURN_BG']
    satob.location = C + sat_d * 90000
    ring_n = (up * math.cos(R(22)) - sat_d * math.sin(R(22))).normalized()
    satob.rotation_euler = ring_n.to_track_quat('Z', 'Y').to_euler()
    for o in [o for o in bpy.data.objects if o.name == 'SUN_BG']:
        bpy.data.objects.remove(o, do_unlink=True)
    rhea_d = (f - right * 0.36 + up * 0.17).normalized()
    moon('rhea', 'rhea', 1500, tuple(C + rhea_d * 30000), rot=(R(10), 0, R(40)))
    sun(None, 5.2, direction=tuple((f * 0.3 - right * 0.85 - up * 0.2).normalized()))
    rim = bpy.data.lights.new('rim', 'AREA'); rim.energy = 2.0e7; rim.size = 400; rim.color = (0.55, 0.7, 1.0)
    ro = bpy.data.objects.new('rim', rim); bpy.context.scene.collection.objects.link(ro); ro.location = (-900, 1600, 900)
    ro.rotation_euler = (Vector((0, 0, 0)) - ro.location).to_track_quat('-Z', 'Y').to_euler()
    cam = camera(tuple(C), tuple(T), lens=32)
    cam.data.clip_end = 1e7
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
elif what in ('quelle', 'herschel'):
    # station panels for the moon stations: each moon gets its own picture
    P, G2, field = stations.small()
    hide_fields()
    field.hide_render = True
    piv = bpy.data.objects.new('st_piv', None); bpy.context.scene.collection.objects.link(piv)
    for o in P + G2:
        if o.parent is None: o.parent = piv
    piv.rotation_euler = (R(12), R(-8), R(35))
    if what == 'quelle':
        interiors.setup_world_space(strength=0.55, saturn=True, sat_dir=(-0.9, 1.0, 0.45), sat_dist=90000, sat_size=11000)
        for o in [o for o in bpy.data.objects if o.name == 'SUN_BG']:
            bpy.data.objects.remove(o, do_unlink=True)
        CAM = Vector((430, -330, 70)); C = Vector((-1500.0, 5600.0, -2300.0)); Rm = 2600.0
        v = (C - CAM).normalized(); right = v.cross(Vector((0, 0, 1))).normalized(); up = right.cross(v).normalized()
        pole = (-right * 0.85 - up * 0.35 - v * 0.3).normalized()             # south pole on the left limb, towards the station
        moon('enceladus', 'enceladus', Rm, tuple(C), face=(0.0, -1.0, 0.0), cam=tuple(C + pole * 10))
        vm = swlib.new_mat('plume'); vm.node_tree.nodes.clear(); vg = G(vm.node_tree)
        tc = vg.node('ShaderNodeTexCoord'); x, y, z = vg.sep(tc.outputs['Generated'])
        r = vg.math('SQRT', vg.add(vg.mul(vg.sub(x, 0.5), vg.sub(x, 0.5)), vg.mul(vg.sub(y, 0.5), vg.sub(y, 0.5))))
        dens = vg.mul(vg.pow(vg.smooth(r, 0.5, 0.0), 3.0), vg.mul(vg.smooth(z, 0.0, 0.25), vg.smooth(z, 1.0, 0.3)))
        nz, _ = vg.noise(vg.vscale(tc.outputs['Object'], 0.004), 2.0, 4, 0.6)
        vol = vg.node('ShaderNodeVolumePrincipled'); vol.inputs['Color'].default_value = hexc('#e8f4ff')
        vg._in(vol.inputs['Density'], vg.mul(vg.mul(dens, vg.add(0.1, nz)), 0.0006))
        vol.inputs['Emission Color'].default_value = hexc('#bfe0ff'); vg._in(vol.inputs['Emission Strength'], vg.mul(vg.mul(dens, nz), 0.006))
        out = vg.node('ShaderNodeOutputMaterial'); vg.l.new(vol.outputs[0], out.inputs['Volume'])
        for k, off in enumerate((Vector((0, 0, 0)), right * 0.25, -right * 0.22, v * 0.2)):
            d = (pole + off).normalized()
            bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=40, radius2=900, depth=3600, location=(0, 0, 0))
            cone = bpy.context.active_object; cone.name = f'plume{k}'
            cone.data.materials.append(vm)
            cone.rotation_mode = 'QUATERNION'; cone.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
            cone.location = C + d * (Rm + 2000)
        sun(None, 4.5, direction=tuple((v * 0.35 + right * 0.8 - up * 0.3).normalized()))
        rim = bpy.data.lights.new('rim', 'AREA'); rim.energy = 1.5e7; rim.size = 400; rim.color = (0.7, 0.85, 1.0)
        ro = bpy.data.objects.new('rim', rim); bpy.context.scene.collection.objects.link(ro); ro.location = (-700, 900, 600)
        ro.rotation_euler = (Vector((0, 0, 0)) - ro.location).to_track_quat('-Z', 'Y').to_euler()
        camera(tuple(CAM), (-60, 60, -40), lens=26)
    else:
        interiors.setup_world_space(strength=0.45, saturn=True, sat_dir=(1.0, 1.0, 0.5), sat_dist=90000, sat_size=13000)
        for o in [o for o in bpy.data.objects if o.name == 'SUN_BG']:
            bpy.data.objects.remove(o, do_unlink=True)
        C = Vector((-600.0, 4200.0, -1500.0)); Rm = 2300.0
        moon('mimas', 'mimas', Rm, tuple(C), face=(-0.45, 0.25, -0.86), cam=(330, -330, 300))
        sun(None, 4.6, direction=(-0.9, 0.35, -0.25))
        red = bpy.data.lights.new('red', 'AREA'); red.energy = 6e7; red.size = 500; red.color = (1.0, 0.35, 0.2)
        ro = bpy.data.objects.new('red', red); bpy.context.scene.collection.objects.link(ro); ro.location = (600, 700, -300)
        ro.rotation_euler = (Vector((0, 0, 0)) - ro.location).to_track_quat('-Z', 'Y').to_euler()
        camera((430, -330, 120), (-40, 60, -60), lens=26)
    res['r'] = save(what)
result = res
