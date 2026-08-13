const CryptoJS = require("crypto-js");

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const CASTLE_BASE = "https://api.hlowb.com";
const PKG = "com.external.castle";
const CHANNEL = "IndiaA";
const CLIENT = "1";
const LANG = "en-US";

const API_HEADERS = {
  "User-Agent": "okhttp/4.9.3",
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Connection": "Keep-Alive",
  "Referer": CASTLE_BASE
};

const PLAYBACK_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Accept": "video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
  "Connection": "keep-alive",
  "Sec-Fetch-Dest": "video",
  "Sec-Fetch-Mode": "no-cors",
  "Sec-Fetch-Site": "cross-site",
  "DNT": "1"
};

async function makeRequest(url, options = {}) {
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: { ...API_HEADERS, ...options.headers },
      body: options.body
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
  } catch (error) {
    console.error(`[Castle] Request failed for ${url}: ${error.message}`);
    throw error;
  }
}

async function extractCipherFromResponse(response) {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty response");
  try {
    const json = JSON.parse(trimmed);
    if (json && json.data && typeof json.data === "string") {
      return json.data.trim();
    }
  } catch (e) {}
  return trimmed;
}

function extractDataBlock(obj) {
  if (obj && obj.data && typeof obj.data === "object") return obj.data;
  return obj || {};
}

async function getTMDBDetails(tmdbId, mediaType) {
  const endpoint = mediaType === "tv" ? "tv" : "movie";
  const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
  const response = await makeRequest(url);
  const data = await response.json();
  const title = mediaType === "tv" ? data.name : data.title;
  const releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
  const year = releaseDate ? parseInt(releaseDate.split("-")[0]) : null;
  return { title, year, tmdbId };
}

