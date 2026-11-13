# CinePrime Nuvio Add-on v1.3.0

Curated movie and series catalogs for Nuvio / Stremio.

## Catalogs
- Trending Movies / Trending Series
- Comedy Movies / Comedy Series (IMDb verified)
- Horror Movies / Horror Series (IMDb verified)
- Korean Movies / Korean Series (latest first; no minimum IMDb score or vote threshold)
- Vietnamese Movies (TMDB country origin: Vietnam; theatrical movie catalog)
- Netflix Movies (TMDB Netflix availability, region configurable; defaults to US)
- Search Movies / Search Series (TMDB search results; no IMDb/OMDb requirement)

Newcomers and Hidden Gems catalogs have been removed.

## Render environment variables
- `TMDB_API_TOKEN` — TMDB API Read Access Token (Bearer token), required
- `OMDB_API_KEY` — OMDb API key, used for IMDb-verified Comedy/Horror catalogs
- `NETFLIX_REGION` — two-letter region code for Netflix availability; defaults to `US`

## Deploy
Build command: `npm install`
Start command: `npm start`
Node.js 20 or newer is required.

After deployment, reinstall or refresh the add-on in Nuvio if the old catalog list remains cached.
