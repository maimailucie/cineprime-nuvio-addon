require('dotenv').config();
const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');

const app = express();
const PORT = Number(process.env.PORT || 7000);
const TMDB_TOKEN = process.env.TMDB_API_TOKEN || '';
const OMDB_KEY = process.env.OMDB_API_KEY || '';
const NGUONC_API = (process.env.NGUONC_API_URL || 'https://phim.nguonc.com/api').replace(/\/$/, '');
const MIN_VOTES = Math.max(0, Number(process.env.MIN_IMDB_VOTES || 200));
const TMDB_LANGUAGE = process.env.TMDB_LANGUAGE || 'vi-VN';
const CACHE = new Map();
const DAY = 24 * 60 * 60 * 1000;

const manifest = {
  id: 'community.cineprime.quality.catalog',
  version: '1.4.0',
  name: '🍿 CinePrime',
  description: 'Danh mục phim tuyển chọn: thịnh hành, hài, kinh dị, IMDb xác minh, phim Hàn mới, điện ảnh Việt và phim Netflix mới. Không có anime.',
  resources: ['catalog', 'meta'],
  types: ['movie', 'series'],
  // TMDB numeric IDs are used by Korean, Vietnamese, Netflix and Search catalogs.
  // Register every digit prefix so the Stremio SDK routes these IDs to metaHandler.
  idPrefixes: ['tt', 'nc_', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
  catalogs: [
    { type: 'movie', id: 'trending_movies', name: '🔥 Phim lẻ thịnh hành' },
    { type: 'series', id: 'trending_series', name: '🔥 Phim bộ thịnh hành' },
    { type: 'movie', id: 'comedy_movies_new', name: '😂 Phim hài · IMDb xác minh' },
    { type: 'series', id: 'comedy_series_new', name: '😂 Phim bộ hài · IMDb xác minh' },
    { type: 'movie', id: 'horror_movies_new', name: '👻 Phim kinh dị · IMDb xác minh' },
    { type: 'series', id: 'horror_series_new', name: '👻 Phim bộ kinh dị · IMDb xác minh' },
    { type: 'movie', id: 'korean_movies_new', name: '🇰🇷 Korean Hot & New · Phim lẻ' },
    { type: 'series', id: 'korean_series_new', name: '🇰🇷 Korean Hot & New · Phim bộ' },
    { type: 'movie', id: 'vietnam_movies', name: '🇻🇳 Phim điện ảnh Việt Nam mới nhất' },
    { type: 'movie', id: 'netflix_movies', name: '🎬 Phim Netflix mới' },
    { type: 'movie', id: 'search_movies', name: '🔎 Tìm phim lẻ', extra: [{ name: 'search', isRequired: true }] },
    { type: 'series', id: 'search_series', name: '🔎 Tìm phim bộ', extra: [{ name: 'search', isRequired: true }] }
  ]};

const builder = new addonBuilder(manifest);

function cacheGet(key) {
  const v = CACHE.get(key);
  if (!v) return null;
  if (v.exp <= Date.now()) { CACHE.delete(key); return null; }
  return v.value;
}
function cacheSet(key, value, ttl = DAY) {
  if (CACHE.size > 1200) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, { value, exp: Date.now() + ttl });
  return value;
}

async function fetchJson(url, headers = {}) {
  const r = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Upstream HTTP ${r.status}`);
  return r.json();
}

async function tmdb(path) {
  if (!TMDB_TOKEN) throw new Error('TMDB_API_TOKEN is not configured');
  return fetchJson(`https://api.themoviedb.org/3${path}`, { Authorization: `Bearer ${TMDB_TOKEN}` });
}

async function imdbData(imdbId) {
  const key = `omdb:${imdbId}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  if (!OMDB_KEY) return null;
  const data = await fetchJson(`https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(OMDB_KEY)}`);
  if (data.Response !== 'True') return null;
  const rating = Number(data.imdbRating);
  const votes = Number(String(data.imdbVotes || '').replace(/,/g, ''));
  if (!Number.isFinite(rating) || !Number.isFinite(votes) || votes < 1) return null;
  return cacheSet(key, { rating, votes, rated: data.Rated || '' });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); } catch (_) { out[i] = null; }
    }
  }));
  return out;
}


function genreName(id) {
  return ({28:'Hành động',12:'Phiêu lưu',16:'Hoạt hình',35:'Hài',80:'Tội phạm',99:'Tài liệu',18:'Chính kịch',10751:'Gia đình',14:'Giả tưởng',36:'Lịch sử',27:'Kinh dị',10402:'Âm nhạc',9648:'Bí ẩn',10749:'Lãng mạn',878:'Khoa học viễn tưởng',10770:'Phim truyền hình',53:'Giật gân',10752:'Chiến tranh',37:'Miền Tây'})[id] || '';
}

function poster(path, size = 'w500') { return path ? `https://image.tmdb.org/t/p/${size}${path}` : null; }
function releaseYear(item, isMovie) {
  const date = isMovie ? item.release_date : item.first_air_date;
  return date ? String(date).slice(0, 4) : '';
}

