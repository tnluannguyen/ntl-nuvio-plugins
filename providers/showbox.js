const cheerio = require("cheerio");
const CryptoJS = require("crypto-js");

const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const DEFAULT_API_BASE = "https://id-mapping-api-showbox-proxy.hf.space/api/media";

const WORKING_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Content-Type": "application/json"
};

function getQualityFromName(qualityStr) {
  if (!qualityStr) return "Unknown";
  const quality = qualityStr.toUpperCase();
  if (quality === "ORG" || quality === "ORIGINAL") return "Original";
  if (quality === "4K" || quality === "2160P") return "4K";
  if (quality === "1440P" || quality === "2K") return "1440p";
  if (quality === "1080P" || quality === "FHD") return "1080p";
  if (quality === "720P" || quality === "HD") return "720p";
  if (quality === "480P" || quality === "SD") return "480p";
  if (quality === "360P") return "360p";
  if (quality === "240P") return "240p";
  const match = qualityStr.match(/(\d{3,4})[pP]?/);
  if (match) {
    const resolution = parseInt(match[1]);
    if (resolution >= 2160) return "4K";
    if (resolution >= 1440) return "1440p";
    if (resolution >= 1080) return "1080p";
    if (resolution >= 720) return "720p";
    if (resolution >= 480) return "480p";
    if (resolution >= 360) return "360p";
    return "240p";
  }
  return "Unknown";
}

function formatFileSize(sizeStr) {
  if (!sizeStr) return "Unknown";
  if (typeof sizeStr === "string" && (sizeStr.includes("GB") || sizeStr.includes("MB") || sizeStr.includes("KB"))) {
    return sizeStr;
  }
  if (typeof sizeStr === "number") {
    const gb = sizeStr / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = sizeStr / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  }
  return sizeStr;
}

async function getTMDBDetails(tmdbId, mediaType) {
  const endpoint = mediaType === "tv" ? "tv" : "movie";
  const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const title = mediaType === "tv" ? data.name : data.title;
    const releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
    const year = releaseDate ? parseInt(releaseDate.split("-")[0]) : null;
    return { title, year };
  } catch (e) {
    console.log(`[ShowBox] Lỗi lấy thông tin TMDB: ${e.message}`);
    return { title: `TMDB ID ${tmdbId}`, year: null };
  }
}

