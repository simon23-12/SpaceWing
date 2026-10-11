"""One station model per outpost, so no two stations look alike.
Usage: bl.py blender/outposts.py <id>|all [--preview-only] [--no-preview]
ids: lagrange, inktomi, quelle, kraken, ringgilde, herschel, gewoelbe, schakalnest
Each writes public/assets/stations/station_<id>/ (model.glb, baked textures, meta.json with dock and colliders).
Common layout: the docking bay sits at the +X end and opens along +X (ships approach along that axis)."""
import importlib, math, os, json, random
import bpy, bmesh
from mathutils import Vector
import swlib, swship
importlib.reload(swlib); importlib.reload(swship)
from swship import box, cyl, sphere, greebles, apply_all, smooth, lathe
from swship import mat_paint, mat_metal, mat_rubber, mat_emit

try:
    REPO
except NameError:
    REPO = swlib.REPO_PATH
swlib.init(REPO)
import stations as ST   # bake/export helpers (its main only runs when executed directly)
importlib.reload(ST)
R = math.radians
b2t = ST.b2t


class Kit:
    """Collects baked parts (P), glow parts (G), the bay field and the parts that get box colliders."""

    def __init__(self, seed):
        self.P, self.G, self.solid = [], [], []
        self.field = None
        self.rnd = random.Random(seed)
        self.dark = mat_rubber('dark_st')
        self.metal = mat_metal('metal_st', '#5f6267', 0.45, metal=0.8, scale=0.4)

    def p(self, ob, solid=False):
        self.P.append(ob)
        if solid:
            self.solid.append(ob)
        return ob

    def g(self, ob):
        self.G.append(ob)
        return ob

    def col(self, size, loc):
        """Invisible collider box (for open structures such as racks and towers)."""
        o = box(f'col{len(self.solid)}', self.dark, size, loc)
        o.hide_render = True
        self.solid.append(o)
        return o

    def dock(self, x, hull, w=60, h=44, depth=40, light='#6fd0ff'):
        """Bay module whose open face is at x + depth/2; returns the bay mouth x."""
        cx = x + depth / 2
        self.p(box('dock', hull, (depth, w, h), (cx, 0, 0), bevel=2), solid=True)
        self.p(box('dock_in', self.dark, (6, w - 14, h - 14), (cx + depth / 2 - 2, 0, 0)))
        bay = mat_emit('glow_bay', light, 8)
        for z in (-(h - 14) / 2 - 1, (h - 14) / 2 + 1):
            self.g(box(f'bay{z}', bay, (1, w - 12, 1), (cx + depth / 2 + 1, 0, z)))
        # approach lights: a lit runway in front of the bay
        lane = mat_emit('glow_lane', '#9fe0ff', 10)
        for k in range(1, 7):
            for s in (-1, 1):
                self.g(box(f'lane{k}{s}', lane, (1.2, 1.2, 1.2), (cx + depth / 2 + 14 * k, s * (w / 2 + 4), -(h / 2) - 2)))
        f = box('field_dock', self.dark, (0.4, w - 14, h - 14), (cx + depth / 2 + 0.5, 0, 0))
        f.data.materials.clear(); f.data.materials.append(mat_emit('glow_field', '#4aa0ff', 1))
        self.field = f
        return cx + depth / 2 + 1

    def windows(self, name, color, centers, size=(2.4, 2.4, 0.4), strength=6):
        m = mat_emit('glow_win' + name, color, strength)
        for i, c in enumerate(centers):
            self.g(box(f'w{name}{i}', m, size, c))

    def beacon(self, loc, color='#ff3020', r=2):
        self.g(sphere(f'beacon{len(self.G)}', mat_emit('glow_blink_red' if color == '#ff3020' else 'glow_blink_' + color[1:], color, 14), r, loc))


def spin(name, prof, mat, at=(0, 0, 0), n=32):
    """Solid of revolution around a Z-parallel axis; prof = [(r, z), ...]."""
    return lathe(name, [(z, r) for r, z in prof], mat, n=n, axis_pos=at, rot=(R(90), 0, 0))


