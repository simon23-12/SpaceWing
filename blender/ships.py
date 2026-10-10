"""Ship definitions. Usage: bl.py blender/ships.py <ship_id> [--preview-only] [--no-preview]"""
import importlib, math, os, json
import swlib, swship
importlib.reload(swlib); importlib.reload(swship)
from swship import loft, wing, lathe, box, cyl, sphere, empty, greebles, mirror_x
from swship import mat_paint, mat_metal, mat_rubber, mat_emit, mat_glass

try:
    REPO
except NameError:
    REPO = swlib.REPO_PATH
swlib.init(REPO)
R = math.radians


def engine_pod(prefix, x, z, y_front, y_back, r, mat_body, mat_nozzle, glow_mat, mirror=True, n=28, intake=True):
    L = y_front - y_back
    prof = [(y_front, r * 0.62), (y_front - 0.06 * L, r * 0.95), (y_front - 0.16 * L, r), (y_back + 0.18 * L, r),
            (y_back + 0.06 * L, r * 0.9), (y_back, r * 0.82)]
    body = lathe(prefix + '_body', list(reversed(prof)), mat_body, n=n, axis_pos=(x, 0, z))
    noz = lathe(prefix + '_noz', [(y_back - 0.12 * L, r * 0.86), (y_back + 0.02, r * 0.78)], mat_nozzle, n=n, axis_pos=(x, 0, z))
    glow = cyl(prefix + '_glow', glow_mat, r * 0.66, 0.05, (x, y_back - 0.12 * L - 0.01, z), n=n)
    parts = [body, noz, glow]
    if intake:
        ring = lathe(prefix + '_intake', [(y_front - 0.02, r * 0.5), (y_front + 0.03, r * 0.66)], mat_nozzle, n=n, axis_pos=(x, 0, z))
        parts.append(ring)
    if mirror and abs(x) > 1e-3:
        for p in parts:
            mirror_x_world(p)
    return parts, (x, y_back - 0.12 * L - 0.05, z)


def mirror_x_world(ob):
    """Mirror around the world X=0 plane (object may be offset)."""
    from mathutils import Matrix
    ob.data.transform(ob.matrix_basis)
    ob.matrix_basis = Matrix.Identity(4)
    mirror_x(ob)


def nav_lights(left, right, tail, glow_r, glow_g, glow_w):
    out = []
    out.append(sphere('nav_l', glow_r, 0.07, left, seg=12, rings=6))
    out.append(sphere('nav_r', glow_g, 0.07, right, seg=12, rings=6))
    if tail:
        out.append(sphere('nav_t', glow_w, 0.06, tail, seg=12, rings=6))
    return out


# ------------------------------------------------------------------------------------------- ships

