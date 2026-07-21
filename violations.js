// Code-violation distressor layer: public code-enforcement records for a ZIP.
// A condemnation or nuisance case is often a stronger distress signal than
// anything visible from the street.
//
// Three tiers, tried in order, all free/keyless:
//   1. KNOWN_JURISDICTIONS — hand-verified Socrata datasets for specific
//      cities/counties, each real-tested against a live zip query. Handles
//      split-address schemas (number/street in separate columns) that the
//      generic detector below can't parse.
//   2. Generic Socrata auto-discovery — searches the Socrata Discovery API
//      for the scanned city's own code-enforcement dataset and detects its
//      column layout by pattern-matching common field names.
//   3. SeeClickFix 311 reports — nationwide fallback for cities with no
//      open-data portal at all.
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

// ---------------------------------------------------------------------------
// Verified jurisdictions — hand-checked against real zip-filtered queries so
// they don't depend on the Socrata catalog's fuzzy search picking the right
// dataset. Each entry maps its own row shape (some split address across
// several columns) into the common violation shape. County-wide portals are
// keyed under every town name Zippopotam is known to report for that county.
// ---------------------------------------------------------------------------
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();

function socrataEntry({ domain, id, name, buildAddress, buildDescription, statusCol, dateCol, zipWhere, latCol, lngCol, residentialType }) {
  return {
    residentialType: residentialType || 'single_family', // 'multi_family' = source is legally multi-unit-only (e.g. NYC HMC); don't prioritize/spend scans on it for an SFR-only product
    async fetch(zip, loc) {
      const params = new URLSearchParams({ $limit: '2000' });
      if (dateCol) params.set('$order', `${dateCol} DESC`);
      if (zipWhere) {
        params.set('$where', zipWhere(zip));
      } else if (latCol && lngCol) {
        // No zip column on this dataset — pull a broad recent batch and
        // filter to a box around the zip centroid.
      } else {
        params.set('$q', zip);
      }

      const res = await fetch(`https://${domain}/resource/${id}.json?${params}`);
      if (!res.ok) throw new Error(`${domain}/${id}: HTTP ${res.status}`);
      let rows = await res.json();

      if (!zipWhere && latCol && lngCol && loc) {
        const d = 0.03;
        rows = rows.filter((r) => {
          const lat = Number(r[latCol]);
          const lng = Number(r[lngCol]);
          return lat && lng && Math.abs(lat - loc.lat) < d && Math.abs(lng - loc.lng) < d;
        });
      }

      return rows
        .map((r) => {
          const address = buildAddress(r);
          if (!address) return null;
          return {
            address: norm(address),
            category: classifyViolation(buildDescription(r)),
            description: (buildDescription(r) || 'Code violation').slice(0, 300),
            status: statusCol ? r[statusCol] || null : null,
            date: dateCol ? r[dateCol] || null : null,
            source: name,
            lat: latCol ? Number(r[latCol]) || null : null,
            lng: lngCol ? Number(r[lngCol]) || null : null
          };
        })
        .filter(Boolean);
    }
  };
}

const cincinnati = socrataEntry({
  domain: 'data.cincinnati-oh.gov', id: 'cncm-znd6', name: 'City of Cincinnati Code Enforcement',
  buildAddress: (r) => r.full_address,
  buildDescription: (r) => [r.comp_type_desc, r.sub_type_desc].filter(Boolean).join(' — '),
  statusCol: 'data_status_display', dateCol: 'entered_date', latCol: 'latitude', lngCol: 'longitude'
});
const kansasCity = socrataEntry({
  domain: 'data.kcmo.org', id: 'nhtf-e75a', name: 'Kansas City Property Violations',
  buildAddress: (r) => r.address,
  buildDescription: (r) => r.violation_description,
  statusCol: 'status', dateCol: 'violation_entry_date',
  zipWhere: (zip) => `zip_code = '${zip}'`, latCol: 'latitude', lngCol: 'longitude'
});
const cambridge = socrataEntry({
  domain: 'data.cambridgema.gov', id: 'f8su-kv88', name: 'Cambridge Housing Code Violations',
  buildAddress: (r) => r.full_address,
  buildDescription: (r) => r.description,
  statusCol: 'status', dateCol: 'case_open_date', latCol: 'latitude', lngCol: 'longitude'
});
const seattle = socrataEntry({
  domain: 'cos-data.seattle.gov', id: 'ez4a-iug7', name: 'Seattle Code Compliance',
  buildAddress: (r) => r.originaladdress1,
  buildDescription: (r) => r.description,
  statusCol: 'statuscurrent', dateCol: 'opendate',
  zipWhere: (zip) => `originalzip = '${zip}'`, latCol: 'latitude', lngCol: 'longitude'
});
const austin = socrataEntry({
  domain: 'datahub.austintexas.gov', id: 'cdze-ufp8', name: 'Austin Vacant Building Registry',
  buildAddress: (r) => r.registered_address,
  buildDescription: () => 'Registered vacant building',
  statusCol: 'registration_status', dateCol: 'violation_case_date',
  zipWhere: (zip) => `zip_code = '${zip}'`, latCol: 'latitude', lngCol: 'longitude'
});
const losAngeles = socrataEntry({
  domain: 'data.lacity.org', id: 'u82d-eh7z', name: 'LA Building & Safety Code Enforcement',
  buildAddress: (r) => [r.stno, r.predir, r.stname, r.suffix].filter(Boolean).join(' '),
  buildDescription: (r) => [r.aptype, r.apc].filter(Boolean).join(' — '),
  statusCol: 'stat', dateCol: 'adddttm',
  zipWhere: (zip) => `starts_with(zip, '${zip}')`
});
const marinCounty = socrataEntry({
  domain: 'data.marincounty.gov', id: 'ti2m-gwng', name: 'Marin County Code Enforcement',
  buildAddress: (r) => [r.streetnumber, r.streetname, r.streetsuffix].filter(Boolean).join(' '),
  buildDescription: (r) => r.responsibledivision,
  statusCol: null, dateCol: null,
  zipWhere: (zip) => `zip = '${zip}'`
});
const montgomeryCountyMD = socrataEntry({
  domain: 'data.montgomerycountymd.gov', id: 'k9nj-z35d', name: 'Montgomery County MD Housing Code Violations',
  buildAddress: (r) => r.street_address,
  buildDescription: (r) => r.disposition,
  statusCol: 'disposition', dateCol: 'date_filed',
  zipWhere: (zip) => `zip_code = '${zip}'`
});
const nyc = socrataEntry({
  domain: 'data.cityofnewyork.us', id: 'wvxf-dwi5', name: 'NYC Housing Maintenance Code Violations',
  buildAddress: (r) => [r.housenumber, r.streetname].filter(Boolean).join(' '),
  buildDescription: (r) => r.novdescription,
  statusCol: 'currentstatus', dateCol: 'inspectiondate',
  zipWhere: (zip) => `zip = '${zip}'`,
  // NYC's Housing Maintenance Code legally only applies to buildings with
  // 3+ units — every match here is structurally ineligible for an SFR-only
  // product, so don't let it drive scan priority (would burn real AI calls
  // scoring properties we already know are the wrong type).
  residentialType: 'multi_family'
});