async function extractFebBoxShare(showboxId, mediaType, seasonNum, episodeNum, uiToken) {
  const streams = [];
  try {
    const boxType = mediaType === "tv" ? 2 : 1;
    const sharePageUrl = `https://www.febbox.com/mbp/to_share_page?box_type=${boxType}&mid=${showboxId}&json=1`;
    console.log(`[ShowBox] Đang yêu cầu link share FebBox: ${sharePageUrl}`);
    
    const formattedCookie = uiToken.startsWith("ui=") ? uiToken : `ui=${uiToken}`;
    const febboxHeaders = {
      ...WORKING_HEADERS,
      "Cookie": formattedCookie,
      "Referer": "https://www.febbox.com/"
    };
    
    let shareRes;
    try {
      const res = await fetch(sharePageUrl, { headers: febboxHeaders });
      const text = await res.text();
      shareRes = JSON.parse(text);
    } catch (e) {
      console.log(`[ShowBox] 🚨 Lỗi parse JSON từ FebBox (Có thể bị Cloudflare chặn hoặc Cookie sai).`);
      return [];
    }

    if (!shareRes || shareRes.code !== 1 || !shareRes.data) {
      console.log(`[ShowBox] Không tìm thấy link share FebBox cho ShowBox ID: ${showboxId}`);
      return [];
    }
    
    const shareLink = shareRes.data.share_link || shareRes.data.shareLink;
    if (!shareLink) return [];
    
    const shareKey = shareLink.split("/").pop();
    console.log(`[ShowBox] Đã phân giải Share Key: ${shareKey}`);
    
    const listUrl = `https://www.febbox.com/file/file_share_list?share_key=${shareKey}`;
    let listRes;
    try {
      const res = await fetch(listUrl, { headers: febboxHeaders });
      const text = await res.text();
      listRes = JSON.parse(text);
    } catch (e) {
      console.log(`[ShowBox] 🚨 Lỗi parse JSON danh sách file.`);
      return [];
    }
    
    if (!listRes || listRes.code !== 1 || !listRes.data || !listRes.data.file_list) {
      console.log(`[ShowBox] Lỗi lấy danh sách file cho Share Key: ${shareKey}`);
      return [];
    }
    
    let fids = [];
    if (mediaType === "movie") {
      fids = listRes.data.file_list;
    } else {
      const seasonName = `season ${seasonNum}`;
      const seasonFolder = listRes.data.file_list.find((f) => f.file_name && f.file_name.toLowerCase() === seasonName);
      if (!seasonFolder) {
        console.log(`[ShowBox] Không tìm thấy thư mục Season: ${seasonName}`);
        return [];
      }
      const seasonListUrl = `https://www.febbox.com/file/file_share_list?share_key=${shareKey}&parent_id=${seasonFolder.fid}&page=1`;
      let seasonRes;
      try {
        const res = await fetch(seasonListUrl, { headers: febboxHeaders });
        const text = await res.text();
        seasonRes = JSON.parse(text);
      } catch (e) {
        console.log(`[ShowBox] 🚨 Lỗi parse JSON danh sách tập.`);
        return [];
      }

      if (!seasonRes || seasonRes.code !== 1 || !seasonRes.data || !seasonRes.data.file_list) {
        console.log(`[ShowBox] Lỗi lấy danh sách tập trong thư mục Season.`);
        return [];
      }
      const seasonSlug = String(seasonNum).padStart(2, "0");
      const episodeSlug = String(episodeNum).padStart(2, "0");
      fids = seasonRes.data.file_list.filter(
        (f) => f.file_name && (f.file_name.toLowerCase().includes(`s${seasonSlug}e${episodeSlug}`) || f.file_name.toLowerCase().includes(`s${seasonNum}e${episodeNum}`))
      );
    }
    
    console.log(`[ShowBox] Tìm thấy ${fids.length} file khớp trong FebBox share.`);
    
    // ĐÃ SỬA: Xóa Range: bytes=0- và thêm Cookie vào videoHeaders
    const videoHeaders = {
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.8",
      "Connection": "keep-alive",
      "Referer": "https://www.febbox.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      "Cookie": formattedCookie
    };
    
    for (const file of fids) {
      const qualityUrl = `https://www.febbox.com/console/video_quality_list?fid=${file.fid}&share_key=${shareKey}`;
      console.log(`[ShowBox] Đang lấy danh sách chất lượng cho file: ${file.file_name}`);
      
      const qualityRes = await fetch(qualityUrl, {
        headers: febboxHeaders
      }).then((res) => res.json()).catch(() => null);
      
      if (!qualityRes || !qualityRes.html) {
        console.log(`[ShowBox] 🚨 CẢNH BÁO: Không lấy được luồng video! Cookie (uiToken) của FebBox có thể đã HẾT HẠN hoặc KHÔNG HỢP LỆ. Vui lòng cập nhật lại biến SHOWBOX_TOKEN.`);
        continue;
      }
      
      const $ = cheerio.load(qualityRes.html);
      $("div.file_quality").each((i, el) => {
        const $quality = $(el);
        const streamUrl = $quality.attr("data-url");
        const qualityLabel = $quality.attr("data-quality");
        const sizeText = $quality.find(".size").text().trim();
        if (streamUrl) {
          const normalizedQuality = getQualityFromName(qualityLabel);
          streams.push({
            name: `ShowBox [${normalizedQuality}]`,
            title: file.file_name,
            url: streamUrl,
            quality: normalizedQuality,
            size: sizeText || file.file_size || "Unknown",
            headers: videoHeaders
          });
          console.log(`[ShowBox] Đã trích xuất luồng FebBox: ${normalizedQuality} (${sizeText})`);
        }
      });
    }
  } catch (e) {
    console.error(`[ShowBox] Lỗi trích xuất FebBox share: ${e.message}`);
  }
  return streams;
}

