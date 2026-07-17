// Area Scan engine: ZIP code -> address discovery -> imagery -> AI distress scoring.
//
// Data sources (all free unless noted):
//   - Zippopotam.us       zip -> city/state/centroid
//   - OSM Overpass API    every mapped address in the zip
//   - Esri World Imagery  satellite tile per property (no key required)
//   - Google Street View  curb-level photo (requires GOOGLE_MAPS_API_KEY)

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

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

// Pull every element tagged with a house number + this postcode from OpenStreetMap.
// Sorted deterministically so offset-based paging is stable between requests.
async function discoverAddresses(loc) {
  const d = 0.12; // ~8 mile box around the zip centroid; postcode tag does the real filtering
  const bbox = `${loc.lat - d},${loc.lng - d},${loc.lat + d},${loc.lng + d}`;
  const query = `
[out:json][timeout:40];
nwr["addr:housenumber"]["addr:postcode"="${loc.zip}"](${bbox});
out center 2000;`;

  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'DistressScout/1.0 (property research; contact: support@distressscout.com)'
        },
        body: `data=${encodeURIComponent(query)}`
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const data = await res.json();

      const seen = new Set();
      const addresses = [];
      for (const el of data.elements || []) {
        const tags = el.tags || {};
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (!lat || !lng || !tags['addr:street']) continue;

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
      lastError = err;
    }
  }
  throw new Error(`Address discovery failed: ${lastError?.message}`);
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

You are scanning for VISIBLE property distress that signals a motivated seller. Return ONLY valid JSON:

{
  "distressScore": <0-10 float; 0 = pristine, 10 = condemned>,
  "riskLevel": "<low|medium|high>",
  "indicators": [<detected issues, e.g. "tarped_roof", "overgrown_yard", "boarded_windows", "junk_vehicles", "fire_damage", "collapsed_structure">],
  "summary": "<one sentence on what you see>",
  "confidence": "<low|medium|high — low if imagery is unclear or the property is hard to make out>"
}

From satellite look for: roof discoloration/holes, blue tarps, overgrown lots, debris piles, junk vehicles, missing shingles.
From street view look for: boarded/broken windows, peeling paint, sagging porch, notices on the door, overgrowth, general abandonment.
Score conservatively: an ordinary lived-in house is 0-2. Only clear visible distress moves the score up.`
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
async function scoreBatch(client, properties, concurrency = 5) {
  const results = [];
  for (let i = 0; i < properties.length; i += concurrency) {
    const chunk = properties.slice(i, i + concurrency);
    results.push(...(await Promise.all(chunk.map((p) => scoreProperty(client, p)))));
  }
  return results;
}

module.exports = { lookupZip, discoverAddresses, scoreBatch };