def ring_windows(cx, cz, r, n, y, axis='x'):
    """Window positions around a cylinder along X (or Z) of radius r."""
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        if axis == 'x':
            out.append((cx, y + math.cos(a) * r, cz + math.sin(a) * r))
        else:
            out.append((cx + math.cos(a) * r, y + math.sin(a) * r, cz))
    return out


# ======================================================================= Frachtdepot L4 (cargo depot + hydroponics)

def lagrange():
    k = Kit(4)
    hull = mat_paint('hull_l4', '#c9c6bc', color2='#a9aba8', wear=0.45, rust=0.1, dirt=0.55, metal=0.35, scale=0.3, stripe=('z', 0.0, 2.0), stripe_color='#2a7fc0')
    truss = mat_metal('truss_l4', '#7d8288', 0.5, metal=0.85, scale=0.5)
    cols = ['#b8452a', '#2f6aa8', '#d0a028', '#3d7a48', '#8a8f95', '#c46a1e']
    cmats = [mat_paint(f'cont{i}', c, wear=0.6, dirt=0.6, scale=1.5, panel=0.5) for i, c in enumerate(cols)]
    green = mat_emit('glow_green_l4', '#9cff8a', 5)
    # long spine along X
    k.p(cyl('spine', hull, 9, 320, (-60, 0, 0), rot=(0, R(90), 0), n=20), solid=True)
    for x in range(-210, 100, 20):
        for s in (-1, 1):
            k.p(box(f'tr{x}{s}', truss, (1.2, 1.2, 70), (x, s * 14, 0)))
            k.p(box(f'tl{x}{s}', truss, (1.2, 28, 1.2), (x, 0, s * 34)))
    # container racks above and below the spine
    for x in range(-200, 90, 14):
        for s in (-1, 1):
            for level in range(k.rnd.randint(1, 3)):
                m = cmats[k.rnd.randrange(len(cmats))]
                k.p(box(f'c{x}{s}{level}', m, (12, 6, 5.5), (x, k.rnd.choice((-7, 0, 7)), s * (12 + level * 6.2)), bevel=0.15))
    k.col((300, 30, 64), (-55, 0, 0))   # the racks as one collider
    # gantry cranes running on the spine
    for x in (-150, -40, 50):
        k.p(box(f'gantry{x}', mat_paint(f'gant{x}', '#d8a21a', wear=0.6, dirt=0.5, scale=1), (4, 44, 4), (x, 0, 44)))
        for s in (-1, 1):
            k.p(box(f'gleg{x}{s}', truss, (3, 3, 44), (x, s * 21, 22)))
        k.p(cyl(f'gcable{x}', k.dark, 0.3, 20, (x, 8, 30), rot=(0, 0, 0), n=6))
        k.p(box(f'gspreader{x}', truss, (13, 7, 1), (x, 8, 20)))
    # hydroponic farm: a fan of greenhouse drums at the far end
    k.p(sphere('farm_hub', hull, 26, (-240, 0, 0), seg=40, rings=20), solid=True)
    for i in range(6):
        a = 2 * math.pi * i / 6
        c = (-240, math.cos(a) * 52, math.sin(a) * 52)
        k.p(cyl(f'farm{i}', hull, 11, 36, c, rot=(a - R(90), 0, 0), n=24), solid=True)
        k.windows(f'f{i}', '#9cff8a', [(-240 + s * 11.2, math.cos(a) * rr, math.sin(a) * rr) for s in (-1, 1) for rr in (40, 50, 60)], size=(0.6, 6, 6), strength=3)
    k.p(box('solarL4', mat_metal('solar_l4', '#16233c', 0.25, metal=0.6, scale=3.0, grime=0.1), (40, 2, 120), (-240, 0, 0)))
    # control tower near the dock
    k.p(cyl('tower', hull, 12, 50, (80, 0, 30), rot=(0, 0, 0), n=20), solid=True)
    k.windows('t', '#ffd9a0', ring_windows(80, 48, 12.2, 10, 0, axis='z'), size=(2.4, 2.4, 2.4))
    mouth = k.dock(100, hull, w=56, h=40)
    k.beacon((80, 0, 58)); k.beacon((-240, 0, 30))
    k.P += greebles(k.P[0], k.metal, count=60, size=(1, 4), height=(0.4, 1.5), seed=11)
    return k, mouth, 420