def spacewing():
    """Hawker-Lindqvist SW-2 'Spacewing' - Teo Okafor's old courier interceptor. A flat wedge with two big
    rear engine nacelles, cockpit far forward, swivel cannons on the nacelle flanks. Faded orange, rusty."""
    paint = mat_paint('hull_sw', '#a8602f', color2='#8b8f8c', wear=0.85, rust=0.55, dirt=0.7, metal=0.2, rough=0.55,
                      stripe=('y', 4.9, 0.3))
    metal = mat_metal('metal_sw', '#6a6c70', 0.42, metal=0.7, grime=0.6)
    dark = mat_rubber('dark_sw', '#1c1d1f')
    glow = mat_emit('glow_engine_sw', '#7fb6ff', 10)
    gr, gg, gw = mat_emit('glow_red', '#ff2a1a', 12), mat_emit('glow_green', '#22ff66', 12), mat_emit('glow_white', '#ffffff', 14)
    glass = mat_glass('glass_sw', '#0b1218')
    P = []
    # wedge body: pointed nose, widening to a flat trapezoid that carries the engines
    fus = loft('fuselage', [
        dict(y=6.3, w=0.08, h=0.05, z=-0.05),
        dict(y=5.7, w=0.75, h=0.26, z=-0.04, e=3.0),
        dict(y=4.2, w=1.9, h=0.58, z=0.0, e=4.0),
        dict(y=2.2, w=3.1, h=0.82, z=0.0, e=4.5),
        dict(y=0.0, w=4.25, h=0.98, z=0.0, e=5.0),
        dict(y=-2.4, w=5.0, h=1.04, z=0.0, e=5.5),
        dict(y=-4.3, w=5.2, h=0.96, z=0.0, e=5.5),
        dict(y=-4.75, w=4.7, h=0.7, z=0.0, e=4.5),
    ], paint, n=44, sharp=30)
    P.append(fus)
    # cockpit tub + bubble canopy, well forward of the engines
    P.append(loft('cockpit_tub', [
        dict(y=3.9, w=0.3, h=0.2, z=0.3), dict(y=3.3, w=1.1, h=0.8, z=0.42, e=3.0),
        dict(y=1.4, w=1.5, h=1.1, z=0.5, e=3.4), dict(y=-0.4, w=1.3, h=0.95, z=0.45, e=3.4), dict(y=-1.6, w=0.6, h=0.4, z=0.36, e=3.0),
    ], paint, n=32))
    P.append(sphere('canopy', glass, 1.0, (0, 1.75, 0.98), scale=(0.58, 1.3, 0.5)))
    P.append(box('canopy_frame', metal, (0.06, 2.3, 0.05), (0, 1.7, 1.47), rot=(R(3), 0, 0)))
    for y in (1.0, 2.4):
        P.append(box(f'canopy_rib{y}', metal, (1.1, 0.06, 0.05), (0, y, 1.38 - abs(y - 1.75) * 0.22)))
    # big engine nacelles on the rear flanks
    eng, ex = engine_pod('eng', 2.75, 0.0, 0.2, -5.95, 0.84, paint, metal, glow, n=32)
    P += eng
    for k, (y, rr) in enumerate(((-1.4, 0.88), (-3.4, 0.88))):
        ring = lathe(f'eng_band{k}', [(y + 0.12, rr), (y - 0.12, rr)], metal, n=32, axis_pos=(2.75, 0, 0.0))
        P.append(ring); mirror_x_world(ring)
    # stabiliser fins above and below each nacelle
    for k, (rot, z) in enumerate(((R(-90), 0.72), (R(90), -0.72))):
        f = wing(f'fin{k}', paint, root_y=-4.6, root_chord=2.2, tip_chord=0.8, span=1.25 if k == 0 else 0.95, sweep=-1.0,
                 thick=0.12, x0=0.0, z0=0.0, mirror=False)
        f.rotation_euler = (0, rot, 0)
        f.location = (2.75, 0, z)
        swship.apply_all(f)
        P.append(f); mirror_x(f)
    # swivel laser cannons on the outer nacelle flanks
    for nm, ob in (('mount', box('mount', metal, (0.5, 1.1, 0.34), (3.55, -0.9, 0.0), bevel=0.05)),
                   ('pod', cyl('pod', metal, 0.19, 1.9, (3.85, -0.7, 0.0))),
                   ('barrel', cyl('barrel', dark, 0.065, 1.9, (3.85, 1.1, 0.0))),
                   ('muzzle', cyl('muzzle', metal, 0.09, 0.28, (3.85, 2.1, 0.0)))):
        P.append(ob); mirror_x_world(ob)
    # details
    P.append(box('intake', dark, (1.6, 0.9, 0.18), (0, -0.6, -0.55), bevel=0.04))
    P.append(loft('spine', [dict(y=-1.4, w=0.2, h=0.1, z=0.45), dict(y=-2.2, w=0.9, h=0.5, z=0.5, e=3), dict(y=-4.2, w=1.0, h=0.55, z=0.5, e=3), dict(y=-4.7, w=0.8, h=0.3, z=0.45)], metal, n=24))
    for sx in (-1, 1):
        P.append(cyl(f'intake_fan{sx}', dark, 0.56, 0.06, (2.75 * sx, 0.25, 0.0), n=32))
    P.append(box('rear_plate', metal, (3.4, 0.25, 0.5), (0, -4.7, 0.0), bevel=0.04))
    P.append(cyl('antenna', metal, 0.02, 1.0, (0.45, -3.6, 0.95), rot=(R(-30), 0, 0)))
    P.append(cyl('antenna2', metal, 0.015, 0.6, (-0.5, -2.2, 0.85), rot=(R(-20), 0, 0)))
    grb = mat_metal('greeble_sw', '#8a8c8f', 0.5, metal=0.5)
    P += greebles(fus, grb, count=40, size=(0.14, 0.4), height=(0.02, 0.06), seed=3,
                  region=lambda h: h.z > 0.3 and not (abs(h.x) < 1.0 and -1.8 < h.y < 4.0) and h.y < 4.4)
    P += nav_lights((-3.85, -1.7, 0.22), (3.85, -1.7, 0.22), (0, -4.85, 0.4), gr, gg, gw)
    E = [empty('exhaust_0', (-2.75, -6.7, 0.0)), empty('exhaust_1', (2.75, -6.7, 0.0)),
         empty('gun_0', (-3.85, 2.3, 0.0)), empty('gun_1', (3.85, 2.3, 0.0)),
         empty('cockpit', (0, 1.6, 0.95))]
    return P, E, dict(dist=22, center=(0, 0, 0))


