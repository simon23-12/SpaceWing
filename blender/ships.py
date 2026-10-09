"""Ship definitions. Usage: bl.py blender/ships.py <ship_id> [--preview-only] [--no-preview]"""
import importlib, math, os, json
import swlib, swship
importlib.reload(swlib); importlib.reload(swship)
from swship import loft, wing, lathe, box, cyl, sphere, empty, greebles, mirror_x
from swship import mat_paint, mat_metal, mat_rubber, mat_emit, mat_glass

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
    """Hawker-Lindqvist SW-2 'Spacewing' – Teo Okafor's old courier fighter. Faded orange, rusty."""
    paint = mat_paint('hull_sw', '#a8602f', color2='#8b8f8c', wear=0.85, rust=0.55, dirt=0.7, metal=0.2, rough=0.55,
                      stripe=('y', 4.5, 0.45))
    metal = mat_metal('metal_sw', '#6a6c70', 0.42, metal=0.7, grime=0.6)
    dark = mat_rubber('dark_sw', '#1c1d1f')
    glow = mat_emit('glow_engine_sw', '#7fb6ff', 10)
    gr, gg, gw = mat_emit('glow_red', '#ff2a1a', 12), mat_emit('glow_green', '#22ff66', 12), mat_emit('glow_white', '#ffffff', 14)
    glass = mat_glass('glass_sw', '#0b1218')
    P = []
    fus = loft('fuselage', [
        dict(y=6.9, w=0.06, h=0.05, z=-0.12),
        dict(y=6.4, w=0.62, h=0.42, z=-0.08, e=2.2),
        dict(y=5.4, w=1.15, h=0.86, z=-0.02, e=2.6, flat=0.8),
        dict(y=4.0, w=1.6, h=1.25, z=0.08, e=3.0, flat=0.75),
        dict(y=2.2, w=1.95, h=1.45, z=0.14, e=3.2, flat=0.75),
        dict(y=0.0, w=2.25, h=1.42, z=0.1, e=3.4, flat=0.8),
        dict(y=-2.6, w=2.4, h=1.28, z=0.06, e=3.6, flat=0.85),
        dict(y=-4.6, w=2.1, h=1.12, z=0.06, e=3.6),
        dict(y=-6.0, w=1.65, h=0.95, z=0.1, e=3.2),
        dict(y=-6.35, w=1.35, h=0.75, z=0.1, e=3.0),
    ], paint, n=40)
    P.append(fus)
    # canopy + frame
    P.append(sphere('canopy', glass, 1.0, (0, 3.15, 0.62), scale=(0.62, 1.75, 0.5)))
    P.append(box('canopy_frame', metal, (0.06, 2.2, 0.05), (0, 3.0, 1.115), rot=(R(4), 0, 0)))
    # wings
    P.append(wing('wing', paint, root_y=-1.6, root_chord=4.4, tip_chord=1.3, span=4.4, sweep=-2.6, dihedral=-0.35,
                  thick=0.16, x0=0.9, z0=-0.15))
    # wingtip cannon pods
    for sx in (1,):
        P.append(cyl('pod', metal, 0.17, 2.6, (5.25, -2.6, -0.5)))
        P.append(cyl('barrel', dark, 0.06, 1.8, (5.25, -0.5, -0.5)))
        P.append(cyl('muzzle', metal, 0.085, 0.25, (5.25, 0.45, -0.5)))
    for o in P[-3:]:
        mirror_x_world(o)
    # engines
    eng, ex = engine_pod('eng', 1.45, 0.3, -1.2, -6.4, 0.62, paint, metal, glow)
    P += eng
    # tail fins on nacelles
    for side in (1,):
        f = wing('fin', paint, root_y=-5.2, root_chord=2.4, tip_chord=0.9, span=1.7, sweep=-1.1, dihedral=0.0,
                 thick=0.12, x0=0.0, z0=0.0, mirror=False)
        f.rotation_euler = (0, R(-72), 0)
        f.location = (1.55, 0, 0.75)
        P.append(f)
        swship.apply_all(f)
        mirror_x(f)
    # belly intake & details
    P.append(box('intake', dark, (1.0, 1.6, 0.3), (0, 0.8, -0.7), bevel=0.05))
    P.append(box('spine', metal, (0.5, 3.4, 0.25), (0, -2.2, 0.82), bevel=0.04))
    P.append(cyl('antenna', metal, 0.02, 1.1, (0.3, -3.8, 1.3), rot=(R(-30), 0, 0)))
    P.append(cyl('antenna2', metal, 0.015, 0.7, (-0.35, -2.5, 1.15), rot=(R(-20), 0, 0)))
    grb = mat_metal('greeble_sw', '#8a8c8f', 0.5, metal=0.5)
    P += greebles(fus, grb, count=34, size=(0.14, 0.38), height=(0.02, 0.06), seed=3,
                  region=lambda h: not (h.z > 0.25 and 0.9 < h.y < 5.4) and h.y < 4.8)
    P += nav_lights((-5.25, -3.95, -0.5), (5.25, -3.95, -0.5), (0, -6.4, 0.75), gr, gg, gw)
    E = [empty('exhaust_0', (-1.45, -7.25, 0.3)), empty('exhaust_1', (1.45, -7.25, 0.3)),
         empty('gun_0', (-5.25, 0.6, -0.5)), empty('gun_1', (5.25, 0.6, -0.5)),
         empty('cockpit', (0, 3.2, 0.95))]
    return P, E, dict(dist=26, center=(0, 0, 0))


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
