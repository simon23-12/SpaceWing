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


def _bool(ob, cutter, op='DIFFERENCE'):
    import bpy
    m = ob.modifiers.new('b', 'BOOLEAN'); m.object = cutter; m.operation = op
    swship.apply_all(ob)
    bpy.data.objects.remove(cutter, do_unlink=True)
    return ob


def _simpod(part):
    """Combat simulator capsule for the Kommandodeck: a white tub on a pedestal with seat, sticks and screens,
    and a glass-topped hood hinged at the back (exported separately as prop_simpod_hatch)."""
    paint = mat_paint('hull_pod', '#d9dfe5', color2='#2c4a60', wear=0.25, rust=0.0, dirt=0.3, metal=0.3, rough=0.32,
                      scale=1.6, stripe=('y', 0.9, 0.12), stripe_color='#2aa0d0')
    metal = mat_metal('metal_pod', '#5c6168', 0.38, metal=0.8, grime=0.3)
    dark = mat_rubber('dark_pod', '#16181b')
    seatm = mat_rubber('seat_pod', '#2a3440', 0.6)
    cyan = mat_emit('glow_pod', '#4ad0ff', 8)
    amber = mat_emit('glow_pod_amber', '#ffb050', 6)
    glass = mat_glass('glass_pod', '#0a1820')
    RIM = 1.06
    secs = [dict(y=1.42, w=0.5, h=0.36, e=3.0), dict(y=1.2, w=1.35, h=0.8, e=3.2), dict(y=0.6, w=1.68, h=1.0, e=3.6),
            dict(y=-0.6, w=1.7, h=1.02, e=3.6), dict(y=-1.25, w=1.45, h=0.9, e=3.4), dict(y=-1.5, w=0.7, h=0.5, e=3.0)]
    P, E = [], []
    if part == 'body':
        tub = loft('tub', [dict(s, z=0.86) for s in secs], paint, n=48)
        top = box('tub_cut', paint, (4, 4, 2), (0, 0, RIM + 1.0))
        _bool(tub, top)
        inner = loft('tub_in', [dict(s, w=s['w'] * 0.84, h=s['h'] * 0.84, z=0.98) for s in secs], paint, n=48)
        _bool(tub, inner)
        P.append(tub)
        P.append(cyl('pedestal', metal, 0.55, 0.42, (0, 0, 0.21), rot=(0, 0, 0), n=32, r2=0.75))
        P.append(cyl('foot', dark, 1.05, 0.08, (0, 0, 0.04), rot=(0, 0, 0), n=48))
        P.append(lathe('foot_ring', [(-0.015, 1.03), (0.015, 1.03), (0.015, 1.07), (-0.015, 1.07)], cyan, n=64))
        P[-1].rotation_euler = (R(90), 0, 0); P[-1].location = (0, 0, 0.085)
        for sx in (-1, 1):   # rim light strips
            P.append(box(f'rim_led{sx}', cyan, (0.03, 1.5, 0.025), (0.79 * sx, -0.05, RIM + 0.005)))
        # seat, reclined, with headrest
        P.append(box('seat', seatm, (0.62, 0.62, 0.14), (0, -0.35, 0.6), rot=(R(-6), 0, 0), bevel=0.05))
        P.append(box('backrest', seatm, (0.6, 0.14, 0.8), (0, -0.82, 0.98), rot=(R(-22), 0, 0), bevel=0.05))
        P.append(box('headrest', seatm, (0.36, 0.12, 0.22), (0, -1.0, 1.42), rot=(R(-22), 0, 0), bevel=0.04))
        # control console and screens in front, two sticks
        P.append(box('console', metal, (1.0, 0.36, 0.3), (0, 0.85, 0.86), rot=(R(-25), 0, 0), bevel=0.04))
        for k, x in enumerate((-0.3, 0.0, 0.3)):
            P.append(box(f'screen{k}', cyan if k != 1 else amber, (0.26, 0.02, 0.17), (x, 0.66, 1.0), rot=(R(-25), 0, R(-12 * (k - 1)))))
        for sx in (-1, 1):
            P.append(cyl(f'stick{sx}', dark, 0.025, 0.32, (0.36 * sx, 0.15, 0.78), rot=(R(-10), 0, 0), n=10))
            P.append(sphere(f'stick_top{sx}', dark, 0.05, (0.36 * sx, 0.12, 0.95), scale=(1, 1, 1.3)))
            P.append(box(f'armrest{sx}', seatm, (0.12, 0.6, 0.08), (0.38 * sx, -0.15, 0.72), bevel=0.03))
        # hinge blocks at the back
        for sx in (-1, 1):
            P.append(box(f'hinge_block{sx}', metal, (0.16, 0.2, 0.18), (0.45 * sx, -1.42, RIM), bevel=0.03))
        E = [empty('hinge', (0, -1.45, RIM))]
        return P, E, dict(dist=7, center=(0, 0, 0.8))
    # hood: upper half of a slightly larger shell, glass window on top, hinged at the back
    hood = loft('hood', [dict(s, w=s['w'] * 1.02, h=s['h'] * 1.3, z=RIM, e=2.3) for s in secs], paint, n=48)
    _bool(hood, box('hood_cut', paint, (4, 4, 2), (0, 0, RIM - 1.0)))
    _bool(hood, loft('hood_in', [dict(s, y=s['y'] * 0.94, w=s['w'] * 0.93, h=s['h'] * 1.2, z=RIM, e=2.3) for s in secs], paint, n=48))
    _bool(hood, sphere('hood_window', paint, 1.0, (0, 0.2, RIM + 0.62), scale=(0.5, 0.95, 0.3)))
    P.append(hood)
    P.append(sphere('canopy_glass', glass, 1.0, (0, 0.2, RIM + 0.22), scale=(0.56, 1.02, 0.42)))
    for sx in (-1, 1):
        P.append(box(f'hood_led{sx}', cyan, (0.03, 1.5, 0.025), (0.84 * sx, -0.05, RIM + 0.03)))
    P.append(box('hood_handle', metal, (0.3, 0.06, 0.05), (0, 1.36, RIM + 0.14), bevel=0.02))
    return P, [empty('hinge', (0, -1.45, RIM))], dict(dist=7, center=(0, 0, 1.0))


