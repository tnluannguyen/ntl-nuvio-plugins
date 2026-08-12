var PROVIDER_NAME = 'AnikotoTV';
var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
var TVDB_API_KEY = '777140fb-de92-440a-aec2-95eb51e2d7ab';
var MOBILE_UAS = [
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
];

function getHeaders(extra) {
  var ua = MOBILE_UAS[Math.floor(Math.random() * MOBILE_UAS.length)];
  var headers = { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9' };
  if (extra) {
    for (var key in extra) {
      headers[key] = extra[key];
    }
  }
  return headers;
}

var _tvdbToken = null;
async function getTvdbToken() {
  if (_tvdbToken) return _tvdbToken;
  try {
    console.log("[" + PROVIDER_NAME + "] Fetching TVDB token...");
    var res = await fetch('https://api4.thetvdb.com/v4/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: TVDB_API_KEY })
    });
    if (res.ok) {
      var data = await res.json();
      if (data && data.data && data.data.token) {
        _tvdbToken = data.data.token;
        console.log("[" + PROVIDER_NAME + "] TVDB token fetched successfully.");
      }
    }
  } catch (e) {
    console.log("[" + PROVIDER_NAME + "] Error fetching TVDB token: " + e.message);
  }
  return _tvdbToken;
}

async function getTMDBTitle(id, type) {
  const mediaType = (type === 'tv' || type === 'series') ? 'tv' : 'movie';
  let url = 'https://api.themoviedb.org/3/' + mediaType + '/' + id + '?api_key=' + TMDB_API_KEY;
  console.log("[" + PROVIDER_NAME + "] Fetching TMDB Title for ID: " + id);

  if (String(id).startsWith('tt')) {
    url = 'https://api.themoviedb.org/3/find/' + id + '?external_source=imdb_id&api_key=' + TMDB_API_KEY;
    try {
      const res = await fetch(url, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (mediaType === 'tv' && data.tv_results && data.tv_results.length > 0) {
          return { title: data.tv_results[0].name, numericId: data.tv_results[0].id };
        } else if (mediaType === 'movie' && data.movie_results && data.movie_results.length > 0) {
          return { title: data.movie_results[0].title, numericId: data.movie_results[0].id };
        }
      }
    } catch (e) {
      console.log("[" + PROVIDER_NAME + "] TMDB Find Error: " + e.message);
    }
    return { title: null, numericId: null };
  }

  try {
    const res = await fetch(url, { headers: getHeaders() });
    if (res.ok) {
      const data = await res.json();
      return { title: mediaType === 'tv' ? data.name : data.title, numericId: id };
    }
  } catch (e) {
    console.log("[" + PROVIDER_NAME + "] TMDB Fetch Error: " + e.message);
  }
  return { title: null, numericId: null };
}

async function getTMDBSeasonName(id, season) {
  const url = 'https://api.themoviedb.org/3/tv/' + id + '/season/' + season + '?api_key=' + TMDB_API_KEY;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      return data.name;
    }
  } catch (e) {}
  return null;
}

async function aniListBridge(search) {
  const query = `
    query ($search: String) {
      Media (search: $search, type: ANIME) {
        id
        idMal
      }
    }
  `;
  try {
    console.log("[" + PROVIDER_NAME + "] Searching AniList for: " + search);
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: Object.assign(getHeaders(), { 'Content-Type': 'application/json', 'Accept': 'application/json' }),
      body: JSON.stringify({ query: query, variables: { search: search } })
    });
    const data = await res.json();
    if (data && data.data && data.data.Media) {
      console.log("[" + PROVIDER_NAME + "] AniList found MAL ID: " + data.data.Media.idMal);
      return { malId: data.data.Media.idMal, aniId: data.data.Media.id, absEp: null };
    }
  } catch (e) {
    console.log("[" + PROVIDER_NAME + "] AniList Error: " + e.message);
  }
  return null;
}

async function getMalId(id, type, season, ep) {
  try {
    let url = 'https://arm.haglund.dev/api/v2/tmdb?id=' + id;
    if (type === 'tv' || type === 'series') url += '&s=' + season + '&e=' + ep;
    console.log("[" + PROVIDER_NAME + "] Fetching ARM mapping: " + url);
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.mal || data.mal_id || data.anilist || data.ani_id) {
        console.log("[" + PROVIDER_NAME + "] ARM mapping successful.");
        return { malId: data.mal || data.mal_id, aniId: data.anilist || data.ani_id, absEp: data.episode || ep };
      }
    }
  } catch (e) {
    console.log("[" + PROVIDER_NAME + "] ARM mapping failed: " + e.message);
  }

  const tmdbData = await getTMDBTitle(id, type);
  let title = tmdbData.title;
  const numericId = tmdbData.numericId;

  if (title) {
    let fallbackTitle = title;
    if ((type === 'tv' || type === 'series') && season > 1 && numericId) {
      const seasonName = await getTMDBSeasonName(numericId, season);
      if (seasonName) {
        if (seasonName.toLowerCase().includes(title.toLowerCase())) {
          title = seasonName;
        } else {
          title = title + ' ' + seasonName;
        }
      } else {
        title = title + ' Season ' + season;
      }
    }
    console.log('[' + PROVIDER_NAME + '] TMDB Title for AniList search: ' + title);
    let aniData = await aniListBridge(title);
    let usedFallback = false;

    if ((!aniData || (aniData && !aniData.malId)) && title !== fallbackTitle) {
      console.log('[' + PROVIDER_NAME + '] Fallback TMDB Title: ' + fallbackTitle);
      aniData = await aniListBridge(fallbackTitle);
      usedFallback = true;
    }

    if (aniData) {
      aniData.absEp = ep;
      aniData.usedFallback = usedFallback;
      aniData.name = tmdbData.title;
      return aniData;
    }
  }
  return null;
}

