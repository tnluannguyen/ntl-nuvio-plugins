const crypto = require('crypto');

const PROVIDER_NAME = '1Shows';
const SITE_URL = 'https://www.1shows.org';
const API_URL = 'https://1shows.org/api';
const TMDB_URL = 'https://api.themoviedb.org/3';
const TMDB_API_KEY = 'ca1f881d0bd7bbf9cb3170edd54b52d5';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DOWNLOAD_KEY_HEX = '7a03086357a2147dab4d757e8ed2ff8b5dc8707ee3d473afcb80d97727afa191';

const API_HEADERS = {
  'Accept': 'application/json',
  'Origin': SITE_URL,
  'Referer': SITE_URL + '/',
  'User-Agent': USER_AGENT
};

async function requestWithBypass(url, options, expectJson = false) {
  let response;
  let text = null;
  let needsBypass = false;

  const fetchOptions = Object.assign({}, options, {
    cfKiller: true,
    skipSizeCheck: true
  });

  const doFetch = async (opts) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      const txt = await res.text();
      clearTimeout(id);
      return { res, txt };
    } catch (e) {
      clearTimeout(id);
      throw e;
    }
  };

  try {
    console.log("[1Shows] Fetching URL: " + url);
    const result = await doFetch(fetchOptions);
    response = result.res;
    text = result.txt;

    if (response.status === 403 || response.status === 503) {
      console.log("[1Shows] Cloudflare 403/503 detected.");
      needsBypass = true;
    } else if (expectJson && text.trim().startsWith('<')) {
      console.log("[1Shows] Sneaky Cloudflare 200 OK (HTML instead of JSON) detected.");
      needsBypass = true;
    }
  } catch (e) {
    console.log("[1Shows] Fetch failed (" + e.message + "). Flagging for bypass.");
    needsBypass = true;
  }

  if (needsBypass) {
    if (typeof Cloudflare !== 'undefined' && Cloudflare.bypass) {
      console.log("[1Shows] Executing Cloudflare bypass for: " + url);
      try {
        const bypassHeaders = await Cloudflare.bypass(url);
        const bypassOptions = { ...fetchOptions };
        bypassOptions.headers = { ...(fetchOptions.headers || {}), ...(bypassHeaders || {}) };
        const result = await doFetch(bypassOptions);
        response = result.res;
        text = result.txt;
        console.log("[1Shows] Bypass request status: " + response.status);
        if (response && response.ok) return text;
      } catch (e) {
        console.log("[1Shows] Bypass request failed: " + e.message);
      }
    } else {
      console.log("[1Shows] Bypass required but Cloudflare.bypass is missing.");
    }
    return null;
  }

  return (response && response.ok) ? text : null;
}

async function fetchJson(url, options) {
  const text = await requestWithBypass(url, options, true);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    console.log("[1Shows] JSON parse error: " + e.message);
    return null;
  }
}