# ======================================================================= Bergbauposten Inktomi (drilling rig)

def inktomi():
    k = Kit(7)
    hull = mat_paint('hull_ink', '#8c7d68', color2='#6f6558', wear=0.7, rust=0.45, dirt=0.8, metal=0.3, scale=0.3, stripe=('z', 6.0, 3.0), stripe_color='#d8a21a')
    truss = mat_metal('truss_ink', '#6e6a62', 0.6, metal=0.8, scale=0.5)
    # hexagonal habitat drum
    k.p(cyl('hab', hull, 40, 46, (0, 0, 0), rot=(0, 0, 0), n=6), solid=True)
    k.windows('h', '#ffcf8a', [(math.cos(a) * 34.8, math.sin(a) * 34.8, z) for a in [R(30 + 60 * i) for i in range(6)] for z in (-8, 8)], size=(4, 4, 3))
    # derrick tower down towards the moon (-Z) and the drill string
    for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        k.p(cyl(f'leg{sx}{sy}', truss, 1.6, 150, (sx * 10, sy * 10, -95), rot=(0, 0, 0), n=8))
    for z in range(-160, -20, 15):
        k.p(box(f'brace{z}', truss, (22, 1.2, 1.2), (0, 10, z), rot=(0, 0, 0)))
        k.p(box(f'brace2{z}', truss, (1.2, 22, 1.2), (10, 0, z)))
    k.p(cyl('drill', mat_metal('drill_m', '#9a9a96', 0.3, metal=0.95), 3, 120, (0, 0, -200), rot=(0, 0, 0), n=16))
    k.col((24, 24, 180), (0, 0, -110))
    # ore hoppers and conveyor arms
    for i, a in enumerate((R(0), R(120), R(240))):
        c = Vector((math.cos(a) * 70, math.sin(a) * 70, 10))
        k.p(cyl(f'hopper{i}', hull, 14, 26, tuple(c), rot=(0, 0, 0), n=16, r2=6), solid=True)
        mid = c * 0.6
        arm = k.p(box(f'conv{i}', truss, (40, 4, 3), (mid.x, mid.y, 18)))
        arm.rotation_euler = (0, 0, a)
    # floodlights on top
    for i in range(4):
        a = R(45 + 90 * i)
        k.p(cyl(f'mast{i}', truss, 0.8, 30, (math.cos(a) * 30, math.sin(a) * 30, 38), rot=(0, 0, 0), n=6))
        k.g(sphere(f'flood{i}', mat_emit('glow_flood', '#ffe0a8', 16), 2.2, (math.cos(a) * 30, math.sin(a) * 30, 54)))
    mouth = k.dock(36, hull, w=50, h=36, light='#ffb050')
    k.beacon((0, 0, 30)); k.beacon((0, 0, -265))
    k.P += greebles(k.P[0], k.metal, count=70, size=(1, 4), height=(0.4, 2.0), seed=13)
    return k, mouth, 280


# ======================================================================= Quelle (Enceladus, water collective)

