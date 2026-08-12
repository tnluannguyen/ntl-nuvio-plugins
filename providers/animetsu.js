const PROVIDER_NAME = 'AniNeko';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const BASE_URL = 'https://anineko.to';
const PROXY_URL = 'https://swiftstream.top/proxy';

function getHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://anineko.to/',
    'X-Requested-With': 'XMLHttpRequest'
  };
}

async function fetchText(url, options = {}, timeout = 10000) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    if (!response.ok) return null;
    return await response.text();
  } catch (e) {
    console.log(`[${PROVIDER_NAME}] Lỗi tải trang: ${e.message}`);
    return null;
  }
}

async function fetchJson(url, options = {}, timeout = 10000) {
  const text = await fetchText(url, options, timeout);
  try { return JSON.parse(text); } catch (e) { return null; }
}

async function getAbsoluteEpisode(tmdbId, season, episode) {
  if (season <= 1) return episode;
  try {
    const url = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const data = await fetchJson(url);
    if (data && data.seasons) {
      let total = 0;
      const previousSeasons = data.seasons.filter(s => s.season_number > 0 && s.season_number < season);
      for (const s of previousSeasons) total += s.episode_count;
      return total + episode;
    }
  } catch (e) {}
  return episode;
}

async function makeStream(serverName, epTag, type, url, quality) {
  const headers = { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://anineko.to/' };
  return {
    name: `NTL Global`,
    title: `${epTag}\n🌸 ${PROVIDER_NAME} - ${serverName} | 📺 ${quality} | 🗣️ ${type.toUpperCase()}`,
    url: url,
    resLabel: quality,
    source: `${PROVIDER_NAME} (${serverName})`,
    headers: headers,
    behaviorHints: { proxyHeaders: { request: headers }, notWebReady: true }
  };
}

async function getStreams(tmdbId, mediaType, season, episode, meta) {
  const headers = getHeaders();
  const isSeries = mediaType === 'tv' || mediaType === 'series';
  
  const tmdbUrl = `https://api.themoviedb.org/3/${isSeries ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  const tmdbData = await fetchJson(tmdbUrl);
  if (!tmdbData) return [];

  const fullTitle = tmdbData.name || tmdbData.title;
  const searchTitle = fullTitle.split(':')[0].trim();
  
  console.log(`[${PROVIDER_NAME}] Đang tìm kiếm: ${searchTitle}`);
  const searchUrl = `${BASE_URL}/ajax/search?q=${encodeURIComponent(searchTitle)}`;
  const htmlResult = await fetchText(searchUrl, { headers });

  if (!htmlResult) {
    console.log(`[${PROVIDER_NAME}] Không nhận được phản hồi từ server.`);
    return [];
  }

  // Bóc tách ID từ HTML bằng Regex
  // Tìm các đoạn có dạng data-id="123" hoặc href="/anime/ten-phim-123"
  const idMatches = [...htmlResult.matchAll(/data-id="(\d+)"/g)].map(m => m[1]);
  const slugMatches = [...htmlResult.matchAll(/\/anime\/[^"-]+-(\d+)/g)].map(m => m[1]);
  
  const allIds = [...new Set([...idMatches, ...slugMatches])];

  if (allIds.length === 0) {
    console.log(`[${PROVIDER_NAME}] Không tìm thấy ID phim trong kết quả tìm kiếm.`);
    return [];
  }

  // Tạm thời chọn ID đầu tiên tìm thấy
  const matchedId = allIds[0];
  console.log(`[${PROVIDER_NAME}] Đã tìm thấy ID: ${matchedId}`);

  const targetEp = isSeries ? await getAbsoluteEpisode(tmdbId, season, episode) : 1;
  const epTag = isSeries ? `${fullTitle} (Phần ${season})\nTập ${String(episode).padStart(2, '0')}` : fullTitle;

  const streams = [];
  const servers = ['kite', 'dio'];
  const types = ['sub', 'dub', 'raw'];

  for (const srv of servers) {
    for (const type of types) {
      const apiStreamUrl = `${BASE_URL}/api/v2/anime/oppai/${matchedId}/${targetEp}?server=${srv}&source_type=${type}`;
      const streamData = await fetchJson(apiStreamUrl, { headers });
      
      if (streamData && streamData.sources) {
        for (const source of streamData.sources) {
          if (source.url) {
            streams.push(await makeStream(
              srv.charAt(0).toUpperCase() + srv.slice(1),
              epTag,
              type,
              PROXY_URL + source.url,
              source.quality || '1080p'
            ));
          }
        }
      }
    }
  }

  console.log(`[${PROVIDER_NAME}] Hoàn tất. Tìm thấy ${streams.length} nguồn.`);
  return streams;
}

module.exports = { getStreams };