async function enrichCandidate(item, isMovie, allowLowVotes = false) {
  const externalKey = `external:${isMovie ? 'movie' : 'tv'}:${item.id}`;
  let ext = cacheGet(externalKey);
  if (!ext) {
    ext = await tmdb(`/${isMovie ? 'movie' : 'tv'}/${item.id}/external_ids`);
    cacheSet(externalKey, ext, 7 * DAY);
  }
  const imdbId = ext && ext.imdb_id;
  if (!imdbId || !/^tt\d+$/.test(imdbId)) return null;
  const ratingInfo = await imdbData(imdbId);
  if (!ratingInfo || (!allowLowVotes && ratingInfo.votes < MIN_VOTES)) return null;

  const genres = (item.genre_ids || []).map(genreName).filter(Boolean);
  const name = isMovie ? item.title : item.name;
  const originalName = isMovie ? item.original_title : item.original_name;
  const year = releaseYear(item, isMovie);
  return {
    id: imdbId,
    type: isMovie ? 'movie' : 'series',
    name: name || originalName || 'Untitled',
    poster: poster(item.poster_path),
    background: poster(item.backdrop_path, 'w1280'),
    description: `${item.overview || ''}${item.overview ? '\n\n' : ''}IMDb ${ratingInfo.rating.toFixed(1)} · ${ratingInfo.votes.toLocaleString(TMDB_LANGUAGE)} votes`,
    releaseInfo: year,
    imdbRating: ratingInfo.rating.toFixed(1),
    genres,
    _votes: ratingInfo.votes,
    _date: isMovie ? (item.release_date || '') : (item.first_air_date || '')
  };
}

