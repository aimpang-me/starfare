"""Reproducible planet maps and layers from public mosaics, DEMs and maps. Offline tooling only (Pillow, numpy, tifffile).

python -I design/prepare-planet-assets.py [body ...] rebuilds the named bodies (all when none is named) and keeps the
other bodies' manifest entries. Each download is cached in its own directory under PLANET_SOURCES, by default
docs/design-audit/2026-10-17/planet-effects/sources. The 4K maps are release assets, kept out of Git.
"""
from pathlib import Path
import hashlib, json, os, sys, urllib.request
import numpy as np
import tifffile
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[1]
SOURCES = Path(os.environ.get('PLANET_SOURCES', ROOT / 'docs/design-audit/2026-10-17/planet-effects/sources'))
OUT = ROOT / 'design/assets/tex'
MANIFEST = ROOT / 'design/assets/planet-assets.json'
REGISTRATION = 'Equirectangular; north up; zero longitude at image center; same UV convention as existing color maps.'
SSS = 'https://www.solarsystemscope.com/textures/download/'
USGS = 'https://planetarymaps.usgs.gov/mosaic/'
SVS = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/'
URLS = {
    'cloud': SSS + '2k_earth_clouds.jpg',
    'normal': SSS + '2k_earth_normal_map.tif',
    'ocean': SSS + '2k_earth_specular_map.tif',
    'moon': SVS + 'ldem_16_uint.tif',
    'mola': 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img',
    # NASA Trek's WMTS copy of the USGS mosaic; zoom 3 is 16 x 8 tiles of 256 px from -180 to 180 longitude.
    'mdim': 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/3/{row}/{col}.jpg',
}
SSS_CREDIT = 'Solar System Scope / INOVE, CC BY 4.0'
# Colour maps. mean is the average channel value a new mosaic is scaled to, the brightness the game was tuned on with
# the map it replaces; tint colours a grey mosaic the way that map was coloured.
COLOR = {
    'sun': dict(url=SSS + '8k_sun.jpg', credit=SSS_CREDIT),
    'mercury': dict(url=SSS + '8k_mercury.jpg', credit=SSS_CREDIT + '; based on NASA MESSENGER data'),
    'venus': dict(url=SSS + '4k_venus_atmosphere.jpg', credit=SSS_CREDIT),
    'earth': dict(url='https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg', tiers='2k 4k', name='earth_day',
        credit='NASA Earth Observatory, Blue Marble Next Generation; public domain'),
    'moon': dict(url=SVS + 'lroc_color_poles_4k.tif', credit='NASA SVS / LRO LROC; public domain'),
    'phobos': dict(url=USGS + 'Phobos_Viking_Mosaic_40ppd_DLRcontrol.tif', mean=89, tint=(1.084, .995, .92),
        credit='Phil Stooke (University of Western Ontario) from NASA Viking Orbiter images, DLR control network; USGS Astrogeology; public domain'),
    'ceres': dict(url=USGS + 'Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif', mean=84.5, tint=(1.042, 1.004, .953), credit='NASA/JPL-Caltech/UCLA/MPS/DLR/IDA; USGS Astrogeology; public domain'),
    'bennu': dict(url=USGS + 'Bennu/Bennu_global_FB34_FB56_ShapeV28_GndControl_MinnaertPhase30_PAN_8bit.tif', credit='NASA/Goddard/University of Arizona; USGS Astrogeology; public domain'),
    'jupiter': dict(url=SSS + '8k_jupiter.jpg', tiers='2k 4k', credit=SSS_CREDIT + '; based on NASA/JPL/Space Science Institute Cassini imagery (PIA07782)'),
    'io': dict(url=USGS + 'Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif', credit='NASA/JPL Voyager and Galileo SSI; USGS Astrogeology; public domain'),
    'europa': dict(url=USGS + 'Europa_Voyager_GalileoSSI_global_mosaic_500m.tif', mean=170, credit='NASA/JPL Voyager and Galileo SSI; USGS Astrogeology; public domain'),
    'ganymede': dict(url=USGS + 'Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m.tif', mean=150, credit='NASA/JPL Voyager and Galileo SSI; USGS Astrogeology; public domain'),
    'callisto': dict(url=USGS + 'Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif', credit='NASA/JPL Voyager and Galileo SSI; USGS Astrogeology; public domain'),
    'saturn': dict(url=SSS + '8k_saturn.jpg', credit=SSS_CREDIT),
    'enceladus': dict(url=USGS + 'Enceladus_Cassini_ISS_Global_Mosaic_100m_HPF.tif', mean=148.5, credit='NASA/JPL-Caltech/Space Science Institute; USGS Astrogeology; public domain'),
    'uranus': dict(url=SSS + '2k_uranus.jpg', tiers='1k 2k', credit=SSS_CREDIT),
    'neptune': dict(url=SSS + '2k_neptune.jpg', tiers='1k 2k', credit=SSS_CREDIT),
    'triton': dict(url=USGS + 'Triton_Voyager2_ClrMosaic_GlobalFill_600m.tif', credit='NASA/JPL Voyager 2; USGS Astrogeology; public domain'),
}

