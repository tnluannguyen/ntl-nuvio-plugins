const CryptoJS = require("crypto-js");

const BASE_URL = "https://app.cloud-mb.xyz";
const TOKEN = "jdvhhjv255vghhghdhvfch2565656jhdcghfdf";
const APP_ID = "com.movieblast";
const HEADERS = {
  "user-agent": "okhttp/5.0.0-alpha.6",
  "x-request-x": APP_ID
};
const SEARCH_HEADERS = Object.assign({}, HEADERS, {
  "hash256": "86dc03244adddb3cbedbf0ae36074a736ee293a64774b18e82a6244eafd0df30",
  "packagename": APP_ID
});
const SIGN_SECRET = "GJ8reydarI7Jqat9rvbAJKNQ9gY4DoEQF2H5nfuI1gi";
const TMDB_API_KEY = "ca1f881d0bd7bbf9cb3170edd54b52d5";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

function generateSignedUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    const path = url.pathname;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const hash = CryptoJS.HmacSHA256(path + timestamp, SIGN_SECRET);
    const signature = CryptoJS.enc.Base64.stringify(hash);
    const encodedSignature = encodeURIComponent(signature);
    const finalUrl = `${urlStr}?verify=${timestamp}-${encodedSignature}`;
    console.log("[MovieBlast] Generated signed URL: " + finalUrl);
    return finalUrl;
  } catch (e) {
    console.log("[MovieBlast] Error generating signed URL: " + e.message);
    return urlStr;
  }
}

function matchQuality(s) {
  if (!s) return "Unknown";
  const v = s.toLowerCase();
  if (v.includes("2160") || v.includes("4k")) return "4K";
  if (v.includes("1440")) return "2K";
  if (v.includes("1080")) return "1080p";
  if (v.includes("720")) return "720p";
  if (v.includes("480")) return "480p";
  if (v.includes("360")) return "360p";
  return "Unknown";
}

function normalizeTitle(title) {
  if (!title) return "";
  return title.toLowerCase().replace(/\b(the|a|an)\b/g, "").replace(/[:\-_]/g, " ").replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim();
}

async function getTMDBDetails(tmdbId, mediaType) {
  const endpoint = mediaType === "tv" ? "tv" : "movie";
  const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  console.log("[MovieBlast] Fetching TMDB URL: " + url);
  const response = await fetch(url, {
    method: "GET",
    headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
  });
  if (!response.ok) throw new Error(`TMDB API error: ${response.status}`);
  const data = await response.json();
  const title = mediaType === "tv" ? data.name : data.title;
  const releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
  const year = releaseDate ? parseInt(releaseDate.split("-")[0]) : null;
  return { title, year };
}

function calculateTitleSimilarity(title1, title2) {
  const norm1 = normalizeTitle(title1);
  const norm2 = normalizeTitle(title2);
  if (norm1 === norm2) return 1;
  const words1 = norm1.split(/\s+/).filter((w) => w.length > 0);
  const words2 = norm2.split(/\s+/).filter((w) => w.length > 0);
  if (words1.length === 0 || words2.length === 0) return 0;
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  const intersection = words1.filter((w) => set2.has(w));
  const union = new Set([...words1, ...words2]);
  return intersection.length / union.size;
}

function findBestMatch(mediaInfo, searchResults) {
  if (!searchResults || searchResults.length === 0) return null;
  let bestMatch = null;
  let bestScore = 0;
  for (const result of searchResults) {
    let score = calculateTitleSimilarity(mediaInfo.title, result.name);
    if (mediaInfo.year && result.release_date) {
      const resultYear = parseInt(result.release_date.split("-")[0]);
      if (mediaInfo.year === resultYear) score += 0.2;
    }
    if (score > bestScore && score > 0.4) {
      bestScore = score;
      bestMatch = result;
    }
  }
  return bestMatch;
}

async function getStreams(tmdbId, mediaType = "movie", season = null, episode = null) {
  console.log(`[MovieBlast] getStreams called. TMDB: ${tmdbId} | Type: ${mediaType} | S${season}E${episode}`);
  try {
    const mediaInfo = await getTMDBDetails(tmdbId, mediaType);
    const safeQuery = encodeURIComponent(mediaInfo.title);
    const searchUrl = `${BASE_URL}/api/search/${safeQuery}/${TOKEN}`;
    
    const searchRes = await fetch(searchUrl, { headers: SEARCH_HEADERS });
    if (!searchRes.ok) return [];
    
    const searchData = await searchRes.json();
    const searchResults = searchData.search || [];
    
    const match = findBestMatch(mediaInfo, searchResults);
    if (!match) return [];
    
    const internalId = match.id;
    const isSeries = match.type.toLowerCase().includes("serie") || mediaType === "tv";
    
    const detailPath = isSeries ? "series/show" : "media/detail";
    const detailUrl = `${BASE_URL}/api/${detailPath}/${internalId}/${TOKEN}`;
    
    const detailRes = await fetch(detailUrl, { headers: HEADERS });
    if (!detailRes.ok) return [];
    
    const detailData = await detailRes.json();
    let targetVideos = [];
    
    if (isSeries) {
      const seasons = detailData.seasons || [];
      const targetSeason = seasons.find((s) => s.season_number == season);
      if (targetSeason) {
        const targetEpisode = (targetSeason.episodes || []).find((e) => e.episode_number == episode);
        if (targetEpisode) {
          targetVideos = targetEpisode.videos || [];
        }
      }
    } else {
      targetVideos = detailData.videos || [];
    }
    
    if (targetVideos.length === 0) return [];
    
    const streams = targetVideos.map((vid) => {
      const rawUrl = vid.link;
      if (!rawUrl) return null;
      const httpsUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
      const signedUrl = generateSignedUrl(httpsUrl);
      return {
        name: "MovieBlast",
        title: `MovieBlast - ${vid.server} (${vid.lang || "EN"})`,
        url: signedUrl,
        quality: matchQuality(vid.server),
        headers: {
          "Accept-Encoding": "identity",
          "Connection": "Keep-Alive",
          "Icy-MetaData": "1",
          "Referer": "MovieBlast",
          "User-Agent": "MovieBlast",
          "x-request-x": "com.movieblast"
        },
        provider: "movieblast"
      };
    }).filter((s) => s !== null);
    
    return streams;
  } catch (error) {
    console.log(`[MovieBlast] Global Error: ${error.message}`);
    return [];
  }
}

module.exports = { getStreams };