async function extractHLS(url, domain) {
  try {
    console.log("[" + PROVIDER_NAME + "] Extracting HLS from: " + url);
    const headers = Object.assign(getHeaders(), { 'Referer': 'https://' + domain + '/' });
    const res = await fetch(url, { headers: headers });
    if (!res.ok) {
      console.log("[" + PROVIDER_NAME + "] Failed to fetch embed page, status: " + res.status);
      return null;
    }
    const html = await res.text();
    let dataIdMatch = html.match(/data-id="(\d+)"/);

    if (!dataIdMatch) {
      const iframeMatch = html.match(/<iframe[^>]*src="([^"]+)"/);
      if (iframeMatch) {
        const iframeUrl = iframeMatch[1].startsWith('http') ? iframeMatch[1] : 'https://' + domain + iframeMatch[1];
        console.log("[" + PROVIDER_NAME + "] Found iframe: " + iframeUrl);
        const iframeRes = await fetch(iframeUrl, { headers: headers });
        if (iframeRes.ok) {
          const iframeHtml = await iframeRes.text();
          dataIdMatch = iframeHtml.match(/data-id="(\d+)"/);
        }
      }
    }

    if (!dataIdMatch) {
      console.log("[" + PROVIDER_NAME + "] Could not find data-id.");
      return null;
    }

    const dataId = dataIdMatch[1];
    const sourceUrl = 'https://' + domain + '/stream/getSources?id=' + dataId;
    console.log("[" + PROVIDER_NAME + "] Fetching sources from: " + sourceUrl);
    
    const sourceRes = await fetch(sourceUrl, {
      headers: Object.assign(getHeaders(), { 'X-Requested-With': 'XMLHttpRequest', 'Referer': url })
    });

    if (!sourceRes.ok) {
      console.log("[" + PROVIDER_NAME + "] Failed to fetch sources, status: " + sourceRes.status);
      return null;
    }

    const sourceData = await sourceRes.json();
    if (sourceData.sources && sourceData.sources.file) {
      var quality = '1080p';
      try {
        const m3u8Res = await fetch(sourceData.sources.file, { headers: { 'Referer': 'https://' + domain + '/' } });
        if (m3u8Res.ok) {
          const m3u8Text = await m3u8Res.text();
          var resMatch = m3u8Text.match(/RESOLUTION=\d+x(\d+)/);
          if (resMatch) quality = resMatch[1] + 'p';
        }
      } catch (e) {
        console.log("[" + PROVIDER_NAME + "] Error parsing m3u8 for quality: " + e.message);
      }
      
      console.log("[" + PROVIDER_NAME + "] Successfully extracted m3u8: " + sourceData.sources.file);
      return {
        url: sourceData.sources.file,
        quality: quality,
        headers: { 'Referer': 'https://' + domain + '/', 'Origin': 'https://' + domain }
      };
    }
  } catch (e) {
    console.error('[' + PROVIDER_NAME + '] Extractor Error for ' + domain + ':', e.message);
  }
  return null;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) return null;
  return await res.json();
}

