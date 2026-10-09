"""SpaceWing Blender helper library (runs inside Blender 5.x via the MCP bridge)."""
import bpy, math, os, random

ASSETS = None  # set by init()


def init(repo):
    global ASSETS
    ASSETS = os.path.join(repo, "public", "assets")
    os.makedirs(ASSETS, exist_ok=True)
    return ASSETS


def out(*parts):
    p = os.path.join(ASSETS, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


# ---------------------------------------------------------------- scene setup

def fresh():
    """Remove all objects and orphan data from the current scene."""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights,
                 bpy.data.curves, bpy.data.node_groups, bpy.data.textures):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)
    for img in list(bpy.data.images):
        if img.users == 0:
            bpy.data.images.remove(img)
    for c in list(bpy.data.collections):
        if c.users == 0 or not c.objects:
            try:
                bpy.data.collections.remove(c)
            except Exception:
                pass
    sc = bpy.context.scene
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    return sc


def cycles(samples=64, w=1920, h=1080, transform="AgX", look=None, denoise=True, exposure=0.0):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
    except Exception:
        pass
    sc.cycles.device = "GPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = denoise
    sc.cycles.use_adaptive_sampling = True
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = transform
    try:
        sc.view_settings.look = look or "None"
    except Exception:
        sc.view_settings.look = "None"
    sc.view_settings.exposure = exposure
    sc.view_settings.gamma = 1.0
    sc.display_settings.display_device = "sRGB"
    return sc


