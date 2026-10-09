"""Saturn, ring profile and moon textures (three.js SphereGeometry UV convention).
Usage: bl.py blender/planets.py [body ...]   (default: all)"""
import importlib, math, bpy
import numpy as np
import swlib
importlib.reload(swlib)
swlib.init(REPO)
G = swlib.G


def craters(g, d, scale, density, depth, rim=0.35, seed=0.0):
    dd = g.vadd(d, (seed, seed * 0.7, seed * 1.3)) if seed else d
    dist, col, _ = g.voronoi(dd, scale)
    r_rand, r_size, r_age = g.sep(col)
    radius = g.add(0.18, g.mul(g.pow(r_size, 2.0), 0.32))
    present = g.math("LESS_THAN", r_rand, density)
    x = g.div(dist, radius)
    inside = g.math("LESS_THAN", x, 1.0)
    bowl = g.mul(g.sub(g.mul(x, x), 1.0), inside)
    rimv = g.mul(g.math("EXPONENT", g.mul(g.pow(g.mul(g.sub(x, 1.0), 5.0), 2.0), -1.0)), rim)
    h = g.mul(g.mul(g.add(bowl, rimv), present), depth)
    return h, g.mul(g.mul(inside, present), r_age)


def crater_field(g, d, layers, seed=0.0):
    h = 0.0
    fresh = 0.0
    for i, (sc, dens, dep) in enumerate(layers):
        hc, fr = craters(g, d, sc, dens, dep, seed=seed + i * 3.17)
        h = g.add(h, hc) if not isinstance(h, float) else hc
        fresh = g.mx(fresh, fr) if not isinstance(fresh, float) else fr
    return h, fresh


def one_crater(g, d, center, radius, depth, rim=0.4):
    c = np.array(center, float); c /= np.linalg.norm(c)
    cosang = g.dot(d, tuple(c))
    ang = g.math("ARCCOSINE", g.mn(cosang, 1.0))
    x = g.div(ang, radius)
    inside = g.math("LESS_THAN", x, 1.0)
    bowl = g.mul(g.sub(g.mul(x, x), 1.0), inside)
    # central peak
    peak = g.mul(g.math("EXPONENT", g.mul(g.pow(g.mul(x, 6.0), 2.0), -1.0)), 0.55)
    rimv = g.mul(g.math("EXPONENT", g.mul(g.pow(g.mul(g.sub(x, 1.0), 5.0), 2.0), -1.0)), rim)
    return g.mul(g.add(g.add(bowl, g.mul(peak, inside)), rimv), depth)


def hout(g, h, gain=0.5):
    return g.clamp01(g.add(0.5, g.mul(h, gain)))


# ------------------------------------------------------------------ bodies

def saturn(g, d, uv):
    x, y, z = g.sep(d)
    warp, _ = g.noise(g.combine(g.mul(x, 3.0), g.mul(y, 9.0), g.mul(z, 3.0)), 1.6, 5, 0.6)
    swirl, _ = g.noise(g.combine(g.mul(x, 2.0), g.mul(y, 40.0), g.mul(z, 2.0)), 2.0, 6, 0.55)
    lat = g.add(y, g.add(g.mul(g.sub(warp, 0.5), 0.05), g.mul(g.sub(swirl, 0.5), 0.022)))
    b1, _ = g.noise(g.combine(g.mul(lat, 7.0), 0.37, 0.11), 1.0, 2, 0.5)
    b2, _ = g.noise(g.combine(g.mul(lat, 31.0), 1.7, 0.4), 1.0, 4, 0.55)
    b3, _ = g.noise(g.combine(g.mul(lat, 140.0), 2.9, 0.9), 1.0, 3, 0.5)
    bands = g.add(g.add(g.mul(b1, 0.45), g.mul(b2, 0.4)), g.mul(b3, 0.15))
    alat = g.abs(lat)
    base = g.ramp(bands, [(0.30, "#a88a5c"), (0.42, "#c7aa75"), (0.52, "#ddc796"),
                          (0.60, "#e8d9b0"), (0.70, "#d6bd8a"), (0.80, "#b99a66")])
    # equatorial zone paler, high latitudes greyer and cooler
    eqz = g.smooth(alat, 0.16, 0.02)
    base = g.mix(g.mul(eqz, 0.55), base, g.rgb("#efe2bd"))
    hi = g.smooth(alat, 0.55, 0.85)
    base = g.mix(g.mul(hi, 0.75), base, g.rgb("#a19a8c"))
    # north polar hexagon
    theta = g.math("ARCTAN2", z, x)
    seg = g.sub(g.math("FRACT", g.div(g.add(theta, math.pi), math.pi / 3.0)), 0.5)
    off = g.mul(seg, math.pi / 3.0)
    rr = g.math("SQRT", g.mx(g.sub(1.0, g.mul(y, y)), 0.0))
    hexr = g.div(0.21 * math.cos(math.pi / 6), g.math("COSINE", off))
    northm = g.math("GREATER_THAN", y, 0.0)
    inside_hex = g.mul(g.smooth(g.sub(rr, hexr), 0.01, -0.01), northm)
    hex_edge = g.mul(g.math("EXPONENT", g.mul(g.pow(g.div(g.sub(rr, hexr), 0.012), 2.0), -1.0)), northm)
    base = g.mix(g.mul(inside_hex, 0.32), base, g.rgb("#8d97a0"))
    base = g.mix(g.mul(hex_edge, 0.18), base, g.rgb("#6a6052"))
    vortex = g.smooth(rr, 0.05, 0.0)
    base = g.mix(g.mul(g.mul(vortex, northm), 0.7), base, g.rgb("#4b5560"))
    # a few storms
    st, _ = g.noise(g.vscale(d, 14.0), 1.0, 2, 0.5)
    storms = g.mul(g.smooth(st, 0.74, 0.8), g.smooth(alat, 0.5, 0.3))
    base = g.mix(g.mul(storms, 0.5), base, g.rgb("#f3ead3"))
    return {"color": base}