async function getCatalog(type, id, extra = {}) {
  if (id === 'search_movies' || id === 'search_series') {
    const term = String(extra.search || '').trim();
    if (!term) return [];
    return getSearchCatalog(type, term);
  }
  const cacheKey = `catalog:${type}:${id}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;

  const isMovie = type === 'movie';
  const isComedy = id.startsWith('comedy_');
  const isHorror = id.startsWith('horror_');
  const isKorean = id.startsWith('korean_');
  const isTrending = id.startsWith('trending_');
  const isHiddenGem = id === 'hidden_gems_movies';
  const isNewcomer = id.includes('newcomer');
  const isVietnam = id === 'vietnam_movies';
  const isNetflix = id === 'netflix_movies';
  if (isKorean || isVietnam || isNetflix) {
    const region = process.env.NETFLIX_REGION || 'US';
    const directMovie = type === 'movie';
    const dateField = directMovie ? 'primary_release_date' : 'first_air_date';
    const params = new URLSearchParams({
      language: TMDB_LANGUAGE,
      sort_by: `${dateField}.desc`,
      include_adult: 'false',
      page: '1',
      [`${dateField}.lte`]: new Date().toISOString().slice(0, 10),
      without_genres: '16'
    });
    if (isKorean) {
      params.set('with_origin_country', 'KR');
      params.set(`${dateField}.gte`, new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10));
      params.set('vote_count.gte', '20');
      params.set('sort_by', 'popularity.desc');
    }
    if (isVietnam) params.set('with_origin_country', 'VN');
    if (isNetflix) {
      params.set('with_watch_providers', '8');
      params.set('watch_region', region);
      params.set('with_watch_monetization_types', 'flatrate');
    }
    const rawPages = await Promise.all(Array.from({ length: 8 }, (_, i) => i + 1).map(async page => {
      const pageParams = new URLSearchParams(params);
      pageParams.set('page', String(page));
      const result = await tmdb(`/discover/${directMovie ? 'movie' : 'tv'}?${pageParams}`);
      return result.results || [];
    }));
    let candidates = rawPages.flat().filter(x => x && x.poster_path && !(x.genre_ids || []).includes(16));
    candidates = [...new Map(candidates.map(x => [x.id, x])).values()];
    if (isKorean) {
      // Korean Hot & New: within 365 days, popularity-led; IMDb >= 6 if rated.
      // If IMDb has no rating yet, require stronger TMDB popularity and votes.
      candidates = candidates.filter(x => Number(x.popularity || 0) >= 8 && Number(x.vote_count || 0) >= 20);
      candidates.sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0));
      const rated = await mapLimit(candidates.slice(0, 160), 5, async item => {
        const ext = await tmdb(`/${directMovie ? 'movie' : 'tv'}/${item.id}/external_ids`);
        const imdb = ext && ext.imdb_id ? await imdbData(ext.imdb_id).catch(() => null) : null;
        if (imdb && imdb.rating < 6.0) return null;
        if (!imdb && (Number(item.popularity || 0) < 15 || Number(item.vote_count || 0) < 100)) return null;
        return { item, imdb };
      });
      const metas = rated.filter(Boolean).map(({ item, imdb }) => ({
        id: String(item.id), type,
        name: item.title || item.name || item.original_title || item.original_name || 'Chưa có tên',
        poster: poster(item.poster_path), background: poster(item.backdrop_path, 'w1280'),
        description: item.overview || '',
        releaseInfo: releaseYear(item, directMovie),
        imdbRating: imdb ? imdb.rating.toFixed(1) : (Number(item.vote_average) > 0 ? Number(item.vote_average).toFixed(1) : undefined),
        genres: (item.genre_ids || []).map(genreName).filter(Boolean)
      }));
      return cacheSet(cacheKey, metas, 3 * 60 * 60 * 1000);
    }
    candidates = candidates.slice(0, 160);
    const metas = candidates.map(item => ({
      id: String(item.id), type,
      name: item.title || item.name || item.original_title || item.original_name || 'Chưa có tên',
      poster: poster(item.poster_path), background: poster(item.backdrop_path, 'w1280'),
      description: item.overview || '',
      releaseInfo: releaseYear(item, directMovie),
      imdbRating: Number(item.vote_average) > 0 ? Number(item.vote_average).toFixed(1) : undefined,
      genres: (item.genre_ids || []).map(genreName).filter(Boolean)
    }));
    return cacheSet(cacheKey, metas, 3 * 60 * 60 * 1000);
  }
  const genre = isComedy ? 35 : (isHorror ? 27 : null);
  const minRating = isComedy ? 6.5 : 6.0;
  const dateField = isMovie ? 'primary_release_date' : 'first_air_date';
  const today = new Date().toISOString().slice(0, 10);
  const from = `${new Date(Date.now() - (isHiddenGem ? 6 : 5) * 365 * DAY).toISOString().slice(0, 10)}`;
  const query = {
    [`${dateField}.gte`]: from,
    [`${dateField}.lte`]: today,
    sort_by: isTrending ? 'popularity.desc' : `${dateField}.desc`,
    'vote_count.gte': isNewcomer || isHiddenGem ? '20' : '100',
    without_genres: '16',
    include_adult: 'false',
    language: TMDB_LANGUAGE,
    page: '1'
  };
  if (genre !== null) query.with_genres = String(genre);
  // Keep general catalogs focused on the markets selected by the user; this excludes India and Europe.
  if (!isKorean && !isVietnam && !isNetflix) query.with_origin_country = 'US|KR|VN|JP|CN|TH';
  if (isKorean) query.with_origin_country = 'KR';
  // TMDB returns only 20 results per page by default. Fetch three pages
  // so each catalog can draw from up to 60 candidates instead of just 20.
  const pageResults = await Promise.all(Array.from({ length: 8 }, (_, i) => i + 1).map(async page => {
    const pageQuery = new URLSearchParams({ ...query, page: String(page) });
    const raw = await tmdb(`/discover/${isMovie ? 'movie' : 'tv'}?${pageQuery}`);
    return raw.results || [];
  }));
  const candidates = pageResults.flat().slice(0, 160);
  const enriched = await mapLimit(candidates, 5, item => enrichCandidate(item, isMovie, isNewcomer));
  let filtered = enriched.filter(x => x && Number(x.imdbRating) >= minRating);
  if (isNewcomer) filtered = filtered.filter(x => x._votes < MIN_VOTES);
  else if (isHiddenGem) filtered = filtered.filter(x => x._votes >= 100 && x._votes < Math.max(MIN_VOTES * 4, 2000));
  else filtered = filtered.filter(x => x._votes >= MIN_VOTES);
  filtered.sort((a, b) => {
    if (isTrending) return b._votes - a._votes;
    return b._date.localeCompare(a._date) || b._votes - a._votes;
  });
  const metas = filtered.slice(0, 100).map(({ _votes, _date, ...meta }) => meta);
  return cacheSet(cacheKey, metas, 6 * 60 * 60 * 1000);
}

async function getSearchCatalog(type, term) {
  const isMovie = type === 'movie';
  const normalized = term.toLowerCase().replace(/\\s+/g, ' ').slice(0, 100);
  const cacheKey = `search:${type}:${normalized}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;
  const pages = await Promise.all(Array.from({ length: 5 }, (_, i) => i + 1).map(async page => {
    const params = new URLSearchParams({ query: term, include_adult: 'false', language: TMDB_LANGUAGE, page: String(page) });
    const raw = await tmdb(`/search/${isMovie ? 'movie' : 'tv'}?${params}`);
    return raw.results || [];
  }));
  const metas = pages.flat().filter(item => item && item.poster_path && !(item.genre_ids || []).includes(16)).slice(0, 100).map(item => ({
    id: String(item.id), type: isMovie ? 'movie' : 'series',
    name: isMovie ? (item.title || item.original_title || 'Untitled') : (item.name || item.original_name || 'Untitled'),
    poster: poster(item.poster_path), background: poster(item.backdrop_path, 'w1280'),
    description: item.overview || '',
    releaseInfo: releaseYear(item, isMovie),
    imdbRating: Number(item.vote_average) > 0 ? Number(item.vote_average).toFixed(1) : undefined,
    genres: []
  }));
  return cacheSet(cacheKey, metas, 30 * 60 * 1000);
}

