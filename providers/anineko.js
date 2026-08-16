const PROVIDER_NAME = "AniNeko";
const BASE_URL = "https://anineko.to";

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": `${BASE_URL}/`
};

async function fetchText(url, options) {
  console.log(`[AniNeko] Fetching URL: ${url}`);
  const res = await fetch(url, Object.assign({ headers: DEFAULT_HEADERS }, options || {}));
  console.log(`[AniNeko] Response status for ${url}: ${res.status}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function searchAniNeko(keyword) {
  const url = `${BASE_URL}/browser?keyword=${encodeURIComponent(keyword)}`;
  console.log(`[AniNeko] Searching AniNeko: ${url}`);
  const html = await fetchText(url);
  
  const results = [];
  const regex = /<article class="nv-anime-card nv-browse-card">[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]+alt="([^"]+)"/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    results.push({
      title: match[3].trim(),
      image: match[2].trim(),
      href: BASE_URL + match[1].trim()
    });
  }
  console.log(`[AniNeko] Search found ${results.length} results for keyword: ${keyword}`);
  return results;
}

function normalizeTitle(str) {
  return String(str || "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleScore(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 80;
  const wa = na.split(" ");
  const wb = nb.split(" ");
  const matched = wa.filter(w => w.length > 2 && wb.includes(w)).length;
  return Math.round((matched / Math.max(wa.length, wb.length)) * 60);
}

function findBestMatch(results, titleRomaji, titleEnglish) {
  let best = null;
  let bestScore = 0;
  for (const r of results) {
    const s1 = titleRomaji ? titleScore(r.title, titleRomaji) : 0;
    const s2 = titleEnglish ? titleScore(r.title, titleEnglish) : 0;
    const s = Math.max(s1, s2);
    console.log(`[AniNeko] Comparing '${r.title}' with Romaji:'${titleRomaji}' (Score: ${s1}) and English:'${titleEnglish}' (Score: ${s2})`);
    if (s > bestScore) { 
      bestScore = s; 
      best = r; 
    }
  }
  console.log(`[AniNeko] Best match score: ${bestScore}`);
  return bestScore >= 40 ? best : null;
}

async function extractEpisodes(showUrl) {
  console.log(`[AniNeko] Extracting episodes from: ${showUrl}`);
  const html = await fetchText(showUrl);
  const episodes = [];
  const regex = /<article class="nv-info-episode-item">[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<strong>Episode (\d+)<\/strong>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    episodes.push({
      href: BASE_URL + match[1].trim(),
      number: parseInt(match[2], 10)
    });
  }
  console.log(`[AniNeko] Found ${episodes.length} episodes.`);
  return episodes;
}

async function extractVibeplayer(videoUrl) {
  console.log(`[AniNeko] Extracting Vibeplayer: ${videoUrl}`);
  try {
    const html = await fetchText(videoUrl);
    let subUrl = null;
    const subMatch = html.match(/file\s*:\s*["']([^"']+\.vtt)["']/i);
    if (subMatch) {
      subUrl = subMatch[1];
    }
    
    const match = videoUrl.match(/https:\/\/([^\/]+)\/([a-z0-9]+)/i);
    if (!match) {
      console.log(`[AniNeko] Vibeplayer regex failed for: ${videoUrl}`);
      return null;
    }
    const domain = match[1];
    const id = match[2];
    const m3u8 = `https://${domain}/public/stream/${id}/master.m3u8`;
    console.log(`[AniNeko] Vibeplayer extracted: ${m3u8}`);
    return { streamUrl: m3u8, subUrl: subUrl };
  } catch (err) {
    console.log(`[AniNeko] Vibeplayer fetch error: ${err.message}`);
    return null;
  }
}