async function getAbsoluteEpisode(id, type, season, ep, name) {
  if (type === 'movie') return 1;
  let absEp = ep;
  let imdbId = null;
  let tvdbId = null;

  try {
    const extIds = await fetchJson('https://api.themoviedb.org/3/tv/' + id + '/external_ids?api_key=' + TMDB_API_KEY);
    if (extIds) {
      imdbId = extIds.imdb_id;
      tvdbId = extIds.tvdb_id;
    }
  } catch (e) {}

  if (!tvdbId && name) {
    try {
      console.log('[' + PROVIDER_NAME + '] Searching TVDB for series: ' + name);
      const token = await getTvdbToken();
      if (token) {
        const searchRes = await fetchJson('https://api4.thetvdb.com/v4/search?query=' + encodeURIComponent(name), { headers: { 'Authorization': 'Bearer ' + token } });
        if (searchRes && searchRes.data) {
          const series = searchRes.data.find(s => s.type === 'series');
          if (series) {
            const foundId = series.id || series.tvdb_id;
            if (foundId) {
              tvdbId = parseInt(String(foundId).replace(/^series-/, ''), 10);
              console.log('[' + PROVIDER_NAME + '] Resolved TVDB ID ' + tvdbId + ' from search');
            }
          }
        }
      }
    } catch (e) {}
  }

  if (tvdbId) {
    try {
      console.log('[' + PROVIDER_NAME + '] Attempting TVDB Math for TVDB: ' + tvdbId);
      const token = await getTvdbToken();
      if (token) {
        const epRes = await fetchJson('https://api4.thetvdb.com/v4/series/' + tvdbId + '/episodes/default?season=' + season, { headers: { 'Authorization': 'Bearer ' + token } });
        if (epRes && epRes.data && epRes.data.episodes) {
          const targetEp = epRes.data.episodes.find(e => e.seasonNumber == season && e.number == ep);
          if (targetEp && targetEp.absoluteNumber) {
            console.log('[' + PROVIDER_NAME + '] TVDB Math calculated absolute episode: ' + targetEp.absoluteNumber);
            return targetEp.absoluteNumber;
          }
        }
      }
    } catch (e) {}
  }

  if (imdbId) {
    try {
      console.log('[' + PROVIDER_NAME + '] Attempting Regex Math for IMDB: ' + imdbId);
      const cinemetaUrl = 'https://aiometadata.elfhosted.com/stremio/80d082c4-6e99-4c97-a67d-3d9e242685ce/meta/series/' + imdbId + '.json';
      const res = await fetch(cinemetaUrl);
      if (res.ok) {
        const text = await res.text();
        let prevEps = 0;
        let found = false;
        const regex = /"season"\s*:\s*(\d+)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          found = true;
          const sNum = parseInt(match[1]);
          if (sNum > 0 && sNum < season) {
            prevEps++;
          }
        }
        if (found) {
          let calcEp = prevEps + ep;
          console.log('[' + PROVIDER_NAME + '] Regex Math calculated absolute episode: ' + calcEp);
          return calcEp;
        }
      }
    } catch (e) {}
  }

  try {
    console.log('[' + PROVIDER_NAME + '] Cinemeta failed. Falling back to TMDB math...');
    const tmdbRes = await fetchJson('https://api.themoviedb.org/3/tv/' + id + '?api_key=' + TMDB_API_KEY, {});
    if (tmdbRes && tmdbRes.seasons) {
      let prevEps = 0;
      const pastSeasons = tmdbRes.seasons.filter(s => s.season_number > 0 && s.season_number < season);
      for (let s of pastSeasons) {
        prevEps += s.episode_count;
      }
      prevEps += ep;
      console.log('[' + PROVIDER_NAME + '] TMDB Calculated absolute episode: ' + prevEps);
      return prevEps;
    }
  } catch (e) {}

  return absEp;
}

async function getStreams(id, type, season, ep) {
  try {
    console.log('[' + PROVIDER_NAME + '] Fetching: ' + id + ' S' + season + ' E' + ep);
    const mapping = await getMalId(id, type, season, ep);
    if (!mapping || (!mapping.malId && !mapping.aniId)) {
      console.log('[' + PROVIDER_NAME + '] Exhausted all mapping bridges. Could not resolve ID.');
      return [];
    }

    const isMal = !!mapping.malId;
    const targetId = isMal ? mapping.malId : mapping.aniId;
    const idType = isMal ? 'mal' : 'ani';
    let absEp = type === 'movie' ? 1 : mapping.absEp;

    if (type !== 'movie' && mapping.usedFallback && season > 1) {
      absEp = await getAbsoluteEpisode(id, type, season, ep, mapping.name);
    }

    console.log('[' + PROVIDER_NAME + '] Mapped to ' + idType.toUpperCase() + ' ID: ' + targetId + ' | Ep: ' + absEp);

    const streams = [];
    const servers = [{ id: 'Vidstream', domain: 'megaplay.buzz' }];

    for (const server of servers) {
      const subTypes = ['sub'];
      for (const subType of subTypes) {
        const url = 'https://' + server.domain + '/stream/' + idType + '/' + targetId + '/' + absEp + '/' + subType;
        console.log('[' + PROVIDER_NAME + '] Requesting stream URL: ' + url);
        const hlsData = await extractHLS(url, server.domain);
        if (hlsData) {
          streams.push({
            name: PROVIDER_NAME + ' [' + server.id + ']',
            quality: hlsData.quality || '1080p',
            title: '1080p',
            url: hlsData.url,
            headers: hlsData.headers
          });
        }
      }
    }

    console.log('[' + PROVIDER_NAME + '] Returning ' + streams.length + ' direct stream URLs.');
    return streams;
  } catch (e) {
    console.error('[' + PROVIDER_NAME + '] Fatal Error:', e.message);
    return [];
  }
}

async function search(query) { return []; }
async function getCatalog(args) { return []; }
async function getItemDetails(id) { return []; }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams, search, getCatalog, getItemDetails };
} else {
  global.getStreams = getStreams;
}