def wespe():
    """Pirate 'Wespe' – stripped racing frame, yellow/black, aggressive forward cannons."""
    paint = mat_paint('hull_wespe', '#c9a21c', color2='#1f1f1f', wear=0.6, rust=0.25, dirt=0.6, metal=0.25, rough=0.5,
                      stripe=('x', 0.0, 0.6), stripe_color='#e0b21e')
    metal = mat_metal('metal_wespe', '#3d3e41', 0.4)
    dark = mat_rubber('dark_wespe')
    glow = mat_emit('glow_engine_wespe', '#ff7a2a', 12)
    gr, gg = mat_emit('glow_red', '#ff2a1a', 12), mat_emit('glow_green', '#22ff66', 12)
    glass = mat_glass('glass_wespe', '#1a0f05')
    P = []
    fus = loft('fuselage', [
        dict(y=5.6, w=0.05, h=0.05, z=0.0),
        dict(y=4.8, w=0.7, h=0.5, z=0.0, e=2.0),
        dict(y=3.0, w=1.2, h=0.95, z=0.1, e=2.4),
        dict(y=1.0, w=1.5, h=1.15, z=0.15, e=2.6),
        dict(y=-1.5, w=1.3, h=1.0, z=0.1, e=2.6),
        dict(y=-3.6, w=0.9, h=0.8, z=0.1, e=2.4),
        dict(y=-4.0, w=0.75, h=0.6, z=0.1, e=2.2),
    ], paint, n=32)
    P.append(fus)
    P.append(sphere('canopy', glass, 1.0, (0, 1.6, 0.55), scale=(0.5, 1.3, 0.42)))
    # X-shaped canted wings
    for i, (dz, ang) in enumerate(((0.15, 28), (0.05, -28))):
        w = wing(f'wing{i}', paint, root_y=-1.6, root_chord=3.0, tip_chord=0.8, span=3.6, sweep=-1.4, dihedral=0,
                 thick=0.14, x0=0.5, z0=0.0, mirror=False)
        w.rotation_euler = (0, R(-ang), 0); w.location = (0, 0, dz)
        swship.apply_all(w); mirror_x(w); P.append(w)
    # wingtip engines
    for dz, ang in ((0.15, 28), (0.05, -28)):
        x = 0.5 + 3.4 * math.cos(R(ang)); z = dz + 3.4 * math.sin(R(ang))
        eng, _ = engine_pod('eng%d' % (ang > 0), x, z, -1.0, -3.9, 0.36, metal, dark, glow)
        P += eng
    # nose cannons
    for x in (0.45,):
        P.append(cyl('cannon', dark, 0.07, 3.0, (x, 4.2, -0.35)))
        P.append(cyl('cannon_h', metal, 0.13, 1.0, (x, 2.8, -0.35)))
        mirror_x_world(P[-1]); mirror_x_world(P[-2])
    P += greebles(fus, metal, count=24, size=(0.1, 0.4), height=(0.02, 0.06), seed=5,
                  region=lambda h: not (h.z > 0.3 and 0.3 < h.y < 3.0))
    P += nav_lights((-3.4, -2.2, 1.9), (3.4, -2.2, 1.9), None, gr, gg, None)
    E = [empty('exhaust_0', (-(0.5 + 3.4 * math.cos(R(28))), -4.4, 0.15 + 3.4 * math.sin(R(28)))),
         empty('exhaust_1', ((0.5 + 3.4 * math.cos(R(28))), -4.4, 0.15 + 3.4 * math.sin(R(28)))),
         empty('exhaust_2', (-(0.5 + 3.4 * math.cos(R(28))), -4.4, 0.05 - 3.4 * math.sin(R(28)))),
         empty('exhaust_3', ((0.5 + 3.4 * math.cos(R(28))), -4.4, 0.05 - 3.4 * math.sin(R(28)))),
         empty('gun_0', (-0.45, 5.8, -0.35)), empty('gun_1', (0.45, 5.8, -0.35)), empty('cockpit', (0, 1.7, 0.85))]
    return P, E, dict(dist=22, center=(0, 0, 0.3))


SHIPS = {'spacewing': spacewing, 'wespe': wespe}


def _mule(rusty):
    """Mule MT-3 bulk hauler (~36 m). 'Sankt Rostig' is a 40 year old example."""
    sfx = 'rost' if rusty else 'mule'
    paint = mat_paint('hull_' + sfx, '#7d8a7a' if rusty else '#c9c2b0', color2='#5d5f5a' if rusty else '#8a8f94',
                      wear=0.9 if rusty else 0.35, rust=0.7 if rusty else 0.0, dirt=0.8 if rusty else 0.4,
                      scale=0.7, stripe=('y', 13.2, 0.8), stripe_color='#c8901a')
    cont = mat_paint('cont_' + sfx, '#2f5a7a' if not rusty else '#7a3b22', color2='#a8692a' if rusty else '#c9b25a',
                     wear=0.7, rust=0.4 if rusty else 0.05, dirt=0.6, scale=0.6, panel=0.6)
    metal = mat_metal('metal_' + sfx, '#5f6164', 0.45, metal=0.7)
    dark = mat_rubber('dark_' + sfx)
    glow = mat_emit('glow_engine_' + sfx, '#ffb070' if rusty else '#8fc4ff', 10)
    gr, gg, gw = mat_emit('glow_red', '#ff2a1a', 12), mat_emit('glow_green', '#22ff66', 12), mat_emit('glow_white', '#ffffff', 14)
    glass = mat_glass('glass_' + sfx)
    P = []
    cab = loft('cabin', [
        dict(y=18.6, w=0.3, h=0.3, z=0.6),
        dict(y=18.0, w=3.2, h=2.6, z=0.4, e=3.2, flat=0.8),
        dict(y=16.4, w=4.6, h=3.6, z=0.3, e=4.0, flat=0.85),
        dict(y=13.0, w=5.0, h=3.8, z=0.2, e=4.5),
        dict(y=11.5, w=4.2, h=3.0, z=0.2, e=4.5),
    ], paint, n=36)
    P.append(cab)
    P.append(sphere('canopy', glass, 1.0, (0, 16.9, 1.35), scale=(1.7, 1.2, 0.75)))
    P.append(box('spine', metal, (1.6, 26.0, 1.4), (0, -1.5, 0.0), bevel=0.08))
    for i in range(6):
        P.append(box(f'truss{i}', metal, (3.8, 0.4, 0.4), (0, 9.0 - i * 4.4, 0.0)))
    k = 0
    for i in range(5):
        y = 8.0 - i * 4.4
        for sx in (-1, 1):
            for sz in (-1, 1):
                if rusty and (i, sx, sz) in ((3, 1, -1), (1, -1, 1)):
                    continue
                P.append(box(f'container{k}', cont, (2.3, 4.0, 2.3), (sx * 1.6, y, sz * 1.25), bevel=0.06)); k += 1
    eng_block = loft('engblock', [
        dict(y=-13.0, w=4.0, h=3.4, e=4.0), dict(y=-14.5, w=6.4, h=4.6, e=4.5),
        dict(y=-19.0, w=6.6, h=4.8, e=4.5), dict(y=-20.0, w=5.8, h=4.2, e=4.0)], paint, n=36)
    P.append(eng_block)
    exh = []
    for i, (x, z) in enumerate(((-1.7, 0.9), (1.7, 0.9), (0.0, -1.2))):
        P.append(lathe(f'noz{i}', [(-20.0, 1.0), (-21.6, 1.25), (-22.4, 1.45)], dark, axis_pos=(x, 0, z)))
        P.append(cyl(f'eglow{i}', glow, 0.95, 0.05, (x, -20.2, z)))
        exh.append(empty(f'exhaust_{i}', (x, -22.6, z)))
    for sx in (-1, 1):
        P.append(box('radiator', metal, (5.0, 3.0, 0.08), (sx * 5.2, -16.5, 0.0), bevel=0.02))
    P.append(cyl('dish_mast', metal, 0.06, 2.0, (1.4, 14.0, 2.6), rot=(0, 0, 0)))
    P.append(sphere('dish', metal, 0.6, (1.4, 14.0, 3.6), scale=(1, 1, 0.3)))
    P += greebles(cab, metal, count=26, size=(0.25, 0.8), height=(0.04, 0.12), seed=11,
                  region=lambda h: not (h.z > 0.6 and h.y > 15.0))
    P += greebles(eng_block, metal, count=20, size=(0.3, 0.9), height=(0.05, 0.15), seed=12)
    P += nav_lights((-5.4, 13.0, 0.4), (5.4, 13.0, 0.4), (0, -14.0, 2.5), gr, gg, gw)
    E = exh + [empty('gun_0', (0, 19.0, 2.4)), empty('turret', (0, 6.0, 2.8)), empty('cockpit', (0, 17.4, 1.7))]
    # dorsal turret (Mags' gun)
    P.append(cyl('turret_base', metal, 0.9, 0.5, (0, 6.0, 2.1), rot=(0, 0, 0)))
    P.append(sphere('turret_dome', paint, 0.8, (0, 6.0, 2.5), scale=(1, 1, 0.6)))
    P.append(cyl('turret_gun', dark, 0.1, 2.4, (0, 7.4, 2.7)))
    return P, E, dict(dist=70, center=(0, -1, 0))