async function extractPacker(videoUrl) {
  console.log(`[AniNeko] Extracting Packer: ${videoUrl}`);
  try {
    const html = await fetchText(videoUrl);
    const scriptMatch = html.match(/<script[^>]*>\s*(eval\(function\(p,a,c,k,e,d[\s\S]*?)<\/script>/);
    if (!scriptMatch) {
      console.log("[AniNeko] Packer script not found in HTML.");
      return null;
    }

    const unpacked = unpack(scriptMatch[1]);
    const hlsMatch = unpacked.match(/(https:\/\/[^"']+(?:master|index)\.m3u8[^"']*)/);
    
    let subUrl = null;
    const subMatch = unpacked.match(/file\s*:\s*["']([^"']+\.vtt)["']/i);
    if (subMatch) {
      subUrl = subMatch[1];
    }

    if (hlsMatch) {
      console.log(`[AniNeko] Packer extracted: ${hlsMatch[1]}`);
      return { streamUrl: hlsMatch[1], subUrl: subUrl };
    }

    console.log("[AniNeko] Packer m3u8 regex failed on unpacked code.");
    return null;
  } catch (err) {
    console.log(`[AniNeko] Packer fetch error: ${err.message}`);
    return null;
  }
}

async function resolveHighestQuality(masterUrl, referer) {
  console.log(`[AniNeko] Resolving highest quality for: ${masterUrl}`);
  try {
    const text = await fetchText(masterUrl, { headers: { "Referer": referer, "Origin": referer.replace(/\/$/, '') } });
    const lines = text.split('\n');
    let bestStream = null;
    let maxScore = 0;
    let currentScore = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF')) {
        const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
        if (resMatch) {
          currentScore = parseInt(resMatch[1], 10) * parseInt(resMatch[2], 10);
        } else {
          const bwMatch = line.match(/BANDWIDTH=(\d+)/);
          if (bwMatch) currentScore = parseInt(bwMatch[1], 10);
        }
      } else if (line && !line.startsWith('#')) {
        if (currentScore > maxScore) {
          maxScore = currentScore;
          bestStream = line;
        }
        currentScore = 0;
      }
    }
    
    if (bestStream) {
      let finalUrl = bestStream;
      if (!bestStream.startsWith('http')) {
        const baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
        finalUrl = baseUrl + bestStream;
      }
      console.log(`[AniNeko] Resolved highest quality stream: ${finalUrl}`);
      return finalUrl;
    }
    console.log("[AniNeko] Could not parse streams, returning master URL.");
    return masterUrl;
  } catch (err) {
    console.log(`[AniNeko] Failed to resolve highest quality: ${err.message}`);
    return masterUrl;
  }
}

async function extractStreamsFromEpisode(episodeUrl) {
  console.log(`[AniNeko] Extracting streams from episode: ${episodeUrl}`);
  const html = await fetchText(episodeUrl);
  const serverTasks = [];
  const regex = /<button[^>]+data-video="([^"]+)"[^>]*>\s*([^<\s]+)\s*<span>([^<]+)<\/span>/g;
  let match;
  let foundServers = 0;

  while ((match = regex.exec(html)) !== null) {
    foundServers++;
    const videoUrl = match[1].replace(/=English/gi, '=Japan');
    const serverName = match[2].trim();
    const label = match[3].trim();

    console.log(`[AniNeko] Found server button: ${serverName} | Label: ${label}`);

    if (label !== "Sort Sub" && label !== "Soft Sub") {
      console.log(`[AniNeko] Skipping server ${serverName} due to label: ${label}`);
      continue;
    }

    let priority = 99;
    let extractorPromise;

    const embedMatch = videoUrl.match(/^https?:\/\/([^\/]+)/i);
    const embedReferer = embedMatch ? `${embedMatch[0]}/` : `${BASE_URL}/`;
    const embedOrigin = embedMatch ? embedMatch[0] : BASE_URL;

    if (serverName === "HD-1" || serverName === "HD-2") {
      priority = serverName === "HD-1" ? 1 : 2;
      extractorPromise = extractVibeplayer(videoUrl);
    } else if (serverName === "StreamHG" || serverName === "Earnvids") {
      priority = serverName === "StreamHG" ? 3 : 4;
      extractorPromise = extractPacker(videoUrl);
    } else {
      console.log(`[AniNeko] Unknown server name: ${serverName}`);
      continue;
    }

    const task = extractorPromise.then(async (extractedData) => {
      if (!extractedData || !extractedData.streamUrl) {
        console.log(`[AniNeko] Extractor returned null for ${serverName}`);
        return null;
      }
      const bestUrl = await resolveHighestQuality(extractedData.streamUrl, embedReferer);
      return { 
        serverName: serverName, 
        priority: priority, 
        streamUrl: bestUrl,
        subUrl: extractedData.subUrl,
        referer: embedReferer,
        origin: embedOrigin
      };
    }).catch(err => {
      console.log(`[AniNeko] Extractor error for ${serverName}: ${err.message}`);
      return null;
    });

    serverTasks.push(task);
  }

  console.log(`[AniNeko] Total server buttons found: ${foundServers}, processing ${serverTasks.length} valid Soft Sub servers.`);

  const results = await Promise.all(serverTasks);
  const valid = results.filter(s => s !== null);
  valid.sort((a, b) => a.priority - b.priority);

  const streams = valid.map(s => ({ 
    serverName: s.serverName, 
    streamUrl: s.streamUrl,
    subUrl: s.subUrl,
    referer: s.referer,
    origin: s.origin
  }));

  console.log(`[AniNeko] Successfully extracted ${streams.length} streams.`);
  return streams;
}

class Unbaser {
  constructor(base) {
    this.ALPHABET = {
      62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
      95: " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~"
    };
    this.dictionary = {};
    this.base = base;

    if (36 < base && base < 62) {
      this.ALPHABET[base] = this.ALPHABET[base] || this.ALPHABET[62].substr(0, base);
    }

    if (2 <= base && base <= 36) {
      this.unbase = (value) => parseInt(value, base);
    } else {
      try {
        this.ALPHABET[base].split("").forEach((cipher, index) => {
          this.dictionary[cipher] = index;
        });
      } catch (er) {
        throw new Error("Unsupported base encoding.");
      }
      this.unbase = (value) => {
        let ret = 0;
        value.split("").reverse().forEach((cipher, index) => {
          ret += Math.pow(this.base, index) * this.dictionary[cipher];
        });
        return ret;
      };
    }
  }
}

function unpack(source) {
  const juicers = [
    /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\), *(\d+), *(.*)\)\)/,
    /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\)/
  ];

  let args = null;
  for (let i = 0; i < juicers.length; i++) {
    args = juicers[i].exec(source);
    if (args) break;
  }
  if (!args) throw new Error("Could not make sense of p.a.c.k.e.r data");

  const payload = args[1];
  const radix   = parseInt(args[2]);
  const count   = parseInt(args[3]);
  const symtab  = args[4].split("|");

  if (count !== symtab.length) throw new Error("Malformed p.a.c.k.e.r. symtab.");

  const unbase = new Unbaser(radix);

  return payload.replace(/\b\w+\b/g, (word) => {
    const decoded = radix === 1 ? symtab[parseInt(word)] : symtab[unbase.unbase(word)];
    return decoded || word;
  });
}

