const PROVIDER_NAME = 'CineFreak';
const BASE_URL = 'https://cinefreak.nl';
const CINECLOUD_BASE = 'https://cinecloud.pro';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';

const MOBILE_UAS = [
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36'
];

function getHeaders(userAgent) {
  return {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
  };
}

async function fetchText(url, userAgent) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(url, {
      headers: getHeaders(userAgent || MOBILE_UAS[0]),
      signal: controller.signal
    });
    clearTimeout(id);
    if (!response.ok) return null;
    return await response.text();
  } catch (e) {
    return null;
  }
}

async function fetchJson(url, userAgent) {
  try {
    const text = await fetchText(url, userAgent);
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function parseQuality(str) {
  const lower = String(str || '').toLowerCase();
  if (lower.includes('2160') || lower.includes('4k')) return '4K';
  if (lower.includes('1080')) return '1080p';
  if (lower.includes('720')) return '720p';
  if (lower.includes('480')) return '480p';
  return 'HD';
}

function extractFslUrl(html) {
  const regex = /href="([^"]+)"[^>]*id="fsl"|href="([^"]+(?:\.workers\.dev|\.r2\.dev|\.buzz|\.cloudflarestorage\.com)\/[^"]+)"|href="(https?:\/\/[^"]+\.(?:mkv|mp4)[^"]*)"|href="(https:\/\/pub-[^"]+)"/ig;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const url = match[1] || match[2] || match[3] || match[4];
    if (url && !url.includes('cinecloud.pro')) {
      return url.replace(/&amp;/g, '&');
    }
  }
  
  const startStr = 'window.location.href="';
  const startIdx = html.indexOf(startStr);
  if (startIdx !== -1) {
    const endIdx = html.indexOf('"', startIdx + startStr.length);
    if (endIdx !== -1) {
      let url = html.substring(startIdx + startStr.length, endIdx);
      return url.replace(/&amp;/g, '&');
    }
  }
  return null;
}

function decodeGenerateUrl(encoded) {
  try {
    let decoded = atob(encoded);
    return decoded.replace(/newgo32$/, '');
  } catch (e) {
    return null;
  }
}

async function searchCinefreak(query, userAgent) {
  if (!query) return [];
  const url = `${BASE_URL}/wp-json/wp/v2/search?search=${encodeURIComponent(query)}&per_page=10`;
  const data = await fetchJson(url, userAgent);
  if (!data || !Array.isArray(data)) return [];
  
  const results = [];
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (!item || !item.title || !item.url) continue;
    results.push({
      id: item.id,
      title: String(item.title).replace(/Download\s*/gi, '').trim(),
      url: item.url
    });
  }
  return results;
}