function nguoncImage(value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://phim.nguonc.com/${String(value).replace(/^\//, '')}`;
}

function categoryEntries(movie) {
  const categories = movie && movie.category;
  if (!categories) return [];
  if (Array.isArray(categories)) return categories;
  if (typeof categories === 'object') return Object.values(categories);
  return [];
}

function categoryGroupText(source, pattern) {
  const matches = [];
  for (const category of categoryEntries(source)) {
    if (!category || !category.group) continue;
    const groupName = String(category.group.name || '');
    if (pattern.test(groupName)) {
      const list = Array.isArray(category.list) ? category.list : [];
      matches.push(...list.map(x => typeof x === 'string' ? x : (x && (x.name || x.slug)) || ''));
    }
  }
  return matches;
}

function isNguonCVietnamese(item, detail) {
  const values = [];
  for (const source of [item, detail]) {
    if (!source) continue;
    for (const key of ['country', 'countries', 'origin_country', 'nationality']) {
      const value = source[key];
      if (Array.isArray(value)) values.push(...value.map(x => typeof x === 'string' ? x : (x && (x.name || x.slug)) || ''));
      else if (value) values.push(typeof value === 'string' ? value : (value.name || value.slug || JSON.stringify(value)));
    }
  }
  values.push(...categoryGroupText(item, /quốc gia|country/i));
  values.push(...categoryGroupText(detail, /quốc gia|country/i));
  // NguonC has returned country metadata in slightly different shapes over time.
  // Inspect only country/category metadata, not synopsis text, to avoid false matches.
  const metadata = [item && item.category, detail && detail.category, item && item.country, detail && detail.country,
    item && item.countries, detail && detail.countries, item && item.origin_country, detail && detail.origin_country];
  values.push(...metadata.filter(Boolean).map(value => JSON.stringify(value)));
  return values.some(value => /việt\s*nam|viet\s*nam|vietnam/i.test(String(value)));
}

function isNguonCMovie(item, detail) {
  const values = [];
  for (const source of [item, detail]) {
    if (!source) continue;
    for (const key of ['type', 'movie_type', 'format', 'category_name', 'list_name']) {
      if (source[key]) values.push(String(source[key]));
    }
  }
  values.push(...categoryGroupText(item, /danh sách|loại phim|type/i));
  values.push(...categoryGroupText(detail, /danh sách|loại phim|type/i));
  // The candidate list is already the NguonC "phim-le" endpoint.
  // Reject only records explicitly identified as series/TV in detail metadata.
  return !values.some(value => /phim\s*bộ|phim-bo|series|tv\s*show/i.test(value));
}