def sankt_rostig(): return _mule(True)
def mule(): return _mule(False)


def lanze():
    """Titan-Konsortium 'Lanze' interceptor – white enamel and gold, very clean."""
    paint = mat_paint('hull_lanze', '#e9e4d8', color2='#c9a24a', wear=0.12, rust=0.0, dirt=0.15, metal=0.35, rough=0.25,
                      stripe=('x', 0.0, 0.35), stripe_color='#c9a24a')
    gold = mat_metal('metal_lanze', '#b8913d', 0.25, metal=1.0, grime=0.1)
    dark = mat_rubber('dark_lanze', '#141416')
    glow = mat_emit('glow_engine_lanze', '#ffd28a', 12)
    gr, gg = mat_emit('glow_red', '#ff2a1a', 12), mat_emit('glow_green', '#22ff66', 12)
    glass = mat_glass('glass_lanze', '#1a1406')
    P = []
    fus = loft('fuselage', [
        dict(y=8.5, w=0.04, h=0.04, z=0.0),
        dict(y=7.0, w=0.55, h=0.4, e=2.0),
        dict(y=4.5, w=1.2, h=0.85, z=0.05, e=2.2),
        dict(y=1.5, w=1.7, h=1.1, z=0.1, e=2.4, flat=0.6),
        dict(y=-2.0, w=2.0, h=1.05, z=0.1, e=2.6, flat=0.6),
        dict(y=-5.0, w=1.7, h=0.95, z=0.1, e=2.6),
        dict(y=-6.2, w=1.4, h=0.8, z=0.1, e=2.4),
    ], paint, n=36)
    P.append(fus)
    P.append(sphere('canopy', glass, 1.0, (0, 3.2, 0.48), scale=(0.5, 1.9, 0.38)))
    P.append(wing('wing', paint, root_y=-3.0, root_chord=6.0, tip_chord=0.7, span=4.6, sweep=-4.4, dihedral=-0.2,
                  thick=0.1, x0=0.8, z0=-0.05))
    P.append(wing('canard', gold, root_y=4.2, root_chord=1.4, tip_chord=0.4, span=1.2, sweep=-0.8, thick=0.08, x0=0.5, z0=0.0))
    f = wing('fin', paint, root_y=-5.0, root_chord=2.8, tip_chord=0.6, span=2.0, sweep=-1.8, thick=0.08, x0=0.0, mirror=False)
    f.rotation_euler = (0, R(-90), 0); f.location = (0, 0, 0.5); P.append(f)
    eng, _ = engine_pod('eng', 0.0, 0.1, -3.5, -6.4, 0.7, gold, dark, glow, mirror=False, intake=False)
    P += eng
    for x in (0.9,):
        P.append(cyl('gun', gold, 0.07, 2.4, (x, 2.6, -0.35)))
        mirror_x_world(P[-1])
    P += greebles(fus, gold, count=14, size=(0.1, 0.3), height=(0.01, 0.04), seed=21,
                  region=lambda h: not (h.z > 0.2 and 1.0 < h.y < 5.5))
    P += nav_lights((-5.3, -6.8, -0.25), (5.3, -6.8, -0.25), None, gr, gg, None)
    E = [empty('exhaust_0', (0, -7.0, 0.1)), empty('gun_0', (-0.9, 3.9, -0.35)), empty('gun_1', (0.9, 3.9, -0.35)),
         empty('cockpit', (0, 3.3, 0.75))]
    return P, E, dict(dist=26, center=(0, 0, 0))


