# strapi-plugin-image-proxy

On-demand image processing and disk caching for Strapi V5, powered by Sharp.

Intercepts requests to `/uploads/` URLs that contain valid transformation parameters. Images without parameters are served normally by Strapi's static file handler — zero overhead, zero breaking changes.

---

## Features

- On-demand resize, crop, format conversion, blur, sharpen, rotate, flip, grayscale, and more
- Focal point-aware cropping via `fpx`/`fpy` params
- Automatic EXIF orientation fix (`autoOrient`) — mobile photos display correctly without explicit `?rotate=`
- Disk cache with configurable TTL and ETag/304 support
- Automatically uses Strapi-generated thumbnail formats as source where possible (avoids processing large originals at request time)
- Path-based Sharp input with `sequentialRead` — memory-efficient, handles large files safely
- Safety limits: max input megapixels, max output dimensions, Sharp concurrency cap
- Dimension validation: requests with `w` or `h` outside the allowed range are rejected with a `400` response before any processing
- `withoutEnlargement` is `true` by default — images are never upscaled beyond their original dimensions unless explicitly opted out
- All query parameters are validated and clamped to safe ranges
- Atomic cache writes — no partial files on crash
- Auto-invalidates cache when files are deleted or replaced in Strapi
- Admin API endpoints for cache invalidation, flush, and stats
- Falls through gracefully on any error — never breaks image delivery

---

## Requirements

- **Node.js** >= 18.17.0
- **Strapi** v5
- **Sharp** >= 0.34.0

---

## Installation

Copy the plugin into your Strapi project:

```
src/plugins/image-proxy/
```

Register it in `config/plugins.js`:

```js
module.exports = {
  'image-proxy': {
    enabled: true,
    resolve: './src/plugins/image-proxy'
  }
};
```

Install Sharp in your Strapi project if not already present:

```bash
npm install sharp
```

---

## Configuration

All options are optional — defaults work out of the box.

```js
// config/plugins.js
module.exports = {
  'image-proxy': {
    enabled: true,
    resolve: './src/plugins/image-proxy',
    config: {
      cacheDir: '/var/cache/strapi-image-proxy',
      ttl: 60 * 60 * 24 * 30,            // 30 days
      defaultFormat: 'webp',
      defaultQuality: 85,                 // 1–100
      maxInputPixels: 100_000_000,        // 100 megapixels
      maxOutputWidth: 4000,               // 4000 px
      maxOutputHeight: 4000,              // 4000 px
      sharpConcurrency: 2,                // 2 threads per image
    }
  }
};
```

### Settings reference

| Setting | Type | Default | Description |
|---|---|---|---|
| `cacheDir` | string | `<project>/.cache/image-proxy` | Directory where processed images are cached on disk |
| `ttl` | number | `2592000` (30 days) | Cache TTL in seconds. Set to `0` to disable expiration |
| `defaultFormat` | string | `webp` | Output format when none specified in request. One of: `jpg`, `jpeg`, `png`, `webp`, `avif`, `tiff`, `gif` |
| `defaultQuality` | number | `85` (1–100) | Output quality when none specified in request |
| `maxInputPixels` | integer | `100000000` (100 megapixels) | Max source image size (width × height). Images exceeding this are served unprocessed |
| `maxOutputWidth` | integer | `4000` (4000 px) | Max allowed output width. Requests outside `1–maxOutputWidth` are rejected with `400` |
| `maxOutputHeight` | integer | `4000` (4000 px) | Max allowed output height. Requests outside `1–maxOutputHeight` are rejected with `400` |
| `sharpConcurrency` | integer | `2` (2 threads/image) | Threads per image. Keep low on shared VPS, increase on dedicated machines |

---

## Usage

Add transformation parameters to any Strapi upload URL:

