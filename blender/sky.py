"""Procedural Milky Way + starfield, rendered as equirect panorama (three.js background convention)."""
import importlib, swlib, math
importlib.reload(swlib)
swlib.init(REPO)
W = int(BL_ARGS[0]) if BL_ARGS else 8192
H = W // 2

def build(g, d, uv):
    # galactic frame: band normal tilted against the ring plane
    n_gal = (0.32, 0.86, -0.40)
    ln = math.sqrt(sum(c * c for c in n_gal)); n_gal = tuple(c / ln for c in n_gal)
    core = (0.80, -0.05, 0.60)
    lc = math.sqrt(sum(c * c for c in core)); core = tuple(c / lc for c in core)
    b = g.dot(d, n_gal)                          # galactic latitude (sin)
    ab = g.abs(b)
    ccos = g.dot(d, core)                        # proximity to galactic core
    band = g.math("EXPONENT", g.mul(g.pow(g.div(ab, 0.16), 2.0), -1.0))
    band_thin = g.math("EXPONENT", g.mul(g.pow(g.div(ab, 0.055), 2.0), -1.0))
    bulge = g.math("EXPONENT", g.mul(g.sub(1.0, ccos), -5.5))
    warp, _ = g.noise(d, 2.2, 3, 0.55)
    dw = g.vadd(d, g.vscale(g.combine(warp, warp, warp), 0.08))
    clouds, _ = g.noise(dw, 4.5, 10, 0.62, dist=0.2)
    fine, _ = g.noise(dw, 22.0, 8, 0.6)
    cl = g.smooth(g.add(g.mul(clouds, 0.8), g.mul(fine, 0.35)), 0.35, 0.85)
    dens = g.mul(g.add(g.mul(band, 0.55), g.mul(bulge, 0.9)), cl)
    dens = g.add(dens, g.mul(band_thin, g.mul(bulge, 0.6)))
    # dust lanes
    dust, _ = g.noise(dw, 9.0, 8, 0.65, dist=0.3)
    dustm = g.mul(g.smooth(dust, 0.45, 0.7), g.math("EXPONENT", g.mul(g.pow(g.div(ab, 0.07), 2.0), -1.0)))
    dens = g.mul(dens, g.sub(1.0, g.mul(dustm, 0.7)))
    hue, _ = g.noise(d, 3.0, 2, 0.5)
    glow_col = g.mix(bulge, g.ramp(hue, [(0.3, "#7f93b8"), (0.7, "#b5a48c")]), g.rgb("#e8c79a"))
    milky = g.mix(1.0, g.rgb((0, 0, 0)), g.mix(g.mul(dens, 0.11), (0, 0, 0, 1), glow_col), blend="ADD")
    # faint emission nebulae
    neb, _ = g.noise(g.vscale(d, 1.0), 3.0, 6, 0.6, dist=0.5)
    nebm = g.mul(g.smooth(neb, 0.62, 0.8), g.mul(band, 0.010))
    milky = g.mix(1.0, milky, g.mix(nebm, (0, 0, 0, 1), g.rgb("#c4466a")), blend="ADD")
    # stars: three voronoi layers
    total = milky
    for scale, keep, size, gain, bw in ((120.0, 0.07, 0.07, 9.0, 0.6), (400.0, 0.22, 0.07, 3.5, 1.2), (1200.0, 0.45, 0.08, 1.4, 1.8), (3600.0, 0.35, 0.10, 0.7, 4.0)):
        dist, col, _ = g.voronoi(d, scale)
        r, gg, bb = g.sep(col)
        # star present if random < keep (more near the band)
        thr = g.mn(0.95, g.mul(keep, g.add(g.add(0.25, g.mul(band, bw)), g.mul(g.mul(bulge, cl), bw))))
        present = g.math("LESS_THAN", r, thr)
        mag = g.pow(gg, 7.0)          # brightness: many faint, few bright
        prof = g.math("EXPONENT", g.mul(g.pow(g.div(dist, size), 2.0), -1.0))
        bright = g.mul(g.mul(prof, present), g.mul(g.add(0.12, mag), gain))
        tint = g.ramp(bb, [(0.0, "#9db4ff"), (0.25, "#cad7ff"), (0.55, "#fff4ea"), (0.8, "#ffd2a1"), (1.0, "#ffb46b")])
        total = g.mix(1.0, total, g.mix(g.clamp01(bright), (0, 0, 0, 1), tint), blend="ADD")
        # soft halo for bright ones
        halo = g.mul(g.math("EXPONENT", g.mul(g.pow(g.div(dist, size * 4.0), 2.0), -1.0)), g.mul(present, g.mul(mag, gain * 0.05)))
        total = g.mix(1.0, total, g.mix(g.clamp01(halo), (0, 0, 0, 1), tint), blend="ADD")
    return {"color": total}

path = swlib.out("sky", "milkyway.jpg")
swlib.render_plane_texture(build, [("color", path, "JPEG", "8", False)], W, H, mapping="equirect", samples=24)
result = {"sky": path}