def moon_generic(g, d, p):
    h, fresh = crater_field(g, d, p["craters"], seed=p.get("seed", 0.0))
    n1, _ = g.noise(d, p.get("nscale", 3.0), 8, 0.6)
    n2, _ = g.noise(d, 18.0, 6, 0.55)
    h = g.add(h, g.mul(g.sub(n1, 0.5), p.get("relief", 0.4)))
    h = g.add(h, g.mul(g.sub(n2, 0.5), 0.12))
    tone = g.add(g.mul(n1, 0.6), g.mul(n2, 0.4))
    col = g.ramp(tone, p["ramp"])
    col = g.mix(g.mul(g.clamp01(g.mul(fresh, 1.5)), p.get("fresh", 0.12)), col, g.rgb(p.get("fresh_col", "#e6e3dc")))
    return h, col


def rhea(g, d, uv):
    p = dict(craters=[(3.0, 0.5, 0.35), (8.0, 0.55, 0.22), (20.0, 0.6, 0.12), (55.0, 0.65, 0.06), (140.0, 0.7, 0.03)],
             ramp=[(0.2, "#77736d"), (0.5, "#9c978f"), (0.8, "#bdb8ae")], seed=1.0)
    h, col = moon_generic(g, d, p)
    x, y, z = g.sep(d)
    wisp, _ = g.noise(g.combine(g.mul(x, 2.0), g.mul(y, 2.0), g.mul(z, 14.0)), 2.0, 6, 0.65)
    trailing = g.smooth(g.mul(z, -1.0), 0.0, 0.6)
    col = g.mix(g.mul(g.mul(g.smooth(wisp, 0.55, 0.75), trailing), 0.6), col, g.rgb("#e9e6df"))
    return {"color": col, "height": hout(g, h)}


def dione(g, d, uv):
    p = dict(craters=[(4.0, 0.45, 0.3), (11.0, 0.55, 0.18), (30.0, 0.6, 0.09), (80.0, 0.65, 0.04)],
             ramp=[(0.2, "#86827c"), (0.6, "#a7a39b"), (0.9, "#c5c1b9")], seed=2.0)
    h, col = moon_generic(g, d, p)
    dist, _, _ = g.voronoi(g.vscale(d, 1.0), 3.0, feature="DISTANCE_TO_EDGE")
    lines = g.smooth(dist, 0.035, 0.0)
    x, y, z = g.sep(d)
    trailing = g.smooth(g.mul(z, -1.0), -0.1, 0.5)
    col = g.mix(g.mul(g.mul(lines, trailing), 0.8), col, g.rgb("#eeece6"))
    h = g.sub(h, g.mul(lines, 0.25))
    return {"color": col, "height": hout(g, h)}


def tethys(g, d, uv):
    p = dict(craters=[(4.0, 0.4, 0.28), (12.0, 0.55, 0.15), (32.0, 0.6, 0.08), (90.0, 0.65, 0.04)],
             ramp=[(0.2, "#a29f99"), (0.6, "#c2bfb8"), (0.9, "#dad7d0")], seed=3.0)
    h, col = moon_generic(g, d, p)
    h = g.add(h, one_crater(g, d, (0.5, 0.45, 0.74), 0.55, 0.6))
    x, y, z = g.sep(d)
    chasm = g.math("EXPONENT", g.mul(g.pow(g.div(g.add(g.mul(x, 0.8), g.mul(y, 0.6)), 0.03), 2.0), -1.0))
    h = g.sub(h, g.mul(chasm, 0.5))
    return {"color": col, "height": hout(g, h)}