```
# Original (served as-is, no processing)
https://yourdomain.cz/uploads/my-image_abc123.jpg

# Resize to 800x600, convert to webp
https://yourdomain.cz/uploads/my-image_abc123.jpg?w=800&h=600

# Resize with focal point (editor-set in Strapi media library)
https://yourdomain.cz/uploads/my-image_abc123.jpg?w=800&h=600&fpx=0.62&fpy=0.30

# Grayscale + blur
https://yourdomain.cz/uploads/my-image_abc123.jpg?w=400&grayscale=true&blur=2

# Force avif output at custom quality
https://yourdomain.cz/uploads/my-image_abc123.jpg?w=1200&format=avif&q=70

# Same as above using the `f` shorthand
https://yourdomain.cz/uploads/my-image_abc123.jpg?w=1200&f=avif&q=70

# Explicitly allow upscaling beyond original dimensions
https://yourdomain.cz/uploads/my-image_abc123.jpg?w=3000&withoutEnlargement=false
```

---

## Supported Parameters

All numeric parameters are validated and clamped to their allowed range. Invalid values are ignored.

### Resize
| Param | Type | Range | Description |
|---|---|---|---|
| `w` | number | 1–`maxOutputWidth` | Output width in pixels. Values outside this range return `400` |
| `h` | number | 1–`maxOutputHeight` | Output height in pixels. Values outside this range return `400` |
| `fit` | string | `cover`, `contain`, `fill`, `inside`, `outside` | Sharp fit mode (default: `cover`) |
| `fpx` | number | 0–1 | Focal point X (default: `0.5`) |
| `fpy` | number | 0–1 | Focal point Y (default: `0.5`) |
| `withoutEnlargement` | boolean | | Never upscale beyond original dimensions (default: `true`). Set `withoutEnlargement=false` to allow upscaling |

### Format
| Param | Type | Range | Description |
|---|---|---|---|
| `format` | string | `webp`, `avif`, `jpg`, `png`, `tiff`, `gif` | Output format |
| `f` | string | (same as `format`) | Shorthand alias for `format` |
| `q` | number | 1–100 | Quality (default: `85`) |
| `lossless` | boolean | | Lossless compression (webp only) |
| `effort` | number | 0–6 | Compression effort (webp/avif) |
| `compressionLevel` | number | 0–9 | Compression level (png only) |

### Color & Tone
| Param | Type | Range | Description |
|---|---|---|---|
| `grayscale` | boolean | | Convert to grayscale |
| `negate` | boolean | | Invert colors |
| `normalize` | boolean | | Enhance contrast by stretching luminance |
| `tint` | string | `#rgb` / `#rrggbb` | Tint with hex color e.g. `tint=%23ff0000` |
| `gamma` | number | 1.0–3.0 | Apply gamma correction |

### Blur & Sharpen
| Param | Type | Range | Description |
|---|---|---|---|
| `blur` | number | 0.3–1000 | Gaussian blur sigma |
| `sharpen` | boolean | | Apply unsharp mask |
| `median` | number | 3–99 (odd) | Median filter kernel size |

### Orientation
| Param | Type | Range | Description |
|---|---|---|---|
| `flip` | boolean | | Flip vertically |
| `flop` | boolean | | Flip horizontally |
| `rotate` | number | -360–360 | Rotate by degrees |

> **Note:** EXIF orientation is applied automatically via `autoOrient`. You only need `rotate` for additional manual rotation beyond what the camera metadata specifies.

---

## SvelteKit helper

Utilities for building proxied image URLs from Strapi image objects. Place in your SvelteKit project:

```js
// src/lib/image.js
import { strapiMedia } from '$lib/api/strapi';

/**
 * @typedef {Object} StrapiImage
 * @property {string}  url
 * @property {string}  [alternativeText]
 * @property {string}  [updatedAt]
 * @property {{ x: number, y: number }} [focalPoint]
 */

/**
 * @typedef {Object} ImageTransformOptions
 * @property {number}  [w]      - Output width in pixels
 * @property {number}  [h]      - Output height in pixels
 * @property {string}  [format] - Output format (webp, avif, jpg, png, gif)
 * @property {number}  [q]      - Quality 1–100
 * @property {string}  [fit]    - Fit mode: cover, contain, fill, inside, outside
 */

/**
 * Build a proxied image URL from a Strapi image object.
 * Automatically includes focal point when set in the media library.
 * Appends `v` param from `updatedAt` for cache busting across all layers.
 *
 * @param {StrapiImage | null | undefined} image - Strapi image object
 * @param {ImageTransformOptions} [opts]  - Transform options
 * @returns {string}
 */
export function imageUrl(image, { w, h, format, q, fit } = {}) {
  if (!image?.url) return '';

  const base = strapiMedia(image.url);
  const params = new URLSearchParams();

  if (w != null) params.set('w', String(w));
  if (h != null) params.set('h', String(h));
  if (format) params.set('f', format);
  if (q != null) params.set('q', String(q));
  if (fit) params.set('fit', fit);

  if (image.focalPoint) {
    params.set('fpx', String(image.focalPoint.x));
    params.set('fpy', String(image.focalPoint.y));
  }

  if (image.updatedAt) {
    params.set('v', String(new Date(image.updatedAt).getTime()));
  }

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Build a `srcset` string for responsive images.
 *
 * @param {StrapiImage | null | undefined} image - Strapi image object
 * @param {number[]} widths   - Array of widths, e.g. [400, 800, 1200]
 * @param {Omit<ImageTransformOptions, 'w'>} [opts] - Shared options (format, q, fit)
 * @returns {string}
 */
export function imageSrcset(image, widths, opts = {}) {
  if (!image?.url) return '';
  return widths
    .map(w => `${imageUrl(image, { ...opts, w })} ${w}w`)
    .join(', ');
}
```

> **Note:** `strapiMedia()` resolves relative `/uploads/...` paths to full URLs using your `PUBLIC_STRAPI_URL` env variable. If you don't have this helper, replace `strapiMedia(image.url)` with `image.url` for same-origin setups.

> **Important:** Include `updatedAt` and `focalPoint` in your Strapi image field selections so that cache busting and focal-point cropping work. All fields except `url` are optional — the helper gracefully skips any that are missing:
> ```js
> image: { fields: ['url', 'alternativeText', 'updatedAt', 'focalPoint'] }
> ```

### Usage: basic `<img>`

```svelte
<script>
  import { imageUrl } from '$lib/image';

  /** @type {{ image: Object }} */
  let { image } = $props();
</script>

<img
  src={imageUrl(image, { w: 800, h: 600 })}
  alt={image.alternativeText || ''}
  class="w-full h-full object-cover"
/>
```

### Usage: responsive `srcset`

```svelte
<script>
  import { imageUrl, imageSrcset } from '$lib/image';

  /** @type {{ image: Object }} */
  let { image } = $props();
</script>

<img
  src={imageUrl(image, { w: 800 })}
  srcset={imageSrcset(image, [400, 800, 1200, 1920])}
  sizes="(max-width: 640px) 400px, (max-width: 1024px) 800px, (max-width: 1536px) 1200px, 1920px"
  alt={image.alternativeText || ''}
  class="w-full h-full object-cover"
/>
```

### Usage: background image

```svelte
<div
  style:background-image="url({imageUrl(image, { w: 1920, h: 1080 })})"
  class="bg-cover bg-center h-screen"
/>
```

---

## Admin API

All endpoints require admin authentication.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/image-proxy/cache/stats` | Cache file count and total size |
| `DELETE` | `/api/image-proxy/cache/:hash` | Invalidate all variants for one image |
| `DELETE` | `/api/image-proxy/cache` | Flush entire cache |

---

## How source selection works

To avoid processing huge originals at request time, the plugin checks if Strapi has already generated a smaller format that is large enough for the requested output size. For example, a `?w=800` request will use the Strapi `large` (1000px) format as its Sharp input rather than a 50MP original. Sharp processes 1000px instead of 50MP — negligible memory, fast response.

If no suitable Strapi format exists, the original is used with `sequentialRead: true` and `limitInputPixels` set to the configured maximum. If the original exceeds the pixel limit, the request falls through to Strapi's default static handler — the original is still served, just unprocessed.

---

## Cache behaviour

- Cache keys are deterministic: query parameter order does not affect the key (`?w=800&h=600` and `?h=600&w=800` produce the same cached file)
- Cache writes are atomic (write to `.tmp`, then rename) — no partial files on crash
- Responses include `ETag` headers; browsers that send `If-None-Match` receive a `304 Not Modified` response, saving bandwidth
- `Cache-Control: public, max-age=31536000, immutable` is set on all processed images
- The `v` param from `updatedAt` busts all cache layers when a file changes in Strapi

### Cache layers

```
Browser cache (1 year, immutable)
  ↓ miss
