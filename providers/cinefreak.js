const PROVIDER_NAME = 'CineFreak';
const BASE_URL = 'https://cinefreak.nl';
const CINECLOUD_BASE = 'https://cinecloud.pro';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function getStreams(tmdbId, type, season, episode) {
  console.log(`[CineFreak] Bắt đầu lấy stream cho TMDB: ${tmdbId}`);
  try {
    const isTv = type === 'tv' || type === 'series';
    const tmdbUrl = `https://api.themoviedb.org/3/${isTv ? 'tv' : 'movie'}/${tmdbId}?api_key=ca1f881d0bd7bbf9cb3170edd54b52d5`;
    
    const tmdbRes = await fetch(tmdbUrl);
    const tmdbData = await tmdbRes.json();
    const title = tmdbData.name || tmdbData.title;
    if (!title) return [];

    console.log(`[CineFreak] Đang tìm kiếm phim: ${title}`);
    const searchUrl = `${BASE_URL}/wp-json/wp/v2/search?search=${encodeURIComponent(title)}&per_page=5`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    
    if (!searchData || !searchData.length) {
      console.log("[CineFreak] Không tìm thấy bài viết nào trên site.");
      return [];
    }

    const postUrl = searchData[0].url;
    console.log("[CineFreak] Đang truy cập bài viết: " + postUrl);
    const postRes = await fetch(postUrl);
    const postHtml = await postRes.text();

    const regex = /\/generate\.php\?id=([a-zA-Z0-9+/=]+)/g;
    let match;
    const streams = [];

    console.log("[CineFreak] Đang quét link giải mã...");
    while ((match = regex.exec(postHtml)) !== null) {
      try {
        const decoded = atob(match[1]).replace(/newgo32$/, '');
        if (!decoded.includes('/f/')) continue;
        
        const hash = decoded.split('/').pop();
        console.log("[CineFreak] Đang giải mã hash: " + hash);
        const finalUrlRes = await fetch(`${CINECLOUD_BASE}/f/${hash}`);
        const finalHtml = await finalUrlRes.text();
        const directUrlMatch = finalHtml.match(/window\.location\.href="([^"]+)"/);
        
        if (directUrlMatch) {
          const directUrl = directUrlMatch[1].replace(/&amp;/g, '&');
          console.log("[CineFreak] Đã lấy được link trực tiếp.");
          streams.push({
            name: PROVIDER_NAME,
            url: directUrl,
            quality: decoded.includes('2160') ? '4K' : '1080p'
          });
        }
      } catch (e) {
        console.log("[CineFreak] Lỗi khi giải mã link: " + e.message);
      }
    }
    
    console.log(`[CineFreak] Hoàn tất, tìm thấy ${streams.length} nguồn.`);
    return streams;
  } catch (e) {
    console.log("[CineFreak] Lỗi hệ thống: " + e.message);
    return [];
  }
}

module.exports = { getStreams };