SHIPS.update({'prop_simpod': lambda: _simpod('body'), 'prop_simpod_hatch': lambda: _simpod('hood')})


# ------------------------------------------------------------------------------------------- espresso machine

def _espresso_mats():
    """Small-scale materials for the cabin espresso machine (object space = metres, the machine is ~30 cm)."""
    from swlib import G as _G
    def new(name):
        m = swlib.new_mat(name); m.node_tree.nodes.clear(); return m, _G(m.node_tree)
    mats = {}
    # polished chrome with faint smudges
    m, g = new('esp_chrome'); p = g.node('ShaderNodeTexCoord').outputs['Object']
    sm, _ = g.noise(g.vscale(p, 30.0), 1.0, 6, 0.6)
    mats['chrome'] = swship._finish(m, g, g.rgb('#d7dade'), g.add(0.05, g.mul(g.smooth(sm, 0.55, 0.8), 0.12)), 1.0,
                                     bump_h=g.mul(sm, 0.004), bump_strength=0.1)
    # brushed stainless for the housing: horizontal grain
    m, g = new('esp_brushed'); p = g.node('ShaderNodeTexCoord').outputs['Object']
    px, py, pz = g.sep(p)
    br, _ = g.noise(g.combine(g.mul(px, 4.0), g.mul(py, 900.0), g.mul(pz, 900.0)), 1.0, 3, 0.5)
    sm, _ = g.noise(g.vscale(p, 18.0), 1.0, 5, 0.6)
    base = g.mix(g.mul(br, 0.25), g.rgb('#cfd2d6'), g.rgb('#a3a6ab'))
    mats['brushed'] = swship._finish(m, g, base, g.add(0.24, g.add(g.mul(br, 0.08), g.mul(g.smooth(sm, 0.6, 0.85), 0.1))), 0.6,
                                      bump_h=g.mul(br, 0.01), bump_strength=0.15)
    # deep oxblood enamel side panels
    m, g = new('esp_enamel'); p = g.node('ShaderNodeTexCoord').outputs['Object']
    n1, _ = g.noise(g.vscale(p, 25.0), 1.0, 5, 0.6)
    mats['enamel'] = swship._finish(m, g, g.mix(g.mul(n1, 0.2), g.rgb('#7a1616'), g.rgb('#4a0c0c')), g.add(0.12, g.mul(n1, 0.08)), 0.0)
    m, g = new('esp_black'); p = g.node('ShaderNodeTexCoord').outputs['Object']
    n1, _ = g.noise(g.vscale(p, 40.0), 1.0, 5, 0.6)
    mats['black'] = swship._finish(m, g, g.mix(g.mul(n1, 0.3), g.rgb('#141516'), g.rgb('#26272a')), 0.35, 0.0)
    mats['rubber'] = swship.mat_rubber('esp_rubber', '#111214', 0.85)
    # walnut: bands across the handle axis (Y), distorted
    m, g = new('esp_wood'); p = g.node('ShaderNodeTexCoord').outputs['Object']
    px, py, pz = g.sep(p)
    wv = g.node('ShaderNodeTexWave', wave_type='RINGS', rings_direction='Y')
    g._in(wv.inputs['Vector'], g.combine(g.mul(px, 1.0), g.mul(py, 0.15), g.mul(pz, 1.0)))
    wv.inputs['Scale'].default_value = 160.0; wv.inputs['Distortion'].default_value = 2.5
    wv.inputs['Detail'].default_value = 4.0; wv.inputs['Detail Scale'].default_value = 1.5
    fine, _ = g.noise(g.combine(g.mul(px, 300.0), g.mul(py, 20.0), g.mul(pz, 300.0)), 1.0, 4, 0.6)
    gr = g.add(g.mul(wv.outputs['Fac'], 0.7), g.mul(fine, 0.3))
    mats['wood'] = swship._finish(m, g, g.ramp(gr, [(0.2, '#3a2312'), (0.6, '#55331a'), (0.9, '#6a4223')]), g.add(0.28, g.mul(gr, 0.15)), 0.0,
                                   bump_h=g.mul(gr, 0.01), bump_strength=0.2)
    m, g = new('esp_ceramic')
    mats['ceramic'] = swship._finish(m, g, g.rgb('#f2eee6'), 0.1, 0.0)
    m, g = new('esp_brass'); p = g.node('ShaderNodeTexCoord').outputs['Object']
    n1, _ = g.noise(g.vscale(p, 60.0), 1.0, 6, 0.6)
    mats['brass'] = swship._finish(m, g, g.mix(g.mul(g.smooth(n1, 0.5, 0.8), 0.6), g.rgb('#c99a45'), g.rgb('#7d5a26')), g.add(0.18, g.mul(n1, 0.2)), 1.0)
    # drip tray grille: long slots
    m, g = new('esp_grille'); p = g.node('ShaderNodeTexCoord').outputs['Object']
    px, py, pz = g.sep(p)
    slot = g.math('GREATER_THAN', g.math('FRACT', g.div(px, 0.0065)), 0.5)
    inside = g.mul(g.math('LESS_THAN', g.abs(px), 0.098), g.math('LESS_THAN', g.abs(g.add(py, 0.167)), 0.036))
    slot = g.mul(slot, inside)
    mats['grille'] = swship._finish(m, g, g.mix(slot, g.rgb('#d0d3d7'), g.rgb('#0c0c0d')), g.add(0.1, g.mul(slot, 0.6)), g.sub(1.0, slot),
                                     bump_h=g.mul(slot, -0.15), bump_strength=0.6)
    # gauge dials (one material per gauge, polar coordinates around its centre)
    for key, cx, cz in (('dial_l', -0.088, 0.255), ('dial_r', 0.088, 0.255)):
        m, g = new('esp_' + key); p = g.node('ShaderNodeTexCoord').outputs['Object']
        px, py, pz = g.sep(p)
        dx, dz = g.sub(px, cx), g.sub(pz, cz)
        r = g.math('SQRT', g.add(g.mul(dx, dx), g.mul(dz, dz)))
        ang = g.math('ARCTAN2', dx, dz)                      # 0 = up, +/-pi = down
        inarc = g.math('LESS_THAN', g.abs(ang), 2.36)
        t = g.div(g.add(ang, 2.36), 4.72)                   # 0..1 across the scale
        minor = g.math('LESS_THAN', g.math('FRACT', g.mul(t, 32.0)), 0.12)
        major = g.math('LESS_THAN', g.math('FRACT', g.mul(t, 8.0)), 0.035)
        ring_min = g.mul(g.math('GREATER_THAN', r, 0.0205), g.math('LESS_THAN', r, 0.024))
        ring_maj = g.mul(g.math('GREATER_THAN', r, 0.0175), g.math('LESS_THAN', r, 0.024))
        ticks = g.mul(inarc, g.mx(g.mul(minor, ring_min), g.mul(major, ring_maj)))
        red = g.mul(g.mul(g.math('GREATER_THAN', t, 0.78), inarc), g.mul(g.math('GREATER_THAN', r, 0.0215), g.math('LESS_THAN', r, 0.024)))
        arc = g.mul(inarc, g.mul(g.math('GREATER_THAN', r, 0.0238), g.math('LESS_THAN', r, 0.0246)))
        edge = g.math('GREATER_THAN', r, 0.0262)
        n1, _ = g.noise(g.vscale(p, 200.0), 1.0, 4, 0.6)
        face = g.mix(g.mul(g.smooth(r, 0.012, 0.027), 0.25), g.mix(g.mul(n1, 0.08), g.rgb('#efe5cc'), g.rgb('#d6c7a2')), g.rgb('#b9a77e'))
        col = g.mix(red, face, g.rgb('#b0201a'))
        col = g.mix(g.mx(ticks, arc), col, g.rgb('#151515'))
        col = g.mix(edge, col, g.rgb('#1a1a1c'))
        mats[key] = swship._finish(m, g, col, 0.3, 0.0)
    return mats


