const PROVIDER_NAME = 'VidEasy';
const TMDB_API_KEY = 'ca1f881d0bd7bbf9cb3170edd54b52d5';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const WINGS_API_BASE = 'https://api.speedracelight.com';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const REQUEST_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': '*/*',
  'Origin': 'https://www.vidking.net',
  'Referer': 'https://www.vidking.net/',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache'
};

// Hàm tính dung lượng nội bộ (Đã tích hợp để không cần gọi từ bên ngoài)
function internalParseSize(sizeStr) {
  if (!sizeStr) return 0;
  const cleaned = String(sizeStr).replace(/,/g, '');
  const match = cleaned.match(/([\d.]+)\s*(GB|MB|KB|G|M|K)/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  let unit = match[2].toUpperCase();
  if (unit === 'G' || unit === 'GB') return val * 1024;
  if (unit === 'M' || unit === 'MB') return val;
  if (unit === 'K' || unit === 'KB') return val / 1024;
  return 0;
}

const jl = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174];
const Js = 61;
const _f = 8;
const ms = 0x9e3779b9;
const Ys = [109, 118, 109, 49]; 

function ui(x) {
  x >>>= 0; x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

function ps(x, y) {
  x >>>= 0; y &= 31;
  return y === 0 ? x >>> 0 : ((x << y) | (x >>> (32 - y))) >>> 0;
}

function wf(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x1000193) >>> 0;
  }
  return ui(h);
}

function vf(a, b, c) { return (((a ^ b) >>> 0) | ((a & b & c) >>> 0)) >>> 0; }

function Nf(str, num) {
  const S = new Array(Js);
  let acc = ui(wf(str) ^ ui((num >>> 0) ^ ms)) >>> 0;
  for (let i = 0; i < _f; i++) {
    const mod = acc % Js;
    acc = ps((acc + ms) >>> 0, 7 + (i & 7));
    S[mod] = (acc ^ ui(acc)) >>> 0;
    acc = ui((acc + mod) >>> 0);
  }
  return { S, acc: ui(acc ^ 0xa5a5a5a5) >>> 0 };
}

function Rf(state, idx) {
  const S = state.S; let acc = state.acc;
  const mod = acc % Js; const flag = 0 - +(mod in S);
  const sVal = S[mod] >>> 0; const mVal = Math.imul(ms, idx + 1) >>> 0;
  let v = vf(acc, (sVal ^ mVal) >>> 0, flag);
  v = (ps((v + acc) >>> 0, mod & 31) ^ ps(acc, Math.imul(mod, 7) & 31)) >>> 0;
  acc = ui((v + ms) >>> 0); S[mod] = acc >>> 0; state.acc = acc;
  return acc >>> 0;
}

function Cf(str, num, len) {
  const state = Nf(str, num); const out = new Uint8Array(len);
  let idx = 0;
  for (let i = 0; i < len;) {
    const r = Rf(state, idx++);
    out[i++] = r & 255;
    if (i < len) out[i++] = (r >>> 8) & 255;
    if (i < len) out[i++] = (r >>> 16) & 255;
    if (i < len) out[i++] = (r >>> 24) & 255;
  }
  return out;
}

function decodeBase64(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = str.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const len = clean.length; const out = new Uint8Array(Math.floor(len * 0.75));
  let j = 0;
  for (let i = 0; i < len; i += 4) {
    const c1 = chars.indexOf(clean[i]);
    const c2 = chars.indexOf(clean[i + 1] || 'A');
    const c3 = chars.indexOf(clean[i + 2] || 'A');
    const c4 = chars.indexOf(clean[i + 3] || 'A');
    out[j++] = (c1 << 2) | (c2 >> 4);
    if (i + 2 < len) out[j++] = ((c2 & 15) << 4) | (c3 >> 2);
    if (i + 3 < len) out[j++] = ((c3 & 3) << 6) | c4;
  }
  return out;
}

function decryptWingsDatabase(b64Str, seedStr, tmdbIdNum) {
  const enc = decodeBase64(b64Str);
  const key = Cf(seedStr, tmdbIdNum, enc.length);
  for (let i = 0; i < enc.length; i++) enc[i] ^= key[i];
  for (let i = 0; i < Ys.length; i++) { if (enc[i] !== Ys[i]) throw new Error('decrypt failed'); }
  let dec = ''; const data = enc.subarray(Ys.length);
  for (let i = 0; i < data.length;) {
    const c = data[i++];
    if (c < 128) dec += String.fromCharCode(c);
    else if (c > 191 && c < 224) dec += String.fromCharCode(((c & 31) << 6) | (data[i++] & 63));
    else if (c > 223 && c < 240) dec += String.fromCharCode(((c & 15) << 12) | ((data[i++] & 63) << 6) | (data[i++] & 63));
    else dec += String.fromCharCode(((c & 7) << 18) | ((data[i++] & 63) << 12) | ((data[i++] & 63) << 6) | (data[i++] & 63));
  }
  return dec;
}

function parseQuality(textStr) {
  const text = String(textStr).toLowerCase();
  if (text.includes('4k') || text.includes('2160') || text.includes('uhd')) return '4K';
  if (text.includes('1080') || text.includes('fhd')) return '1080p';
  if (text.includes('720') || (text.includes('hd') && !text.includes('uhd') && !text.includes('fhd'))) return '720p';
  return '480p';
}

async function fetchMediaDetails(tmdbId, mediaType) {
  try {
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    const data = await res.json();
    return {
      title: type === 'tv' ? data.name : data.title,
      year: (type === 'tv' ? data.first_air_date : data.release_date || '').substring(0, 4),
      imdbId: data.external_ids?.imdb_id || null
    };
  } catch (e) { return null; }
}

async function getStreams(tmdbId, type = 'movie', season = null, episode = null) {
  console.log(`[VidEasy] Request: tmdbId=${tmdbId} type=${type} S${season}E${episode}`);
  try {
    const mediaDetails = await fetchMediaDetails(tmdbId, type);
    if (!mediaDetails) return [];

    const seedUrl = `${WINGS_API_BASE}/seed?mediaId=${tmdbId}`;
    const seedRes = await fetch(seedUrl, { headers: REQUEST_HEADERS });
    if (!seedRes.ok) throw new Error(`Seed HTTP ${seedRes.status}`);
    const { seed } = await seedRes.json();

    const params = {
      title: mediaDetails.title,
      mediaType: type === 'series' ? 'tv' : type,
      year: mediaDetails.year,
      episodeId: String(episode || 1),
      seasonId: String(season || 1),
      tmdbId: String(tmdbId),
      imdbId: mediaDetails.imdbId || '',
      enc: '2',
      seed: seed,
      t: Date.now()
    };

    const queryString = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
    const url = `${WINGS_API_BASE}/cdn/sources-with-title?${queryString}`;
    
    const res = await fetch(url, { headers: REQUEST_HEADERS });
    const text = await res.text();
    
    const decryptedJson = decryptWingsDatabase(text, seed, Number(tmdbId));
    const parsedData = JSON.parse(decryptedJson);
    if (!parsedData || !parsedData.sources) return [];

    const streams = [];
    parsedData.sources.forEach(source => {
      if (!source.url) return;
      const quality = parseQuality(source.quality || '1080p');
      
      // Sử dụng hàm nội bộ đã khai báo ở trên
      const sizeMB = internalParseSize(source.size || '');
      
      let score = sizeMB;
      if (source.quality?.includes('1080')) score += 1000000;

      streams.push({
        name: `VidEasy [CDN]`,
        title: `${mediaDetails.title}\n📺 ${quality} | 💾 ${source.size || 'Unknown'}`,
        url: source.url,
        quality: quality,
        score: score,
        headers: { 'Referer': 'https://www.vidking.net/', 'Origin': 'https://www.vidking.net' }
      });
    });

    const bestStreams = {};
    streams.forEach(s => {
      if (!bestStreams[s.quality] || s.score > bestStreams[s.quality].score) bestStreams[s.quality] = s;
    });

    const results = [];
    ['4K', '1080p', '720p', '480p'].forEach(q => {
      if (bestStreams[q]) {
        const s = bestStreams[q];
        delete s.score; delete s.quality;
        results.push(s);
      }
    });

    return results;
  } catch (e) {
    console.log(`[VidEasy] Error: ${e.message}`);
    return [];
  }
}

module.exports = { getStreams };
