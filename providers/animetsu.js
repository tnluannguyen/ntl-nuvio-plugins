const PROVIDER_NAME = 'Animetsu';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const BASE_URL = 'https://animetsu.vu/api/v2'; // Đổi vị trí api/v2
const PROXY_URL = 'https://swiftstream.top/proxy';

const MOBILE_UAS = [
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
];

function getHeaders(customUa = null) {
  const ua = customUa || MOBILE_UAS[Math.floor(Math.random() * MOBILE_UAS.length)];
  return {
    'User-Agent': ua,
    'Referer': 'https://animetsu.vu/',
    'Origin': 'https://animetsu.vu/',
    'Accept-Language': 'en-US,en;q=0.9'
  };
}

async function fetchJson(url, options = {}, timeout = 12000) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    if (!response.ok) {
      console.log(`[${PROVIDER_NAME}] HTTP ${response.status} tại: ${url}`);
      return null;
    }
    return await response.json();
  } catch (e) {
    console.log(`[${PROVIDER_NAME}] Lỗi Fetch: ${e.message}`);
    return null;
  }
}

async function getAbsoluteEpisode(tmdbId, season, episode) {
  if (season <= 1) return episode;
  try {
    const url = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const data = await fetchJson(url);
    if (data && data.seasons) {
      let total = 0;
      const previousSeasons = data.seasons.filter(s => s.season_number > 0 && s.season_number < season);
      for (const s of previousSeasons) {
        total += s.episode_count;
      }
      return total + episode;
    }
  } catch (e) {}
  return episode;
}

async function makeStream(serverName, epTag, type, url, quality, ua) {
  const headers = getHeaders(ua);
  const isM3u8 = url.includes('.m3u8') || !url.includes('.mp4');
  const finalUrl = isM3u8 ? (url.includes('#ext=') ? url : `${url}#ext=.m3u8`) : url;

  return {
    name: `NTL Global`,
    title: `${epTag}\n🌸 ${PROVIDER_NAME} - ${serverName} | 📺 ${quality} | 🗣️ ${type.toUpperCase()}`,
    url: finalUrl,
    resLabel: quality,
    source: `${PROVIDER_NAME} (${serverName})`,
    headers: headers,
    behaviorHints: {
      proxyHeaders: { request: headers },
      notWebReady: true
    }
  };
}

async function getStreams(tmdbId, mediaType, season, episode, meta) {
  const ua = MOBILE_UAS[0];
  const headers = getHeaders(ua);
  const isSeries = mediaType === 'tv' || mediaType === 'series';
  
  // 1. Lấy thông tin TMDB để có tên phim chuẩn
  const tmdbUrl = `https://api.themoviedb.org/3/${isSeries ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  const tmdbData = await fetchJson(tmdbUrl);
  if (!tmdbData) return [];

  const fullTitle = tmdbData.name || tmdbData.title;
  const searchTitle = fullTitle.split(':')[0].trim();
  
  // 2. Tìm kiếm trên Animetsu (Thử nghiệm 2 loại endpoint để tránh 404)
  let searchData = null;
  const searchPaths = [
    `${BASE_URL}/search?query=`,
    `https://animetsu.vu/v2/api/search?query=`
  ];

  for (const path of searchPaths) {
    console.log(`[${PROVIDER_NAME}] Đang thử tìm kiếm tại: ${path}${encodeURIComponent(searchTitle)}`);
    searchData = await fetchJson(`${path}${encodeURIComponent(searchTitle)}`, { headers });
    if (searchData && searchData.results && searchData.results.length > 0) break;
  }

  if (!searchData || !searchData.results || searchData.results.length === 0) {
    console.log(`[${PROVIDER_NAME}] Không tìm thấy phim trên hệ thống.`);
    return [];
  }

  // 3. Khớp phim thông minh sử dụng ID từ DB (anilistId)
  let matchedAnime = null;
  const targetAniId = meta?.anilistId;

  if (targetAniId) {
    const aniRegex = new RegExp(`/${targetAniId}[-.]`);
    matchedAnime = searchData.results.find(r => 
      aniRegex.test(r.cover_image?.large || '') || 
      aniRegex.test(r.banner || '')
    );
    if (matchedAnime) console.log(`[${PROVIDER_NAME}] Đã khớp phim qua AniList ID: ${targetAniId}`);
  }

  if (!matchedAnime) {
    matchedAnime = searchData.results[0];
    console.log(`[${PROVIDER_NAME}] Không khớp được ID, chọn kết quả đầu tiên: ${matchedAnime.id}`);
  }

  // 4. Tính toán tập phim và lấy link
  const targetEp = isSeries ? await getAbsoluteEpisode(tmdbId, season, episode) : 1;
  const epTag = isSeries ? `${fullTitle} (Phần ${season})\nTập ${String(episode).padStart(2, '0')}` : fullTitle;

  const streams = [];
  const servers = ['kite', 'dio'];
  const types = ['sub', 'dub', 'raw'];

  for (const srv of servers) {
    for (const type of types) {
      // Endpoint lấy link stream (oppai)
      const apiStreamUrl = `https://animetsu.vu/api/v2/anime/oppai/${matchedAnime.id}/${targetEp}?server=${srv}&source_type=${type}`;
      const streamData = await fetchJson(apiStreamUrl, { headers });
      
      if (streamData && streamData.sources) {
        for (const source of streamData.sources) {
          if (source.url) {
            const stream = await makeStream(
              srv.charAt(0).toUpperCase() + srv.slice(1),
              epTag,
              type,
              PROXY_URL + source.url,
              source.quality || '1080p',
              ua
            );
            streams.push(stream);
          }
        }
      }
    }
  }

  console.log(`[${PROVIDER_NAME}] Trả về ${streams.length} nguồn phát.`);
  return streams;
}

module.exports = { getStreams };
