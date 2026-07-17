// Code-violation distressor layer: public code-enforcement records for a ZIP.
// A condemnation or nuisance case is often a stronger distress signal than
// anything visible from the street.
//
// Strategy: hundreds of US cities publish code-enforcement data on Socrata
// open-data portals. Rather than hardcode each portal, we auto-discover the
// best dataset for the scanned city via the Socrata Discovery API, detect its
// column layout, and full-text search it by ZIP. No key, no scraping needed.
// Counties that only expose scraping portals (2Captcha via CAPTCHA_API_KEY)
// can be added later as dedicated adapters with the same output shape:
//   { address, category, description, status, date, source }

const VIOLATION_WEIGHTS = {
  dangerous_building: 4.0,
  condemnation: 4.0,
  demolition_order: 4.0,
  fire_damage: 3.5,
  vacant_structure: 3.0,
  unsafe_structure: 3.0,
  public_nuisance: 2.5,
  housing_code: 1.5,
  tall_grass_weeds: 1.0,
  trash_debris: 1.0,
  junk_vehicle: 1.0,
  other: 0.5
};

function classifyViolation(text = '') {
  const t = text.toLowerCase();
  if (/(condemn|placard)/.test(t)) return 'condemnation';
  if (/demoli/.test(t)) return 'demolition_order';
  if (/dangerous.{0,3}build/.test(t)) return 'dangerous_building';
  if (/fire/.test(t)) return 'fire_damage';
  if (/vacant|abandon|barricad|board.{0,5}up/.test(t)) return 'vacant_structure';
  if (/unsafe|structural/.test(t)) return 'unsafe_structure';
  if (/nuisance/.test(t)) return 'public_nuisance';
  if (/(grass|weed|vegetation|overgrow)/.test(t)) return 'tall_grass_weeds';
  if (/(trash|debris|litter|refuse|garbage|bulky)/.test(t)) return 'trash_debris';
  if (/vehicle/.test(t)) return 'junk_vehicle';
  if (/housing|maintenance|exterior|building/.test(t)) return 'housing_code';
  return 'other';
}

// Find the city's code-enforcement dataset on any Socrata portal.
const datasetCache = new Map(); // "city,state" -> dataset descriptor or null

async function discoverDataset(city, state) {
  const cacheKey = `${city},${state}`.toLowerCase();
  if (datasetCache.has(cacheKey)) return datasetCache.get(cacheKey);

  const url =
    'https://api.us.socrata.com/api/catalog/v1?only=datasets&limit=20&q=' +
    encodeURIComponent(`code violations enforcement ${city}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Socrata catalog: HTTP ${res.status}`);
  const { results = [] } = await res.json();

  let best = null;
  let bestScore = 0;
  for (const r of results) {
    const meta = r.metadata || {};
    const resource = r.resource || {};
    const name = `${resource.name || ''} ${resource.description || ''}`.toLowerCase();
    const domain = (meta.domain || '').toLowerCase();
    const cityLc = city.toLowerCase();

    // Hard requirement: the dataset must belong to the scanned city, or we'd
    // silently return another city's violations.
    const cityMatch = domain.includes(cityLc.replace(/\s/g, '')) || name.includes(cityLc);
    if (!cityMatch) continue;

    let score = 3;
    if (/violation|code enforcement|nuisance|blight|condemn/.test(name)) score += 2;
    const cols = (resource.columns_field_name || []).map((c) => c.toLowerCase());
    if (cols.some((c) => /address|location|street/.test(c))) score += 1;
    if (!cols.length) score = 0;

    if (score > bestScore) {
      bestScore = score;
      best = { domain: meta.domain, id: resource.id, name: resource.name, columns: resource.columns_field_name || [] };
    }
  }

  const found = bestScore >= 3 ? best : null;
  datasetCache.set(cacheKey, found);
  return found;
}

function pickColumn(columns, patterns) {
  for (const pattern of patterns) {
    const hit = columns.find((c) => pattern.test(c));
    if (hit) return hit;
  }
  return null;
}

