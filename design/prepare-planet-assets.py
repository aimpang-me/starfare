"""Reproducible planet layers from public DEMs and maps. Offline tooling only (Pillow, numpy).

python -I design/prepare-planet-assets.py [earth] [moon] [mars] rebuilds the named bodies (all when none is named) and
keeps the other bodies' manifest entries. Downloads are cached in PLANET_SOURCES, by default
docs/design-audit/2026-10-17/planet-effects/sources.
"""
from pathlib import Path
import hashlib, json, os, sys, urllib.request
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCES = Path(os.environ.get('PLANET_SOURCES', ROOT / 'docs/design-audit/2026-10-17/planet-effects/sources'))
OUT = ROOT / 'design/assets/tex'
MANIFEST = ROOT / 'design/assets/planet-assets.json'
REGISTRATION = 'Equirectangular; north up; zero longitude at image center; same UV convention as existing color maps.'
URLS = {
    'cloud': 'https://www.solarsystemscope.com/textures/download/2k_earth_clouds.jpg',
    'normal': 'https://www.solarsystemscope.com/textures/download/2k_earth_normal_map.tif',
    'ocean': 'https://www.solarsystemscope.com/textures/download/2k_earth_specular_map.tif',
    'moon': 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_4_uint.tif',
    'mola': 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img',
    # NASA Trek's WMTS copy of the USGS mosaic; zoom 3 is 16 x 8 tiles of 256 px from -180 to 180 longitude.
    'mdim': 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/3/{row}/{col}.jpg',
}

def fetch(url, dest=None):
    dest = dest or SOURCES / url.rsplit('/', 1)[1]
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.solarsystemscope.com/'})
        dest.write_bytes(urllib.request.urlopen(req, timeout=45).read())
    return dest

entries = []
def save(image, name, body, layer, key, sources, encoding, conversion, credit, **options):
    p = OUT / name
    if p.suffix == '.webp': image.save(p, quality=90, method=6)
    elif p.suffix == '.jpg': image.save(p, optimize=True, **options)
    else: image.save(p, optimize=True)
    # A tiled source's checksum covers its tiles' bytes concatenated in row-major order.
    entries.append(dict(body=body, layer=layer, file=name, width=image.width, height=image.height, encoding=encoding,
        source=URLS[key], source_sha256=hashlib.sha256(b''.join(s.read_bytes() for s in sources)).hexdigest(),
        sha256=hashlib.sha256(p.read_bytes()).hexdigest(), registration=REGISTRATION, conversion=conversion, credit=credit))