async function getTMDBInfo(tmdbId, type, userAgent) {
  const isTv = type === 'tv' || type === 'series';
  const url = isTv 
    ? `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`
    : `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
    
  const data = await fetchJson(url, userAgent);
  if (!data) return null;
  
  return {
    title: isTv ? data.name : data.title,
    year: isTv ? (data.first_air_date || '').substring(0, 4) : (data.release_date || '').substring(0, 4),
    isTv: isTv
  };
}

function matchByTitleYear(targetTitle, targetYear, results, season) {
  if (!results || !results.length) return null;
  const targetClean = String(targetTitle || '').toLowerCase().trim();
  
  function getScore(item) {
    if (!item) return 0;
    let score = 0;
    const itemTitle = String(item.title).toLowerCase();
    if (itemTitle.includes(targetClean)) score += 10;
    if (targetYear && itemTitle.includes(String(targetYear))) score += 3;
    return score;
  }

  let bestMatch = null;
  let highestScore = -1;

  if (season) {
    const seasonRegex = new RegExp(`season\\s*0*${season}\\b`, 'i');
    for (let i = 0; i < results.length; i++) {
      const item = results[i];
      if (!item || !item.title) continue;
      if (seasonRegex.test(item.title)) {
        const score = getScore(item) + 10;
        if (score > highestScore) {
          highestScore = score;
          bestMatch = item;
        }
      }
    }
    if (bestMatch) return bestMatch;
  }

  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    if (!item || !item.title) continue;
    const score = getScore(item);
    if (score > highestScore) {
      highestScore = score;
      bestMatch = item;
    }
  }

  return highestScore >= 3 ? bestMatch : null;
}

function extractMovieQualities(html) {
  if (!html) return [];
  const qualities = [];
  const parts = html.split('dlbtn-container');
  
  for (let i = 1; i < parts.length; i++) {
    const current = parts[i];
    const prev = parts[i - 1];
    
    const linkMatch = current.match(/href="(?:https?:\/\/[^"]*?)?\/generate\.php\?id=([a-zA-Z0-9+/=]+)"/);
    if (!linkMatch) continue;
    
    const encodedId = linkMatch[1];
    const decodedUrl = decodeGenerateUrl(encodedId);
    if (!decodedUrl || decodedUrl.indexOf('/f/') === -1) continue;
    
    let label = '';
    let labelMatch = prev.match(/<\/span>\s*([^<]*?(?:2160|1080|720|480|4K)[^<]*?\[[^\]]+\])/i);
    if (!labelMatch) labelMatch = prev.match(/<\/span>\s*([^<]*?(?:2160|1080|720|480|4K)[^<]*?)\s*\[/i);
    
    if (labelMatch) label = labelMatch[1].trim();
    
    if (!label) {
      labelMatch = prev.match(/\b(?:4K\s*2160p|UHD|2160p|1080p|720p|480p)\b/i);
      if (labelMatch) label = labelMatch[0];
    }
    
    if (!label) label = decodedUrl;
    
    const quality = parseQuality(label);
    
    let exists = false;
    for (let j = 0; j < qualities.length; j++) {
      if (qualities[j].decodedUrl === decodedUrl) {
        exists = true;
        break;
      }
    }
    
    if (!exists) {
      qualities.push({ encodedId, decodedUrl, label, quality });
    }
  }
  return qualities;
}

function extractAllGenerateLinks(html) {
  if (!html) return [];
  const links = [];
  let pos = 0;
  const searchStr = '/generate.php?id=';
  
  while (true) {
    const idx = html.indexOf(searchStr, pos);
    if (idx === -1) break;
    
    const startQuote = html.lastIndexOf('"', idx);
    if (startQuote === -1 || startQuote < pos) {
      pos = idx + 1;
      continue;
    }
    
    const endA = html.indexOf('</a>', idx);
    if (endA === -1) {
      pos = idx + 1;
      continue;
    }
    
    const endQuote = html.indexOf('"', idx);
    if (endQuote === -1) {
      pos = endA + 4;
      continue;
    }
    
    const encodedId = html.substring(idx + searchStr.length, endQuote);
    const decodedUrl = decodeGenerateUrl(encodedId);
    
    links.push({
      encodedId,
      decodedUrl: decodedUrl || '',
      label: 'Episode Link'
    });
    
    pos = endA + 4;
  }
  return links;
}

function extractEpisodeQualities(html, episodeNum) {
  if (!html) return [];
  const parts = html.split('accordion-item');
  let targetPart = null;
  
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const epMatch = part.match(/episode-badge[^>]*>Episode\s*(\d+)/i);
    if (!epMatch) continue;
    
    if (parseInt(epMatch[1], 10) === episodeNum) {
      targetPart = part;
      break;
    }
  }
  
  if (!targetPart) return [];
  
  const links = extractAllGenerateLinks(targetPart);
  const qualities = [];
  
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    if (!link.decodedUrl || link.decodedUrl.indexOf('/f/') === -1) continue;
    
    const quality = parseQuality(link.decodedUrl);
    let exists = false;
    for (let j = 0; j < qualities.length; j++) {
      if (qualities[j].decodedUrl === link.decodedUrl) {
        exists = true;
        break;
      }
    }
    
    if (!exists) {
      qualities.push({
        encodedId: link.encodedId,
        decodedUrl: link.decodedUrl,
        label: quality,
        quality: quality
      });
    }
  }
  return qualities;
}

function filterQualities(qualities) {
  if (!qualities || !qualities.length) return [];
  const filtered = [];
  for (let i = 0; i < qualities.length; i++) {
    const q = qualities[i];
    if (q.quality === '480p' || q.quality === 'SD') continue;
    filtered.push(q);
  }
  
  const rank = { '4K': 0, '2160p': 0, '1080p': 1, '720p': 2, 'HD': 3 };
  return filtered.sort((a, b) => {
    const rankA = rank[a.quality] !== undefined ? rank[a.quality] : 99;
    const rankB = rank[b.quality] !== undefined ? rank[b.quality] : 99;
    return rankA - rankB;
  });
}

function extractHash(url) {
  if (!url) return '';
  const idx1 = url.indexOf('/f/');
  const idx2 = url.indexOf('/v/');
  const start = idx1 >= 0 ? idx1 + 3 : (idx2 >= 0 ? idx2 + 3 : -1);
  if (start < 0) return '';
  return url.substring(start);
}

async function resolveFslUrl(url, userAgent) {
  if (!url) return null;
  const hash = extractHash(url);
  if (!hash) return null;
  
  const cinecloudUrl = `${CINECLOUD_BASE}/f/${hash}`;
  const html = await fetchText(cinecloudUrl, userAgent);
  if (!html) return null;
  
  return extractFslUrl(html);
}

async function getStreams(tmdbId, type, season, episode) {
  try {
    const isTv = type === 'tv' || type === 'series';
    const userAgent = MOBILE_UAS[0];
    
    const tmdbInfo = await getTMDBInfo(tmdbId, type, userAgent);
    if (!tmdbInfo || !tmdbInfo.title) return [];
    
    const targetSeason = isTv ? parseInt(season, 10) || 1 : null;
    let searchResults = await searchCinefreak(tmdbInfo.title, userAgent);
    
    if (!searchResults || searchResults.length < 3) {
      const extendedResults = await searchCinefreak(`${tmdbInfo.title} ${tmdbInfo.year}`, userAgent);
      if (extendedResults && extendedResults.length) {
        searchResults = extendedResults;
      }
    }
    
    if (!searchResults || !searchResults.length) return [];
    
    const match = matchByTitleYear(tmdbInfo.title, tmdbInfo.year, searchResults, targetSeason);
    if (!match) return [];
    
    let postUrl = match.url;
    if (!postUrl.startsWith('http')) {
      postUrl = postUrl.startsWith('/') ? BASE_URL + postUrl : BASE_URL + '/' + postUrl;
    }
    
    const postHtml = await fetchText(postUrl, userAgent);
    if (!postHtml) return [];
    
    let qualities = [];
    if (isTv) {
      const targetEpisode = parseInt(episode, 10) || 1;
      qualities = extractEpisodeQualities(postHtml, targetEpisode);
    } else {
      qualities = extractMovieQualities(postHtml);
    }
    
    if (!qualities || !qualities.length) return [];
    
    const filteredQualities = filterQualities(qualities);
    if (!filteredQualities.length) return [];
    
    const finalStreams = [];
    for (let i = 0; i < filteredQualities.length; i++) {
      const q = filteredQualities[i];
      const directUrl = await resolveFslUrl(q.decodedUrl, userAgent);
      
      if (directUrl) {
        finalStreams.push({
          name: PROVIDER_NAME,
          title: `${tmdbInfo.title}\n${q.quality} | CineFreak`,
          url: directUrl,
          quality: q.quality,
          headers: {
            'Referer': CINECLOUD_BASE + '/',
            'User-Agent': userAgent
          }
        });
      }
    }
    
    return finalStreams;
  } catch (e) {
    return [];
  }
}

module.exports = { getStreams };