function processShowBoxResponse(data, mediaInfo, mediaType, seasonNum, episodeNum) {
  const streams = [];
  try {
    if (!data || !data.success) return streams;
    if (!data.versions || !Array.isArray(data.versions) || data.versions.length === 0) return streams;
    
    let streamTitle = mediaInfo.title || "Unknown Title";
    if (mediaInfo.year) streamTitle += ` (${mediaInfo.year})`;
    if (mediaType === "tv" && seasonNum && episodeNum) {
      streamTitle = `${mediaInfo.title || "Unknown"} S${String(seasonNum).padStart(2, "0")}E${String(episodeNum).padStart(2, "0")}`;
      if (mediaInfo.year) streamTitle += ` (${mediaInfo.year})`;
    }
    
    data.versions.forEach(function(version, versionIndex) {
      const versionSize = version.size || "Unknown";
      if (version.links && Array.isArray(version.links)) {
        version.links.forEach(function(link) {
          if (!link.url) return;
          const normalizedQuality = getQualityFromName(link.quality || "Unknown");
          const linkSize = link.size || versionSize;
          let streamName = "ShowBox";
          if (data.versions.length > 1) streamName += ` V${versionIndex + 1}`;
          
          streams.push({
            name: streamName,
            title: streamTitle,
            url: link.url,
            quality: normalizedQuality,
            size: formatFileSize(linkSize)
          });
        });
      }
    });
  } catch (error) {
    console.error(`[ShowBox] Lỗi xử lý response: ${error.message}`);
  }
  return streams;
}

async function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null, payload) {
  console.log(`[ShowBox] Bắt đầu cào dữ liệu cho TMDB ID: ${tmdbId}, Type: ${mediaType}`);
  
  const uiToken = payload.showboxToken;
  if (!uiToken) {
    console.error("[ShowBox] 🚨 LỖI: Không tìm thấy SHOWBOX_TOKEN trong biến môi trường. Vui lòng cấu hình trong file .env!");
    return [];
  }

  const apiBase = DEFAULT_API_BASE;

  try {
    const mediaInfo = await getTMDBDetails(tmdbId, mediaType);
    let proxyUrl;
    if (mediaType === "tv" && seasonNum && episodeNum) {
      proxyUrl = `${apiBase}/tv/${tmdbId}/${seasonNum}/${episodeNum}?cookie=${encodeURIComponent(uiToken)}`;
    } else {
      proxyUrl = `${apiBase}/movie/${tmdbId}?cookie=${encodeURIComponent(uiToken)}`;
    }
    
    console.log(`[ShowBox] Đang truy vấn Proxy API: ${proxyUrl}`);
    let showboxId = null;
    let streams = [];
    
    try {
      const response = await fetch(proxyUrl, { headers: WORKING_HEADERS });
      if (response.ok) {
        const data = await response.json();
        streams = processShowBoxResponse(data, mediaInfo, mediaType, seasonNum, episodeNum);
        if (data.id || data.mid) {
          showboxId = data.id || data.mid;
        } else if (data.data && (data.data.id || data.data.mid)) {
          showboxId = data.data.id || data.data.mid;
        }
      }
    } catch (e) {
      console.log(`[ShowBox] Lỗi kết nối Proxy server: ${e.message}`);
    }
    
    if (showboxId) {
      console.log(`[ShowBox] Đang phân giải luồng trực tiếp từ FebBox cho ShowBox ID: ${showboxId}`);
      const directStreams = await extractFebBoxShare(showboxId, mediaType, seasonNum, episodeNum, uiToken);
      if (directStreams.length > 0) {
        streams = streams.concat(directStreams);
      }
    }
    
    if (streams.length === 0) {
      console.log(`[ShowBox] Không tìm thấy luồng nào.`);
      return [];
    }
    
    streams.sort(function(a, b) {
      const qualityOrder = { "Original": 6, "4K": 5, "1440p": 4, "1080p": 3, "720p": 2, "480p": 1, "360p": 0, "240p": -1, "Unknown": -2 };
      return (qualityOrder[b.quality] || -2) - (qualityOrder[a.quality] || -2);
    });
    
    console.log(`[ShowBox] Tổng cộng tìm thấy: ${streams.length} streams.`);
    return streams;
  } catch (error) {
    console.error(`[ShowBox] Lỗi nghiêm trọng khi chạy scraper: ${error.message}`);
    return [];
  }
}

module.exports = { getStreams };