async function fetchViolations(zip, city, state, loc) {
  const dataset = await discoverDataset(city, state);
  if (!dataset) return null;

  const cols = dataset.columns.filter((c) => !c.startsWith(':'));
  const addressCol = pickColumn(cols, [/^address$/, /full_address/, /street_address/, /^location_address/, /address/, /^str_nam/, /location/]);
  const descCols = cols.filter((c) => /violation|complaint|descript|^type$|_type_desc|case_type|nuisance|service_request/.test(c)).slice(0, 3);
  const statusCol = pickColumn(cols, [/status_display/, /^status$/, /case_status/, /status/]);
  const dateCol = pickColumn(cols, [/violation_date/, /opened/, /entered/, /created/, /^date/, /reported/, /date/]);
  const zipCol = pickColumn(cols, [/^zip$/, /^zipcode$/, /zip_code/, /postal/]);
  const latCol = pickColumn(cols, [/^latitude$/, /^lat$/]);
  const lngCol = pickColumn(cols, [/^longitude$/, /^lon(gitude)?$|^lng$/]);
  if (!addressCol) return null;

  // Prefer an explicit ZIP column; otherwise pull recent records and filter
  // by coordinates around the ZIP centroid; last resort is full-text search.
  const params = new URLSearchParams();
  let filterByCoords = false;
  if (zipCol) {
    params.set('$where', `${zipCol} = '${zip}'`);
    params.set('$limit', '500');
  } else if (latCol && lngCol && loc) {
    params.set('$limit', '5000');
    filterByCoords = true;
  } else {
    params.set('$q', zip);
    params.set('$limit', '500');
  }
  if (dateCol) params.set('$order', `${dateCol} DESC`);

  const res = await fetch(`https://${dataset.domain}/resource/${dataset.id}.json?${params}`);
  if (!res.ok) throw new Error(`${dataset.domain}/${dataset.id}: HTTP ${res.status}`);
  let rows = await res.json();

  if (filterByCoords) {
    const d = 0.02; // ~1.4 mile box around the zip centroid
    rows = rows.filter((r) => {
      const lat = Number(r[latCol]);
      const lng = Number(r[lngCol]);
      return lat && lng && Math.abs(lat - loc.lat) < d && Math.abs(lng - loc.lng) < d;
    });
  }

  return rows
    .filter((r) => r[addressCol])
    .map((r) => {
      // Handle Toledo-style split columns (str_num + str_nam) and plain strings
      const rawAddress = typeof r[addressCol] === 'object'
        ? r[addressCol].human_address || JSON.stringify(r[addressCol])
        : r.str_num && r.str_nam
          ? `${r.str_num} ${r.str_prefix || ''} ${r.str_nam} ${r.str_suffix || ''}`
          : String(r[addressCol]);
      const description = descCols.map((c) => r[c]).filter((v) => typeof v === 'string').join(' — ');
      return {
        address: rawAddress.replace(/\s+/g, ' ').trim().toUpperCase(),
        category: classifyViolation(description),
        description: (description || 'Code violation').slice(0, 300),
        status: statusCol ? r[statusCol] || null : null,
        date: dateCol ? r[dateCol] || null : null,
        source: `${dataset.name} (${dataset.domain})`
      };
    });
}

// Returns { available, source?, count?, byAddress?, message? } — byAddress is
// keyed by normalized "123 MAIN ST" so results merge with the visual scan.
async function getViolationsForZip(zip, city, state, loc) {
  try {
    const violations = await fetchViolations(zip, city, state, loc);
    if (!violations) {
      return {
        available: false,
        message: `No open-data code-violation source found for ${city}, ${state} yet — county-specific scraper can be added.`
      };
    }

    const byAddress = {};
    for (const v of violations) {
      (byAddress[v.address] ||= []).push(v);
    }
    return {
      available: true,
      source: violations[0]?.source || 'Socrata open data',
      count: violations.length,
      byAddress
    };
  } catch (err) {
    return { available: false, message: `Violation lookup failed: ${err.message}` };
  }
}

// Combine visual distress (0-10) with violation records into one distressor
// score (0-10). Violations add up to 4 points; a property flagged by both
// layers ranks above either alone.
function combineScores(visualScore, violations = []) {
  const violationPoints = Math.min(
    4,
    violations.reduce((sum, v) => sum + (VIOLATION_WEIGHTS[v.category] ?? 0.5), 0)
  );
  const visual = Number(visualScore) || 0;
  return Math.min(10, Math.round((visual * 0.75 + violationPoints * 1.6) * 10) / 10);
}

module.exports = { getViolationsForZip, combineScores, classifyViolation };
