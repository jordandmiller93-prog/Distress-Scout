// Area Scan engine: ZIP code -> address discovery -> imagery -> AI distress scoring.
//
// Data sources (all free unless noted):
//   - Zippopotam.us       zip -> city/state/centroid
//   - OSM Overpass API    every mapped address in the zip
//   - Esri World Imagery  satellite tile per property (no key required)
//   - Google Street View  curb-level photo (requires GOOGLE_MAPS_API_KEY)

// Overpass is a free, shared public service that occasionally 504s under
// load — more mirrors + a retry pass materially cuts the failure rate.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lookupZip(zip) {
  const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
  if (!res.ok) throw new Error(`ZIP ${zip} not found`);
  const data = await res.json();
  const place = data.places?.[0];
  if (!place) throw new Error(`ZIP ${zip} has no location data`);
  return {
    zip,
    city: place['place name'],
    state: place['state abbreviation'],
    lat: Number(place.latitude),
    lng: Number(place.longitude)
  };
}

// OSM building/tag values that mean "not a single-family home" — checked
// before any imagery is fetched or any AI call is made, so commercial
// buildings never cost a cent to filter out.
const NON_RESIDENTIAL_BUILDING = new Set([
  'commercial', 'retail', 'industrial', 'warehouse', 'office', 'civic', 'public',
  'hospital', 'school', 'university', 'college', 'kindergarten', 'church', 'mosque',
  'synagogue', 'temple', 'cathedral', 'chapel', 'hotel', 'motel', 'supermarket',
  'kiosk', 'garage', 'garages', 'service', 'hangar', 'grandstand', 'stadium',
  'train_station', 'transportation', 'parking', 'government', 'fire_station',
  'gatehouse', 'apartments', 'dormitory', 'bunker', 'greenhouse'
]);
const RESIDENTIAL_BUILDING = new Set([
  'house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'residential',
  'cabin', 'static_caravan', 'hut', 'farm', 'yes'
]);

function isSingleFamilyResidential(tags) {
  const building = (tags.building || '').toLowerCase();
  // Any of these tags present means a business/institution occupies the address.
  const commercialSignal = ['shop', 'office', 'amenity', 'craft', 'healthcare', 'tourism', 'leisure']
    .some((k) => tags[k]);
  if (commercialSignal || NON_RESIDENTIAL_BUILDING.has(building)) return false;
  // No building tag at all is the common case for plain US address nodes —
  // treat as residential. An unrecognized building value is excluded to be safe.
  return !building || RESIDENTIAL_BUILDING.has(building);
}

// Pull every element tagged with a house number + this postcode from OpenStreetMap,
// keeping only ones that look like single-family homes. Sorted deterministically
// so offset-based paging is stable between requests.
async function discoverAddresses(loc) {
  const d = 0.12; // ~8 mile box around the zip centroid; postcode tag does the real filtering
  const bbox = `${loc.lat - d},${loc.lng - d},${loc.lat + d},${loc.lng + d}`;
  const query = `
[out:json][timeout:8];
nwr["addr:housenumber"]["addr:postcode"="${loc.zip}"](${bbox});
out center 2000;`;

  // Hard overall deadline: Vercel's function has a 60s cap and imagery/AI
  // scoring still needs to run after this, so give up cleanly well before
  // that rather than let a slow mirror drag the whole request past the
  // platform's own hard timeout (which produces an ugly, unrecoverable error
  // instead of the friendly one below).
  const deadline = Date.now() + 25000;
  let lastError;
  for (let pass = 0; pass < 2 && Date.now() < deadline; pass++) {
    if (pass > 0) await sleep(1000); // brief backoff before the retry pass
    for (const endpoint of OVERPASS_ENDPOINTS) {
      if (Date.now() >= deadline) break;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 9000); // fail fast per mirror
        let res;
        try {
          res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'DistressScout/1.0 (property research; contact: support@distressscout.com)'
            },
            body: `data=${encodeURIComponent(query)}`,
            signal: controller.signal
          });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) throw new Error(`Overpass ${res.status}`);
        const data = await res.json();

        const seen = new Set();
        const addresses = [];
        for (const el of data.elements || []) {
          const tags = el.tags || {};
          const lat = el.lat ?? el.center?.lat;
          const lng = el.lon ?? el.center?.lon;
          if (!lat || !lng || !tags['addr:street']) continue;
          if (!isSingleFamilyResidential(tags)) continue;

          const address = `${tags['addr:housenumber']} ${tags['addr:street']}`;
          const key = address.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);

          addresses.push({
            address,
            city: tags['addr:city'] || loc.city,
            state: loc.state,
            zip: loc.zip,
            lat,
            lng,
            building: tags.building || null
          });
        }

        addresses.sort((a, b) => a.address.localeCompare(b.address));
        return addresses;
      } catch (err) {
        lastError = err.name === 'AbortError' ? new Error('Overpass timeout') : err;
      }
    }
  }
  throw new Error(
    `Address lookup service is temporarily overloaded (${lastError?.message || 'unknown error'}). Please try this ZIP again in a moment.`
  );
}