def kestrel():
    """Kestrel K-9 – ex-militia multirole fighter. Grey-blue, forward-swept wings."""
    paint = mat_paint('hull_kestrel', '#56636e', color2='#7d8790', wear=0.35, rust=0.0, dirt=0.4, metal=0.3, rough=0.45,
                      stripe=('y', 5.0, 0.35), stripe_color='#d23a2a')
    metal = mat_metal('metal_kestrel', '#6b6e72', 0.4, metal=0.8)
    dark = mat_rubber('dark_kestrel')
    glow = mat_emit('glow_engine_kestrel', '#9fd0ff', 12)
    gr, gg, gw = mat_emit('glow_red', '#ff2a1a', 12), mat_emit('glow_green', '#22ff66', 12), mat_emit('glow_white', '#ffffff', 14)
    glass = mat_glass('glass_kestrel', '#0a1420')
    P = []
    fus = loft('fuselage', [
        dict(y=7.2, w=0.05, h=0.05, z=-0.1),
        dict(y=6.2, w=0.8, h=0.6, z=-0.05, e=2.4),
        dict(y=4.2, w=1.5, h=1.2, z=0.05, e=2.8, flat=0.7),
        dict(y=1.5, w=2.0, h=1.4, z=0.1, e=3.2, flat=0.7),
        dict(y=-2.0, w=2.6, h=1.3, z=0.05, e=3.6, flat=0.8),
        dict(y=-5.0, w=2.0, h=1.2, z=0.05, e=3.2),
        dict(y=-5.8, w=1.6, h=1.0, z=0.05, e=3.0),
    ], paint, n=36)
    P.append(fus)
    P.append(sphere('canopy', glass, 1.0, (0, 3.6, 0.6), scale=(0.62, 1.7, 0.5)))
    P.append(box('canopy_frame', metal, (0.06, 2.0, 0.05), (0, 3.5, 1.1)))
    P.append(wing('wing', paint, root_y=-2.4, root_chord=3.6, tip_chord=1.6, span=4.3, sweep=1.4, dihedral=0.25,
                  thick=0.14, x0=1.1, z0=-0.1))
    for side in (1,):
        f = wing('fin', paint, root_y=-4.4, root_chord=2.2, tip_chord=0.8, span=1.8, sweep=-1.0, thick=0.1, x0=0.0, mirror=False)
        f.rotation_euler = (0, R(-65), 0); f.location = (0.9, 0, 0.5)
        swship.apply_all(f); mirror_x(f); P.append(f)
    eng, _ = engine_pod('eng', 0.0, 0.05, -3.8, -6.2, 0.75, metal, dark, glow, mirror=False, intake=False)
    P += eng
    for sx in (1,):
        P.append(lathe('intake', [(0.5, 0.0), (1.2, 0.42), (-1.5, 0.45), (-2.5, 0.3)], metal, axis_pos=(1.35, 0, -0.25)))
        mirror_x_world(P[-1])
    P.append(cyl('gun', dark, 0.08, 2.4, (5.4, -1.2, -0.0)))
    mirror_x_world(P[-1])
    P.append(cyl('missile_rail', metal, 0.12, 1.6, (3.0, -1.6, -0.4)))
    mirror_x_world(P[-1])
    P += greebles(fus, metal, count=28, size=(0.12, 0.4), height=(0.02, 0.06), seed=31,
                  region=lambda h: not (h.z > 0.25 and 1.6 < h.y < 5.8) and h.y < 5.8)
    P += nav_lights((-5.4, -2.6, 0.15), (5.4, -2.6, 0.15), (0, -5.8, 0.65), gr, gg, gw)
    E = [empty('exhaust_0', (0, -6.7, 0.05)), empty('gun_0', (-5.4, 0.1, 0)), empty('gun_1', (5.4, 0.1, 0)),
         empty('cockpit', (0, 3.6, 0.95))]
    return P, E, dict(dist=26, center=(0, 0, 0))


def corsair():
    """Corsair heavy gunship – broad armoured wedge, four engines, dorsal turret. Olive/black."""
    paint = mat_paint('hull_corsair', '#4a5240', color2='#2c2f2a', wear=0.45, rust=0.1, dirt=0.55, metal=0.3, rough=0.5,
                      scale=0.8, stripe=('y', 7.0, 0.5), stripe_color='#d9d2b0')
    metal = mat_metal('metal_corsair', '#5d5f61', 0.4, metal=0.8)
    dark = mat_rubber('dark_corsair')
    glow = mat_emit('glow_engine_corsair', '#ff9a5a', 12)
    gr, gg, gw = mat_emit('glow_red', '#ff2a1a', 12), mat_emit('glow_green', '#22ff66', 12), mat_emit('glow_white', '#ffffff', 14)
    glass = mat_glass('glass_corsair', '#0a1008')
    P = []
    body = loft('body', [
        dict(y=10.0, w=0.4, h=0.3, z=-0.2),
        dict(y=8.8, w=3.2, h=1.2, z=-0.1, e=4.0, flat=0.6),
        dict(y=5.0, w=6.0, h=2.2, z=0.0, e=5.0, flat=0.7),
        dict(y=0.0, w=8.6, h=2.6, z=0.0, e=6.0, flat=0.7),
        dict(y=-6.0, w=9.6, h=2.4, z=0.0, e=6.0),
        dict(y=-8.0, w=9.0, h=2.0, z=0.0, e=5.0),
    ], paint, n=40)
    P.append(body)
    P.append(sphere('canopy', glass, 1.0, (0, 6.6, 0.9), scale=(1.1, 1.8, 0.55)))
    exh = []
    for i, x in enumerate((-3.4, -1.15, 1.15, 3.4)):
        eng, _ = engine_pod(f'eng{i}', x, 0.0, -5.0, -8.6, 0.85, metal, dark, glow, mirror=False, intake=False)
        P += eng; exh.append(empty(f'exhaust_{i}', (x, -9.1, 0.0)))
    P.append(cyl('turret_base', metal, 1.0, 0.4, (0, -1.5, 1.4), rot=(0, 0, 0)))
    P.append(sphere('turret', paint, 0.95, (0, -1.5, 1.7), scale=(1, 1.2, 0.55)))
    for x in (0.35,):
        P.append(cyl('tgun', dark, 0.09, 2.6, (x, 0.2, 1.85))); mirror_x_world(P[-1])
    for x in (2.2,):
        P.append(cyl('chin_gun', dark, 0.12, 3.0, (x, 8.4, -0.9))); mirror_x_world(P[-1])
        P.append(box('chin_mount', metal, (0.5, 1.6, 0.5), (x, 6.6, -0.8))); mirror_x_world(P[-1])
    P += greebles(body, metal, count=50, size=(0.2, 0.7), height=(0.03, 0.12), seed=41,
                  region=lambda h: not (h.z > 0.4 and 4.8 < h.y < 8.6))
    P += nav_lights((-4.9, -4.0, 0.0), (4.9, -4.0, 0.0), (0, -8.0, 1.0), gr, gg, gw)
    E = exh + [empty('gun_0', (-2.2, 10.0, -0.9)), empty('gun_1', (2.2, 10.0, -0.9)), empty('turret', (0, -1.5, 2.0)),
               empty('cockpit', (0, 6.8, 1.3))]
    return P, E, dict(dist=40, center=(0, 0, 0))


