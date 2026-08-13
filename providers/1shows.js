const crypto = require('crypto');

const PROVIDER_NAME = '1Shows';
const SITE_URL = 'https://www.1shows.org';
const API_URL = 'https://1shows.org/api';
const TMDB_URL = 'https://api.themoviedb.org/3';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DOWNLOAD_KEY_HEX = '7a03086357a2147dab4d757e8ed2ff8b5dc8707ee3d473afcb80d97727afa191';

const API_HEADERS = {
  'Accept': 'application/json',
  'Origin': SITE_URL,
  'Referer': SITE_URL + '/',
  'User-Agent': USER_AGENT
};

async function fetchJson(url, options) {
  console.log("[1Shows] Fetching JSON URL: " + url);
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    
    // Kiểm tra nếu bị Cloudflare chặn (trả về HTML thay vì JSON)
    if (text.trim().startsWith('<')) {
      throw new Error("Cloudflare HTML challenge detected");
    }
    
    console.log("[1Shows] Response status for " + url + ": " + response.status);
    if (!response.ok) return null;
    return JSON.parse(text);
  } catch (e) {
    console.log("[1Shows] Standard fetch failed: " + e.message);
    
    // Fallback sang FlareSolverr nếu có sẵn trong Sandbox
    if (typeof flareFetch !== 'undefined') {
      console.log("[1Shows] Attempting flareFetch fallback for: " + url);
      const flareRes = await flareFetch(url, 15000);
      if (flareRes && flareRes.text && !flareRes.text.trim().startsWith('<')) {
        try {
          console.log("[1Shows] flareFetch successful.");
          return JSON.parse(flareRes.text);
        } catch (err) {
          console.log("[1Shows] flareFetch JSON parse error: " + err.message);
        }
      } else {
        console.log("[1Shows] flareFetch failed or returned HTML.");
      }
    }
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
