# CinePrime Nuvio Add-on v1.3.2

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


Giao diện catalog và metadata TMDB mặc định dùng tiếng Việt (`vi-VN`). Có thể đổi bằng biến môi trường `TMDB_LANGUAGE`. Mỗi catalog tải tối đa 8 trang TMDB (tối đa 160 ứng viên) và trả tối đa 100 phim; tìm kiếm tải tối đa 5 trang. Mặc định ngưỡng IMDb Verified giảm còn 200 lượt bình chọn (`MIN_IMDB_VOTES` có thể cấu hình).

## v1.3.2 fix
- Registered numeric TMDB ID prefixes in the add-on manifest so Stremio/Nuvio routes numeric movie and series IDs to the metadata handler.
- General catalogs are limited to US, South Korea, Vietnam, Japan, China, and Thailand; India and European-origin titles are excluded from those general catalogs.