def quelle():
    k = Kit(9)
    white = mat_paint('hull_q', '#e6ecf0', color2='#cdd6dc', wear=0.3, rust=0.0, dirt=0.35, metal=0.3, scale=0.3, stripe=('z', 0.0, 2.5), stripe_color='#3a8fd0')
    pipe = mat_metal('pipe_q', '#9aa6ae', 0.35, metal=0.9, scale=0.6)
    # a stack of spherical water tanks around a central column
    k.p(cyl('column', white, 10, 220, (0, 0, 0), rot=(0, 0, 0), n=24), solid=True)
    for i in range(8):
        a = 2 * math.pi * i / 8 + (0.4 if i % 2 else 0)
        z = -60 if i % 2 else 50
        c = (math.cos(a) * 46, math.sin(a) * 46, z)
        k.p(sphere(f'tank{i}', white, 22, c, seg=40, rings=20), solid=True)
        k.p(cyl(f'tpipe{i}', pipe, 2, 30, (math.cos(a) * 22, math.sin(a) * 22, z), rot=(R(90), 0, a + R(90)), n=10))
        k.g(box(f'tlight{i}', mat_emit('glow_tank', '#7fd8ff', 9), (1.2, 8, 1.2), (math.cos(a) * 46, math.sin(a) * 46, z + 22.5)))
    # habitat ring of the collective around the middle
    k.p(ST.torus_ring('hab_ring', white, 70, 14, 12), solid=True)
    k.windows('q', '#cfefff', [(math.cos(a) * 77.2, math.sin(a) * 77.2, 0) for a in [2 * math.pi * i / 36 for i in range(36)]], size=(1.8, 1.8, 3.0), strength=5)
    for i in range(4):
        a = 2 * math.pi * i / 4 + R(45)
        sp = k.p(box(f'spoke{i}', pipe, (60, 4, 4), (math.cos(a) * 40, math.sin(a) * 40, 0)))
        sp.rotation_euler = (0, 0, a)
    k.p(cyl('cap', white, 18, 10, (0, 0, 115), rot=(0, 0, 0), n=32, r2=10))
    mouth = k.dock(84, white, w=50, h=40)
    k.beacon((0, 0, 125)); k.beacon((0, 0, -115))
    return k, mouth, 260


# ======================================================================= Kraken-Hafen (Titan, consortium: gold towers)

def kraken():
    k = Kit(12)
    gold = mat_paint('hull_kr', '#d6a64a', color2='#b08436', wear=0.15, rust=0.0, dirt=0.2, metal=0.85, rough=0.3, scale=0.3, stripe=('z', 0.0, 1.5), stripe_color='#f2efe6')
    ivory = mat_paint('ivory_kr', '#ece6d6', color2='#d8d0bc', wear=0.15, dirt=0.25, metal=0.3, scale=0.3)
    # central spire
    k.p(spin('spire', [(0, -150), (26, -140), (30, -60), (24, 40), (16, 120), (6, 190), (0, 220)], ivory, n=48), solid=True)
    for z in range(-120, 130, 18):
        r = 30 - max(0, z + 60) * 0.075 if z > -60 else 29
        k.windows(f's{z}', '#ffe6b0', ring_windows(0, z, r + 0.4, 24, 0, axis='z'), size=(1.6, 1.6, 4), strength=7)
    # gold bands
    for z, R0 in ((-90, 40), (-20, 38), (60, 30)):
        k.p(ST.torus_ring(f'band{z}', gold, R0, 8, 5)).location = (0, 0, z)
    # three tower pods with sky bridges
    for i in range(3):
        a = 2 * math.pi * i / 3 + R(90)
        c = Vector((math.cos(a) * 85, math.sin(a) * 85, -30))
        k.p(spin(f'pod{i}', [(0, -70), (14, -62), (16, 30), (8, 70), (0, 84)], gold, at=tuple(c)), solid=True)
        br = k.p(box(f'bridge{i}', ivory, (70, 6, 5), tuple(c * 0.5 + Vector((0, 0, 20)))))
        br.rotation_euler = (0, 0, a)
        k.windows(f'p{i}', '#ffe6b0', [(c.x + math.cos(b) * 16.4, c.y + math.sin(b) * 16.4, c.z + z) for b in [2 * math.pi * j / 10 for j in range(10)] for z in (-20, 0, 20)], size=(1.6, 1.6, 3), strength=7)
    mouth = k.dock(28, ivory, w=56, h=40, light='#ffd28a')
    k.beacon((0, 0, 224), '#ffcc44'); k.beacon((0, 0, -152))
    return k, mouth, 260


# ======================================================================= Gildenhalle (ring rim: habitats welded between ice rocks)