def _tube(name, mat, pts, r, n=16, closed=False, cap=True):
    """Sweep a circle along a polyline (parallel-transport frames). r: scalar or one radius per point."""
    import bmesh
    from mathutils import Vector
    P = [Vector(p) for p in pts]
    R_ = r if isinstance(r, (list, tuple)) else [r] * len(P)
    k = len(P)
    T = []
    for i in range(k):
        a = P[(i - 1) % k] if (closed or i > 0) else P[i]
        b = P[(i + 1) % k] if (closed or i < k - 1) else P[i]
        T.append((b - a).normalized())
    N = [T[0].orthogonal().normalized()]
    for i in range(1, k):
        q = T[i - 1].rotation_difference(T[i])
        nn = q @ N[-1]
        nn = (nn - T[i] * nn.dot(T[i])).normalized()
        N.append(nn)
    bm = bmesh.new()
    rings = []
    for i in range(k):
        B = T[i].cross(N[i])
        rings.append([bm.verts.new(P[i] + R_[i] * (math.cos(2 * math.pi * j / n) * N[i] + math.sin(2 * math.pi * j / n) * B)) for j in range(n)])
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
    for a, b in pairs:
        for j in range(n):
            bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
    if cap and not closed:
        bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = swship._obj_from_bm(bm, name, mat)
    swship.smooth(ob, 60)
    return ob