async function getStreams(tmdbId, mediaType, season, episode, payload) {
  const ep = episode || 1;
  const p = payload || {};
  const titleRomaji = p.romaji || "";
  const titleEnglish = p.english || p.title || "";
  
  const searchTitle = titleRomaji || titleEnglish;
  if (!searchTitle) {
     console.log("[AniNeko] No title available for searching.");
     return [];
  }

  console.log(`[AniNeko] getStreams called. S${season}E${ep} | Romaji: ${titleRomaji} | English: ${titleEnglish}`);

  try {
    let results = await searchAniNeko(searchTitle);
    
    if (results.length === 0 && titleRomaji && titleEnglish && titleRomaji !== titleEnglish) {
      console.log(`[AniNeko] No results for Romaji, falling back to English: ${titleEnglish}`);
      results = await searchAniNeko(titleEnglish);
    }

    if (results.length === 0) {
      console.log("[AniNeko] Search returned 0 results overall.");
      return [];
    }

    let match = findBestMatch(results, titleRomaji, titleEnglish);
    if (!match) {
      console.log(`[AniNeko] No strong match found, falling back to first result: ${results[0].title}`);
      match = results[0];
    } else {
      console.log(`[AniNeko] Selected match: ${match.title}`);
    }

    const episodes = await extractEpisodes(match.href);
    const targetEp = episodes.find(e => e.number === ep);

    if (!targetEp) {
      console.log(`[AniNeko] Target episode ${ep} not found in episode list.`);
      return [];
    }

    const streams = await extractStreamsFromEpisode(targetEp.href);
    
    const finalStreams = streams.map(s => ({
      name: `${PROVIDER_NAME} [${s.serverName}]`,
      title: "1080p",
      url: s.streamUrl,
      subUrl: s.subUrl,
      headers: {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Referer": s.referer,
        "Origin": s.origin
      }
    }));
    
    console.log(`[AniNeko] Returning ${finalStreams.length} final streams.`);
    return finalStreams;

  } catch (err) {
    console.log(`[AniNeko] Global Error in getStreams: ${err.message}`);
    return [];
  }
}

module.exports = { getStreams };
