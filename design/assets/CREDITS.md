# Art credits

The design mockups (`design/mockups/d-hybrid.html`, `design/mockups/f-ops-3d.html`) load these files through `design/assets/sol-art.js`. The live site and flight pages (`connector/src/site.html`, `connector/src/flight.html`) load the same files from `/assets/`. Every map was resized and re-encoded for the web. Any other changes are noted below.

## Planet and Sun maps (`tex/`)

| File | Source | Licence | Changes |
|---|---|---|---|
| `sun_1k.jpg`, `sun_2k.jpg`, `sun_4k.jpg` | Solar System Scope, Sun (the 8k download, 4096x2048). https://www.solarsystemscope.com/textures/ | CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ | Resized |
| `mercury_1k.jpg`, `mercury_2k.jpg`, `mercury_4k.jpg` | Solar System Scope, 8k Mercury (based on NASA MESSENGER data). https://www.solarsystemscope.com/textures/ | CC BY 4.0 | Resized |
| `venus_1k.jpg`, `venus_2k.jpg`, `venus_4k.jpg` | Solar System Scope, 4k Venus atmosphere. https://www.solarsystemscope.com/textures/ | CC BY 4.0 | Resized |
| `earth_day_2k.jpg`, `earth_day_4k.jpg` | NASA Earth Observatory, Blue Marble Next Generation, December 2004 (topography and bathymetry). https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg | NASA, public domain | Resized |
| `earth_lights_2k.jpg` | NASA Earth Observatory, Black Marble 2012 (VIIRS Day/Night Band). https://eoimages.gsfc.nasa.gov/images/imagerecords/79000/79765/dnb_land_ocean_ice.2012.3600x1800.jpg | NASA, public domain | City lights extracted: the land, ocean and ice base was keyed out to black so only the lights remain, for an emissive map |
| `moon_1k.jpg`, `moon_2k.jpg`, `moon_4k.jpg` | NASA Scientific Visualization Studio, CGI Moon Kit (LRO LROC colour, 4096x2048). https://svs.gsfc.nasa.gov/4720 | NASA, public domain | Resized |
| `mars_1k.jpg`, `mars_2k.jpg`, `mars_4k.jpg` | USGS Astrogeology, Mars Viking MDIM 2.1 colour mosaic. https://astrogeology.usgs.gov/search/map/mars_viking_mdim21_clrmosaic_global_232m, fetched as NASA Trek's WMTS tiles (zoom 3, 4096x2048) | USGS, public domain | Tiles stitched, resized, JPEG quality 90 |
| `phobos_1k.jpg`, `phobos_2k.jpg`, `phobos_4k.jpg` | Phil Stooke (University of Western Ontario), Phobos Viking global mosaic 40 px/deg on the DLR control network, from NASA Viking Orbiter images; USGS Astrogeology. https://planetarymaps.usgs.gov/mosaic/Phobos_Viking_Mosaic_40ppd_DLRcontrol.tif | Public domain | Resized; tinted and scaled to the warm dark grey (mean 89) of the earlier map |
| `titan_1k.jpg` | USGS Astrogeology, Titan Cassini ISS global mosaic (PIA19658). https://astrogeology.usgs.gov/search/map/titan_iss_p19658_mosaic_global_4km | NASA/JPL-Caltech/Space Science Institute, processed by USGS; public domain. The USGS page asks users to "Please cite authors". | Blurred and tinted orange so it reads as Titan's haze from a distance, not as the surface the mosaic shows |
| `jupiter_2k.jpg`, `jupiter_4k.jpg` | Solar System Scope, Jupiter (the 8k download, 4096x2048), based on NASA/JPL/Space Science Institute Cassini imagery (PIA07782). https://www.solarsystemscope.com/textures/ | CC BY 4.0 | Resized |
| `saturn_1k.jpg`, `saturn_2k.jpg`, `saturn_4k.jpg` | Solar System Scope, Saturn (the 8k download, 4096x2048). https://www.solarsystemscope.com/textures/ | CC BY 4.0 | Resized |
| `saturn_ring_1k.webp` | Solar System Scope, 2k Saturn ring alpha. https://www.solarsystemscope.com/textures/ | CC BY 4.0 | Resized; converted from PNG to WebP |
| `uranus_1k.jpg`, `uranus_2k.jpg` | Solar System Scope, 2k Uranus. https://www.solarsystemscope.com/textures/ | CC BY 4.0 | Resized |
| `neptune_1k.jpg`, `neptune_2k.jpg` | Solar System Scope, 2k Neptune. https://www.solarsystemscope.com/textures/ | CC BY 4.0 | Resized |
| `ceres_1k.jpg`, `ceres_2k.jpg`, `ceres_4k.jpg` | NASA/JPL-Caltech/UCLA/MPS/DLR/IDA, Dawn FC global mosaic 20 px/deg (DLR, October 2015); USGS Astrogeology. https://planetarymaps.usgs.gov/mosaic/Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif | Public domain | Resized; rolled half a turn; unimaged pixels filled with the imaged mean; tinted and scaled to the warm grey (mean 84.5) of the earlier map |
| `io_1k.jpg`, `io_2k.jpg`, `io_4k.jpg` | NASA/JPL Voyager and Galileo SSI, Io global colour merge 1 km; USGS Astrogeology. https://planetarymaps.usgs.gov/mosaic/Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif | Public domain | Resized |
| `europa_1k.jpg`, `europa_2k.jpg`, `europa_4k.jpg` | NASA/JPL Voyager and Galileo SSI, Europa global mosaic 500 m; USGS Astrogeology. https://planetarymaps.usgs.gov/mosaic/Europa_Voyager_GalileoSSI_global_mosaic_500m.tif | Public domain | Resized; rolled half a turn; unimaged pixels filled with the imaged mean; scaled to the earlier map's brightness (mean 170) |
| `ganymede_1k.jpg`, `ganymede_2k.jpg`, `ganymede_4k.jpg` | NASA/JPL Voyager and Galileo SSI, Ganymede global colour mosaic 1.4 km; USGS Astrogeology. https://planetarymaps.usgs.gov/mosaic/Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m.tif | Public domain | Resized; rolled half a turn; unimaged pixels filled with the imaged mean; scaled to the earlier map's brightness (mean 150) |
| `callisto_1k.jpg`, `callisto_2k.jpg`, `callisto_4k.jpg` | NASA/JPL Voyager and Galileo SSI, Callisto global mosaic 1 km; USGS Astrogeology. https://planetarymaps.usgs.gov/mosaic/Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif | Public domain | Resized; rolled half a turn; unimaged pixels filled with the imaged mean |
| `enceladus_1k.jpg`, `enceladus_2k.jpg`, `enceladus_4k.jpg` | NASA/JPL-Caltech/Space Science Institute, Enceladus Cassini ISS global mosaic 100 m, high-pass filtered (Schenk); USGS Astrogeology. https://planetarymaps.usgs.gov/mosaic/Enceladus_Cassini_ISS_Global_Mosaic_100m_HPF.tif | Public domain | Resized; rolled half a turn; scaled to the earlier map's brightness (mean 148.5) |
| `triton_1k.jpg`, `triton_2k.jpg`, `triton_4k.jpg` | NASA/JPL Voyager 2, Triton global colour mosaic 600 m (GlobalFill); USGS Astrogeology. https://planetarymaps.usgs.gov/mosaic/Triton_Voyager2_ClrMosaic_GlobalFill_600m.tif | Public domain | Resized. Voyager 2 imaged about 61% of this map; the rest is filled with the imaged mean colour |
| `bennu_1k.jpg`, `bennu_2k.jpg`, `bennu_4k.jpg` | NASA/Goddard/University of Arizona, Bennu OSIRIS-REx OCAMS global PAN mosaic (8-bit); USGS Astrogeology. https://planetarymaps.usgs.gov/mosaic/Bennu/Bennu_global_FB34_FB56_ShapeV28_GndControl_MinnaertPhase30_PAN_8bit.tif | Public domain | Resized; rolled half a turn; unimaged pixels filled with the imaged mean |