def _bez(p0, p1, p2, p3, k=12):
    out = []
    for i in range(k + 1):
        t = i / k; u = 1 - t
        out.append(tuple(u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d for a, b, c, d in zip(p0, p1, p2, p3)))
    return out


def _rbox(name, mat, size, loc, bevel, seg=4):
    ob = box(name, mat, size, loc)
    md = ob.modifiers.new('bev', 'BEVEL'); md.width = bevel; md.segments = seg; md.limit_method = 'ANGLE'
    swship.apply_all(ob)
    swship.smooth(ob, 40)
    return ob


def _cup(name, mats, x, y, z, upside=False, saucer=True):
    """Espresso cup (with saucer when upright). Height 42 mm."""
    P = []
    h, rb, rt, w = 0.042, 0.018, 0.025, 0.0028
    prof = [(0.0, 0.0), (0.0, rb), (0.004, rb + 0.0015), (h * 0.5, (rb + rt) / 2 + 0.002), (h, rt), (h + 0.0008, rt - w * 0.5),
            (h, rt - w), (h * 0.5, (rb + rt) / 2 + 0.002 - w), (0.006, rb - w), (0.006, 0.0)]
    if upside:
        prof = [(h - yy, rr) for yy, rr in prof]
    zc = z + (0.0045 if saucer and not upside else 0.0)
    P.append(lathe(name, prof, mats['ceramic'], n=40, axis_pos=(x, y, zc), rot=(R(90), 0, 0)))
    # handle on the right side: half loop
    hz0 = zc + (h * 0.75 if not upside else h * 0.25)
    hz1 = zc + (h * 0.3 if not upside else h * 0.7)
    rx = x + (rb + rt) / 2 + 0.0015
    P.append(_tube(name + '_h', mats['ceramic'], _bez((rx - 0.002, y, hz0), (rx + 0.014, y, hz0 + 0.002), (rx + 0.012, y, hz1 - 0.004), (rx - 0.003, y, hz1), 14), 0.0028, n=10))
    if saucer and not upside:
        P.append(lathe(name + '_s', [(0.0, 0.0), (0.0, 0.03), (0.002, 0.042), (0.0045, 0.046), (0.0048, 0.044), (0.003, 0.03), (0.0035, 0.0)],
                       mats['ceramic'], n=48, axis_pos=(x, y, z), rot=(R(90), 0, 0)))
    return P