const KNOWN_JURISDICTIONS = {
  'cincinnati,oh': cincinnati,
  'kansas city,mo': kansasCity,
  'cambridge,ma': cambridge,
  'boston,ma': cambridge, // Cambridge dataset covers greater-Boston zips it has data for; harmless if empty
  'seattle,wa': seattle,
  'austin,tx': austin,
  'los angeles,ca': losAngeles,
  // Marin County, CA — largest towns
  'san rafael,ca': marinCounty, 'novato,ca': marinCounty, 'mill valley,ca': marinCounty,
  'sausalito,ca': marinCounty, 'larkspur,ca': marinCounty, 'corte madera,ca': marinCounty,
  'fairfax,ca': marinCounty, 'san anselmo,ca': marinCounty, 'tiburon,ca': marinCounty,
  // Montgomery County, MD — largest towns
  'rockville,md': montgomeryCountyMD, 'silver spring,md': montgomeryCountyMD,
  'bethesda,md': montgomeryCountyMD, 'gaithersburg,md': montgomeryCountyMD,
  'germantown,md': montgomeryCountyMD, 'wheaton,md': montgomeryCountyMD,
  'olney,md': montgomeryCountyMD, 'potomac,md': montgomeryCountyMD,
  'takoma park,md': montgomeryCountyMD,
  // NYC — all five boroughs
  'new york,ny': nyc, 'brooklyn,ny': nyc, 'bronx,ny': nyc, 'staten island,ny': nyc, 'queens,ny': nyc,
  'jamaica,ny': nyc, 'flushing,ny': nyc, 'astoria,ny': nyc, 'long island city,ny': nyc
};

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
        source: `${dataset.name} (${dataset.domain})`,
        lat: latCol ? Number(r[latCol]) || null : null,
        lng: lngCol ? Number(r[lngCol]) || null : null
      };
    });
}

// Nationwide fallback: SeeClickFix 311 issues (open API). Sparser than a
// county code-enforcement feed, but covers cities with no open-data portal.
// Only property-distress categories are kept; potholes and streetlights are
// classified 'other' and dropped.
async function fetchSeeClickFix(loc) {
  const d = 0.03;
  const params = new URLSearchParams({
    min_lat: loc.lat - d, max_lat: loc.lat + d,
    min_lng: loc.lng - d, max_lng: loc.lng + d,
    status: 'open,acknowledged,closed',
    per_page: '100'
  });
  const res = await fetch(`https://seeclickfix.com/api/v2/issues?${params}`);
  if (!res.ok) throw new Error(`SeeClickFix: HTTP ${res.status}`);
  const { issues = [] } = await res.json();

  return issues
    .map((i) => {
      const text = `${i.summary || ''} ${typeof i.description === 'string' ? i.description : ''}`;
      const category = classifyViolation(text);
      const street = String(i.address || '').split(',')[0].replace(new RegExp(`\\s+${loc.city}.*$`, 'i'), '');
      return {
        address: street.replace(/\s+/g, ' ').trim().toUpperCase(),
        category,
        description: (i.summary || 'Resident complaint').slice(0, 300),
        status: i.status || null,
        date: i.created_at || null,
        source: 'SeeClickFix 311 reports',
        lat: i.lat ?? null,
        lng: i.lng ?? null
      };
    })
    .filter((v) => v.address && v.category !== 'other');
}

// Returns { available, source?, count?, byAddress?, message? } — byAddress is
// keyed by normalized "123 MAIN ST" so results merge with the visual scan.
async function getViolationsForZip(zip, city, state, loc) {
  try {
    const knownKey = `${city},${state}`.toLowerCase();
    const known = KNOWN_JURISDICTIONS[knownKey];

    let violations = known ? await known.fetch(zip, loc) : null;
    if (!violations) violations = await fetchViolations(zip, city, state, loc);
    if (!violations) violations = await fetchSeeClickFix({ ...loc, city }).catch(() => null);
    if (!violations || !violations.length) {
      return {
        available: false,
        message: `No code-violation records found for ${city}, ${state} — visual scoring only. A county-specific scraper can be added.`
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
      byAddress,
      residentialType: known?.residentialType || 'single_family'
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