def rock(name, mat, r, loc, seed):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=r)
    rnd = random.Random(seed)
    for v in bm.verts:
        n = v.co.normalized()
        v.co *= 0.75 + 0.35 * (math.sin(n.x * 3.1 + seed) * math.cos(n.y * 2.3 - seed) * 0.5 + 0.5) + rnd.uniform(-0.05, 0.05)
    ob = swship._obj_from_bm(bm, name, mat)
    ob.location = loc
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def ringgilde():
    k = Kit(15)
    hull = mat_paint('hull_rg', '#7f8a78', color2='#6c6a60', wear=0.75, rust=0.5, dirt=0.75, metal=0.3, scale=0.3, stripe=('z', 0.0, 2.5), stripe_color='#4f8a52')
    ice = mat_paint('ice_rg', '#c8d2d8', color2='#9aa4ac', wear=0.0, rust=0.0, dirt=0.4, metal=0.0, rough=0.7, scale=0.08, panel=0.0)
    patch = mat_paint('patch_rg', '#a8602f', color2='#8b8f8c', wear=0.8, rust=0.6, dirt=0.6, scale=1.5)
    for i, (c, r) in enumerate((((-40, -50, 10), 42), ((-20, 70, -20), 36), ((-110, 10, 30), 30))):
        k.p(rock(f'rock{i}', ice, r, c, i + 3), solid=True)
    # habitats of different ages at odd angles
    habs = [((-10, 0, 0), 18, 110, (0, R(90), 0)), ((-60, 30, 40), 12, 70, (R(30), R(60), 0)), ((-70, -40, -30), 14, 80, (R(-20), R(100), R(20))),
            ((-120, 50, -10), 10, 60, (R(80), 0, R(30)))]
    for i, (c, r, L, rot) in enumerate(habs):
        k.p(cyl(f'hab{i}', hull if i % 2 == 0 else patch, r, L, c, rot=rot, n=16), solid=True)
    for i in range(14):
        c = (k.rnd.uniform(-130, 20), k.rnd.uniform(-60, 70), k.rnd.uniform(-40, 50))
        k.p(box(f'plate{i}', patch, (k.rnd.uniform(6, 14), k.rnd.uniform(6, 14), 1), c, rot=(k.rnd.uniform(0, 3), k.rnd.uniform(0, 3), 0)))
    k.windows('r', '#ffd08a', [(-10 + x, 0, 18.3) for x in range(-40, 50, 10)] + [(-10 + x, 0, -18.3) for x in range(-40, 50, 10)], size=(3, 3, 0.6))
    # welding arcs and work lights
    for i in range(5):
        k.g(sphere(f'arc{i}', mat_emit('glow_arc', '#bfe8ff', 18), 0.8, (k.rnd.uniform(-100, 0), k.rnd.uniform(-40, 50), k.rnd.uniform(-30, 30))))
    mouth = k.dock(44, hull, w=48, h=36, light='#9fe08a')
    k.beacon((-10, 0, 30), '#4aff6a')
    return k, mouth, 230


# ======================================================================= Herschel-Depot (Mimas, black market bunker)

def herschel():
    k = Kit(18)
    armor = mat_paint('hull_hd', '#4a4c4f', color2='#3a3b3d', wear=0.6, rust=0.3, dirt=0.8, metal=0.5, scale=0.3, stripe=('z', -8.0, 3.0), stripe_color='#b8302a')
    k.p(box('bunker', armor, (110, 90, 34), (0, 0, 0), bevel=4), solid=True)
    k.p(box('bunker_top', armor, (70, 60, 18), (-10, 0, 25), bevel=3), solid=True)
    k.p(box('bunker_low', armor, (60, 120, 14), (-20, 0, -24), bevel=3), solid=True)
    for s in (-1, 1):
        k.p(box(f'wing{s}', armor, (50, 30, 20), (-40, s * 70, 0), bevel=3), solid=True)
        # gun turrets
        for x in (-50, 10):
            k.p(cyl(f'tur{s}{x}', k.metal, 5, 4, (x, s * 30, 36), rot=(0, 0, 0), n=12))
            k.p(cyl(f'barrel{s}{x}', k.dark, 0.8, 14, (x + 7, s * 30, 38), rot=(0, R(90), 0), n=8))
    # slit windows, red
    k.windows('hd', '#ff5a3a', [(55.3, y, z) for y in range(-36, 40, 8) for z in (-6, 6)], size=(0.6, 5, 1.2), strength=7)
    k.windows('hd2', '#ffb070', [(x, 45.3, 4) for x in range(-45, 50, 9)] + [(x, -45.3, 4) for x in range(-45, 50, 9)], size=(5, 0.6, 1.2), strength=5)
    # sensor mast with dish
    k.p(cyl('mast', k.metal, 1.2, 50, (-30, 0, 59), rot=(0, 0, 0), n=8))
    k.p(spin('dish', [(0, 0), (9, 2.5), (10, 3.2)], k.metal, at=(-30, 0, 84), n=24))
    mouth = k.dock(55, armor, w=50, h=30, light='#ff7a4a')
    k.beacon((-30, 0, 86)); k.beacon((-40, 70, 12)); k.beacon((-40, -70, 12))
    k.P += greebles(k.P[0], k.metal, count=90, size=(1, 5), height=(0.5, 2.0), seed=19)
    return k, mouth, 200