nginx proxy_cache (optional, 30 days)
  ↓ miss
Plugin disk cache (30 day TTL)
  ↓ miss
Sharp processing → cached to disk → response flows back up
```

### nginx proxy_cache (optional, recommended)

By default, even cache HITs go through Node.js. Adding `proxy_cache` lets nginx serve cached images directly without touching Strapi:

```nginx
proxy_cache_path /var/cache/nginx/image-proxy levels=1:2
                 keys_zone=images:10m max_size=2g inactive=30d;

location /uploads/ {
    proxy_cache images;
    proxy_cache_key "$uri$is_args$args";
    proxy_cache_valid 200 30d;
    proxy_cache_valid 304 30d;
    proxy_cache_use_stale error timeout updating;

    proxy_pass http://127.0.0.1:1337;
    proxy_set_header Host $host;

    proxy_pass_header ETag;
    proxy_pass_header Cache-Control;
}
```

No purging needed — the `v` param in image URLs changes when a file is updated in Strapi, which produces a new URL and automatically misses all caches.

---

## Cache invalidation

Cache is invalidated automatically via Strapi lifecycle hooks when:
- A file is deleted from the media library
- A file is replaced (updated) in the media library

Manual invalidation is available via the admin API endpoints above, or by deleting files directly from `cacheDir`.

---

## Sharp constructor options

The plugin uses these Sharp constructor options for safety and correctness:

| Option | Value | Why |
|---|---|---|
| `limitInputPixels` | from config | Rejects oversized images before processing |
| `sequentialRead` | `true` | Memory-efficient streaming for large files |
| `failOn` | `'error'` | Tolerates slightly corrupt uploads (phone cameras, partial downloads) |
| `autoOrient` | `true` | Fixes EXIF rotation automatically — mobile photos display correctly |

---

## Performance tuning

Sharp uses a [libuv-managed thread pool](https://sharp.pixelplumbing.com/performance/) for native processing. The defaults are conservative — tune these environment variables for production:

### `UV_THREADPOOL_SIZE`

Node.js defaults to **4** libuv threads. If your machine has more than 4 physical CPU cores, increase this **before** the process starts:

```bash
# Set to the number of physical cores
export UV_THREADPOOL_SIZE="$(nproc)"
```

This controls how many images Sharp can process **in parallel**. The plugin's `sharpConcurrency` setting (default: `2`) controls how many threads are used **per image** — these are independent knobs.

### `MALLOC_ARENA_MAX` (Linux glibc only)

On Linux with the default glibc allocator, reduce memory fragmentation:

```bash
export MALLOC_ARENA_MAX="2"
```

### Example: systemd service

```ini
[Service]
Environment=UV_THREADPOOL_SIZE=8
Environment=MALLOC_ARENA_MAX=2
ExecStart=/usr/bin/node /opt/strapi/server.js
```

### Example: Docker

```dockerfile
ENV UV_THREADPOOL_SIZE=8
ENV MALLOC_ARENA_MAX=2
```

### Tuning `sharpConcurrency`

The plugin defaults to `sharpConcurrency: 2` (threads per image). This is a good trade-off for shared VPS. On dedicated machines:

| Scenario | `sharpConcurrency` | `UV_THREADPOOL_SIZE` |
|---|---|---|
| Shared VPS (1–2 cores) | `1` | `4` (default) |
| Small dedicated (4 cores) | `2` | `4` |
| Medium dedicated (8 cores) | `4` | `8` |
| Large dedicated (16+ cores) | `4`–`8` | `16` |

Keep `sharpConcurrency × concurrent_requests` below your core count to avoid thread contention.