function decryptPayload(encryptedData, tokenHex) {
  console.log("[1Shows] Attempting to decrypt payload...");
  try {
    const key = Buffer.from(DOWNLOAD_KEY_HEX, 'hex');
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const ct = Buffer.from(encryptedData.ct, 'hex');
    const tag = Buffer.from(encryptedData.tag, 'hex');
    const aad = Buffer.from(tokenHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    decipher.setAAD(aad);

    let decrypted = decipher.update(ct);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    console.log("[1Shows] Payload decrypted successfully.");
    return JSON.parse(decrypted.toString('utf8'));
  } catch (e) {
    console.log("[1Shows] Decryption failed: " + e.message);
    return null;
  }
}

async function fetchDownloadSources(id, type, season, episode) {
  console.log("[1Shows] Fetching download token...");
  const tokenData = await fetchJson(`${API_URL}/download-token`, { headers: API_HEADERS });
  if (!tokenData || !tokenData.token) {
    console.log("[1Shows] Failed to get download token.");
    return [];
  }

  const endpoint = type === 'tv' 
    ? `/download/tv/${encodeURIComponent(id)}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}`
    : `/download/movie/${encodeURIComponent(id)}`;

  console.log("[1Shows] Fetching encrypted sources from: " + endpoint);
  const encryptedRes = await fetchJson(`${API_URL}${endpoint}`, {
    headers: { ...API_HEADERS, 'x-download-token': tokenData.token }
  });

  if (!encryptedRes) {
    console.log("[1Shows] Failed to fetch encrypted sources.");
    return [];
  }

  const decrypted = decryptPayload(encryptedRes, tokenData.token);
  if (decrypted && Array.isArray(decrypted.sources)) {
    console.log("[1Shows] Extracted " + decrypted.sources.length + " sources from decrypted payload.");
    return decrypted.sources;
  }
  console.log("[1Shows] No sources found in decrypted payload.");
  return [];
}

async function fetchMediaDetails(tmdbId, type) {
  try {
    const endpoint = type === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_URL}/${endpoint}/${encodeURIComponent(tmdbId)}?api_key=${TMDB_API_KEY}`;
    console.log("[1Shows] Fetching TMDB details: " + url);
    const data = await fetchJson(url, { headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT } });
    
    if (!data) {
      console.log("[1Shows] Failed to fetch TMDB details.");
      return { title: 'Unknown', year: null };
    }
    
    const title = data.name || data.title || data.original_name || data.original_title || 'Unknown';
    const dateStr = data.release_date || data.first_air_date || '';
    const year = Number(dateStr.slice(0, 4)) || null;
    
    console.log("[1Shows] TMDB Details extracted: " + title + " (" + year + ")");
    return { title, year };
  } catch (e) {
    console.log("[1Shows] TMDB fetch error: " + e.message);
    return { title: 'Unknown', year: null };
  }
}

function parseQuality(label) {
  const lower = String(label || '').toLowerCase();
  if (lower.includes('2160') || lower.includes('4k')) return '4K';
  if (lower.includes('1080')) return '1080p';
  if (lower.includes('720')) return '720p';
  if (lower.includes('480')) return '480p';
  return 'HD';
}

function parseSizeToMB(sizeStr) {
  if (!sizeStr) return 0;
  const match = String(sizeStr).match(/([\d.]+)\s*(GB|MB)/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'GB') return Math.round(val * 1024);
  if (unit === 'MB') return Math.round(val);
  return 0;
}

function isDirectMedia(url) {
  if (/\.(?:m3u8|mpd|mp4|mkv|webm)(?:$|[?#])/i.test(url)) return true;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'pixeldrain.com' || hostname.includes('hubcloud') || hostname.includes('workers.dev');
  } catch (e) {
    return false;
  }
}

function normalizeDirectUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('pixeldrain')) {
      const match = parsed.pathname.match(/^\/(?:u|l)\/([^/?#]+)/i);
      if (match) return `https://pixeldrain.com/api/file/${match[1]}`;
    }
  } catch (e) {}
  return url;
}

async function getStreams(tmdbId, type, season, episode) {
  console.log(`[1Shows] getStreams called. TMDB: ${tmdbId} | Type: ${type} | S${season}E${episode}`);
  if (!tmdbId) return [];
  
  const isTv = type === 'tv' || type === 'series';
  const s = Number(season) || 1;
  const e = Number(episode) || 1;

  try {
    const [sources, details] = await Promise.all([
      fetchDownloadSources(tmdbId, isTv ? 'tv' : 'movie', s, e),
      fetchMediaDetails(tmdbId, isTv ? 'tv' : 'movie')
    ]);

    if (!sources || sources.length === 0) {
      console.log("[1Shows] No sources returned from fetchDownloadSources.");
      return [];
    }

    const finalStreams = [];
    
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      if (!source || !source.url) continue;
      
      let directUrl = source.url;
      if (isDirectMedia(directUrl) || directUrl.includes('pixeldrain')) {
        directUrl = normalizeDirectUrl(directUrl);
      } else {
        console.log("[1Shows] Skipping non-direct media URL: " + directUrl);
        continue;
      }

      const quality = parseQuality(source.label || source.name || '');
      const sizeMB = parseSizeToMB(source.size);
      const sizeStr = source.size || 'Unknown Size';
      
      let sourceName = '1Shows';
      if (directUrl.includes('pixeldrain')) sourceName = 'Pixeldrain';
      else if (directUrl.includes('hubcloud')) sourceName = 'HubCloud';

      console.log(`[1Shows] Extracted stream: ${quality} | ${sourceName} | ${sizeStr}`);

      finalStreams.push({
        name: PROVIDER_NAME,
        title: `${details.title}\n${quality} | ${sourceName} | ${sizeStr}`,
        url: directUrl,
        quality: quality,
        sizeInMB: sizeMB,
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': SITE_URL + '/'
        }
      });
    }

    console.log(`[1Shows] Returning ${finalStreams.length} final streams.`);
    return finalStreams;
  } catch (err) {
    console.log(`[1Shows] Global Error: ${err.message}`);
    return [];
  }
}

module.exports = { getStreams };
