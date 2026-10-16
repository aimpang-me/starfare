# Art credits

The design mockups (`design/mockups/d-hybrid.html`, `design/mockups/f-ops-3d.html`) load these files through `design/assets/sol-art.js`. Every map was resized and re-encoded for the web. Any other changes are noted below.

## Planet and Sun maps (`tex/`)

| File | Source | Licence | Changes |
|---|---|---|---|
| `earth_day_2k.jpg` | NASA Earth Observatory, Blue Marble Next Generation, December 2004 (topography and bathymetry). https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg | NASA, public domain | Resized to 2048x1024 |
| `earth_lights_2k.jpg` | NASA Earth Observatory, Black Marble 2012 (VIIRS Day/Night Band). https://eoimages.gsfc.nasa.gov/images/imagerecords/79000/79765/dnb_land_ocean_ice.2012.3600x1800.jpg | NASA, public domain | City lights extracted: the land, ocean and ice base was keyed out to black so only the lights remain, for an emissive map |
| `moon_1k.jpg` | NASA Scientific Visualization Studio, CGI Moon Kit (LRO LROC colour). https://svs.gsfc.nasa.gov/4720 | NASA, public domain | Resized |
| `mars_1k.jpg` | USGS Astrogeology, Mars Viking MDIM 2.1 colour mosaic. https://astrogeology.usgs.gov/search/map/mars_viking_mdim21_clrmosaic_global_232m | USGS, public domain | Resized |
| `phobos_1k.jpg` | NASA/JPL Solar System Simulator map `mar1kuu2.jpg` (Viking data, USGS). https://maps.jpl.nasa.gov/tmaps/pix/mar1kuu2.jpg | NASA/USGS, public domain | Resized and tinted to a darker, warmer grey |
| `titan_1k.jpg` | USGS Astrogeology, Titan Cassini ISS global mosaic (PIA19658). https://astrogeology.usgs.gov/search/map/titan_iss_p19658_mosaic_global_4km | NASA/JPL-Caltech/Space Science Institute, processed by USGS; public domain. The USGS page asks users to "Please cite authors". | Blurred and tinted orange so it reads as Titan's haze from a distance, not as the surface the mosaic shows |
| `jupiter_2k.jpg` | NASA/JPL/Space Science Institute, Cassini Jupiter cylindrical map, PIA07782. https://photojournal.jpl.nasa.gov/catalog/PIA07782 | NASA, public domain | Resized |
| `saturn_1k.jpg` | Solar System Scope, 2k Saturn. https://www.solarsystemscope.com/textures/ | CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ | Resized |
| `saturn_ring_1k.webp` | Solar System Scope, 2k Saturn ring alpha. https://www.solarsystemscope.com/textures/ | CC BY 4.0 | Resized; converted from PNG to WebP |
| `sun_1k.jpg` | Solar System Scope, 2k Sun. https://www.solarsystemscope.com/textures/ | CC BY 4.0 | Resized |

## Stars (`stars-bsc5.json`)

The Yale Bright Star Catalogue, 5th revised edition (Hoffleit and Warren, 1991), from CDS catalogue V/50: https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50. It holds 9096 stars with a position and V magnitude. Each entry keeps the J2000 position (converted to the ecliptic frame), the V magnitude, which sets the star's size, and the B-V colour index, which sets its colour. Nothing else from the catalogue is kept.

## Original work

The Starseeker ship model, its engine plume, nav lights and callsign decal, the Fresnel atmosphere rims, the bloom, vignette and grain settings, and the SVG icon sprite are all original. They were drawn in code in `sol-art.js` for Starfare. They are not modelled on any real vehicle, and Starfare has no affiliation with Tesla or SpaceX.

The rides, riders, weather and fleet on these pages are simulated. Planet positions are real (NASA JPL DE421).