def fetch(url, dest=None):
    name = url.rsplit('/', 1)[1]
    dest = dest or SOURCES / name.rsplit('.', 1)[0] / name
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.solarsystemscope.com/'})
        dest.write_bytes(urllib.request.urlopen(req, timeout=45).read())
    return dest

def digest(paths):
    h = hashlib.sha256()
    for p in paths:
        with open(p, 'rb') as f:
            for block in iter(lambda: f.read(1 << 20), b''): h.update(block)
    return h.hexdigest()

entries = []
def save(image, name, body, layer, url, sources, encoding, conversion, credit, **options):
    p = OUT / name
    if p.suffix == '.webp': image.save(p, quality=90, method=6)
    elif p.suffix == '.jpg': image.save(p, optimize=True, **options)
    else: image.save(p, optimize=True)
    # A tiled source's checksum covers its tiles' bytes concatenated in row-major order.
    entries.append(dict(body=body, layer=layer, file=name, width=image.width, height=image.height, encoding=encoding,
        source=url, source_sha256=digest(sources), sha256=digest([p]), registration=REGISTRATION, conversion=conversion, credit=credit))

def shrink(image, width):
    return image.resize((width, width // 2), Image.Resampling.LANCZOS, reducing_gap=3.0)

def colour(body):
    c = COLOR[body]
    src = fetch(c['url']); image = Image.open(src)
    tiers = c.get('tiers', '1k 2k 4k').split(); width = int(tiers[-1][0]) * 1024
    assert image.width >= width, f'{body}: a {image.width} px source cannot make a {tiers[-1]} map'
    notes = [f'{image.width}x{image.height} source, Lanczos resize']
    tags, shift = getattr(image, 'tag_v2', {}), 0
    if 33922 in tags:
        # GeoTIFF: a west edge easting of -0.5 of the width puts the projection's central meridian at the image centre.
        # Several USGS mosaics centre on 180E, so the map is rolled half a turn to bring zero longitude there.
        frac = tags[33922][3] / (tags[33550][0] * image.width)
        assert abs(frac + .5) < 1e-3, f'{body}: the central meridian sits at {frac:+.3f} of the width, not the centre'
        with tifffile.TiffFile(src) as t: meridian = t.geotiff_metadata['ProjCenterLongGeoKey']
        shift = meridian / 360 * width
        assert shift == int(shift), f'{body}: a {meridian} deg central meridian is not a whole pixel at {width} px'
        if shift: notes.append(f'rolled {meridian:g} deg so zero longitude is centred')
    if image.mode not in ('L', 'RGB'): image = image.convert('RGB')
    rgb = np.asarray(shrink(image, width), dtype=np.float64)
    if str(tags.get(42113, '')).strip() == '0':
        # Unimaged pixels are 0. The coverage mask is resized alongside, so imaged and filled areas blend at the seam.
        cover = np.clip(np.asarray(shrink(image.convert('L').point(lambda v: 255 if v else 0), width), dtype=np.float64) / 255, 0, 1)
        if rgb.ndim == 3: cover = cover[..., None]
        imaged = rgb.sum(axis=(0, 1)) / cover.sum(axis=(0, 1)) if rgb.ndim == 3 else rgb.sum() / cover.sum()
        rgb = rgb + imaged * (1 - cover)
        notes.append(f'unimaged {1 - cover.mean():.1%} filled with the imaged mean')
    if 'tint' in c:
        rgb = rgb[..., None] * np.array(c['tint'])
        notes.append('tinted x(%s)' % ', '.join(map(str, c['tint'])))
    if 'mean' in c:
        gain = c['mean'] / rgb.mean()
        rgb = rgb * gain
        clipped = (rgb > 255).mean()
        print(f'{body}: gain {gain:.3f}, {clipped:.3%} of values clip')
        notes.append(f'scaled x{gain:.3f} to mean {c["mean"]}')
    base = Image.fromarray(np.uint8(np.clip(np.rint(np.roll(rgb, int(shift), axis=1)), 0, 255)))
    name = c.get('name', body)
    for tier in tiers:
        w = int(tier[0]) * 1024
        save(base if w == width else shrink(base, w), f'{name}_{tier}.jpg', body, 'color', c['url'], [src], 'sRGB color',
            '; '.join(notes) + f'; {w}x{w // 2}, JPEG quality 90.', c['credit'], quality=90)

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
    for width in [1024, 2048]:
        size = (width, width // 2); tier = '1k' if width == 1024 else '2k'
        save(Image.open(cloud).convert('L').resize(size, Image.Resampling.LANCZOS), f'earth_clouds_{tier}.webp', 'earth', 'cloud', URLS['cloud'], [cloud], 'linear mask', 'Grayscale coverage, Lanczos resize, WebP quality 90.', SSS_CREDIT)
        save(Image.open(normal).convert('RGB').resize(size, Image.Resampling.LANCZOS), f'earth_normal_{tier}.png', 'earth', 'normal', URLS['normal'], [normal], 'linear tangent-space RGB', 'Lanczos resize; normals renormalized in shader. No color encoding.', SSS_CREDIT)
    save(Image.open(ocean).convert('L').resize((1024,512),Image.Resampling.LANCZOS), 'earth_ocean_1k.png', 'earth', 'ocean', URLS['ocean'], [ocean], 'linear mask', 'Grayscale water/specular mask; white is reflective ocean.', SSS_CREDIT)
    colour('earth')

def moon():
    colour('moon')
    src = fetch(URLS['moon'])
    # LOLA unsigned height units are 0.5m, shifted by +10000m from the 1737.4km reference sphere. 16 px/deg, averaged
    # 2x2 to 8 px/deg, still finer than the 2048 px output.
    height = (tifffile.imread(src).astype(np.float64) - 20000) * .0005
    height = height.reshape(1440, 2, 2880, 2).mean(axis=(1, 3))
    print(f'moon: heights {height.min():.2f} to {height.max():.2f} km')
    normals = relief(height, 1737.4, 4)
    for width in [1024, 2048]:
        save(shrink(normals, width), f'moon_normal_{width // 1024}k.png', 'moon', 'normal', URLS['moon'], [src], 'linear tangent-space RGB',
            'LOLA 16 px/deg 0.5m unsigned heights averaged 2x2, converted to km; geodesic slopes, 4x relief shading, normal-map encoding. No geometric displacement.', 'NASA SVS / LRO LOLA')

def mars():
    tiles = [fetch(URLS['mdim'].format(row=r, col=c), SOURCES / 'mars_mdim21_z3' / f'{r}_{c}.jpg') for r in range(8) for c in range(16)]
    color = Image.new('RGB', (4096, 2048))
    for i, t in enumerate(tiles): color.paste(Image.open(t).convert('RGB'), (i % 16 * 256, i // 16 * 256))
    for width in [1024, 2048, 4096]:
        save(shrink(color, width), f'mars_{width // 1024}k.jpg', 'mars', 'color', URLS['mdim'], tiles, 'sRGB color',
            'Zoom-3 WMTS tiles (4096x2048) stitched, Lanczos resize, JPEG quality 90.', 'USGS Astrogeology / NASA Trek, public domain', quality=90)
    src = fetch(URLS['mola'])
    # MEGDR: big-endian int16 meters above the areoid, 16 px/deg, west edge at 0E. Rolled half a turn so 0E is centered,
    # then averaged 2x2 to 8 px/deg, still finer than the 2048 px output.
    height = np.roll(np.fromfile(src, '>i2').reshape(2880, 5760), 2880, axis=1).astype(np.float64) / 1000
    height = height.reshape(1440, 2, 2880, 2).mean(axis=(1, 3))
    # Mars is smooth at this scale (median slope 1.3 deg at 4x), so it takes 8x. One 1K map: a 2K PNG is 2.5 MB,
    # and JPEG's error (median 0.45 deg) is a large share of those slopes.
    save(shrink(relief(height, 3396.0, 8), 1024), 'mars_normal_1k.png', 'mars', 'normal', URLS['mola'], [src], 'linear tangent-space RGB',
        'MOLA MEGDR 16 px/deg heights averaged 2x2, converted to km on the 3396 km reference sphere; geodesic slopes, 8x relief shading, normal-map encoding. No geometric displacement.', 'NASA / MGS MOLA Science Team (PDS Geosciences Node), public domain')

BUILD = {body: (lambda b: lambda: colour(b))(body) for body in COLOR}
BUILD.update(earth=earth, moon=moon, mars=mars)
bodies = sys.argv[1:] or list(BUILD)
for body in bodies: BUILD[body]()
kept = [a for a in json.loads(MANIFEST.read_text(encoding='utf-8'))['assets'] if a['body'] not in bodies] if MANIFEST.exists() else []
manifest = dict(note='Appearance assets only; not live weather or scientific surface-orientation telemetry.', assets=kept + entries)
MANIFEST.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(files=len(entries),bytes=sum((OUT/e['file']).stat().st_size for e in entries))))