def korvette():
    """Liga customs corvette 'Unbestechlich' (~85 m). White and blue, wedge hull, bridge tower."""
    paint = mat_paint('hull_korv', '#d9dde2', color2='#9aa3ad', wear=0.18, rust=0.0, dirt=0.3, metal=0.3, rough=0.35,
                      scale=0.35, stripe=('y', 20.0, 3.0), stripe_color='#2a5bb8')
    metal = mat_metal('metal_korv', '#6a6e74', 0.4, metal=0.85, scale=0.5)
    dark = mat_rubber('dark_korv')
    glow = mat_emit('glow_engine_korv', '#a8d4ff', 12)
    gr, gg, gw = mat_emit('glow_red', '#ff2a1a', 12), mat_emit('glow_green', '#22ff66', 12), mat_emit('glow_white', '#ffffff', 14)
    win = mat_emit('glow_windows', '#ffe9c0', 6)
    P = []
    hull = loft('hull', [
        dict(y=44.0, w=1.0, h=1.0, z=-1.0),
        dict(y=38.0, w=9.0, h=4.0, z=-0.5, e=4.0, flat=0.7),
        dict(y=20.0, w=22.0, h=8.0, z=0.0, e=6.0, flat=0.6),
        dict(y=-10.0, w=28.0, h=9.5, z=0.0, e=7.0, flat=0.6),
        dict(y=-36.0, w=26.0, h=9.0, z=0.0, e=7.0),
        dict(y=-40.0, w=22.0, h=7.5, z=0.0, e=6.0),
    ], paint, n=44)
    P.append(hull)
    tower = loft('tower', [dict(y=-6.0, w=8.0, h=3.0, z=5.5, e=6), dict(y=-10.0, w=10.0, h=6.0, z=7.0, e=6),
                           dict(y=-22.0, w=10.0, h=6.0, z=7.0, e=6), dict(y=-26.0, w=7.0, h=3.0, z=5.5, e=6)], paint, n=32)
    P.append(tower)
    P.append(box('bridge_win', win, (8.4, 0.2, 0.7), (0, -9.2, 8.6)))
    for i in range(10):
        P.append(box(f'win{i}', win, (0.2, 1.4, 0.35), (13.9, 12 - i * 4.5, 0.5))); mirror_x_world(P[-1])
    exh = []
    for i, (x, z) in enumerate(((-8, 2), (0, 2.5), (8, 2), (-4.5, -2.2), (4.5, -2.2))):
        eng, _ = engine_pod(f'eng{i}', x, z, -32.0, -41.0, 2.1, metal, dark, glow, mirror=False, intake=False)
        P += eng; exh.append(empty(f'exhaust_{i}', (x, -42.5, z)))
    for i, (x, y) in enumerate(((6, 18), (-6, 18), (9, -2), (-9, -2))):
        P.append(cyl(f'tbase{i}', metal, 1.4, 0.8, (x, y, 4.2), rot=(0, 0, 0)))
        P.append(cyl(f'tgun{i}', dark, 0.25, 6.0, (x, y + 3.0, 4.6)))
    P.append(cyl('mast', metal, 0.25, 8.0, (0, -16.0, 14.0), rot=(0, 0, 0)))
    P += greebles(hull, metal, count=110, size=(0.6, 2.4), height=(0.15, 0.6), seed=51)
    P += greebles(tower, metal, count=30, size=(0.4, 1.4), height=(0.1, 0.4), seed=52)
    P += nav_lights((-14, -10, 0), (14, -10, 0), (0, -16, 18.2), gr, gg, gw)
    E = exh + [empty(f'gun_{i}', p) for i, p in enumerate(((6, 21, 4.6), (-6, 21, 4.6), (9, 1, 4.6), (-9, 1, 4.6)))]
    return P, E, dict(dist=150, center=(0, 0, 0))


