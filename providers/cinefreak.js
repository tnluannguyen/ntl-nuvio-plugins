const BASE_URL = 'https://cinefreak.nl';
const TMDB_API_KEY = 'ca1f881d0bd7bbf9cb3170edd54b52d5';
const PROVIDER_NAME = 'CineFreak';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5'
};

function parseSizeToMB(sizeStr) {
  if (!sizeStr) return 0;
  const cleaned = String(sizeStr).replace(/,/g, '');
  const match = cleaned.match(/([\d.]+)\s*(GB|MB|KB|G|M|K)/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'GB' || unit === 'G') return val * 1024;
  if (unit === 'MB' || unit === 'M') return val;
  if (unit === 'KB' || unit === 'K') return val / 1024;
  return 0;
}

function parseQuality(textStr) {
  const text = String(textStr).toLowerCase();
  if (text.includes('4k') || text.includes('2160') || text.includes('uhd')) return '4K';
  if (text.includes('1080') || text.includes('fhd')) return '1080p';
  if (text.includes('720') || (text.includes('hd') && !text.includes('uhd') && !text.includes('fhd'))) return '720p';
  if (text.includes('480') || text.includes('sd')) return '480p';
  return 'Unknown';
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function fetchText(url) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  }
}

async function getTMDBInfo(tmdbId, type) {
  const isTv = type === 'tv' || type === 'series';
  const url = isTv 
    ? `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`
    : `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
  
  const data = await fetchJson(url);
  if (!data) return null;
  
  return {
    title: isTv ? data.name : data.title,
    year: isTv ? (data.first_air_date || '').substring(0, 4) : (data.release_date || '').substring(0, 4),
    isTv: isTv
  };
}

async function searchCinefreak(query) {
  if (!query) return [];
  const url = `${BASE_URL}/wp-json/wp/v2/search?search=${encodeURIComponent(query)}&per_page=10`;
  const data = await fetchJson(url);
  if (!data || !Array.isArray(data)) return [];
  
  return data.map(item => ({
    id: item.id,
    title: String(item.title).replace(/Download\s*/gi, '').trim(),
    url: item.url
  }));
}

function matchByTitleYear(targetTitle, targetYear, results) {
  if (!results || results.length === 0) return null;
  const targetClean = String(targetTitle).toLowerCase().trim();
  
  let bestMatch = null;
  let bestScore = -1;

  for (const item of results) {
    if (!item || !item.title) continue;
    const itemTitle = String(item.title).toLowerCase();
    let score = 0;
    
    if (itemTitle.includes(targetClean) || targetClean.includes(itemTitle)) score += 10;
    if (targetYear && itemTitle.includes(String(targetYear))) score += 5;
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }
  
  return bestScore >= 10 ? bestMatch : null;
}

function decodeGenerateUrl(encoded) {
  try {
    let decoded = atob(encoded);
    return decoded.replace(/newgo32$/, '');
  } catch (e) {
    return null;
  }
}

function extractFslUrl(html) {
  const regex = /href="([^"]+)"[^>]*id="fsl"|href="([^"]+(?:\.workers\.dev|\.r2\.dev|\.buzz|\.cloudflarestorage\.com)\/[^"]+)"|href="(https?:\/\/[^"]+\.(?:mkv|mp4)[^"]*)"|href="(https:\/\/pub-[^"]+)"/ig;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const url = match[1] || match[2] || match[3] || match[4];
    if (url && !url.includes('cinecloud')) {
      return url.replace(/&amp;/g, '&');
    }
  }
  
  // Fallback: Tìm chính xác nút bấm có id="fsl" (FAST CLOUD)
  const fslIdx = html.indexOf('id="fsl"');
  if (fslIdx !== -1) {
    const hrefIdx = html.lastIndexOf('href="', fslIdx);
    if (hrefIdx !== -1) {
      const start = hrefIdx + 6;
      const end = html.indexOf('"', start);
      if (end !== -1) {
        return html.substring(start, end).replace(/&amp;/g, '&');
      }
    }
  }
  
  return null;
}

// ĐÃ SỬA: Nhận trực tiếp decodedUrl thay vì encodedId để hỗ trợ tên miền động
async function resolveFslUrl(decodedUrl) {
  if (!decodedUrl) return null;
  const html = await fetchText(decodedUrl);
  if (!html) return null;
  return extractFslUrl(html);
}

function extractMovieQualities(html) {
  if (!html) return [];
  const results = [];
  const blocks = html.split('dlbtn-container');
  
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const prevBlock = blocks[i - 1];
    
    const match = block.match(/href="(?:https?:\/\/[^"]*?)?\/generate\.php\?id=([a-zA-Z0-9+/=]+)"/);
    if (!match) continue;
    
    const encodedId = match[1];
    const decodedUrl = decodeGenerateUrl(encodedId);
    if (!decodedUrl || !decodedUrl.includes('/f/')) continue;
    
    let label = '';
    const labelMatch = prevBlock.match(/<\/span>\s*([^<]*?(?:2160|1080|720|480|4K)[^<]*?\[[^\]]+\])/i) || 
                       prevBlock.match(/<\/span>\s*([^<]*?(?:2160|1080|720|480|4K)[^<]*?)\s*\[/i);
    
    if (labelMatch) label = labelMatch[1].trim();
    if (!label) {
      const fallbackMatch = prevBlock.match(/\b(?:4K\s*2160p|UHD|2160p|1080p|720p|480p)\b/i) || prevBlock.match(/\b(?:SD|HD)\b/i);
      if (fallbackMatch) label = fallbackMatch[0];
    }
    
    const quality = parseQuality(label || decodedUrl);
    results.push({ encodedId, decodedUrl, label: label || quality, quality });
  }
  return results;
}

function extractEpisodeQualities(html, targetEp) {
  if (!html) return [];
  const blocks = html.split('episode-badge');
  let targetBlock = null;
  
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const match = block.match(/>Episode\s*(\d+)/i);
    if (match && parseInt(match[1], 10) === targetEp) {
      targetBlock = block;
      break;
    }
  }
  
  if (!targetBlock) return [];
  
  const results = [];
  let searchIdx = 0;
  while (true) {
    const genIdx = targetBlock.indexOf('/generate.php?id=', searchIdx);
    if (genIdx === -1) break;
    
    const startQuote = targetBlock.lastIndexOf('"', genIdx);
    const endQuote = targetBlock.indexOf('"', genIdx);
    if (startQuote === -1 || endQuote === -1) {
      searchIdx = genIdx + 1;
      continue;
    }
    
    const urlPart = targetBlock.substring(startQuote + 1, endQuote);
    const idMatch = urlPart.match(/id=([a-zA-Z0-9+/=]+)/);
    if (idMatch) {
      const encodedId = idMatch[1];
      const decodedUrl = decodeGenerateUrl(encodedId);
      if (decodedUrl && decodedUrl.includes('/f/')) {
        const quality = parseQuality(decodedUrl);
        results.push({ encodedId, decodedUrl, label: quality, quality });
      }
    }
    searchIdx = endQuote + 1;
  }
  
  return results;
}

async function getStreams(tmdbId, type = 'movie', season = null, episode = null) {
  console.log(`[CineFreak] Request: tmdbId=${tmdbId} type=${type} S${season}E${episode}`);
  try {
    const isTv = type === 'tv' || type === 'series';
    const info = await getTMDBInfo(tmdbId, type);
    if (!info || !info.title) return [];
    
    console.log(`[CineFreak] TMDB: ${info.title} (${info.year})`);
    
    let searchResults = await searchCinefreak(info.title);
    if (!searchResults || searchResults.length === 0) return [];
    
    const match = matchByTitleYear(info.title, info.year, searchResults);
    if (!match) return [];
    
    console.log(`[CineFreak] Matched Post: ${match.title}`);
    
    const postHtml = await fetchText(match.url);
    if (!postHtml) return [];
    
    let qualities = [];
    if (isTv) {
      const epNum = parseInt(episode, 10) || 1;
      qualities = extractEpisodeQualities(postHtml, epNum);
    } else {
      qualities = extractMovieQualities(postHtml);
    }
    
    if (qualities.length === 0) return [];
    
    const streams = [];
    for (const q of qualities) {
      // ĐÃ SỬA: Truyền decodedUrl thay vì encodedId
      const finalUrl = await resolveFslUrl(q.decodedUrl);
      if (finalUrl) {
        const textForScoring = (q.label + ' ' + match.title).toLowerCase();
        const sizeMB = parseSizeToMB(q.label);
        let score = sizeMB;
        
        if (textForScoring.includes('eng') || textForScoring.includes('english')) score += 1000000;
        if (textForScoring.includes('dual') || textForScoring.includes('multi')) score += 500000;
        if (textForScoring.includes('h265') || textForScoring.includes('hevc')) score += 100000;
        
        // ĐÃ SỬA: Tự động lấy Origin từ decodedUrl làm Referer
        let referer = 'https://cinecloud.site/';
        try {
          referer = new URL(q.decodedUrl).origin + '/';
        } catch(e) {}

        streams.push({
          name: `CineFreak [${q.quality}]`,
          title: `${match.title}\n📺 ${q.quality} | 💾 ${q.label}`,
          url: finalUrl,
          quality: q.quality,
          score: score,
          headers: { 'Referer': referer }
        });
      }
    }
    
    const bestStreams = {};
    for (const s of streams) {
      if (!bestStreams[s.quality] || s.score > bestStreams[s.quality].score) {
        bestStreams[s.quality] = s;
      }
    }
    
    if (bestStreams['4K'] && bestStreams['1080p']) {
      delete bestStreams['720p'];
      delete bestStreams['480p'];
    }
    
    const results = [];
    const order = ['4K', '1080p', '720p', '480p', 'Unknown'];
    for (const q of order) {
      if (bestStreams[q]) {
        const finalStream = bestStreams[q];
        delete finalStream.score;
        delete finalStream.quality;
        results.push(finalStream);
      }
    }
    
    console.log(`[CineFreak] Returning ${results.length} streams.`);
    return results;
    
  } catch (e) {
    console.log(`[CineFreak] Error: ${e.message}`);
    return [];
  }
}

module.exports = { getStreams };
