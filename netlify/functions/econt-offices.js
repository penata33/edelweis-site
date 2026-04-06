let cachedOffices = null;
let cachedAt = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ECONT_OFFICES_URL = 'https://ee.econt.com/services/Nomenclatures/NomenclaturesService.getOffices.json';

async function loadOffices() {
  const now = Date.now();
  if (cachedOffices && (now - cachedAt) < CACHE_TTL_MS) {
    return cachedOffices;
  }

  const response = await fetch(ECONT_OFFICES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      countryCode: 'BGR'
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error('Econt offices request failed with status ' + response.status + (text ? ' - ' + text.slice(0, 300) : ''));
  }

  const data = await response.json();
  const offices = Array.isArray(data.offices) ? data.offices : [];

  cachedOffices = offices;
  cachedAt = now;
  return offices;
}

function normalizeOffice(office) {
  const address = office && office.address ? office.address : {};
  const city = address.city && address.city.name ? address.city.name : '';
  const quarter = address.quarter || '';
  const street = address.street || '';
  const num = address.num || '';
  const other = address.other || '';
  const fullAddress = address.fullAddress || [street, num, other].filter(Boolean).join(' ');

  return {
    id: office.id || '',
    code: office.code || '',
    name: office.name || '',
    city,
    quarter,
    addr: (fullAddress || '').trim(),
    type: office.isAPS ? 'Еконтомат' : 'Офис'
  };
}

function isRealOffice(office) {
  const code = String(office.code || '');
  // Filter obvious demo/test offices that appear in some example datasets.
  if (code === '99999999' || code === '999999999' || code === '888888888') return false;
  return true;
}

exports.handler = async function(event) {
  try {
    if (event.httpMethod && event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const query = String(body.query || '').trim().toLowerCase();

    if (query.length < 2) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offices: [] })
      };
    }

    const words = query.split(/\s+/).filter(Boolean);
    const offices = await loadOffices();

    const filtered = offices
      .filter(isRealOffice)
      .map(normalizeOffice)
      .filter(function(office) {
        const haystack = [
          office.name,
          office.city,
          office.quarter,
          office.addr,
          office.code,
          office.type
        ].join(' ').toLowerCase();

        return words.every(function(word) {
          return haystack.includes(word);
        });
      })
      .slice(0, 15);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offices: filtered })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err && err.message ? err.message : 'Unknown server error' })
    };
  }
};