def relief(height_km, radius_km, exaggeration):
    """Tangent-space normals from an equirectangular height grid: geodesic slopes, relief shading exaggerated for the
    enlarged game globe. Geometry and silhouette stay spherical."""
    h, w = height_km.shape
    latitude = np.linspace(np.pi/2, -np.pi/2, h)[:, None]
    east = (np.roll(height_km, -1, axis=1) - np.roll(height_km, 1, axis=1)) / (2 * radius_km * np.maximum(.08, np.cos(latitude)) * (2*np.pi/w))
    north = -np.gradient(height_km, axis=0) / (radius_km * np.pi/h)
    normal = np.stack([-east*exaggeration, -north*exaggeration, np.ones_like(height_km)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return Image.fromarray(np.uint8(np.clip((normal*.5+.5)*255, 0, 255)))

def earth():
    cloud, normal, ocean = (fetch(URLS[k]) for k in ('cloud', 'normal', 'ocean'))
    credit = 'Solar System Scope / INOVE, CC BY 4.0'
    for width in [1024, 2048]:
        size = (width, width // 2); tier = '1k' if width == 1024 else '2k'
        save(Image.open(cloud).convert('L').resize(size, Image.Resampling.LANCZOS), f'earth_clouds_{tier}.webp', 'earth', 'cloud', 'cloud', [cloud], 'linear mask', 'Grayscale coverage, Lanczos resize, WebP quality 90.', credit)
        save(Image.open(normal).convert('RGB').resize(size, Image.Resampling.LANCZOS), f'earth_normal_{tier}.png', 'earth', 'normal', 'normal', [normal], 'linear tangent-space RGB', 'Lanczos resize; normals renormalized in shader. No color encoding.', credit)
    save(Image.open(ocean).convert('L').resize((1024,512),Image.Resampling.LANCZOS), 'earth_ocean_1k.png', 'earth', 'ocean', 'ocean', [ocean], 'linear mask', 'Grayscale water/specular mask; white is reflective ocean.', credit)

def moon():
    src = fetch(URLS['moon'])
    # LOLA unsigned height units are 0.5m, shifted by +10000m from the 1737.4km reference sphere.
    height = (np.asarray(Image.open(src), dtype=np.float64) - 20000) * .0005
    save(relief(height, 1737.4, 4).resize((1024,512),Image.Resampling.LANCZOS), 'moon_normal_1k.png', 'moon', 'normal', 'moon', [src], 'linear tangent-space RGB', 'LOLA 0.5m unsigned heights converted to km; geodesic slopes, 4x relief shading, normal-map encoding. No geometric displacement.', 'NASA SVS / LRO LOLA')

def mars():
    tiles = [fetch(URLS['mdim'].format(row=r, col=c), SOURCES / 'mars_mdim21_z3' / f'{r}_{c}.jpg') for r in range(8) for c in range(16)]
    color = Image.new('RGB', (4096, 2048))
    for i, t in enumerate(tiles): color.paste(Image.open(t).convert('RGB'), (i % 16 * 256, i // 16 * 256))
    for width in [1024, 2048]:
        save(color.resize((width, width // 2), Image.Resampling.LANCZOS), f'mars_{width // 1024}k.jpg', 'mars', 'color', 'mdim', tiles, 'sRGB color',
            'Zoom-3 WMTS tiles (4096x2048) stitched, Lanczos resize, JPEG quality 90.', 'USGS Astrogeology / NASA Trek, public domain', quality=90)
    src = fetch(URLS['mola'])
    # MEGDR: big-endian int16 meters above the areoid, 16 px/deg, west edge at 0E. Rolled half a turn so 0E is centered,
    # then averaged 2x2 to 8 px/deg, still finer than the 2048 px output.
    height = np.roll(np.fromfile(src, '>i2').reshape(2880, 5760), 2880, axis=1).astype(np.float64) / 1000
    height = height.reshape(1440, 2, 2880, 2).mean(axis=(1, 3))
    # Mars is smooth at this scale (median slope 1.3 deg at 4x), so it takes 8x. One 1K map: a 2K PNG is 2.5 MB,
    # and JPEG's error (median 0.45 deg) is a large share of those slopes.
    save(relief(height, 3396.0, 8).resize((1024, 512), Image.Resampling.LANCZOS), 'mars_normal_1k.png', 'mars', 'normal', 'mola', [src], 'linear tangent-space RGB',
        'MOLA MEGDR 16 px/deg heights averaged 2x2, converted to km on the 3396 km reference sphere; geodesic slopes, 8x relief shading, normal-map encoding. No geometric displacement.', 'NASA / MGS MOLA Science Team (PDS Geosciences Node), public domain')

BUILD = {'earth': earth, 'moon': moon, 'mars': mars}
bodies = sys.argv[1:] or list(BUILD)
for body in bodies: BUILD[body]()
kept = [a for a in json.loads(MANIFEST.read_text(encoding='utf-8'))['assets'] if a['body'] not in bodies] if MANIFEST.exists() else []
manifest = dict(note='Appearance assets only; not live weather or scientific surface-orientation telemetry.', assets=kept + entries)
MANIFEST.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(files=len(entries),bytes=sum((OUT/e['file']).stat().st_size for e in entries))))