# ======================================================================= Das Gewölbe (Iapetus, archive)

def gewoelbe():
    k = Kit(21)
    stone = mat_paint('hull_gw', '#3a3742', color2='#2c2a33', wear=0.2, rust=0.0, dirt=0.4, metal=0.2, rough=0.6, scale=0.25, panel=0.6)
    pale = mat_paint('pale_gw', '#d8d4e4', color2='#b8b4c8', wear=0.2, dirt=0.3, metal=0.3, scale=0.3)
    # octagonal monolith with stepped crown
    k.p(cyl('vault', stone, 70, 140, (0, 0, 0), rot=(0, 0, 0), n=8), solid=True)
    k.p(cyl('crown', stone, 52, 30, (0, 0, 85), rot=(0, 0, 0), n=8, r2=40), solid=True)
    k.p(cyl('base', stone, 58, 26, (0, 0, -83), rot=(0, 0, 0), n=8, r2=46), solid=True)
    # tall violet light slits on every face ("library windows")
    for i in range(8):
        a = 2 * math.pi * i / 8 + math.pi / 8
        rr = 70 * math.cos(math.pi / 8) + 0.4
        for j in (-2, -1, 0, 1, 2):
            t = a + j * 0.09
            k.g(box(f'slit{i}{j}', mat_emit('glow_slit', '#c79bff', 7), (1.0, 2.4, 100), (math.cos(t) * rr, math.sin(t) * rr, 0))).rotation_euler = (0, 0, t)
    # observatory dome and an antenna array
    k.p(sphere('dome', pale, 26, (0, 0, 100), scale=(1, 1, 0.6), seg=40, rings=20))
    for i in range(6):
        a = 2 * math.pi * i / 6
        k.p(cyl(f'ant{i}', k.metal, 0.6, 40, (math.cos(a) * 45, math.sin(a) * 45, 120), rot=(0, 0, 0), n=6))
        k.g(sphere(f'antl{i}', mat_emit('glow_antl', '#d7b8ff', 12), 1.2, (math.cos(a) * 45, math.sin(a) * 45, 141)))
    mouth = k.dock(66, pale, w=50, h=34, light='#d7b8ff')
    k.beacon((0, 0, 130), '#d7b8ff')
    return k, mouth, 200


# ======================================================================= Schakalnest (Phoebe, pirate den in old hulls)

