const crypto = require('crypto');

const PROVIDER_NAME = '1Shows';
const SITE_URL = 'https://www.1shows.org';
const API_URL = 'https://1shows.org/api';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DOWNLOAD_KEY_HEX = '7a03086357a2147dab4d757e8ed2ff8b5dc8707ee3d473afcb80d97727afa191';

const API_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Origin': SITE_URL,
  'Referer': SITE_URL + '/',
  'User-Agent': USER_AGENT,
  'X-Requested-With': 'XMLHttpRequest'
};

function decryptPayload(encryptedData, tokenHex) {
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
    return JSON.parse(decrypted.toString('utf8'));
  } catch (e) {
    return null;
  }
}

async function getStreams(tmdbId, type, season, episode) {
  if (!tmdbId) return [];
  const isTv = type === 'tv' || type === 'series';
  
  try {
    const tokenRes = await fetch(`${API_URL}/download-token`, { headers: API_HEADERS });
    const tokenData = await tokenRes.json();
    if (!tokenData || !tokenData.token) return [];

    const endpoint = isTv 
      ? `/download/tv/${tmdbId}/${season}/${episode}`
      : `/download/movie/${tmdbId}`;

    const sourcesRes = await fetch(`${API_URL}${endpoint}`, {
      headers: { ...API_HEADERS, 'x-download-token': tokenData.token }
    });
    
    const encryptedRes = await sourcesRes.json();
    const decrypted = decryptPayload(encryptedRes, tokenData.token);
    if (!decrypted || !Array.isArray(decrypted.sources)) return [];

    return decrypted.sources.map(source => {
      let url = source.url;
      if (url.includes('pixeldrain.com')) {
        const id = url.split('/').pop();
        url = `https://pixeldrain.com/api/file/${id}`;
      }
      return {
        name: PROVIDER_NAME,
        title: `1Shows - ${source.label || 'HD'} - ${source.size || 'Unknown'}`,
        url: url,
        quality: source.label || 'HD',
        sizeStr: source.size,
        headers: { 'User-Agent': USER_AGENT, 'Referer': SITE_URL + '/' }
      };
    });
  } catch (err) {
    return [];
  }
}

module.exports = { getStreams };