async function getNguonCVietnamMovies() {
  const cacheKey = 'nguonc:vietnam:feature-films';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const pages = [1, 2, 3, 4, 5];
  const [movieResponses, countryResponses] = await Promise.all([
    Promise.all(pages.map(async page => {
      try { return await fetchJson(`${NGUONC_API}/films/danh-sach/phim-le?page=${page}`, { 'user-agent': 'CinePrime/1.2.2' }); }
      catch (error) { console.warn('[CinePrime] NguonC movie-list error:', error.message); return null; }
    })),
    Promise.all(pages.map(async page => {
      try { return await fetchJson(`${NGUONC_API}/films/quoc-gia/viet-nam?page=${page}`, { 'user-agent': 'CinePrime/1.2.2' }); }
      catch (error) { console.warn('[CinePrime] NguonC country-list error:', error.message); return null; }
    }))
  ]);
  const extractItems = data => {
    if (Array.isArray(data && data.items)) return data.items;
    if (Array.isArray(data && data.data && data.data.items)) return data.data.items;
    return [];
  };
  const movieItems = movieResponses.flatMap(extractItems);
  const countryItems = countryResponses.flatMap(extractItems);
  const countrySlugs = new Set(countryItems.filter(x => x && x.slug).map(x => x.slug));
  // Intersect only when the country endpoint actually returned data; detail metadata
  // remains the final Vietnam-country validation to avoid false positives.
  const candidates = movieItems.filter(x => x && x.slug && (!countrySlugs.size || countrySlugs.has(x.slug)));
  const unique = [...new Map(candidates.map(x => [x.slug, x])).values()];
  console.log(`[CinePrime] NguonC lists: phim-le=${movieItems.length}, viet-nam=${countryItems.length}, candidates=${unique.length}`);
  const details = await mapLimit(unique.slice(0, 100), 5, async item => {
    const data = await fetchJson(`${NGUONC_API}/film/${encodeURIComponent(item.slug)}`, { 'user-agent': 'CinePrime/1.2.2' });
    const movie = data && data.movie;
    if (!movie || !isNguonCVietnamese(item, movie) || !isNguonCMovie(item, movie)) return null;
    const tmdbId = movie.tmdb && movie.tmdb.id ? String(movie.tmdb.id) : '';
    const imdbId = movie.imdb && movie.imdb.id ? String(movie.imdb.id) : '';
    const id = /^tt\d+$/.test(imdbId) ? imdbId : (/^\d+$/.test(tmdbId) ? tmdbId : `nc_${item.slug}`);
    const year = String(movie.year || item.year || '').match(/\d{4}/)?.[0] || '';
    const name = movie.name || item.name || item.original_name || 'Phim Việt Nam';
    const genres = categoryGroupText(movie, /thể loại|genre/i);
    return {
      id, type: 'movie', name,
      poster: nguoncImage(item.poster_url || item.thumb_url || movie.poster_url || movie.thumb_url),
      background: nguoncImage(item.thumb_url || item.poster_url || movie.thumb_url || movie.poster_url),
      description: [movie.content || movie.description || item.description || '', movie.quality || item.quality || ''].filter(Boolean).join('\n\n'),
      releaseInfo: year,
      genres: genres.length ? genres : ['Phim Việt Nam'],
      _slug: item.slug
    };
  });
  const metas = details.filter(Boolean).slice(0, 100).map(({ _slug, ...meta }) => meta);
  console.log(`[CinePrime] NguonC Vietnamese feature films returned: ${metas.length}`);
  return cacheSet(cacheKey, metas, 30 * 60 * 1000);
}

async function getNguonCMeta(slug) {
  const data = await fetchJson(`${NGUONC_API}/film/${encodeURIComponent(slug)}`, { 'user-agent': 'CinePrime/1.2.0' });
  const movie = data && data.movie;
  if (!movie) return null;
  const imdbId = movie.imdb && movie.imdb.id ? String(movie.imdb.id) : '';
  const tmdbId = movie.tmdb && movie.tmdb.id ? String(movie.tmdb.id) : '';
  const year = String(movie.year || '').match(/\d{4}/)?.[0] || '';
  const genres = categoryEntries(movie).flatMap(category => (category && category.group && /thể loại|genre/i.test(category.group.name || '') ? (category.list || []).map(x => x.name).filter(Boolean) : []));
  return {
    id: /^tt\d+$/.test(imdbId) ? imdbId : (/^\d+$/.test(tmdbId) ? tmdbId : `nc_${slug}`),
    type: 'movie', name: movie.name || movie.original_name || 'Phim Việt Nam',
    poster: nguoncImage(movie.poster_url || movie.thumb_url),
    background: nguoncImage(movie.thumb_url || movie.poster_url),
    description: movie.content || movie.description || '',
    releaseInfo: year,
    genres: genres.length ? genres : ['Phim Việt Nam']
  };
}