def mimas(g, d, uv):
    p = dict(craters=[(3.5, 0.6, 0.4), (9.0, 0.65, 0.25), (24.0, 0.7, 0.13), (60.0, 0.75, 0.06)],
             ramp=[(0.2, "#88857f"), (0.6, "#a8a59f"), (0.9, "#c4c1ba")], seed=4.0)
    h, col = moon_generic(g, d, p)
    h = g.add(h, one_crater(g, d, (0.0, 0.0, 1.0), 0.42, 1.1, rim=0.5))
    return {"color": col, "height": hout(g, h, 0.4)}


def enceladus(g, d, uv):
    x, y, z = g.sep(d)
    north = g.smooth(y, -0.45, 0.2)
    p = dict(craters=[(6.0, 0.5, 0.2), (16.0, 0.6, 0.12), (40.0, 0.65, 0.05)],
             ramp=[(0.2, "#dfe5ea"), (0.6, "#f0f3f6"), (0.9, "#fbfcfd")], fresh=0.0, seed=5.0)
    h, col = moon_generic(g, d, p)
    h = g.mul(h, north)
    # fracture network
    dist, _, _ = g.voronoi(g.vscale(d, 1.0), 6.0, feature="DISTANCE_TO_EDGE")
    cracks = g.smooth(dist, 0.03, 0.0)
    col = g.mix(g.mul(cracks, 0.45), col, g.rgb("#b9cad6"))
    h = g.sub(h, g.mul(cracks, 0.2))
    # tiger stripes near the south pole
    xr = g.add(g.mul(x, 0.8), g.mul(z, 0.6))
    wob, _ = g.noise(g.vscale(d, 6.0), 1.0, 3, 0.5)
    stripe = g.math("SINE", g.mul(g.add(xr, g.mul(g.sub(wob, 0.5), 0.08)), 33.0))
    stripes = g.mul(g.smooth(g.abs(stripe), 0.12, 0.0), g.smooth(y, -0.72, -0.82))
    col = g.mix(g.mul(stripes, 0.8), col, g.rgb("#6f8ea6"))
    h = g.sub(h, g.mul(stripes, 0.35))
    return {"color": col, "height": hout(g, h)}


def titan(g, d, uv):
    x, y, z = g.sep(d)
    n1, _ = g.noise(d, 2.5, 6, 0.6)
    n2, _ = g.noise(g.combine(g.mul(x, 2.0), g.mul(y, 10.0), g.mul(z, 2.0)), 1.5, 3, 0.5)
    tone = g.add(g.mul(n1, 0.5), g.mul(n2, 0.5))
    col = g.ramp(tone, [(0.25, "#b97c33"), (0.55, "#cf9446"), (0.8, "#deae5f")])
    dunes = g.mul(g.smooth(g.abs(y), 0.3, 0.1), g.smooth(n1, 0.45, 0.6))
    col = g.mix(g.mul(dunes, 0.35), col, g.rgb("#8c5a26"))
    hood = g.smooth(y, 0.65, 0.9)
    col = g.mix(g.mul(hood, 0.55), col, g.rgb("#7d6a50"))
    h = g.mul(g.sub(n1, 0.5), 0.2)
    return {"color": col, "height": hout(g, h)}


def iapetus(g, d, uv):
    x, y, z = g.sep(d)
    p = dict(craters=[(3.0, 0.5, 0.35), (8.0, 0.55, 0.22), (22.0, 0.6, 0.11), (60.0, 0.65, 0.05)],
             ramp=[(0.2, "#b8b1a4"), (0.6, "#d3cdc1"), (0.9, "#e6e1d7")], seed=6.0)
    h, col = moon_generic(g, d, p)
    edge, _ = g.noise(g.vscale(d, 1.0), 4.0, 8, 0.65)
    lead = g.add(g.dot(d, (0.0, 0.12, 0.99)), g.mul(g.sub(edge, 0.5), 0.45))
    dark = g.smooth(lead, 0.18, 0.32)
    col = g.mix(dark, col, g.ramp(edge, [(0.3, "#1d1712"), (0.7, "#3a2c20")]))
    ridge = g.math("EXPONENT", g.mul(g.pow(g.div(y, 0.025), 2.0), -1.0))
    rn, _ = g.noise(g.vscale(d, 8.0), 1.0, 4, 0.5)
    h = g.add(h, g.mul(ridge, g.add(0.6, g.mul(rn, 0.6))))
    return {"color": col, "height": hout(g, h, 0.4)}


