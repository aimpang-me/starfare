"""Reproducible Earth layers and lunar DEM normals. Offline tooling only (Pillow, numpy)."""
from pathlib import Path
import hashlib, json, urllib.request
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'docs/design-audit/2026-10-17/planet-effects/sources'
OUT = ROOT / 'design/assets/tex'
SOURCES.mkdir(parents=True, exist_ok=True)
URLS = {
    'cloud': 'https://www.solarsystemscope.com/textures/download/2k_earth_clouds.jpg',
    'normal': 'https://www.solarsystemscope.com/textures/download/2k_earth_normal_map.tif',
    'ocean': 'https://www.solarsystemscope.com/textures/download/2k_earth_specular_map.tif',
    'moon': 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_4_uint.tif',
}
files = {}
for key, url in URLS.items():
    dest = SOURCES / url.rsplit('/', 1)[1]
    if not dest.exists():
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.solarsystemscope.com/'})
        dest.write_bytes(urllib.request.urlopen(req, timeout=45).read())
    files[key] = dest

entries = []
def save(image, name, key, encoding, conversion):
    p = OUT / name
    if p.suffix == '.webp': image.save(p, quality=90, method=6)
    else: image.save(p, optimize=True)
    entries.append(dict(body='moon' if key == 'moon' else 'earth', layer=key, file=name,
        width=image.width, height=image.height, encoding=encoding, source=URLS[key],
        source_sha256=hashlib.sha256(files[key].read_bytes()).hexdigest(), sha256=hashlib.sha256(p.read_bytes()).hexdigest(),
        registration='Equirectangular; north up; zero longitude at image center; same UV convention as existing color maps.',
        conversion=conversion, credit='NASA SVS / LRO LOLA' if key == 'moon' else 'Solar System Scope / INOVE, CC BY 4.0'))

for width in [1024, 2048]:
    size = (width, width // 2); tier = '1k' if width == 1024 else '2k'
    save(Image.open(files['cloud']).convert('L').resize(size, Image.Resampling.LANCZOS), f'earth_clouds_{tier}.webp', 'cloud', 'linear mask', 'Grayscale coverage, Lanczos resize, WebP quality 90.')
    save(Image.open(files['normal']).convert('RGB').resize(size, Image.Resampling.LANCZOS), f'earth_normal_{tier}.png', 'normal', 'linear tangent-space RGB', 'Lanczos resize; normals renormalized in shader. No color encoding.')
save(Image.open(files['ocean']).convert('L').resize((1024,512),Image.Resampling.LANCZOS), 'earth_ocean_1k.png', 'ocean', 'linear mask', 'Grayscale water/specular mask; white is reflective ocean.')

# LOLA unsigned height units are 0.5m, shifted by +10000m from the 1737.4km reference sphere.
height = (np.asarray(Image.open(files['moon']), dtype=np.float64) - 20000) * .0005
h,w = height.shape
latitude = np.linspace(np.pi/2, -np.pi/2, h)[:,None]
east = (np.roll(height,-1,axis=1)-np.roll(height,1,axis=1)) / (2 * 1737.4 * np.maximum(.08,np.cos(latitude)) * (2*np.pi/w))
north = -np.gradient(height, axis=0) / (1737.4 * np.pi/h)
# Relief shading exaggerated 4x for the enlarged game globe; geometry/silhouette stay spherical.
normal = np.stack([-east*4, -north*4, np.ones_like(height)], axis=-1)
normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
rgb = np.uint8(np.clip((normal*.5+.5)*255,0,255))
save(Image.fromarray(rgb).resize((1024,512),Image.Resampling.LANCZOS), 'moon_normal_1k.png', 'moon', 'linear tangent-space RGB', 'LOLA 0.5m unsigned heights converted to km; geodesic slopes, 4x relief shading, normal-map encoding. No geometric displacement.')

manifest = dict(note='Appearance assets only; not live weather or scientific surface-orientation telemetry.', assets=entries)
(ROOT/'design/assets/planet-assets.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(files=len(entries),bytes=sum((OUT/e['file']).stat().st_size for e in entries))))