def save_render(path, fmt="PNG", depth="8", mode="RGB", quality=92):
    sc = bpy.context.scene
    st = sc.render.image_settings
    st.file_format = fmt
    st.color_mode = mode
    if fmt == "PNG":
        st.color_depth = depth
        st.compression = 90
    if fmt == "JPEG":
        st.quality = quality
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def new_mat(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    return m


def srgb(c):
    """sRGB 0..1 component -> linear."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(h, a=1.0):
    h = h.lstrip("#")
    return (srgb(int(h[0:2], 16) / 255), srgb(int(h[2:4], 16) / 255), srgb(int(h[4:6], 16) / 255), a)


# ---------------------------------------------------------------- node graph builder

class G:
    """Small helper to build shader node graphs from code."""

    def __init__(self, tree):
        self.t = tree
        self.n = tree.nodes
        self.l = tree.links
        self._x = 0

    def node(self, kind, **props):
        nd = self.n.new(kind)
        for k, v in props.items():
            setattr(nd, k, v)
        self._x += 1
        nd.location = ((self._x % 40) * 220, -(self._x // 40) * 300)
        return nd

    def _in(self, sock, val):
        if val is None:
            return
        if isinstance(val, bpy.types.NodeSocket):
            self.l.new(val, sock)
        elif isinstance(val, (int, float)) and hasattr(sock.default_value, '__len__'):
            n = len(sock.default_value)
            sock.default_value = (val,) * 3 + ((1.0,) if n == 4 else ())
        elif isinstance(val, (tuple, list)):
            if len(sock.default_value) == 4 and len(val) == 3:
                val = tuple(val) + (1.0,)
            sock.default_value = val
        else:
            sock.default_value = val

    def math(self, op, a, b=None, c=None, clamp=False):
        nd = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self._in(nd.inputs[0], a)
        if b is not None:
            self._in(nd.inputs[1], b)
        if c is not None:
            self._in(nd.inputs[2], c)
        return nd.outputs[0]

    def add(self, a, b): return self.math("ADD", a, b)
    def sub(self, a, b): return self.math("SUBTRACT", a, b)
    def mul(self, a, b): return self.math("MULTIPLY", a, b)
    def div(self, a, b): return self.math("DIVIDE", a, b)
    def pow(self, a, b): return self.math("POWER", a, b)
    def mn(self, a, b): return self.math("MINIMUM", a, b)
    def mx(self, a, b): return self.math("MAXIMUM", a, b)
    def abs(self, a): return self.math("ABSOLUTE", a)
    def clamp01(self, a): return self.math("ADD", a, 0.0, clamp=True)
    def madd(self, a, b, c): return self.math("MULTIPLY_ADD", a, b, c)

    def smooth(self, v, a, b, lo=0.0, hi=1.0):
        nd = self.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
        self._in(nd.inputs["Value"], v)
        nd.inputs["From Min"].default_value = a
        nd.inputs["From Max"].default_value = b
        nd.inputs["To Min"].default_value = lo
        nd.inputs["To Max"].default_value = hi
        return nd.outputs["Result"]

    def remap(self, v, a, b, lo=0.0, hi=1.0, clamp=True):
        nd = self.node("ShaderNodeMapRange", interpolation_type="LINEAR", clamp=clamp)
        self._in(nd.inputs["Value"], v)
        for k, x in (("From Min", a), ("From Max", b), ("To Min", lo), ("To Max", hi)):
            self._in(nd.inputs[k], x)
        return nd.outputs["Result"]

    def vmath(self, op, a, b=None, scale=None):
        nd = self.node("ShaderNodeVectorMath", operation=op)
        self._in(nd.inputs[0], a)
        if b is not None:
            self._in(nd.inputs[1], b)
        if scale is not None:
            self._in(nd.inputs["Scale"], scale)
        out = nd.outputs["Value"] if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else nd.outputs["Vector"]
        return out

    def vadd(self, a, b): return self.vmath("ADD", a, b)
    def vscale(self, a, s): return self.vmath("SCALE", a, scale=s)
    def dot(self, a, b): return self.vmath("DOT_PRODUCT", a, b)

    def combine(self, x, y, z):
        nd = self.node("ShaderNodeCombineXYZ")
        for i, v in enumerate((x, y, z)):
            self._in(nd.inputs[i], v)
        return nd.outputs[0]

    def sep(self, v):
        nd = self.node("ShaderNodeSeparateXYZ")
        self._in(nd.inputs[0], v)
        return nd.outputs[0], nd.outputs[1], nd.outputs[2]

    def noise(self, vec, scale=1.0, detail=4.0, rough=0.5, lac=2.0, dist=0.0, kind="FBM", w=None):
        nd = self.node("ShaderNodeTexNoise")
        nd.noise_dimensions = "4D" if w is not None else "3D"
        try:
            nd.noise_type = kind
            nd.normalize = True
        except Exception:
            pass
        self._in(nd.inputs["Vector"], vec)
        if w is not None:
            self._in(nd.inputs["W"], w)
        self._in(nd.inputs["Scale"], scale)
        self._in(nd.inputs["Detail"], detail)
        self._in(nd.inputs["Roughness"], rough)
        self._in(nd.inputs["Lacunarity"], lac)
        self._in(nd.inputs["Distortion"], dist)
        return nd.outputs["Fac"], nd.outputs["Color"]

    def voronoi(self, vec, scale=5.0, rand=1.0, feature="F1", metric="EUCLIDEAN"):
        nd = self.node("ShaderNodeTexVoronoi", feature=feature, distance=metric)
        nd.voronoi_dimensions = "3D"
        self._in(nd.inputs["Vector"], vec)
        self._in(nd.inputs["Scale"], scale)
        self._in(nd.inputs["Randomness"], rand)
        o = {s.name: s for s in nd.outputs if s.enabled}
        return o.get("Distance"), o.get("Color"), o.get("Position")

    def white(self, vec):
        nd = self.node("ShaderNodeTexWhiteNoise", noise_dimensions="3D")
        self._in(nd.inputs["Vector"], vec)
        return nd.outputs["Value"], nd.outputs["Color"]

    def ramp(self, fac, stops, interp="LINEAR"):
        nd = self.node("ShaderNodeValToRGB")
        cr = nd.color_ramp
        cr.interpolation = interp
        els = cr.elements
        while len(els) > 1:
            els.remove(els[-1])
        for i, (pos, col) in enumerate(stops):
            if isinstance(col, str):
                col = hexc(col)
            elif len(col) == 3:
                col = tuple(col) + (1.0,)
            e = els[0] if i == 0 else els.new(pos)
            e.position = pos
            e.color = col
        self._in(nd.inputs["Fac"], fac)
        return nd.outputs["Color"]

    def mix(self, fac, a, b, blend="MIX"):
        nd = self.node("ShaderNodeMix", data_type="RGBA", blend_type=blend, clamp_result=False)
        ins = [i for i in nd.inputs]
        self._in(nd.inputs["Factor"], fac)
        a_s = [i for i in ins if i.name == "A" and i.type == "RGBA"][0]
        b_s = [i for i in ins if i.name == "B" and i.type == "RGBA"][0]
        self._in(a_s, a)
        self._in(b_s, b)
        return [o for o in nd.outputs if o.type == "RGBA"][0]

    def rgb(self, col):
        nd = self.node("ShaderNodeRGB")
        if isinstance(col, str):
            col = hexc(col)
        nd.outputs[0].default_value = col if len(col) == 4 else tuple(col) + (1,)
        return nd.outputs[0]

    def value(self, v):
        nd = self.node("ShaderNodeValue")
        nd.outputs[0].default_value = v
        return nd.outputs[0]

    def emission(self, color, strength=1.0):
        nd = self.node("ShaderNodeEmission")
        self._in(nd.inputs["Color"], color)
        self._in(nd.inputs["Strength"], strength)
        return nd.outputs[0]

    def output(self, shader):
        out = [n for n in self.n if n.type == "OUTPUT_MATERIAL"]
        out = out[0] if out else self.node("ShaderNodeOutputMaterial")
        self.l.new(shader, out.inputs["Surface"])


# ---------------------------------------------------------------- texture rendering via UV plane

def _dir_from_uv(g, mapping):
    """Return a direction-vector socket computed from the plane's UV.

    mapping == 'sphere'   : three.js SphereGeometry UV convention (top of image = +Y)
    mapping == 'equirect' : three.js equirectangular background convention
    """
    tc = g.node("ShaderNodeTexCoord")
    u, v, _ = g.sep(tc.outputs["UV"])
    if mapping == "sphere":
        phi = g.mul(u, 2 * math.pi)
        theta = g.mul(g.sub(1.0, v), math.pi)
        st = g.math("SINE", theta)
        x = g.mul(g.mul(g.math("COSINE", phi), st), -1.0)
        y = g.math("COSINE", theta)
        z = g.mul(g.math("SINE", phi), st)
    else:
        phi = g.mul(g.sub(u, 0.5), 2 * math.pi)
        lat = g.mul(g.sub(v, 0.5), math.pi)
        cl = g.math("COSINE", lat)
        x = g.mul(cl, g.math("COSINE", phi))
        y = g.math("SINE", lat)
        z = g.mul(cl, g.math("SINE", phi))
    return g.combine(x, y, z), (u, v)


def render_plane_texture(build, outputs, w, h, mapping="sphere", samples=8):
    """build(g, dir, uv) -> dict name->socket(color or float).
    outputs: list of (name, path, fmt, depth, raw)
    Renders each named output of the graph to an image file via an emission plane."""
    fresh()
    sc = cycles(samples=samples, w=w, h=h, transform="Standard", denoise=False)
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.filter_width = 1.2
    sc.world.color = (0, 0, 0)
    bpy.ops.mesh.primitive_plane_add(size=2.0)
    plane = bpy.context.active_object
    plane.scale = (w / h, 1, 1)
    mat = new_mat("tex_render")
    mat.node_tree.nodes.clear()
    g = G(mat.node_tree)
    d, uv = _dir_from_uv(g, mapping)
    socks = build(g, d, uv)
    em = g.node("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.0
    outn = g.node("ShaderNodeOutputMaterial")
    g.l.new(em.outputs[0], outn.inputs["Surface"])
    plane.data.materials.append(mat)
    cam_d = bpy.data.cameras.new("texcam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = 2.0 * w / h
    cam = bpy.data.objects.new("texcam", cam_d)
    sc.collection.objects.link(cam)
    cam.location = (0, 0, 2)
    sc.camera = cam
    done = []
    for name, path, fmt, depth, raw in outputs:
        sock = socks[name]
        for lk in list(em.inputs["Color"].links):
            g.l.remove(lk)
        g.l.new(sock, em.inputs["Color"])
        sc.view_settings.view_transform = "Raw" if raw else "Standard"
        save_render(path, fmt=fmt, depth=depth, mode="BW" if raw else "RGB")
        done.append(path)
    return done