def phoebe(g, d, uv):
    p = dict(craters=[(2.5, 0.65, 0.45), (7.0, 0.7, 0.3), (18.0, 0.7, 0.15), (45.0, 0.75, 0.07)],
             ramp=[(0.2, "#2d2a27"), (0.6, "#3e3a35"), (0.9, "#57514a")], fresh=0.3, fresh_col="#8a847a", seed=7.0)
    h, col = moon_generic(g, d, p)
    return {"color": col, "height": hout(g, h, 0.4)}


BODIES = {
    "saturn": (saturn, 4096, False),
    "rhea": (rhea, 4096, True),
    "enceladus": (enceladus, 4096, True),
    "titan": (titan, 2048, True),
    "dione": (dione, 2048, True),
    "tethys": (tethys, 2048, True),
    "mimas": (mimas, 2048, True),
    "iapetus": (iapetus, 4096, True),
    "phoebe": (phoebe, 2048, True),
}


def rings():
    """Radial ring profile 66,900 km .. 141,000 km -> RGBA strip (alpha = opacity)."""
    W = 4096
    r = np.linspace(66900.0, 141000.0, W)
    rng = np.random.default_rng(7)

    def fine(freqs, amp):
        out = np.zeros(W)
        for f in freqs:
            ph = rng.uniform(0, 2 * np.pi)
            out += np.sin(r / 141000.0 * f * 2 * np.pi + ph) * rng.uniform(0.5, 1.0)
        return out / len(freqs) * amp

    noise = np.zeros(W)
    for k in (37, 91, 233, 587, 1201, 2411):
        noise += np.interp(r, np.linspace(r[0], r[-1], k), rng.uniform(-1, 1, k)) / (1 + k ** 0.35)
    op = np.zeros(W); col = np.zeros((W, 3)); br = np.ones(W)
    def band(a, b): return (r >= a) & (r < b)
    m = band(66900, 74500); op[m] = 0.015
    m = band(74658, 92000); op[m] = 0.09 + 0.05 * (np.sin(r[m] / 600.0) > 0.6) + 0.06 * noise[m]
    col[m] = (0.48, 0.42, 0.36)
    m = band(92000, 117580)
    t = (r[m] - 92000) / 25580
    op[m] = np.clip(0.6 + 0.3 * np.sin(t * np.pi) + 0.45 * noise[m] + fine([310, 770, 1900, 3100], 0.25)[m], 0.3, 0.995)
    bv = 0.9 + 0.25 * noise[m] + fine([150, 520, 1700], 0.1)[m]
    col[m] = np.stack([(0.83 + 0.05 * t) * bv, (0.76 + 0.04 * t) * bv, (0.62 + 0.03 * t) * bv], 1)
    m = band(117580, 122170); op[m] = 0.06 + 0.04 * noise[m]; col[m] = (0.5, 0.46, 0.42)
    m = band(117780, 117860); op[m] = 0.5; col[m] = (0.7, 0.65, 0.57)  # Huygens ringlet
    m = band(122170, 136775)
    t = (r[m] - 122170) / 14605
    op[m] = np.clip(0.5 + 0.08 * np.cos(t * 7) + 0.12 * noise[m] + fine([400, 1300], 0.06)[m], 0.25, 0.75)
    av = 0.92 + 0.2 * noise[m]
    col[m] = np.stack([0.74 * av, 0.68 * av, 0.57 * av], 1)
    m = band(133423, 133745); op[m] = 0.02     # Encke gap
    m = band(136485, 136527); op[m] = 0.02     # Keeler gap
    m = band(140130, 140230); op[m] = 0.45; col[m] = (0.8, 0.76, 0.7)  # F ring
    op = np.clip(op, 0, 1); col = np.clip(col, 0, 1)
    img = np.zeros((4, W, 4), np.float32)
    lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    img[:, :, 0:3] = col[None, :, :]
    img[:, :, 3] = op[None, :]
    path = swlib.out("planets", "rings.png")
    im = bpy.data.images.new("rings", W, 4, alpha=True, float_buffer=False)
    im.colorspace_settings.name = "sRGB"
    px = img
    im.pixels.foreach_set(px.ravel())
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)
    return path


names = BL_ARGS or (list(BODIES) + ["rings"])
done = []
for nm in names:
    if nm == "rings":
        done.append(rings())
        continue
    fn, w, has_h = BODIES[nm]
    outs = [("color", swlib.out("planets", nm + ".jpg"), "JPEG", "8", False)]
    if has_h:
        outs.append(("height", swlib.out("planets", nm + "_h.jpg"), "JPEG", "8", True))
    done += swlib.render_plane_texture(lambda g, d, uv: fn(g, d, uv), outs, w, w // 2, mapping="sphere", samples=4)
result = {"done": done}