builder.defineCatalogHandler(async ({ type, id, extra = {} }) => {
  if (!['movie', 'series'].includes(type)) return { metas: [] };
  if (!manifest.catalogs.some(c => c.type === type && c.id === id)) return { metas: [] };
  try { return { metas: await getCatalog(type, id, extra) }; }
  catch (err) { console.error('[CinePrime] catalog error:', err.message); return { metas: [] }; }
});

builder.defineMetaHandler(async ({ type, id }) => {
  if (!['movie', 'series'].includes(type)) return { meta: null };
  if (type === 'movie' && id.startsWith('nc_')) {
    try { return { meta: await getNguonCMeta(id.slice(3)) }; }
    catch (err) { console.error('[CinePrime] NguonC meta error:', err.message); return { meta: null }; }
  }
  if (/^\d+$/.test(id)) {
    const numericKey = `meta:${type}:tmdb:${id}`;
    const numericHit = cacheGet(numericKey);
    if (numericHit) return { meta: numericHit };
    try {
      const item = await tmdb(`/${type === 'movie' ? 'movie' : 'tv'}/${encodeURIComponent(id)}?language=${TMDB_LANGUAGE}`);
      const ext = await tmdb(`/${type === 'movie' ? 'movie' : 'tv'}/${encodeURIComponent(id)}/external_ids`);
      const imdb = ext && ext.imdb_id ? await imdbData(ext.imdb_id) : null;
      const meta = {
        id, type, name: item.title || item.name || item.original_title || item.original_name || 'Untitled',
        poster: poster(item.poster_path), background: poster(item.backdrop_path, 'w1280'),
        description: item.overview || '', releaseInfo: releaseYear(item, type === 'movie'),
        imdbRating: imdb ? imdb.rating.toFixed(1) : undefined,
        genres: (item.genres || []).map(g => g.name).filter(Boolean)
      };
      cacheSet(numericKey, meta);
      return { meta };
    } catch (err) { console.error('[CinePrime] TMDB meta error:', err.message); return { meta: null }; }
  }
  if (!/^tt\d+$/.test(id)) return { meta: null };
  const cacheKey = `meta:${type}:${id}`;
  const hit = cacheGet(cacheKey);
  if (hit) return { meta: hit };
  try {
    const omdb = await imdbData(id).catch(() => null);
    const search = await tmdb(`/find/${id}?external_source=imdb_id`);
    const item = type === 'movie' ? (search.movie_results || [])[0] : (search.tv_results || [])[0];
    if (!item) return { meta: null };
    const meta = {
      id, type,
      name: item.title || item.name || item.original_title || item.original_name,
      poster: poster(item.poster_path),
      background: poster(item.backdrop_path, 'w1280'),
      description: `${item.overview || ''}${omdb ? `${item.overview ? '\n\n' : ''}IMDb ${omdb.rating.toFixed(1)} · ${omdb.votes.toLocaleString(TMDB_LANGUAGE)} votes` : ''}`,
      releaseInfo: releaseYear(item, type === 'movie'),
      imdbRating: omdb ? omdb.rating.toFixed(1) : (Number(item.vote_average) > 0 ? Number(item.vote_average).toFixed(1) : undefined),
      genres: (item.genre_ids || []).map(genreName).filter(Boolean)
    };
    cacheSet(cacheKey, meta);
    return { meta };
  } catch (err) {
    console.error('[CinePrime] meta error:', err.message);
    return { meta: null };
  }
});

app.use('/', getRouter(builder.getInterface()));
app.get('/health', (_req, res) => res.json({ ok: true, name: 'CinePrime', version: '1.4.0' }));
app.listen(PORT, () => {
  console.log(`CinePrime listening on :${PORT}`);
  if (!TMDB_TOKEN || !OMDB_KEY) console.warn('Set TMDB_API_TOKEN and OMDB_API_KEY before expecting catalog results.');
});