async function decryptCastle(encryptedB64, securityKeyB64) {
  console.log("[Castle] Bắt đầu giải mã AES-CBC...");
  try {
    const CASTLE_SUFFIX = "T!BgJB";
    const securityKeyWords = CryptoJS.enc.Base64.parse(securityKeyB64);
    const suffixWords = CryptoJS.enc.Utf8.parse(CASTLE_SUFFIX);
    const keyMaterial = securityKeyWords.concat(suffixWords);
    
    let finalKey;
    if (keyMaterial.sigBytes < 16) {
      const padding = CryptoJS.lib.WordArray.create(new Array(16 - keyMaterial.sigBytes).fill(0));
      finalKey = keyMaterial.concat(padding);
    } else if (keyMaterial.sigBytes > 16) {
      finalKey = CryptoJS.lib.WordArray.create(keyMaterial.words.slice(0, 4), 16);
    } else {
      finalKey = keyMaterial;
    }
    
    const iv = finalKey;
    const decrypted = CryptoJS.AES.decrypt(encryptedB64, finalKey, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
    
    const result = decrypted.toString(CryptoJS.enc.Utf8);
    if (!result) throw new Error("Giải mã thất bại (chuỗi rỗng).");
    
    console.log("[Castle] Giải mã thành công.");
    return result;
  } catch (error) {
    console.error(`[Castle] Lỗi giải mã: ${error.message}`);
    throw error;
  }
}

async function getSecurityKey() {
  console.log("[Castle] Đang lấy Security Key...");
  const url = `${CASTLE_BASE}/v0.1/system/getSecurityKey/1?channel=${CHANNEL}&clientType=${CLIENT}&lang=${LANG}`;
  const response = await makeRequest(url);
  const data = await response.json();
  if (data.code !== 200 || !data.data) {
    throw new Error(`Lỗi API Security key: ${JSON.stringify(data)}`);
  }
  console.log("[Castle] Đã lấy được Security Key.");
  return data.data;
}

async function searchCastle(securityKey, keyword, page = 1, size = 30) {
  console.log(`[Castle] Đang tìm kiếm từ khóa: "${keyword}"`);
  const params = new URLSearchParams({
    channel: CHANNEL, clientType: CLIENT, keyword, lang: LANG,
    mode: "1", packageName: PKG, page: page.toString(), size: size.toString()
  });
  const url = `${CASTLE_BASE}/film-api/v1.1.0/movie/searchByKeyword?${params.toString()}`;
  const response = await makeRequest(url);
  const cipher = await extractCipherFromResponse(response);
  const decrypted = await decryptCastle(cipher, securityKey);
  return JSON.parse(decrypted);
}

async function getDetails(securityKey, movieId) {
  console.log(`[Castle] Đang lấy thông tin chi tiết cho MovieID: ${movieId}`);
  const url = `${CASTLE_BASE}/film-api/v1.9.9/movie?channel=${CHANNEL}&clientType=${CLIENT}&lang=${LANG}&movieId=${movieId}&packageName=${PKG}`;
  const response = await makeRequest(url);
  const cipher = await extractCipherFromResponse(response);
  const decrypted = await decryptCastle(cipher, securityKey);
  return JSON.parse(decrypted);
}

async function getVideoV1(securityKey, movieId, episodeId, languageId, resolution = 2) {
  console.log(`[Castle] Đang lấy Video (v1) - MovieID: ${movieId}, LangID: ${languageId}`);
  const url = `${CASTLE_BASE}/film-api/v2.0.1/movie/getVideo2?clientType=${CLIENT}&packageName=${PKG}&channel=${CHANNEL}&lang=${LANG}`;
  const body = {
    mode: "1", appMarket: "GuanWang", clientType: CLIENT, woolUser: "false",
    apkSignKey: "ED0955EB04E67A1D9F3305B95454FED485261475", androidVersion: "13",
    movieId: movieId.toString(), episodeId: episodeId.toString(),
    languageId: languageId.toString(), isNewUser: "true",
    resolution: resolution.toString(), packageName: PKG
  };
  const response = await makeRequest(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const cipher = await extractCipherFromResponse(response);
  const decrypted = await decryptCastle(cipher, securityKey);
  return JSON.parse(decrypted);
}

async function getVideo2(securityKey, movieId, episodeId, resolution = 2) {
  console.log(`[Castle] Đang lấy Video (v2 Shared) - MovieID: ${movieId}, EpID: ${episodeId}`);
  const url = `${CASTLE_BASE}/film-api/v2.0.1/movie/getVideo2?clientType=${CLIENT}&packageName=${PKG}&channel=${CHANNEL}&lang=${LANG}`;
  const body = {
    mode: "1", appMarket: "GuanWang", clientType: CLIENT, woolUser: "false",
    apkSignKey: "ED0955EB04E67A1D9F3305B95454FED485261475", androidVersion: "13",
    movieId: movieId.toString(), episodeId: episodeId.toString(),
    isNewUser: "true", resolution: resolution.toString(), packageName: PKG
  };
  const response = await makeRequest(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const cipher = await extractCipherFromResponse(response);
  const decrypted = await decryptCastle(cipher, securityKey);
  return JSON.parse(decrypted);
}

async function findCastleMovieId(securityKey, tmdbInfo) {
  const searchTerm = tmdbInfo.year ? `${tmdbInfo.title} ${tmdbInfo.year}` : tmdbInfo.title;
  const searchResult = await searchCastle(securityKey, searchTerm);
  const data = extractDataBlock(searchResult);
  const rows = data.rows || [];
  if (rows.length === 0) throw new Error("Không tìm thấy kết quả trên Castle.");
  
  for (const item of rows) {
    const itemTitle = (item.title || item.name || "").toLowerCase();
    const searchTitle = tmdbInfo.title.toLowerCase();
    if (itemTitle.includes(searchTitle) || searchTitle.includes(itemTitle)) {
      const movieId = item.id || item.redirectId || item.redirectIdStr;
      if (movieId) {
        console.log(`[Castle] Tìm thấy khớp: ${item.title || item.name} (ID: ${movieId})`);
        return movieId.toString();
      }
    }
  }
  const firstItem = rows[0];
  const movieId = firstItem.id || firstItem.redirectId || firstItem.redirectIdStr;
  if (movieId) {
    console.log(`[Castle] Dùng kết quả đầu tiên: ${firstItem.title || firstItem.name} (ID: ${movieId})`);
    return movieId.toString();
  }
  throw new Error("Không thể trích xuất Movie ID từ kết quả tìm kiếm.");
}

function getQualityValue(quality) {
  if (!quality) return 0;
  const cleanQuality = quality.toString().toLowerCase().replace(/^(sd|hd|fhd|uhd|4k)\s*/i, "").replace(/p$/, "").trim();
  const qualityMap = { "4k": 2160, "2160": 2160, "1440": 1440, "1080": 1080, "720": 720, "480": 480, "360": 360, "240": 240 };
  if (qualityMap[cleanQuality]) return qualityMap[cleanQuality];
  const numQuality = parseInt(cleanQuality);
  if (!isNaN(numQuality) && numQuality > 0) return numQuality;
  return 0;
}

function formatSize(sizeValue) {
  if (typeof sizeValue !== "number" || sizeValue <= 0) return "Unknown";
  if (sizeValue > 1e9) return `${(sizeValue / 1e9).toFixed(2)} GB`;
  return `${(sizeValue / 1e6).toFixed(0)} MB`;
}

function resolutionToQuality(resolution) {
  const qualityMap = { 1: "480p", 2: "720p", 3: "1080p" };
  return qualityMap[resolution] || `${resolution}p`;
}

function processVideoResponse(videoData, mediaInfo, seasonNum, episodeNum, resolution, languageInfo) {
  const streams = [];
  const data = extractDataBlock(videoData);
  const videoUrl = data.videoUrl;
  if (!videoUrl) {
    console.log("[Castle] Không tìm thấy videoUrl trong response.");
    return streams;
  }

  let mediaTitle = mediaInfo.title || "Unknown";
  if (mediaInfo.year) mediaTitle += ` (${mediaInfo.year})`;
  if (seasonNum && episodeNum) {
    mediaTitle = `${mediaInfo.title} S${String(seasonNum).padStart(2, "0")}E${String(episodeNum).padStart(2, "0")}`;
  }
  const quality = resolutionToQuality(resolution);
  
  if (data.videos && Array.isArray(data.videos)) {
    for (const video of data.videos) {
      let videoQuality = video.resolutionDescription || video.resolution || quality;
      videoQuality = videoQuality.replace(/^(SD|HD|FHD)\s+/i, "");
      const streamName = languageInfo ? `Castle ${languageInfo}` : `Castle`;
      streams.push({
        name: streamName,
        title: mediaTitle,
        url: video.url || videoUrl,
        quality: videoQuality,
        size: formatSize(video.size),
        headers: PLAYBACK_HEADERS
      });
    }
  } else {
    const streamName = languageInfo ? `Castle ${languageInfo}` : `Castle`;
    streams.push({
      name: streamName,
      title: mediaTitle,
      url: videoUrl,
      quality: quality,
      size: formatSize(data.size),
      headers: PLAYBACK_HEADERS
    });
  }
  return streams;
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum, payload) {
  console.log(`[Castle] Bắt đầu tiến trình cào dữ liệu cho TMDB ID: ${tmdbId}, Type: ${mediaType}`);
  try {
    const tmdbInfo = await getTMDBDetails(tmdbId, mediaType);
    console.log(`[Castle] TMDB Info: "${tmdbInfo.title}" (${tmdbInfo.year || "N/A"})`);
    
    const securityKey = await getSecurityKey();
    const movieId = await findCastleMovieId(securityKey, tmdbInfo);
    let details = await getDetails(securityKey, movieId);
    let currentMovieId = movieId;
    
    if (mediaType === "tv" && seasonNum && episodeNum) {
      const data = extractDataBlock(details);
      const seasons = data.seasons || [];
      const season = seasons.find((s) => s.number === seasonNum);
      if (season && season.movieId && season.movieId !== movieId) {
        console.log(`[Castle] Đang lấy chi tiết cho Season ${seasonNum}...`);
        details = await getDetails(securityKey, season.movieId.toString());
        currentMovieId = season.movieId.toString();
      }
    }
    
    const detailsData = extractDataBlock(details);
    const episodes = detailsData.episodes || [];
    let episodeId = null;
    
    if (mediaType === "tv" && seasonNum && episodeNum) {
      const episode = episodes.find((e) => e.number === episodeNum);
      if (episode && episode.id) episodeId = episode.id.toString();
    } else if (episodes.length > 0) {
      episodeId = episodes[0].id.toString();
    }
    
    if (!episodeId) throw new Error("Không tìm thấy Episode ID.");
    
    const episode = episodes.find((e) => e.id.toString() === episodeId);
    const tracks = episode && episode.tracks || [];
    const resolution = 2;
    const allStreams = [];
    
    for (const track of tracks) {
      const langName = track.languageName || track.abbreviate || "Unknown";
      if (track.existIndividualVideo && track.languageId) {
        try {
          console.log(`[Castle] Đang lấy luồng ${langName} (LangID: ${track.languageId})`);
          const videoData = await getVideoV1(securityKey, currentMovieId, episodeId, track.languageId, resolution);
          const langStreams = processVideoResponse(videoData, tmdbInfo, seasonNum, episodeNum, resolution, `[${langName}]`);
          if (langStreams.length > 0) {
            console.log(`[Castle] ✅ ${langName}: Tìm thấy ${langStreams.length} streams.`);
            allStreams.push(...langStreams);
          }
        } catch (error) {
          console.log(`[Castle] ⚠️ ${langName}: Thất bại - ${error.message}`);
        }
      }
    }
    
    if (allStreams.length === 0) {
      console.log("[Castle] Chuyển sang dùng luồng Shared (v2)...");
      const videoData = await getVideo2(securityKey, currentMovieId, episodeId, resolution);
      const sharedStreams = processVideoResponse(videoData, tmdbInfo, seasonNum, episodeNum, resolution, "[Shared]");
      allStreams.push(...sharedStreams);
    }
    
    allStreams.sort((a, b) => getQualityValue(b.quality) - getQualityValue(a.quality));
    console.log(`[Castle] Tổng cộng tìm thấy: ${allStreams.length} streams.`);
    return allStreams;
  } catch (error) {
    console.error(`[Castle] Lỗi nghiêm trọng: ${error.message}`);
    return [];
  }
}

module.exports = { getStreams };