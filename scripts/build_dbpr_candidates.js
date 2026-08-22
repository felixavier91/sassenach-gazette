// Cleanses the raw Florida DBPR license CSVs (hrfood1.csv = District 1: Dade+Monroe,
// hrfood2.csv = District 2: Broward+Martin+Palm Beach) into a filtered candidate pool
// for the restaurant directory in index.html.
//
// This does NOT check against the current dataset in index.html (that changes every
// time restaurants get added, so it must be re-checked fresh each run) — it only does
// the static filtering that doesn't depend on DB state: drop non-food-serving license
// types, drop inactive licenses, drop known fast-food/chain names, drop known
// non-restaurant categories (banquet halls, hotels, cafeterias, clubs, etc.), and map
// each row's city to one of the curated REGION_ORDER neighborhood tags used in index.html.
//
// Source CSVs: see reference_fl_dbpr_csv_source memory for the download URLs. Re-download
// hrfood1.csv/hrfood2.csv to refresh, then re-run this script to refresh dbpr_candidates_cleansed.json.
//
// Usage: node scripts/build_dbpr_candidates.js   (run from repo root)

const fs = require('fs');
const path = require('path');
const REPO = __dirname + '/..';

function parseCsvLine(line) {
  const fields = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) { if (ch === '"') { if (line[i+1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else { if (ch === '"') inQ = true; else if (ch === ',') { fields.push(cur); cur=''; } else cur += ch; }
  }
  fields.push(cur); return fields;
}

// Keep in sync with index.html's REGION_ORDER (the curated neighborhood filter list).
const REGION_ORDER = [
  "Allapattah", "Aventura", "Bal Harbour", "Bay Harbor Islands", "Boca Raton", "Brickell",
  "Coconut Grove", "Cooper City", "Coral Gables", "Coral Springs",
  "Dania Beach", "Davie", "Deerfield Beach", "Delray Beach", "Design District", "Doral", "Downtown Miami",
  "Fort Lauderdale", "Hallandale Beach", "Hialeah", "Hollywood",
  "Kendall", "Little Haiti", "Little Havana", "Little River",
  "MIA Airport Area", "Miami Beach", "Miami Lakes", "Midtown", "Miramar",
  "North Miami", "North Miami Beach", "Oakland Park",
  "Palmetto Bay", "Pembroke Pines", "Pinecrest", "Plantation", "Pompano Beach",
  "South Miami", "Sunny Isles Beach", "Sunrise", "Surfside", "Sweetwater",
  "Weston", "Wilton Manors", "Wynwood"
];
const cityToRegion = {};
REGION_ORDER.forEach(r => cityToRegion[r.toUpperCase()] = r);

// National fast-food / chain-restaurant names to exclude outright.
const CHAIN_KEYWORDS = ['mcdonald','burger king','subway','chipotle',"wendy's",'wendys','taco bell','dunkin','starbucks','domino','pizza hut','popeyes',' kfc','panera','chick-fil-a','chick fil a','sonic drive','arby','denny','ihop','waffle house','five guys',"culver's",'checkers','wingstop','jimmy john','panda express','jersey mike','firehouse subs','papa john','little caesars','krispy kreme','baskin robbins','dairy queen',
  'cheesecake factory','yard house',"eddie v",'chuck e cheese',"cooper's hawk",'coopers hawk','compass group','texas roadhouse','olive garden','red lobster','outback','applebee','chili\'s','chilis grill','tgi friday','ruby tuesday','longhorn steakhouse','bonefish grill','carrabba','pf chang','p.f. chang','buffalo wild wings','hooters'];
function isChain(name) { const n = name.toLowerCase(); return CHAIN_KEYWORDS.some(k => n.includes(k)); }

// Non-restaurant categories that show up in DBPR "SEAT"/"NOST" license data but aren't
// public sit-down restaurants: convention/banquet/catering venues, hotel generic F&B,
// private clubs, cafeterias, entertainment/theater venues, institutional food service.
const NON_RESTAURANT_KEYWORDS = ['convention center','conference center','banquet','catering','cafeteria','employee','concession','vending','commissary','country club','golf club','yacht club','marriott','hilton','hyatt','westin','sheraton','embassy suites','courtyard by','hampton inn','holiday inn','doubletree','ritz-carlton','ritz carlton','four seasons','fairmont','regal ','amc ','cinemark','movie','theatre','theater','nursing','rehab','assisted living','hospital','school','elementary','middle school','high school','university','college','church','synagogue','stadium','arena','airport','jai alai','clubhouse','condo','condominium','hoa ','homeowners','food hall','sodexo','aramark'];
function isNonRestaurant(name) { const n = name.toLowerCase(); return NON_RESTAURANT_KEYWORDS.some(k => n.includes(k)); }

function titleCase(s) {
  if (!s) return s;
  return s.toLowerCase().replace(/\b([a-z0-9])/g, m => m.toUpperCase());
}
function formatPhone(raw) {
  if (!raw) return 'N/A';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return '(' + digits.slice(0,3) + ') ' + digits.slice(3,6) + '-' + digits.slice(6);
  return raw.trim() || 'N/A';
}
function formatZip(raw) {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  if (d.length >= 9) return d.slice(0,5) + '-' + d.slice(5,9);
  if (d.length >= 5) return d.slice(0,5);
  return raw.trim();
}

function run() {
  let rows = [];
  for (const file of ['hrfood1.csv', 'hrfood2.csv']) {
    const fp = path.join(REPO, file);
    if (!fs.existsSync(fp)) { console.error('Missing', file, '— see reference_fl_dbpr_csv_source memory for download URLs.'); continue; }
    const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/).filter(Boolean);
    const header = parseCsvLine(lines[0]);
    const idx = {}; header.forEach((h,i) => idx[h] = i);
    for (let i = 1; i < lines.length; i++) {
      const f = parseCsvLine(lines[i]);
      const rank = f[idx['Rank Code']];
      const status = f[idx['Primary Status Code']];
      if (!['SEAT','NOST','CATR','MFDV'].includes(rank)) continue;
      if (status !== '20') continue;
      const name = f[idx['Business Name']];
      if (!name || isChain(name) || isNonRestaurant(name)) continue;
      const city = (f[idx['Location City']] || '').trim().toUpperCase();
      const region = cityToRegion[city];
      if (!region) continue; // only keep rows whose city directly maps to an existing curated region
      const seats = parseInt(f[idx['Number of Seats or Rental Units']]) || 0;
      if (rank === 'SEAT' && seats > 0 && seats < 12) continue; // tiny counter shop
      if (seats > 350) continue; // convention/banquet-scale, not a real sit-down restaurant
      rows.push({
        name, rank, seats,
        addr: f[idx['Location Street Address']],
        city: f[idx['Location City']],
        zip: f[idx['Location Zip Code']],
        phone: f[idx['Secondary Phone Number']] || f[idx['Primary Phone Number']],
        region,
      });
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const r of rows) {
    const key = (r.name + '|' + r.addr).toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  const out = deduped.map(r => ({
    n: titleCase(r.name),
    a: titleCase(r.addr),
    c: titleCase(r.city) + ', FL' + (r.zip ? ' ' + formatZip(r.zip) : ''),
    ph: formatPhone(r.phone),
    reg: r.region,
    seats: r.seats,
    rank: r.rank,
  }));

  const outPath = path.join(REPO, 'dbpr_candidates_cleansed.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('Wrote', outPath, '—', out.length, 'cleansed candidates.');
  console.log('Note: this pool still needs cross-checking against index.html\'s current dataset');
  console.log('(names/addresses already present) before use — that check depends on live DB state.');
}

run();