Maps ending `_4k` are release assets, kept out of Git; `python -I design/prepare-planet-assets.py` rebuilds them from their sources. Without them a page keeps the 2K map close up. No map is upscaled past its source.

Every map puts zero longitude at its centre, east to the right. The USGS mosaics for Ceres, Europa, Ganymede, Callisto, Enceladus and Bennu centre on 180E (their GeoTIFF central meridian), so the script rolls them half a turn. The maps used before October 19, 2026 for Ceres, Callisto, Enceladus and Bennu were centred on 180E and drawn half a turn off.

## Stars (`stars-bsc5.json`)

The Yale Bright Star Catalogue, 5th revised edition (Hoffleit and Warren, 1991), from CDS catalogue V/50: https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50. It holds 9096 stars with a position and V magnitude. Each entry keeps the J2000 position (converted to the ecliptic frame), the V magnitude, which sets the star's size, and the B-V colour index, which sets its colour. Nothing else from the catalogue is kept.

## Earth and Moon material layers (October 17, 2026)

- `earth_clouds_1k.webp`, `earth_clouds_2k.webp`: Solar System Scope Earth cloud map, [source](https://www.solarsystemscope.com/textures/download/2k_earth_clouds.jpg), INOVE, CC BY 4.0. Converted to grayscale cloud coverage, resized, WebP quality 90.
- `earth_normal_1k.png`, `earth_normal_2k.png`: Solar System Scope Earth normal map, [source](https://www.solarsystemscope.com/textures/download/2k_earth_normal_map.tif), INOVE, CC BY 4.0. Resized and stored as linear tangent-space data.
- `earth_ocean_1k.png`: Solar System Scope specular/water map, [source](https://www.solarsystemscope.com/textures/download/2k_earth_specular_map.tif), INOVE, CC BY 4.0. Resized grayscale mask; white marks reflective water.
- `moon_normal_1k.png`, `moon_normal_2k.png` (2K added October 19, 2026): NASA's Scientific Visualization Studio / LRO LOLA, [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/), [16 px/deg unsigned elevation source](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif), averaged 2x2. Height-derived tangent normals, 4x relief shading for the game globe, without geometric displacement. Latitude-aware slopes and longitude wrapping. NASA public-domain data; credit to NASA SVS / LRO LOLA.

- `mars_normal_1k.png` (October 18, 2026): NASA / MGS MOLA Science Team, MEGDR 16 px/deg topography, [source](https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img), PDS Geosciences Node. Height-derived tangent normals like the Moon's, 8x relief shading (Mars is smoother at this scale), without geometric displacement. NASA public-domain data.

The derivatives are reproducible with `python -I design/prepare-planet-assets.py [body ...]` (Pillow, numpy and tifffile, offline tooling only). Their source/output hashes and coordinate conventions are recorded in `planet-assets.json`. Surface and cloud rotation are illustrative and slowed; they do not represent live weather or alter the simulation.

## Other-world material profiles (October 18, 2026)

`planet-effects.js` uses the credited color maps above for all other mapped worlds. Mercury, Phobos, Ceres, Bennu, Io and Callisto use matte diffuse shading; Europa, Ganymede, Enceladus and Triton add restrained ice highlights. No elevation or normals are fabricated from color imagery. Only Earth, the Moon and Mars have registered relief assets.

Mars has a thin warm limb; Venus uses its existing cloud-top map; Titan uses the existing haze-treated Cassini mosaic. Jupiter, Saturn, Uranus and Neptune have body-specific atmospheric colors and bounded latitude-dependent map drift. These are illustrative materials, not current atmospheric measurements or game-weather events. [NASA Titan facts](https://science.nasa.gov/titan/facts/) describes Titan's dense atmosphere; [NASA Saturn rings](https://science.nasa.gov/saturn/rings/) supplies the physical context for the ring treatment.

Saturn reuses the existing alpha ring strip with analytic planet/ring shadows; no shadow-map asset is added. The Sun sharpens through the same 1K, 2K and 4K tiers as the planets and keeps its compact halo with subtle shader convection. Existing presentation tilt is retained. Slow appearance periods (180–720 seconds, with Venus/Uranus illustrated retrograde) are explicitly decorative, independent of ephemerides and replay timing; they are not scientific axial-orientation telemetry.

## Original work

The Starseeker ship model, its engine plume, nav lights and callsign decal, the Fresnel atmosphere rims, the bloom, vignette and grain settings, and the SVG icon sprite are all original. They were drawn in code in `sol-art.js` for Starfare. They are not modelled on any real vehicle, and Starfare is not affiliated with any real company.

The rides, riders, weather and fleet on these pages are simulated. Planet positions are real (NASA JPL DE421).
