# Art credits

The design mockups (`design/mockups/d-hybrid.html`, `design/mockups/f-ops-3d.html`) load these files through `design/assets/sol-art.js`. The live site and flight pages (`connector/src/site.html`, `connector/src/flight.html`) load the same files from `/assets/`. Every map was resized and re-encoded for the web. Any other changes are noted below.

## Planet and Sun maps (`tex/`)

| File | Source | Licence | Changes |
|---|---|---|---|
| `earth_day_2k.jpg` | NASA Earth Observatory, Blue Marble Next Generation, December 2004 (topography and bathymetry). https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg | NASA, public domain | Resized to 2048x1024 |
| `earth_lights_2k.jpg` | NASA Earth Observatory, Black Marble 2012 (VIIRS Day/Night Band). https://eoimages.gsfc.nasa.gov/images/imagerecords/79000/79765/dnb_land_ocean_ice.2012.3600x1800.jpg | NASA, public domain | City lights extracted: the land, ocean and ice base was keyed out to black so only the lights remain, for an emissive map |
| `moon_1k.jpg` | NASA Scientific Visualization Studio, CGI Moon Kit (LRO LROC colour). https://svs.gsfc.nasa.gov/4720 | NASA, public domain | Resized |
| `mars_1k.jpg`, `mars_2k.jpg` | USGS Astrogeology, Mars Viking MDIM 2.1 colour mosaic. https://astrogeology.usgs.gov/search/map/mars_viking_mdim21_clrmosaic_global_232m, fetched as NASA Trek's WMTS tiles (zoom 3, 4096x2048) | USGS, public domain | Tiles stitched, resized, JPEG quality 90 |
| `phobos_1k.jpg` | NASA/JPL Solar System Simulator map `mar1kuu2.jpg` (Viking data, USGS). https://maps.jpl.nasa.gov/tmaps/pix/mar1kuu2.jpg | NASA/USGS, public domain | Resized and tinted to a darker, warmer grey |
| `titan_1k.jpg` | USGS Astrogeology, Titan Cassini ISS global mosaic (PIA19658). https://astrogeology.usgs.gov/search/map/titan_iss_p19658_mosaic_global_4km | NASA/JPL-Caltech/Space Science Institute, processed by USGS; public domain. The USGS page asks users to "Please cite authors". | Blurred and tinted orange so it reads as Titan's haze from a distance, not as the surface the mosaic shows |
| `jupiter_2k.jpg` | NASA/JPL/Space Science Institute, Cassini Jupiter cylindrical map, PIA07782. https://photojournal.jpl.nasa.gov/catalog/PIA07782 | NASA, public domain | Resized |
| `saturn_1k.jpg` | Solar System Scope, 2k Saturn. https://www.solarsystemscope.com/textures/ | CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ | Resized |
| `saturn_ring_1k.webp` | Solar System Scope, 2k Saturn ring alpha. https://www.solarsystemscope.com/textures/ | CC BY 4.0 | Resized; converted from PNG to WebP |
| `sun_1k.jpg` | Solar System Scope, 2k Sun. https://www.solarsystemscope.com/textures/ | CC BY 4.0 | Resized |
| `mercury_1k.jpg` | Solar System Scope, 2k Mercury (based on NASA MESSENGER data). https://www.solarsystemscope.com/textures/ | CC BY 4.0 | Resized |
| `venus_1k.jpg` | Solar System Scope, 2k Venus atmosphere. https://www.solarsystemscope.com/textures/ | CC BY 4.0 | Resized |
| `uranus_1k.jpg` | Solar System Scope, 2k Uranus. https://www.solarsystemscope.com/textures/ | CC BY 4.0 | Resized |
| `neptune_1k.jpg` | Solar System Scope, 2k Neptune. https://www.solarsystemscope.com/textures/ | CC BY 4.0 | Resized |
| `ceres_1k.jpg` | NASA/JPL-Caltech/UCLA/MPS/DLR/IDA, Dawn colorized map of Ceres, PIA20354. https://photojournal.jpl.nasa.gov/catalog/PIA20354 | NASA, public domain | Resized; turned to warm grey because the colour layer is incomplete near the poles; rows with no data take the nearest row |
| `io_1k.jpg` | NASA/JPL Solar System Simulator map `jup1vss2.jpg` (Voyager and Galileo SSI). https://maps.jpl.nasa.gov/tmaps/pix/jup1vss2.jpg | NASA, public domain | Resized |
| `europa_1k.jpg` | NASA/JPL Solar System Simulator map `jup2vss2.jpg` (Voyager and Galileo SSI). https://maps.jpl.nasa.gov/tmaps/pix/jup2vss2.jpg | NASA, public domain | Resized |
| `ganymede_1k.jpg` | NASA/JPL Solar System Simulator map `jup3vss2.jpg` (Voyager and Galileo SSI). https://maps.jpl.nasa.gov/tmaps/pix/jup3vss2.jpg | NASA, public domain | Resized |
| `callisto_1k.jpg` | USGS Astrogeology, Callisto Voyager/Galileo SSI global mosaic 1 km. https://astrogeology.usgs.gov/search/map/callisto_galileo_voyager_global_mosaic_1km | USGS, public domain | Unimaged areas filled with the mosaic's mean grey |
| `enceladus_1k.jpg` | USGS Astrogeology, Enceladus Cassini global mosaic 100 m (Schenk, 2024). https://astrogeology.usgs.gov/search/map/enceladus-cassini-global-mosaic-100m-schenk | NASA/JPL-Caltech/Space Science Institute, processed by USGS; public domain | None beyond the 1024 px preview USGS publishes |
| `triton_1k.jpg` | NASA/JPL Solar System Simulator map `nep1vuu2.jpg` (Voyager 2, USGS). https://maps.jpl.nasa.gov/tmaps/pix/nep1vuu2.jpg | NASA/USGS, public domain | Resized. Voyager 2 imaged under half of Triton; the rest is filled with the imaged part's mean colour |
| `bennu_1k.jpg` | USGS Astrogeology, Bennu OSIRIS-REx OCAMS global PAN mosaic (data NASA/Goddard/University of Arizona). https://astrogeology.usgs.gov/search/map/bennu_osiris_rex_ocams_global_pan_mosaic_5cm | USGS product; mission data NASA, public domain | None beyond the 1024 px preview USGS publishes |