def eisvogel():
    """'Eisvogel' - Mags Okafor's ice hauler and gunship (~22 m). Ice-white enamel with a navy belly and the orange
    stripe of the Ringgilde, two frosted ice tanks on the flanks, a dorsal ball turret with a glass bubble (the gunner's
    seat), hot radiator fins and three engines. Well kept: Mags loves this ship."""
    paint = mat_paint('hull_eis', '#dfe5e8', color2='#24465e', wear=0.3, rust=0.04, dirt=0.35, metal=0.3, rough=0.32,
                      scale=0.8, stripe=('y', 6.4, 0.55), stripe_color='#e0702a')
    tankm = mat_paint('tank_eis', '#cfe4ee', color2='#7fa9bf', wear=0.25, rust=0.0, dirt=0.3, metal=0.35, rough=0.28,
                      scale=1.2, panel=0.5)
    metal = mat_metal('metal_eis', '#6c7076', 0.36, metal=0.85, grime=0.35)
    dark = mat_rubber('dark_eis', '#17191c')
    glow = mat_emit('glow_engine_eis', '#9fd8ff', 11)
    heat = mat_emit('glow_heat_eis', '#ff6a2a', 3)
    gr, gg, gw = mat_emit('glow_red', '#ff2a1a', 12), mat_emit('glow_green', '#22ff66', 12), mat_emit('glow_white', '#ffffff', 14)
    glass = mat_glass('glass_eis', '#0a141c')
    P = []
    hull = loft('hull', [
        dict(y=12.0, w=0.16, h=0.12, z=0.05),
        dict(y=11.1, w=1.4, h=0.8, z=0.08, e=3.0),
        dict(y=8.6, w=3.0, h=1.9, z=0.2, e=3.6, flat=0.85),
        dict(y=5.0, w=3.8, h=2.4, z=0.2, e=4.2, flat=0.85),
        dict(y=0.0, w=4.0, h=2.6, z=0.1, e=4.6, flat=0.8),
        dict(y=-5.0, w=4.4, h=2.6, z=0.1, e=4.6, flat=0.8),
        dict(y=-8.0, w=4.0, h=2.2, z=0.1, e=4.2),
        dict(y=-8.8, w=3.0, h=1.5, z=0.1, e=3.4),
    ], paint, n=48, sharp=32)
    P.append(hull)
    # sharp chines along the flanks give the long hull its edge
    ch = wing('chine', paint, root_y=4.2, root_chord=9.0, tip_chord=6.4, span=0.55, sweep=-0.6, thick=0.05, x0=1.75, z0=0.35)
    P.append(ch)
    P.append(loft('spine', [dict(y=-0.7, w=0.3, h=0.2, z=1.3), dict(y=-1.6, w=0.9, h=0.6, z=1.45, e=3), dict(y=-6.5, w=1.1, h=0.75, z=1.45, e=3),
                            dict(y=-8.4, w=0.6, h=0.3, z=1.3)], metal, n=24))
    # cockpit: wraparound canopy with frame
    P.append(loft('canopy_hood', [dict(y=10.0, w=0.4, h=0.2, z=0.75), dict(y=9.2, w=1.8, h=0.9, z=0.95, e=3.0),
                                  dict(y=7.0, w=2.2, h=1.2, z=1.05, e=3.4), dict(y=5.6, w=1.6, h=0.8, z=1.0, e=3.0)], paint, n=32))
    P.append(sphere('canopy', glass, 1.0, (0, 8.25, 1.38), scale=(0.95, 1.55, 0.5)))
    P.append(box('canopy_spine', metal, (0.07, 2.9, 0.06), (0, 8.15, 1.88), rot=(R(-2), 0, 0)))
    for y in (7.3, 9.0):
        P.append(box(f'canopy_rib{y}', metal, (1.7, 0.07, 0.06), (0, y, 1.8 - abs(y - 8.2) * 0.18)))
    # dorsal ball turret: the gunner sits in the glass bubble
    P.append(cyl('turret_ring', metal, 1.0, 0.36, (0, 0.5, 1.42), rot=(0, 0, 0), n=40))
    P.append(sphere('turret_ball', paint, 0.88, (0, 0.5, 1.9), scale=(1, 1, 0.78)))
    P.append(sphere('turret_bubble', glass, 0.56, (0, 1.05, 2.02), scale=(0.95, 0.75, 0.72)))
    for sx in (-1, 1):
        P.append(box(f'turret_cheek{sx}', metal, (0.32, 1.0, 0.42), (0.62 * sx, 1.0, 1.9), bevel=0.05))
        P.append(cyl(f'turret_barrel{sx}', dark, 0.075, 2.8, (0.62 * sx, 2.7, 1.9)))
        P.append(cyl(f'turret_muzzle{sx}', metal, 0.11, 0.3, (0.62 * sx, 4.1, 1.9)))
    # frosted ice tanks on the flanks
    for sx in (-1, 1):
        t = cyl(f'tank{sx}', tankm, 1.0, 8.6, (2.75 * sx, 1.75, -0.55), n=40)
        P.append(t)
        for y, nm in ((6.05, 'f'), (-2.55, 'b')):
            P.append(sphere(f'tank_cap{nm}{sx}', tankm, 1.0, (2.75 * sx, y, -0.55), scale=(1, 0.42, 1), seg=40, rings=16))
        for k, y in enumerate((4.6, 1.75, -1.1)):
            P.append(lathe(f'tank_band{k}{sx}', [(y + 0.16, 1.05), (y - 0.16, 1.05)], metal, n=40, axis_pos=(2.75 * sx, 0, -0.55)))
        for y in (4.0, -0.6):
            P.append(box(f'pylon{y}{sx}', metal, (1.3, 1.2, 0.36), (1.95 * sx, y, -0.45), bevel=0.05))
        P.append(cyl(f'tank_valve{sx}', metal, 0.16, 0.5, (2.75 * sx, 6.6, -0.55)))
    # engines: two nacelles on the shoulders + the main drive
    exh = []
    eng, _ = engine_pod('eng', 2.25, 0.8, -3.0, -9.2, 1.02, paint, metal, glow, n=36)
    P += eng
    for k, y in enumerate((-4.6, -7.0)):
        r = lathe(f'eng_band{k}', [(y + 0.14, 1.06), (y - 0.14, 1.06)], metal, n=36, axis_pos=(2.25, 0, 0.8))
        P.append(r); mirror_x_world(r)
    P.append(lathe('main_noz', [(-8.7, 1.05), (-9.6, 1.2), (-10.3, 1.34)], dark, n=36, axis_pos=(0, 0, 0.1)))
    P.append(cyl('main_glow', glow, 0.95, 0.05, (0, -8.85, 0.1), n=36))
    exh += [empty('exhaust_0', (-2.25, -10.1, 0.8)), empty('exhaust_1', (2.25, -10.1, 0.8)), empty('exhaust_2', (0, -10.5, 0.1))]
    # hot radiator fins (angled up) with glowing edges, a ventral fin
    for sx in (1,):
        f = wing('radiator', metal, root_y=-3.6, root_chord=4.2, tip_chord=1.5, span=3.3, sweep=-2.2, dihedral=1.4,
                 thick=0.09, x0=1.5, z0=1.15)
        P.append(f)
        hb = wing('radiator_glow', heat, root_y=-3.62, root_chord=4.24, tip_chord=1.54, span=3.32, sweep=-2.2, dihedral=1.4,
                  thick=0.03, x0=1.49, z0=1.15)
        hb.scale = (1.0, 1.0, 1.0)
        P.append(hb)
    vf = wing('vfin', paint, root_y=-5.4, root_chord=3.2, tip_chord=1.1, span=1.5, sweep=-1.6, thick=0.14, x0=0.0, z0=0.0, mirror=False)
    vf.rotation_euler = (0, R(90), 0); vf.location = (0, 0, -1.0); swship.apply_all(vf)
    P.append(vf)
    # chin cannons
    for sx in (-1, 1):
        P.append(box(f'chin_mount{sx}', metal, (0.45, 1.6, 0.42), (0.95 * sx, 8.6, -0.72), bevel=0.05))
        P.append(cyl(f'chin_gun{sx}', dark, 0.09, 2.4, (0.95 * sx, 10.4, -0.72)))
        P.append(cyl(f'chin_muzzle{sx}', metal, 0.12, 0.26, (0.95 * sx, 11.6, -0.72)))
    # comms: dish behind the turret, mast, sensor blister
    P.append(cyl('dish_mast', metal, 0.05, 0.9, (-1.0, -2.6, 1.6), rot=(0, 0, 0)))
    P.append(sphere('dish', metal, 0.55, (-1.0, -2.6, 2.1), scale=(1, 1, 0.28)))
    P.append(cyl('antenna', metal, 0.02, 1.6, (0.9, -4.8, 1.75), rot=(R(-35), 0, 0)))
    P.append(sphere('sensor', dark, 0.32, (0, 10.6, -0.35), scale=(1, 1.4, 0.6)))
    P.append(box('belly_hatch', metal, (1.8, 2.4, 0.12), (0, -1.5, -1.22), bevel=0.03))
    grb = mat_metal('greeble_eis', '#8d9196', 0.45, metal=0.6)
    P += greebles(hull, grb, count=46, size=(0.16, 0.5), height=(0.02, 0.07), seed=7,
                  region=lambda h: h.z > 0.9 and not (abs(h.x) < 1.3 and (5.2 < h.y < 10.5 or -0.8 < h.y < 1.8)))
    P += greebles(hull, grb, count=18, size=(0.2, 0.6), height=(0.03, 0.08), seed=8, region=lambda h: h.z < -0.8)
    P += nav_lights((-3.75, 1.75, -0.55), (3.75, 1.75, -0.55), (0, -8.9, 1.2), gr, gg, gw)
    E = exh + [empty('gun_0', (-0.95, 11.9, -0.72)), empty('gun_1', (0.95, 11.9, -0.72)),
               empty('turret', (0, 0.6, 2.35)), empty('cockpit', (0, 8.4, 1.45))]
    return P, E, dict(dist=46, center=(0, 0.5, 0))


SHIPS.update({'sankt_rostig': sankt_rostig, 'mule': mule, 'lanze': lanze, 'kestrel': kestrel, 'corsair': corsair, 'korvette': korvette, 'eisvogel': eisvogel})

if __name__ != 'ships':  # executed via the bridge (not imported)
    ship_id = BL_ARGS[0]
    flags = BL_ARGS[1:]
    swlib.fresh()
    swship.MATS.clear()
    P, E, cam = SHIPS[ship_id]()
    prev = swlib.out('ships', ship_id, 'preview.jpg')
    if '--no-preview' not in flags:
        swship.studio_preview(prev, cam['center'], cam['dist'], samples=int(os.environ.get('SW_SAMPLES', 96)))
    res = {'preview': prev}
    if '--preview-only' not in flags:
        path, hull = swship.finalize_ship(ship_id, P, E)
        res['glb'] = path
        res['tris'] = sum(len(p.vertices) - 2 for p in hull.data.polygons)
    result = res
