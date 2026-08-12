var PROVIDER_NAME = "AniNeko";
var BASE_URL = "https://anineko.to";
var TMDB_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

var DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": BASE_URL + "/"
};

function fetchText(url, options) {
  return fetch(url, Object.assign({ headers: DEFAULT_HEADERS }, options || {}))
    .then(function(res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    });
}

function getTMDBTitle(tmdbId, mediaType) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var url = "https://api.themoviedb.org/3/" + type + "/" + tmdbId +
            "?api_key=" + TMDB_KEY;

  return fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      return {
        title: data.name || data.title || "",
        originalTitle: data.original_name || data.original_title || "",
        year: (data.first_air_date || data.release_date || "").split("-")[0]
      };
    })
    .catch(function() { return { title: "", originalTitle: "", year: "" }; });
}

function searchAniNeko(keyword) {
  var url = BASE_URL + "/browser?keyword=" + encodeURIComponent(keyword);
  return fetchText(url).then(function(html) {
    var results = [];
    var regex = /<article class="nv-anime-card nv-browse-card">[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]+alt="([^"]+)"/g;
    var match;
    while ((match = regex.exec(html)) !== null) {
      results.push({
        title: match[3].trim(),
        image: match[2].trim(),
        href: BASE_URL + match[1].trim()
      });
    }
    return results;
  });
}