## Stars (`stars-bsc5.json`)

The Yale Bright Star Catalogue, 5th revised edition (Hoffleit and Warren, 1991), from CDS catalogue V/50: https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50. It holds 9096 stars with a position and V magnitude. Each entry keeps the J2000 position (converted to the ecliptic frame), the V magnitude, which sets the star's size, and the B-V colour index, which sets its colour. Nothing else from the catalogue is kept.

## Earth and Moon material layers (October 17, 2026)

- `earth_clouds_1k.webp`, `earth_clouds_2k.webp`: Solar System Scope Earth cloud map, [source](https://www.solarsystemscope.com/textures/download/2k_earth_clouds.jpg), INOVE, CC BY 4.0. Converted to grayscale cloud coverage, resized, WebP quality 90.
- `earth_normal_1k.png`, `earth_normal_2k.png`: Solar System Scope Earth normal map, [source](https://www.solarsystemscope.com/textures/download/2k_earth_normal_map.tif), INOVE, CC BY 4.0. Resized and stored as linear tangent-space data.
- `earth_ocean_1k.png`: Solar System Scope specular/water map, [source](https://www.solarsystemscope.com/textures/download/2k_earth_specular_map.tif), INOVE, CC BY 4.0. Resized grayscale mask; white marks reflective water.
- `moon_normal_1k.png`: NASA's Scientific Visualization Studio / LRO LOLA, [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/), [unsigned elevation source](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_4_uint.tif). Height-derived tangent normals, 4x relief shading for the game globe, without geometric displacement. Latitude-aware slopes and longitude wrapping. NASA public-domain data; credit to NASA SVS / LRO LOLA.

- `mars_normal_1k.png` (October 18, 2026): NASA / MGS MOLA Science Team, MEGDR 16 px/deg topography, [source](https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img), PDS Geosciences Node. Height-derived tangent normals like the Moon's, 8x relief shading (Mars is smoother at this scale), without geometric displacement. NASA public-domain data.

The derivatives are reproducible with `python -I design/prepare-planet-assets.py [earth] [moon] [mars]` (Pillow and numpy, offline tooling only). Their source/output hashes and coordinate conventions are recorded in `planet-assets.json`. Surface and cloud rotation are illustrative and slowed; they do not represent live weather or alter the simulation.

## Other-world material profiles (October 18, 2026)

`planet-effects.js` reuses the credited color maps above for all other mapped worlds. Mercury, Phobos, Ceres, Bennu, Io and Callisto use matte diffuse shading; Europa, Ganymede, Enceladus and Triton add restrained ice highlights. No elevation or normals are fabricated from color imagery. Only Earth, the Moon and Mars have registered relief assets.

Mars has a thin warm limb; Venus uses its existing cloud-top map; Titan uses the existing haze-treated Cassini mosaic. Jupiter, Saturn, Uranus and Neptune have body-specific atmospheric colors and bounded latitude-dependent map drift. These are illustrative materials, not current atmospheric measurements or game-weather events. [NASA Titan facts](https://science.nasa.gov/titan/facts/) describes Titan's dense atmosphere; [NASA Saturn rings](https://science.nasa.gov/saturn/rings/) supplies the physical context for the ring treatment.

Saturn reuses the existing alpha ring strip with analytic planet/ring shadows; no shadow-map asset is added. The Sun reuses its existing texture and compact halo with subtle shader convection. Existing presentation tilt is retained. Slow appearance periods (180–720 seconds, with Venus/Uranus illustrated retrograde) are explicitly decorative, independent of ephemerides and replay timing; they are not scientific axial-orientation telemetry.

## Original work

The Starseeker ship model, its engine plume, nav lights and callsign decal, the Fresnel atmosphere rims, the bloom, vignette and grain settings, and the SVG icon sprite are all original. They were drawn in code in `sol-art.js` for Starfare. They are not modelled on any real vehicle, and Starfare is not affiliated with any real company.

The rides, riders, weather and fleet on these pages are simulated. Planet positions are real (NASA JPL DE421).
