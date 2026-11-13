# CinePrime for Nuvio — v1.2.2

A Stremio-compatible catalog add-on for Nuvio. CinePrime focuses on recent, curated movies and series, with separate IMDb-verified and newcomer lists. Anime is excluded.

## Catalogs

- Trending movies and series
- Comedy movies and series — IMDb >= 6.5
- Horror movies and series — IMDb >= 6.0
- Comedy/Horror newcomers — IMDb rating present, but below the verified vote threshold
- Hidden Gems — recent movies with IMDb >= 6.0 and a moderate vote count
- Korean movies and series — South Korean origin, IMDb >= 6.0
- Vietnamese theatrical films — sourced from NguonC only; intersects NguonC's `phim-le` and `viet-nam` catalog lists, then checks title details. No Vietnamese TV series catalog is included.

## Quality and date rules

- Recent releases are prioritized (normally the last five years).
- Older titles are not broadly backfilled into catalogs.
- Comedy: IMDb rating >= 6.5.
- Horror, Korean and general discovery: IMDb rating >= 6.0.
- Verified catalogs: at least `MIN_IMDB_VOTES` (default 500).
- Newcomer catalogs: valid IMDb rating, but fewer than `MIN_IMDB_VOTES` votes. These are clearly separated from verified titles.
- Missing IMDb rating/ID is excluded from TMDB-discovered quality catalogs.
- TMDB supplies discovery, posters and metadata; OMDb supplies IMDb ratings and vote counts.

Vietnamese cinema is the exception: its catalog is based on NguonC's own listing and metadata, not IMDb filtering. NguonC's catalog/detail API is third-party and can change or be unavailable. If NguonC does not return country/type metadata reliably, the catalog may be incomplete rather than guessing titles.

## Playback note for NguonC

CinePrime is a catalog add-on, not a stream provider. For Vietnamese film playback, install/enable the separate NguonC provider in Nuvio. Items carrying an IMDb ID or TMDB ID can be matched by the provider's metadata lookup. A NguonC title without either external ID can still appear in the catalog, but automatic provider matching may not work for that title.

## Requirements

- Node.js 20+
- TMDB API Read Access Token
- OMDb API key

## Run locally

```bash
npm install
cp .env.example .env
# Fill TMDB_API_TOKEN and OMDB_API_KEY in .env
npm start
```

Keep `.env` private and never commit API keys.

## Deploy

Deploy this folder to Render, Railway, Fly.io, or another Node.js host. Configure:

- `TMDB_API_TOKEN` (required)
- `OMDB_API_KEY` (required)
- `MIN_IMDB_VOTES` (optional, default `500`)
- `NGUONC_API_URL` (optional, default `https://phim.nguonc.com/api`)
- `PORT` (normally supplied by the host)

After deployment, install this URL in Nuvio's **Add-ons** section (not Plugins):

`https://YOUR-HOST/manifest.json`

Health check: `/health`.

## Caching and limits

- TMDB/IMDb catalogs: cached for 6 hours.
- IMDb lookups: cached for 24 hours.
- NguonC Vietnamese cinema list: cached for 30 minutes.
- Catalog refresh makes bounded upstream requests; OMDb quotas depend on the selected API plan.


### v1.2.2 catalog expansion
- Fetches three TMDB discover pages (up to 60 candidates) per catalog instead of only the first page.
- Returns up to 50 catalog items when enough eligible titles are available.
- Caches TMDB external-ID lookups for seven days to reduce upstream requests.
- Fixes Newcomers so titles below the configured IMDb vote threshold are not discarded before filtering.


## v1.2.2 updates

- Adds search-only Movie and Series catalogs using TMDB search; they appear in Search rather than as empty home rows.
- Adds more defensive NguonC response parsing and country/category metadata checks for the Vietnamese feature-film catalog.
- Logs NguonC list counts and the number of Vietnamese feature films returned, to make troubleshooting easier.

Search catalogs are declared with the Stremio `search` extra parameter. Search requests are handled through `extra.search`.