def schakalnest():
    k = Kit(24)
    rust = mat_paint('hull_sn', '#6a4a36', color2='#5a5f66', wear=0.9, rust=0.9, dirt=0.9, metal=0.35, scale=0.3, stripe=('z', 0.0, 2.5), stripe_color='#c83a2a')
    old = mat_paint('old_sn', '#7a7e80', color2='#a8602f', wear=0.85, rust=0.7, dirt=0.85, metal=0.4, scale=0.3)
    # two old freighter hulls crossed and welded together, a third broken one hanging off
    k.p(box('hulk_a', rust, (160, 34, 30), (-30, 0, 0), rot=(0, 0, R(8)), bevel=3), solid=True)
    k.p(box('hulk_b', old, (130, 28, 26), (-50, 0, 30), rot=(R(10), 0, R(-55)), bevel=3), solid=True)
    k.p(cyl('hulk_c', rust, 14, 90, (-100, -40, -30), rot=(R(20), R(70), 0), n=12), solid=True)
    for i in range(18):
        c = (k.rnd.uniform(-110, 40), k.rnd.uniform(-30, 30), k.rnd.uniform(-20, 40))
        k.p(box(f'scaf{i}', k.metal, (k.rnd.uniform(1, 2), k.rnd.uniform(14, 40), k.rnd.uniform(1, 2)), c, rot=(k.rnd.uniform(0, 3), 0, k.rnd.uniform(0, 3))))
    k.windows('sn', '#ff7a3a', [(-30 + x, 17.3, 2) for x in range(-60, 70, 12)], size=(4, 0.6, 2))
    for i in range(7):
        k.g(sphere(f'lamp{i}', mat_emit('glow_sn_g', '#4aff6a' if i % 2 else '#ff4a3a', 12), 1.4, (k.rnd.uniform(-110, 40), k.rnd.uniform(-30, 30), k.rnd.uniform(-25, 50))))
    # skull-ish banner plate on the bow
    k.p(box('banner', mat_paint('banner_sn', '#1a1a1c', wear=0.4, dirt=0.6, scale=1), (1, 26, 18), (52, 0, 22)))
    mouth = k.dock(50, rust, w=46, h=30, light='#ff5a3a')
    k.beacon((-30, 0, 20)); k.beacon((-100, -40, -10))
    return k, mouth, 220


BUILDERS = {'lagrange': lagrange, 'inktomi': inktomi, 'quelle': quelle, 'kraken': kraken, 'ringgilde': ringgilde,
            'herschel': herschel, 'gewoelbe': gewoelbe, 'schakalnest': schakalnest}


def finalize(k, mouth, radius, outdir):
    # colliders from the solid parts' bounding boxes (three.js axes)
    cols = []
    for o in k.solid:
        bpy.context.view_layer.update()
        pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        c, h = (lo + hi) / 2, (hi - lo) / 2
        cols.append({'t': 'b', 'c': b2t(c), 'h': [round(h.x, 2), round(h.z, 2), round(h.y, 2)]})
    for o in [o for o in k.solid if o.hide_render]:
        bpy.data.objects.remove(o, do_unlink=True)
    hullo = ST.bake_groups({'hull': k.P}, outdir, size=2048, ao=96)[0]
    finals = [hullo]
    groups = {}
    for o in k.G:
        groups.setdefault(o.material_slots[0].material.name, []).append(o)
    for mname, objs in groups.items():
        finals.append(ST.join_glow(objs, mname, bpy.data.materials[mname].get('glow_color', '#ffffff')))
    apply_all(k.field); finals.append(k.field)
    path = os.path.join(outdir, 'model.glb')
    swship.export_glb(finals, path)
    meta = {'dock': {'pos': b2t((mouth, 0, 0)), 'dir': b2t((1, 0, 0))}, 'spin': [], 'radius': radius, 'colliders': cols}
    with open(os.path.join(outdir, 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    return path


if __name__ != 'outposts':  # executed via the bridge (not imported)
    names = list(BUILDERS) if BL_ARGS[0] == 'all' else [BL_ARGS[0]]
    flags = BL_ARGS[1:]
    res = {}
    for name in names:
        swlib.fresh(); swship.MATS.clear()
        k, mouth, radius = BUILDERS[name]()
        outdir = swlib.out('stations', 'station_' + name, 'x').rsplit(os.sep, 1)[0]
        if '--no-preview' not in flags:
            res[name + ':preview'] = swship.studio_preview(os.path.join(outdir, 'preview.jpg'), (-30, 0, 0), radius * 1.55, samples=64, cam_dir=(1.0, -0.7, 0.45), lens=50)
        if '--preview-only' not in flags:
            res[name] = finalize(k, mouth, radius, outdir)
    result = res