def _text(name, mat, body, loc, size, depth=0.0006):
    import bpy
    cu = bpy.data.curves.new(name, 'FONT'); cu.body = body; cu.size = size; cu.extrude = depth
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.space_character = 1.15
    ob = bpy.data.objects.new(name + '_tmp', cu); bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = (R(90), 0, 0); ob.location = loc
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    m = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(m)
    m.matrix_world = ob.matrix_world.copy()
    bpy.data.objects.remove(ob, do_unlink=True)
    me.materials.append(mat)
    return m


def prop_espresso():
    """'Cassini Classico' - an old Italian-style dual-boiler espresso machine for cabin 4-117, about 30 x 33 x 36 cm.
    Front faces -Y (three.js +Z). Brushed housing, oxblood enamel side panels, chrome E61-style group,
    walnut handles and knobs, two pressure gauges, gallery rail with cups on top, drip tray with brass name plate."""
    M_ = _espresso_mats()
    glow_r = mat_emit('glow_esp_red', '#ff3020', 6)
    glow_a = mat_emit('glow_esp_amber', '#ffb040', 5)
    P = []
    # feet, plinth, housing, side panels, front plate
    for fx in (-0.125, 0.125):
        for fy in (-0.09, 0.14):
            P.append(cyl(f'foot{fx}{fy}', M_['rubber'], 0.012, 0.014, (fx, fy, 0.007), rot=(0, 0, 0), n=20))
    P.append(_rbox('plinth', M_['black'], (0.30, 0.30, 0.024), (0, 0.02, 0.026), 0.006))
    P.append(_rbox('housing', M_['brushed'], (0.28, 0.28, 0.29), (0, 0.02, 0.183), 0.012))
    for sx in (-1, 1):
        P.append(_rbox(f'side{sx}', M_['enamel'], (0.006, 0.236, 0.236), (0.1405 * sx, 0.02, 0.18), 0.0028, seg=3))
        P.append(_rbox(f'side_trim{sx}', M_['chrome'], (0.004, 0.246, 0.246), (0.1395 * sx, 0.02, 0.18), 0.0018, seg=2))
    P.append(_rbox('front', M_['brushed'], (0.262, 0.006, 0.266), (0, -0.121, 0.188), 0.003, seg=3))
    # cup warmer tray with gallery rail
    P.append(_rbox('tray_top', M_['chrome'], (0.27, 0.27, 0.008), (0, 0.02, 0.331), 0.003, seg=3))
    rr, rect = 0.02, []
    x0, x1, y0, y1 = -0.122, 0.122, -0.100, 0.140
    for cx, cy, a0 in ((x1 - rr, y1 - rr, 0), (x0 + rr, y1 - rr, 90), (x0 + rr, y0 + rr, 180), (x1 - rr, y0 + rr, 270)):
        for i in range(7):
            a = R(a0 + i * 15)
            rect.append((cx + rr * math.cos(a), cy + rr * math.sin(a), 0.362))
    P.append(_tube('rail', M_['chrome'], rect, 0.0035, n=12, closed=True))
    for cx, cy in ((x0 + 0.006, y0 + 0.006), (x1 - 0.006, y0 + 0.006), (x0 + 0.006, y1 - 0.006), (x1 - 0.006, y1 - 0.006), (0, y0), (0, y1)):
        P.append(cyl(f'post{cx}{cy}', M_['chrome'], 0.003, 0.028, (cx, cy, 0.349), rot=(0, 0, 0), n=10))
    P += _cup('cup_t1', M_, -0.06, 0.06, 0.335, upside=True, saucer=False)
    P += _cup('cup_t2', M_, 0.0, 0.085, 0.335, upside=True, saucer=False)
    P += _cup('cup_t3', M_, 0.055, 0.02, 0.335, upside=False, saucer=True)
    # E61-style group head: neck into the housing, column with domed top, brew lever
    P.append(cyl('group_neck', M_['chrome'], 0.026, 0.05, (0, -0.145, 0.232), n=32))
    P.append(lathe('group', [(0.158, 0.0), (0.158, 0.029), (0.163, 0.034), (0.172, 0.0355), (0.18, 0.032), (0.236, 0.030), (0.252, 0.027),
                             (0.27, 0.021), (0.283, 0.012), (0.289, 0.005), (0.29, 0.0)], M_['chrome'], n=48, axis_pos=(0, -0.172, 0), rot=(R(90), 0, 0)))
    P.append(lathe('group_ring', [(0.2, 0.0312), (0.2, 0.0328), (0.206, 0.0328), (0.206, 0.0312)], M_['black'], n=48, axis_pos=(0, -0.172, 0), rot=(R(90), 0, 0)))
    P.append(cyl('lever_pivot', M_['chrome'], 0.008, 0.014, (0.029, -0.172, 0.262), rot=(0, R(90), 0), n=16))
    P.append(_tube('lever', M_['chrome'], _bez((0.038, -0.172, 0.262), (0.05, -0.172, 0.29), (0.06, -0.175, 0.31), (0.066, -0.178, 0.334), 10), [0.0045] * 6 + [0.0038] * 5, n=12))
    P.append(sphere('lever_ball', M_['wood'], 0.011, (0.066, -0.178, 0.343), seg=24, rings=12))
    # portafilter: basket, twin spout, walnut handle
    P.append(lathe('basket', [(0.126, 0.0), (0.126, 0.026), (0.13, 0.031), (0.15, 0.033), (0.157, 0.0345), (0.158, 0.0)], M_['chrome'], n=48,
                   axis_pos=(0, -0.172, 0), rot=(R(90), 0, 0)))
    for sx in (-1, 1):
        P.append(_tube(f'spout{sx}', M_['chrome'], [(0, -0.172, 0.127), (0.006 * sx, -0.172, 0.12), (0.011 * sx, -0.172, 0.113)], [0.0045, 0.0042, 0.004], n=12))
    P.append(_tube('pf_neck', M_['chrome'], [(0, -0.2, 0.142), (0, -0.218, 0.139), (0, -0.236, 0.135)], [0.009, 0.0085, 0.0085], n=16))
    hp = [(0, -0.236 - i * 0.011, 0.135 - i * 0.0018) for i in range(10)]
    P.append(_tube('pf_handle', M_['wood'], hp, [0.0095, 0.011, 0.012, 0.0128, 0.013, 0.0128, 0.0124, 0.0118, 0.0095, 0.004], n=20))
    # pressure gauges
    for k, gx in (('l', -0.088), ('r', 0.088)):
        P.append(lathe(f'bezel_{k}', [(-0.124, 0.0268), (-0.124, 0.034), (-0.131, 0.0345), (-0.136, 0.032), (-0.137, 0.0285), (-0.133, 0.0268)],
                       M_['chrome'], n=48, axis_pos=(gx, 0, 0.255), closed=True))
        P.append(cyl(f'dial_{k}', M_['dial_' + k], 0.0275, 0.002, (gx, -0.131, 0.255), n=48))
        a = R(-35 if k == 'l' else 40)
        P.append(box(f'needle_{k}', M_['black'], (0.0016, 0.0008, 0.024), (gx + math.sin(a) * 0.008, -0.1325, 0.255 + math.cos(a) * 0.008), rot=(0, a, 0)))
        P.append(cyl(f'needle_cap_{k}', M_['black'], 0.0025, 0.002, (gx, -0.133, 0.255), n=16))
    # valve knobs and wands
    for sx in (-1, 1):
        x = 0.118 * sx
        P.append(cyl(f'stem{sx}', M_['chrome'], 0.0055, 0.024, (x, -0.135, 0.2), n=16))
        P.append(lathe(f'knob{sx}', [(-0.146, 0.0), (-0.146, 0.0145), (-0.15, 0.0175), (-0.163, 0.0165), (-0.17, 0.012), (-0.172, 0.0)],
                       M_['wood'], n=36, axis_pos=(x, 0, 0.2)))
        P.append(lathe(f'knob_cap{sx}', [(-0.1715, 0.0), (-0.1715, 0.006), (-0.1725, 0.006), (-0.1725, 0.0)], M_['chrome'], n=24, axis_pos=(x, 0, 0.2)))
        P.append(sphere(f'wand_joint{sx}', M_['chrome'], 0.009, (x, -0.13, 0.172), seg=20, rings=10))
        end_z = 0.085 if sx > 0 else 0.115
        P.append(_tube(f'wand{sx}', M_['chrome'], _bez((x, -0.13, 0.172), (x + 0.012 * sx, -0.15, 0.17), (x + 0.02 * sx, -0.158, 0.14), (x + 0.022 * sx, -0.16, end_z), 14), 0.0042, n=12))
        P.append(cyl(f'wand_tip{sx}', M_['chrome'], 0.0035, 0.012, (x + 0.022 * sx, -0.16, end_z - 0.005), rot=(0, 0, 0), n=14, r2=0.0052))
    # drip tray with grille and brass name plate
    P.append(_rbox('drip', M_['chrome'], (0.24, 0.11, 0.022), (0, -0.166, 0.048), 0.004))
    P.append(_rbox('grille', M_['grille'], (0.214, 0.09, 0.003), (0, -0.167, 0.0598), 0.001, seg=1))
    P.append(_rbox('plate', M_['brass'], (0.092, 0.002, 0.015), (0, -0.2215, 0.048), 0.001, seg=2))
    P.append(_text('plate_text', bpy_mat(M_['black']), 'CASSINI', (0, -0.2226, 0.0478), 0.0105))
    P += _cup('cup_brew', M_, 0.0, -0.172, 0.0613, upside=False, saucer=True)
    # indicator lights between the gauges (unbaked glow meshes)
    for gx, gm in ((-0.024, glow_r), (0.024, glow_a)):
        P.append(lathe(f'lamp_ring{gx}', [(-0.124, 0.0035), (-0.124, 0.0058), (-0.128, 0.0058), (-0.128, 0.0035)], M_['chrome'], n=20, axis_pos=(gx, 0, 0.3), closed=True))
        P.append(sphere(f'lamp{gx}', gm, 0.0038, (gx, -0.1265, 0.3), seg=16, rings=8))
    for o in P:
        swship.apply_all(o)
    return P, [empty('cup', (0, -0.172, 0.11))], dict(dist=1.45, center=(0, -0.03, 0.19), dir=(0.75, -1.25, 0.55))


def bpy_mat(m):
    import bpy
    return bpy.data.materials[m] if isinstance(m, str) else m


SHIPS.update({'prop_espresso': prop_espresso})

if __name__ != 'ships':  # executed via the bridge (not imported)
    ship_id = BL_ARGS[0]
    flags = BL_ARGS[1:]
    swlib.fresh()
    swship.MATS.clear()
    P, E, cam = SHIPS[ship_id]()
    prev = swlib.out('ships', ship_id, 'preview.jpg')
    if '--no-preview' not in flags:
        swship.studio_preview(prev, cam['center'], cam['dist'], samples=int(os.environ.get('SW_SAMPLES', 96)), cam_dir=cam.get('dir', (1.0, 1.15, 0.55)))
    res = {'preview': prev}
    if '--preview-only' not in flags:
        path, hull = swship.finalize_ship(ship_id, P, E)
        res['glb'] = path
        res['tris'] = sum(len(p.vertices) - 2 for p in hull.data.polygons)
    result = res