function normalizeTitle(str) {
  return String(str || "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleScore(a, b) {
  var na = normalizeTitle(a);
  var nb = normalizeTitle(b);
  if (na === nb) return 100;
  if (na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1) return 80;
  var wa = na.split(" ");
  var wb = nb.split(" ");
  var matched = wa.filter(function(w) { return w.length > 2 && wb.indexOf(w) !== -1; }).length;
  return Math.round((matched / Math.max(wa.length, wb.length)) * 60);
}

function findBestMatch(results, title, originalTitle) {
  var best = null;
  var bestScore = 0;
  results.forEach(function(r) {
    var s = Math.max(titleScore(r.title, title), titleScore(r.title, originalTitle));
    if (s > bestScore) { bestScore = s; best = r; }
  });
  return bestScore >= 40 ? best : null;
}

function extractEpisodes(showUrl) {
  return fetchText(showUrl).then(function(html) {
    var episodes = [];
    var regex = /<article class="nv-info-episode-item">[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<strong>Episode (\d+)<\/strong>/g;
    var match;
    while ((match = regex.exec(html)) !== null) {
      episodes.push({
        href: BASE_URL + match[1].trim(),
        number: parseInt(match[2], 10)
      });
    }
    return episodes;
  });
}

function extractVibeplayer(videoUrl) {
  var match = videoUrl.match(/https:\/\/([^\/]+)\/([a-z0-9]+)/i);
  if (!match) return Promise.resolve(null);
  var domain = match[1];
  var id = match[2];
  return Promise.resolve("https://" + domain + "/public/stream/" + id + "/master.m3u8");
}

function extractPacker(videoUrl) {
  return fetchText(videoUrl).then(function(html) {
    var scriptMatch = html.match(/<script[^>]*>\s*(eval\(function\(p,a,c,k,e,d[\s\S]*?)<\/script>/);
    if (!scriptMatch) return null;

    var unpacked = unpack(scriptMatch[1]);
    var hlsMatch = unpacked.match(/(https:\/\/[^"']+(?:master|index)\.m3u8[^"']*)/);
    if (hlsMatch) return hlsMatch[1];

    return null;
  });
}

function extractStreamsFromEpisode(episodeUrl) {
  return fetchText(episodeUrl).then(function(html) {
    var serverTasks = [];
    var regex = /<button[^>]+data-video="([^"]+)"[^>]*>\s*([^<\s]+)\s*<span>([^<]+)<\/span>/g;
    var match;

    while ((match = regex.exec(html)) !== null) {
      var videoUrl = match[1];
      var serverName = match[2].trim();
      var label = match[3].trim();

      if (label !== "Sort Sub" && label !== "Soft Sub") {
        continue;
      }

      (function(vUrl, sName) {
        var priority = 99;
        var extractor;

        if (sName === "HD-1" || sName === "HD-2") {
          priority = sName === "HD-1" ? 1 : 2;
          extractor = extractVibeplayer(vUrl);
        } else if (sName === "StreamHG" || sName === "Earnvids") {
          priority = sName === "StreamHG" ? 3 : 4;
          extractor = extractPacker(vUrl);
        } else {
          return;
        }

        serverTasks.push(
          extractor
            .then(function(streamUrl) {
              if (!streamUrl) return null;
              return { serverName: sName, priority: priority, streamUrl: streamUrl };
            })
            .catch(function() {
              return null;
            })
        );
      })(videoUrl, serverName);
    }

    return Promise.all(serverTasks).then(function(results) {
      var valid = results.filter(function(s) { return s !== null; });
      valid.sort(function(a, b) { return a.priority - b.priority; });

      var streams = [];
      valid.forEach(function(s) {
        streams.push({ serverName: s.serverName, streamUrl: s.streamUrl });
      });

      return streams;
    });
  });
}

function Unbaser(base) {
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
    this.unbase = function(value) { return parseInt(value, base); };
  } else {
    var self = this;
    try {
      self.ALPHABET[base].split("").forEach(function(cipher, index) {
        self.dictionary[cipher] = index;
      });
    } catch (er) {
      throw new Error("Unsupported base encoding.");
    }
    this.unbase = function(value) {
      var ret = 0;
      value.split("").reverse().forEach(function(cipher, index) {
        ret += Math.pow(self.base, index) * self.dictionary[cipher];
      });
      return ret;
    };
  }
}

function unpack(source) {
  var juicers = [
    /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\), *(\d+), *(.*)\)\)/,
    /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\)/
  ];

  var args = null;
  for (var i = 0; i < juicers.length; i++) {
    args = juicers[i].exec(source);
    if (args) break;
  }
  if (!args) throw new Error("Could not make sense of p.a.c.k.e.r data");

  var payload = args[1];
  var radix   = parseInt(args[2]);
  var count   = parseInt(args[3]);
  var symtab  = args[4].split("|");

  if (count !== symtab.length) throw new Error("Malformed p.a.c.k.e.r. symtab.");

  var unbase = new Unbaser(radix);

  return payload.replace(/\b\w+\b/g, function(word) {
    var decoded = radix === 1
      ? symtab[parseInt(word)]
      : symtab[unbase.unbase(word)];
    return decoded || word;
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var ep = episode || 1;

  return getTMDBTitle(tmdbId, mediaType).then(function(info) {
    if (!info.title) {
      throw new Error("Could not resolve title from TMDB");
    }

    return searchAniNeko(info.title).then(function(results) {
      if (results.length === 0 && info.originalTitle && info.originalTitle !== info.title) {
        return searchAniNeko(info.originalTitle).then(function(r2) {
          return { results: r2, info: info };
        });
      }
      return { results: results, info: info };
    });
  }).then(function(data) {
    var results = data.results;
    var info    = data.info;

    if (results.length === 0) {
      throw new Error("No search results found");
    }

    var match = findBestMatch(results, info.title, info.originalTitle);
    if (!match) {
      match = results[0];
    }

    return extractEpisodes(match.href).then(function(episodes) {
      var targetEp = episodes.find(function(e) { return e.number === ep; });

      if (!targetEp) {
        throw new Error("Episode not found");
      }

      return extractStreamsFromEpisode(targetEp.href).then(function(streams) {
        return streams.map(function(s) {
          return {
            name: PROVIDER_NAME + " [" + s.serverName + "]",
            title: "1080p",
            url: s.streamUrl,
            headers: {
              "User-Agent": DEFAULT_HEADERS["User-Agent"],
              "Referer": BASE_URL + "/"
            }
          };
        });
      });
    });
  }).catch(function() {
    return [];
  });
}

module.exports = { getStreams: getStreams };
