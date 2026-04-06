let cachedOffices = null;
let cachedAt = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SPEEDY_OFFICES_URL = 'https://services.speedy.bg/office_locator_widget_v2/offices_list.php?lang=bg';

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtmlToLines(html) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|li|tr|td|h1|h2|h3|h4|h5|h6)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parseSpeedyOffices(html) {
  const lines = stripHtmlToLines(html);
  const offices = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^(.*?)(?:\s*\[(\d+)\])$/);
    if (!match) continue;

    const name = match[1].trim();
    const code = match[2] || '';
    let addressLine = '';

    for (let j = i + 1; j < Math.min(i + 6, lines.length); j += 1) {
      if (/^Адрес:/i.test(lines[j])) {
        addressLine = lines[j].replace(/^Адрес:\s*/i, '').trim();
        break;
      }
    }

    const cityMatch = addressLine.match(/(?:гр\.|с\.)\s*([^\[]+)/i);
    const city = cityMatch ? cityMatch[1].trim() : '';
    const type = name.toUpperCase().includes('(АВТОМАТ)') ? 'Автомат' : 'Офис';

    offices.push({
      id: code,
      code,
      name,
      city,
      quarter: '',
      addr: addressLine,
      type,
    });
  }

  return offices;
}

async function loadOffices() {
  const now = Date.now();
  if (cachedOffices && (now - cachedAt) < CACHE_TTL_MS) {
    return cachedOffices;
  }

  const response = await fetch(SPEEDY_OFFICES_URL);
  if (!response.ok) {
    throw new Error('Speedy offices request failed with status ' + response.status);
  }

  const html = await response.text();
  const offices = parseSpeedyOffices(html);

  cachedOffices = offices;
  cachedAt = now;
  return offices;
}

exports.handler = async function (event) {
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

    const filtered = offices.filter(function (office) {
      const haystack = [
        office.name,
        office.city,
        office.quarter,
        office.addr,
        office.code,
        office.type
      ].join(' ').toLowerCase();

      return words.every(function (word) {
        return haystack.includes(word);
      });
    }).slice(0, 15);

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