// ~90m-wide satellite crop centered on the parcel. Keyless.
async function fetchSatellite(lat, lng) {
  const d = 0.0004;
  const url =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export' +
    `?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&bboxSR=4326&size=512,512&format=jpg&f=image`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 5000 ? buf : null; // tiny responses are blank tiles
}

// Curb-level photo via Google Street View Static API. Returns null when no
// key is configured or no imagery exists at that location.
async function fetchStreetView(lat, lng) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  const meta = await fetch(
    `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&source=outdoor&key=${key}`
  ).then((r) => r.json()).catch(() => null);
  if (meta?.status !== 'OK') return null;

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/streetview?size=640x400&location=${lat},${lng}&fov=80&source=outdoor&key=${key}`
  );
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

// Score one property from its imagery. Street view is the primary signal when
// available; satellite catches roof damage, tarps, junk piles, overgrowth.
async function scoreProperty(client, prop) {
  const [satellite, streetView] = await Promise.all([
    fetchSatellite(prop.lat, prop.lng),
    fetchStreetView(prop.lat, prop.lng)
  ]);

  if (!satellite && !streetView) {
    return { ...prop, scored: false, error: 'No imagery available' };
  }

  const content = [];
  if (streetView) {
    content.push({ type: 'text', text: 'STREET VIEW (curb-level):' });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: streetView.toString('base64') }
    });
  }
  if (satellite) {
    content.push({ type: 'text', text: 'SATELLITE (overhead, ~90m wide, property at center):' });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: satellite.toString('base64') }
    });
  }
  content.push({
    type: 'text',
    text: `Property: ${prop.address}, ${prop.city}, ${prop.state} ${prop.zip}

This app only wants SINGLE-FAMILY RESIDENTIAL houses — no businesses, apartment
buildings, churches, schools, or other commercial/institutional structures, even
if they look distressed. Return ONLY valid JSON:

{
  "propertyType": "<single_family | multi_family | commercial | institutional | vacant_lot | unclear>",
  "distressScore": <0-10 float; 0 = pristine, 10 = condemned. Use 0 if propertyType is not single_family>,
  "riskLevel": "<low|medium|high>",
  "indicators": [<detected issues, e.g. "tarped_roof", "overgrown_yard", "boarded_windows", "junk_vehicles", "fire_damage", "collapsed_structure">],
  "summary": "<one sentence on what you see>",
  "confidence": "<low|medium|high — low if imagery is unclear or the property is hard to make out>"
}

From satellite look for: roof discoloration/holes/patching, blue tarps, overgrown or dead lawns, debris/junk piles, junk or inoperable vehicles, missing shingles, pool covered in algae, driveway/walkway cracking or heaving, detached structures in disrepair.
From street view look for: boarded/broken/missing windows, peeling or mismatched paint, sagging porch/roofline, notices or liens posted on the door, overgrowth, damaged or missing gutters, deteriorated siding, broken fencing, unkempt landscaping compared to neighboring homes, general abandonment. Also look for storefronts, signage, parking lots, or multiple unit entrances — these mean it is NOT single-family.

Look carefully — moderate deterioration (peeling paint on part of the house, a
patchy/overgrown yard, a sagging gutter, a cracked driveway) is real distress
and should score in the 3-6 range, not be waved off as "ordinary." Reserve 0-2
only for houses that are genuinely well-kept with no visible issues. Reserve
7-10 for severe cases (boarded up, collapsing, fire damage, condemned).
Compare the house's upkeep to what a well-maintained home on the same street
would look like — relative neglect is still a real signal.`
  });

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 512,
      messages: [{ role: 'user', content }]
    });
    const text = message.content.find((b) => b.type === 'text')?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const analysis = JSON.parse(jsonMatch ? jsonMatch[0] : text);

    return {
      ...prop,
      scored: true,
      ...analysis,
      imagery: { streetView: !!streetView, satellite: !!satellite }
    };
  } catch (err) {
    return { ...prop, scored: false, error: err.message };
  }
}

// Score a batch with limited concurrency to stay inside serverless time limits.
// A cold ZIP scan (Overpass + violations + AI scoring) has to fit inside
// Vercel's 60s function cap in one request — higher concurrency here is the
// difference between ~38s and ~20s for a 10-property batch.
async function scoreBatch(client, properties, concurrency = 10) {
  const results = [];
  for (let i = 0; i < properties.length; i += concurrency) {
    const chunk = properties.slice(i, i + concurrency);
    results.push(...(await Promise.all(chunk.map((p) => scoreProperty(client, p)))));
  }
  return results;
}

module.exports = { lookupZip, discoverAddresses, scoreBatch };
