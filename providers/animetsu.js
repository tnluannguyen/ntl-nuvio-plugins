const PROVIDER_NAME = 'AniNeko';
const BASE_URL = 'https://anineko.to';
const PLAYER_REFERER = 'https://bibiemb.xyz/';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': BASE_URL + '/',
  'X-Requested-With': 'XMLHttpRequest'
};

async function fetchWithTimeout(url, options = {}, timeout = 8000) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (e) { return null; }
}

async function fetchText(url, options = {}, timeout = 8000) {
  const res = await fetchWithTimeout(url, options, timeout);
  return res && res.ok ? await res.text() : null;
}

async function fetchJson(url, options = {}, timeout = 8000) {
  const res = await fetchWithTimeout(url, options, timeout);
  return res && res.ok ? await res.json() : null;
}

async function checkLinkAlive(url) {
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'], 'Referer': PLAYER_REFERER }
    }, 4000);
    return res && res.status >= 200 && res.status < 400;
  } catch (e) { return false; }
}

function Unbaser(base) {
  this.ALPHABET = {
    62: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
    95: ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'
  };
  this.dictionary = {};
  this.base = base;
  if (36 < base && base < 62) this.ALPHABET[base] = this.ALPHABET[base] || this.ALPHABET[62].substr(0, base);
  if (2 <= base && base <= 36) {
    this.unbase = (value) => parseInt(value, base);
  } else {
    const self = this;
    this.ALPHABET[base].split('').forEach((cipher, index) => { self.dictionary[cipher] = index; });
    this.unbase = (value) => {
      let ret = 0;
      value.split('').reverse().forEach((cipher, index) => { ret += Math.pow(self.base, index) * self.dictionary[cipher]; });
      return ret;
    };
  }
}

function unpack(source) {
  const juicers = [
    /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\), *(\d+), *(.*)\)\)/,
    /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\)/
  ];
  let args = null;
  for (let i = 0; i < juicers.length; i++) {
    args = juicers[i].exec(source);
    if (args) break;
  }
  if (!args) return '';
  const payload = args[1], radix = parseInt(args[2]), count = parseInt(args[3]), symtab = args[4].split('|');
  const unbase = new Unbaser(radix);
  return payload.replace(/\b\w+\b/g, (word) => {
    const decoded = radix === 1 ? symtab[parseInt(word)] : symtab[unbase.unbase(word)];
    return decoded || word;
  });
}

async function extractVibeplayer(videoUrl) {
  const idMatch = videoUrl.match(/vibeplayer\.site\/([a-z0-9]+)/i) || videoUrl.match(/workers\.dev\/([a-z0-9]+)/i);
  if (!idMatch) return null;
  return `https://vibeplayer.site/public/stream/${idMatch[1]}/master.m3u8`;
}

async function extractPacker(videoUrl) {
  const html = await fetchText(videoUrl, { headers: DEFAULT_HEADERS });
  if (!html) return null;
  const scriptMatch = html.match(/eval\(function\(p,a,c,k,e,d[\s\S]*?\.split\('\|'\)\)\)/);
  if (!scriptMatch) return null;
  const unpacked = unpack(scriptMatch[0]);
  const hlsMatch = unpacked.match(/"(https:\/\/[^"]+master\.m3u8[^"]*)"/) || unpacked.match(/file\s*:\s*"(https:\/\/[^"]+)"/);
  return hlsMatch ? hlsMatch[1] : null;
}

async function getStreams(tmdbId, mediaType, season, episode, meta) {
  const isSeries = mediaType === 'tv' || mediaType === 'series';
  const tmdbUrl = `https://api.themoviedb.org/3/${isSeries ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  const tmdbData = await fetchJson(tmdbUrl);
  if (!tmdbData) return [];

  const fullTitle = tmdbData.name || tmdbData.title;
  const searchTitle = fullTitle.split(':')[0].trim();
  
  const searchUrl = `${BASE_URL}/browser?keyword=${encodeURIComponent(searchTitle)}`;
  const searchHtml = await fetchText(searchUrl, { headers: DEFAULT_HEADERS });
  if (!searchHtml) return [];

  const cards = [...searchHtml.matchAll(/<article class="nv-anime-card[^>]*>[\s\S]*?href="([^"]+)"[^>]*>[\s\S]*?class="nv-card-title">([^<]+)</gi)];
  let bestSlug = null;

  for (const match of cards) {
    const slug = match[1].replace('/watch/', '');
    const title = match[2].toLowerCase();
    if (isSeries) {
      if (season > 1) {
        if (title.includes(`season ${season}`) || title.includes(`part ${season}`) || slug.includes(`season-${season}`)) {
          bestSlug = slug; break;
        }
      } else if (!title.includes('season') && !title.includes('part')) {
        bestSlug = slug; break;
      }
    } else { bestSlug = slug; break; }
  }
  if (!bestSlug && cards.length > 0) bestSlug = cards[0][1].replace('/watch/', '');
  if (!bestSlug) return [];

  const epUrl = `${BASE_URL}/watch/${bestSlug}/ep-${episode}`;
  const epHtml = await fetchText(epUrl, { headers: DEFAULT_HEADERS });
  if (!epHtml) return [];

  const serverMatches = [...epHtml.matchAll(/<button[^>]+data-video="([^"]+)"[^>]*>\s*([^<\s]+)\s*<span>([^<]+)<\/span>/g)];
  const softSubServers = serverMatches.filter(m => m[3].trim() === 'Sort Sub' || m[3].trim() === 'Soft Sub');

  for (const match of softSubServers) {
    const videoUrl = match[1];
    const serverName = match[2].trim();
    let streamUrl = null;

    if (serverName.includes('HD')) {
      streamUrl = await extractVibeplayer(videoUrl);
    } else if (serverName === 'StreamHG' || serverName === 'Earnvids') {
      streamUrl = await extractPacker(videoUrl);
    }

    if (streamUrl) {
      const isAlive = await checkLinkAlive(streamUrl);
      if (isAlive) {
        const headers = { 'User-Agent': DEFAULT_HEADERS['User-Agent'], 'Referer': PLAYER_REFERER };
        return [{
          name: `NTL Global`,
          title: `${fullTitle} (S${season}E${episode})\n🌸 ${serverName} | 📺 1080p | 🗣️ SOFT SUB`,
          url: streamUrl,
          resLabel: '1080p',
          source: `${PROVIDER_NAME} (${serverName})`,
          behaviorHints: { proxyHeaders: { request: headers }, notWebReady: true }
        }];
      }
    }
  }

  return [];
}

module.exports = { getStreams };
