# strapi-plugin-image-proxy

On-demand image processing and disk caching for Strapi V5, powered by Sharp.

Intercepts requests to `/uploads/` URLs that contain valid transformation parameters. Images without parameters are served normally by Strapi's static file handler — zero overhead, zero breaking changes.

---

## Features

- On-demand resize, crop, format conversion, blur, sharpen, rotate, flip, grayscale, and more
- Focal point support via `fpx`/`fpy`. Sharp snaps these to a 3×3 gravity and only crops when **both** `w` and `h` are set. Responsive width-only srcsets do not crop; the SvelteKit helper applies the real focal point with CSS `object-position`
- Automatic EXIF orientation fix (`autoOrient`) — mobile photos display correctly without explicit `?rotate=`
- Disk cache with configurable TTL and ETag/304 support
- Automatically uses Strapi-generated thumbnail formats as source where possible (avoids processing large originals at request time)
- Works with **any Strapi V5 upload provider** — local disk, AWS S3, Cloudinary, etc. Remote sources are fetched on demand and cached locally
- Path-based Sharp input with `sequentialRead` for local files; in-memory buffer for remote — both are memory-efficient
- Safety limits: max input megapixels, max output dimensions, libvips threads per image, and a global cap on simultaneous Sharp pipelines
- Bounded concurrency queue prevents thread-pool starvation under traffic spikes
- Short-lived in-memory cache for `plugin::upload.file` lookups — responsive `srcset` does not hammer the DB on cold cache
- Dimension validation: requests with `w` or `h` outside the allowed range are rejected with a `400` response before any processing
- `withoutEnlargement` is `true` by default — images are never upscaled beyond their original dimensions unless explicitly opted out
- All query parameters are validated and clamped to safe ranges
- All metadata (EXIF, GPS, ICC, XMP) is stripped by default; opt-in flags to keep specific blocks
- Cache keys are computed only from whitelisted parameters — tracking params (`utm_*`, etc.) cannot pollute the cache
- Atomic cache writes — no partial files on crash; orphan `.tmp` files are swept on bootstrap
- Auto-invalidates disk and lookup caches when files are deleted or replaced in Strapi
- Admin API endpoints for cache invalidation, flush, and stats (results memoised for 60 s)
- Falls through gracefully on any error — never breaks image delivery

---

## Requirements

- **Node.js** >= 18.17.0
- **Strapi** v5
- **Sharp** >= 0.34.0

---

## Installation

From the Strapi project, pin a 1.x tag range:

```json
{
  "dependencies": {
    "strapi-plugin-image-proxy": "git+https://github.com/smiley-cz/strapi-plugin-image-proxy.git#semver:^1.0.0"
  }
}
```

Then `npm install`. Same specifier on the command line:

```bash
npm install git+https://github.com/smiley-cz/strapi-plugin-image-proxy.git#semver:^1.0.0
```

Strapi loads the plugin from `node_modules` because `package.json` sets `strapi.kind` to `plugin` and `strapi.name` to `image-proxy`. The `exports` map must include `./package.json` — Strapi discovers installed plugins with `require('<package>/package.json')`, and Node will reject that lookup if the subpath is missing. Enable the plugin in `config/plugins.js`. Do not set `resolve` for a GitHub/npm install. Use `resolve` only when the plugin is a folder at `src/plugins/image-proxy`.

```js
module.exports = {
  'image-proxy': {
    enabled: true,
    // resolve: './src/plugins/image-proxy'
  }
};
```

`sharp` is a dependency of this package, so the GitHub install brings it in.

---

## Configuration

All options are optional — defaults work out of the box.

```js
// config/plugins.js
module.exports = {
  'image-proxy': {
    enabled: true,
    // resolve: './src/plugins/image-proxy',
    config: {
      // cacheDir: '/var/cache/strapi-image-proxy', // default: <project>/.cache/image-proxy (see cacheDir note)
      ttl: 60 * 60 * 24 * 30,            // 30 days; set to 0 to never expire
      defaultFormat: 'webp',
      defaultQuality: 85,                 // 1–100
      maxInputPixels: 100_000_000,        // 100 megapixels
      maxOutputWidth: 4000,               // 4000 px
      maxOutputHeight: 4000,              // 4000 px
      sharpConcurrency: 2,                // libvips threads per image
      maxConcurrentJobs: 2,               // simultaneous Sharp pipelines (queue gates the rest)
      urlPrefix: '/uploads/',             // URL path prefix to intercept
      fileLookupTtl: 30,                  // seconds; in-memory cache for DB lookups (0 disables)
      fileLookupMax: 1000,                // LRU max entries for the lookup cache
      tmpFileMaxAge: 3600,                // seconds; orphan .tmp files older than this are swept on bootstrap
    }
  }
};
```

### Settings reference

| Setting | Type | Default | Description |
|---|---|---|---|
| `cacheDir` | string | `<project>/.cache/image-proxy` | Directory where processed images are cached on disk |
| `ttl` | number | `2592000` (30 days) | Cache TTL in seconds. Set to `0` to keep cached files indefinitely |
| `defaultFormat` | string | `webp` | Output format when none specified in request. One of: `jpg`, `jpeg`, `png`, `webp`, `avif`, `tiff`, `gif` |
| `defaultQuality` | number | `85` (1–100) | Output quality when none specified in request |
| `maxInputPixels` | integer | `100000000` (100 megapixels) | Max source image size (width × height). Images exceeding this are served unprocessed |
| `maxOutputWidth` | integer | `4000` (4000 px) | Max allowed output width. Requests outside `1–maxOutputWidth` are rejected with `400` |
| `maxOutputHeight` | integer | `4000` (4000 px) | Max allowed output height. Requests outside `1–maxOutputHeight` are rejected with `400` |
| `sharpConcurrency` | integer | `2` | libvips threads used **per image**. Keep low on shared VPS, increase on dedicated machines |
| `maxConcurrentJobs` | integer | `2` | Maximum **simultaneous** Sharp pipelines. Additional requests are queued (FIFO). Default × `sharpConcurrency` (2 × 2 = 4) matches Node's default `UV_THREADPOOL_SIZE`. Increase together with `UV_THREADPOOL_SIZE` for higher throughput |
| `urlPrefix` | string | `/uploads/` | URL path prefix to intercept. Must start and end with `/`. Change this if Strapi serves uploads from a different mount point |
| `fileLookupTtl` | number | `30` | Seconds to cache `plugin::upload.file` lookups in memory. Lifecycle hooks invalidate on update/delete; this is just a TTL safety net. Set `0` to disable |
| `fileLookupMax` | integer | `1000` | Max entries in the in-memory lookup cache (LRU eviction) |
| `tmpFileMaxAge` | number | `3600` | Seconds. On bootstrap, orphan `.tmp` files in `cacheDir` older than this are removed. Set `0` to disable the sweep |

### cacheDir and permissions

The default `<project>/.cache/image-proxy` needs no setup and no root. The plugin creates it on startup, as the user that runs Strapi.

A directory outside the project has to exist before the first start, owned by that user. `/var/cache` belongs to root, so the plugin cannot create a folder there itself, and Strapi stops with `EACCES`:

```bash
sudo mkdir -p /var/cache/strapi-image-proxy
sudo chown <strapi-user>:<strapi-user> /var/cache/strapi-image-proxy
```

Do not point `cacheDir` at nginx's cache directory. A full flush deletes `cacheDir` and recreates it, and nginx does not serve the plugin's files from there anyway.

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
| `fpx` | number | 0–1 | Focal point X (default: `0.5`). See [Focal point](#focal-point) |
| `fpy` | number | 0–1 | Focal point Y (default: `0.5`). See [Focal point](#focal-point) |
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

### Metadata retention

By default, **all** metadata (EXIF, GPS, ICC profile, XMP) is stripped from processed images. EXIF on photos taken with a phone often contains GPS coordinates, device IDs, and timestamps; stripping is the safe default. Opt back in only when you need it.

| Param | Type | Description |
|---|---|---|
| `keepMetadata` | boolean | Keep **all** metadata blocks (EXIF + ICC + XMP). Convenience flag |
| `keepExif` | boolean | Keep EXIF only (camera, lens, GPS, timestamps) |
| `keepIcc` | boolean | Keep the ICC color profile (useful for color-critical workflows) |
| `keepXmp` | boolean | Keep XMP metadata (Adobe / Photoshop edit history, ratings) |

> **Privacy warning:** EXIF can leak GPS coordinates and device identifiers. Only enable `keepExif` / `keepMetadata` for assets that have already been scrubbed by your editorial workflow.

### Adding new transformation parameters

The whitelist of accepted query params lives in [`server/src/constants.js`](server/src/constants.js). Adding a new param is a one-line change there, plus a handler in [`server/src/services/sharp.js`](server/src/services/sharp.js). Anything not in the whitelist is ignored — both at request-handling time and when computing cache keys, so unknown query strings (`utm_source`, tracking tokens, etc.) cannot pollute the cache.

---

## SvelteKit helper

Drop-in utilities for building proxied image URLs, `<img>` props, and a `<picture>` format cascade from Strapi image objects.

| Helper | Returns | When to use |
|---|---|---|
| `imageUrl(image, opts)` | `string` (URL) | Background images, custom markup, anywhere you just need a URL |
| `imageSrcset(image, widths, opts)` | `string` (width-descriptor srcset) | Low-level primitive when you need just a srcset |
| `imageDprSrcset(image, w, h, dpr, opts)` | `string` (DPR srcset) | Fixed-size images served at multiple pixel densities |
| `focalPointToObjectPosition(focalPoint)` | CSS `object-position` or `undefined` | When you position the crop yourself |
| `imageProps(image, opts)` | full `<img>` props, including `style` when a focal point is set | Single-format `<img>`. Spread onto `<img>` |
| `pictureProps(image, opts)` | `{ sources, img }` | **Recommended for content images.** avif and webp `<source>`s, jpg `<img>` fallback |

### Focal point

`fpx` and `fpy` do not crop to the exact focal pixel.

Sharp runs the focal point only inside `resize`, and only the `position` gravity. The plugin buckets each axis into thirds: `<= 0.33` is left or top, `>= 0.67` is right or bottom, and the middle third is centre. A focal point of `0.40, 0.40` is still `centre`.

That gravity runs only when **both** `w` and `h` are present. A width-only URL keeps the source aspect ratio, so `position` changes nothing. The params are still part of the cache key, so sending them on a width-only URL stores a duplicate variant.

Do not pass one `h` through a width-descriptor srcset. `imageSrcset(image, [400, 800, 1200], { h: 600 })` requests 400×600, 800×600, and 1200×600. Those are three aspect ratios, and the layout breaks.

Use the mode the helper already picks:

- **Responsive** (`widths`, or neither `widths` nor `w`). Omit `h`. `imageProps` and `pictureProps` set `style="object-position: X% Y%"` from `image.focalPoint`, using the real percentage rather than the 3×3 snap. The element needs `object-fit: cover` (`object-cover` in Tailwind) or that position does nothing. A later `style` attribute on the `<img>` replaces the one from the helper.
- **Fixed box** (`w` and `h`, no `widths`). Sharp crops with the 3×3 gravity. `imageDprSrcset` scales both sides per DPR (`w * d`, `h * d`), so 1x and 2x keep the same aspect ratio.

Strapi may store `focalPoint` as 0–1 or as 0–100. The helper normalizes both.

Server-side crop of the exact focal pixel, with a proportional `h` per srcset width, is not implemented. Until it is, responsive images should keep using `object-position`.

### Format

The plugin's own defaults (`defaultFormat: webp`, `defaultQuality: 85`) apply only when the URL omits `f` / `format` and `q`.

The helper does not rely on that. `imageUrl` always sends `f=jpg` and `q=70` unless you pass `format` or `q`. That keeps the `<img>` fallback explicit. `pictureProps` then adds avif and webp `<source>` elements, so each displayed size is three cached files. Use `imageProps` when you want the jpg only.

Place in your SvelteKit project:

```js
// src/lib/image.js
import { strapiMedia } from '$lib/api/strapi';

/**
 * @typedef {Object} StrapiImage
 * @property {string}  url
 * @property {string}  [alternativeText]
 * @property {string}  [updatedAt]
 * @property {number}  [width]
 * @property {number}  [height]
 * @property {{ x: number, y: number }} [focalPoint]
 */

/**
 * Full set of params accepted by the image-proxy plugin.
 * Mirrors VALID_PARAMS in `server/src/constants.js` — see "Supported Parameters" above for the full list.
 *
 * @typedef {Object} ImageTransformOptions
 * // resize
 * @property {number}  [w]                  - Output width in pixels
 * @property {number}  [h]                  - Output height in pixels
 * @property {'cover'|'contain'|'fill'|'inside'|'outside'} [fit]
 * @property {number}  [fpx]                - Focal point X (0–1); auto-filled from image.focalPoint when present
 * @property {number}  [fpy]                - Focal point Y (0–1); auto-filled from image.focalPoint when present
 * @property {boolean} [withoutEnlargement] - Plugin default is true; pass false to allow upscaling
 * // format
 * @property {'webp'|'avif'|'jpg'|'jpeg'|'png'|'tiff'|'gif'} [format]
 * @property {number}  [q]                  - Quality 1–100
 * @property {boolean} [lossless]           - webp only
 * @property {number}  [effort]             - 0–6 (webp/avif)
 * @property {number}  [compressionLevel]   - 0–9 (png only)
 * // color & tone
 * @property {boolean} [grayscale]
 * @property {boolean} [negate]
 * @property {boolean} [normalize]
 * @property {string}  [tint]               - Hex color, e.g. '#ff0000'
 * @property {number}  [gamma]              - 1.0–3.0
 * // blur & sharpen
 * @property {number}  [blur]               - 0.3–1000
 * @property {boolean} [sharpen]
 * @property {number}  [median]             - 3–99 (odd)
 * // orientation
 * @property {boolean} [flip]
 * @property {boolean} [flop]
 * @property {number}  [rotate]             - -360–360
 * // metadata retention (opt-in; default is to strip everything)
 * @property {boolean} [keepMetadata]
 * @property {boolean} [keepExif]
 * @property {boolean} [keepIcc]
 * @property {boolean} [keepXmp]
 */

const PASSTHROUGH_PARAMS = /** @type {const} */ ([
  'w', 'h', 'fit', 'withoutEnlargement',
  'q', 'lossless', 'effort', 'compressionLevel',
  'grayscale', 'negate', 'normalize', 'tint', 'gamma',
  'blur', 'sharpen', 'median',
  'flip', 'flop', 'rotate',
  'keepMetadata', 'keepExif', 'keepIcc', 'keepXmp',
]);

/**
 * Build a proxied image URL from a Strapi image object.
 * Automatically includes focal point when set in the media library.
 * Appends `v` param from `updatedAt` for cache busting across all layers.
 *
 * @param {StrapiImage | null | undefined} image
 * @param {ImageTransformOptions} [opts]
 * @returns {string}
 */
export function imageUrl(image, opts = {}) {
  if (!image?.url) return '';

  const base = strapiMedia(image.url);
  const params = new URLSearchParams();

  params.set('f', opts.format ?? 'jpg');
  params.set('q', String(opts.q ?? 70));

  for (const key of PASSTHROUGH_PARAMS) {
    if (key === 'q') continue;
    const value = opts[key];
    if (value == null || value === false) continue;
    params.set(key, value === true ? 'true' : String(value));
  }

  // Sent even on width-only URLs. Sharp crops with these only when both w and h
  // are set, and then only as a 3×3 gravity. Responsive crops use object-position.
  // On a width-only URL the params still change the cache key.
  const fpx = opts.fpx ?? image.focalPoint?.x;
  const fpy = opts.fpy ?? image.focalPoint?.y;
  if (fpx != null) params.set('fpx', String(fpx > 1 ? fpx / 100 : fpx));
  if (fpy != null) params.set('fpy', String(fpy > 1 ? fpy / 100 : fpy));

  if (image.updatedAt) {
    params.set('v', String(new Date(image.updatedAt).getTime()));
  }

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Build a width-descriptor `srcset` string.
 *
 * @param {StrapiImage | null | undefined} image
 * @param {number[]} widths
 * @param {Omit<ImageTransformOptions, 'w'>} [opts]
 * @returns {string}
 */
export function imageSrcset(image, widths, opts = {}) {
  if (!image?.url || !widths?.length) return '';
  return widths
    .map((w) => `${imageUrl(image, { ...opts, w })} ${w}w`)
    .join(', ');
}

/**
 * Build a DPR-descriptor `srcset` for fixed-size images.
 * Use when the image's CSS size is constant across breakpoints (avatars,
 * decorative portraits, icons). The browser picks based on devicePixelRatio.
 *
 * @param {StrapiImage | null | undefined} image
 * @param {number} w
 * @param {number} [h]
 * @param {number[]} [dpr]
 * @param {Omit<ImageTransformOptions, 'w' | 'h'>} [opts]
 * @returns {string}
 */
export function imageDprSrcset(image, w, h, dpr = [1, 2], opts = {}) {
  if (!image?.url || !w) return '';
  return dpr
    .map((d) => `${imageUrl(image, { ...opts, w: w * d, h: h ? h * d : undefined })} ${d}x`)
    .join(', ');
}

const DEFAULT_WIDTHS = [400, 800, 1200, 1920];
const DEFAULT_DPR = [1, 2];
const DEFAULT_FORMAT_CASCADE = /** @type {const} */ (['avif', 'webp']);

/** @type {Record<string, string>} */
const FORMAT_MIME = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  tiff: 'image/tiff',
  gif: 'image/gif',
};

/**
 * @typedef {Object} ImagePropsOptions
 * Mode is auto-detected:
 *   - `widths` provided → width-descriptor srcset (responsive)
 *   - `w` + `h` (no `widths`) → DPR srcset (fixed-size)
 *   - just `w` → single-source <img>
 *
 * @property {number[]}  [widths]        - Width candidates; defaults to [400, 800, 1200, 1920] when neither widths nor w are provided
 * @property {number[]}  [dpr]           - DPR descriptors for fixed-size mode; default [1, 2]
 * @property {string}    [sizes]         - Required for eager images; ignored for DPR mode. Lazy images default to 'auto'
 * @property {'lazy'|'eager'} [loading]  - Default 'lazy'
 * @property {'async'|'sync'|'auto'} [decoding] - Default 'async'
 * @property {'high'|'low'|'auto'} [fetchpriority]
 * @property {string}    [alt]           - Overrides image.alternativeText
 * // plus all ImageTransformOptions (w, h, format, q, fit, blur, …)
 */

/**
 * Build a complete set of `<img>` props from a Strapi image object.
 * Spread the result onto an `<img>` element.
 *
 * Defaults align with https://piccalil.li/blog/the-end-of-responsive-images/ —
 * lazy images get `sizes="auto"` so the browser picks the best candidate based
 * on actual rendered size. Eager images must supply explicit `sizes`.
 *
 * @param {StrapiImage | null | undefined} image
 * @param {ImagePropsOptions & ImageTransformOptions} [opts]
 */
export function imageProps(image, opts = {}) {
  const {
    widths, dpr = DEFAULT_DPR, sizes,
    loading = 'lazy', decoding = 'async', fetchpriority,
    alt, ...transform
  } = opts;

  if (!image?.url) {
    return { src: '', alt: alt ?? '', loading, decoding };
  }

  /** @type {{ src: string, srcset?: string, sizes?: string, width?: number, height?: number, alt: string, loading: 'lazy' | 'eager', decoding: 'async' | 'sync' | 'auto', fetchpriority?: 'high' | 'low' | 'auto', style?: string }} */
  const props = { src: '', alt: alt ?? image.alternativeText ?? '', loading, decoding };
  if (fetchpriority) props.fetchpriority = fetchpriority;

  // Focal point as object-position. Needs object-fit: cover on the element.
  // Sharp's fpx/fpy crop is a separate path and only runs when both w and h are set.
  const objectPosition = focalPointToObjectPosition(image.focalPoint);
  if (objectPosition) props.style = `object-position: ${objectPosition}`;

  // Fixed-size DPR mode
  if (!widths && transform.w != null) {
    const w = transform.w;
    const h = transform.h;
    props.src = imageUrl(image, transform);
    props.srcset = imageDprSrcset(image, w, h, dpr, transform);
    props.width = w;
    if (h != null) props.height = h;
    return props;
  }

  // Responsive width-descriptor mode (default)
  const widthList = widths ?? DEFAULT_WIDTHS;
  const largest = widthList[widthList.length - 1];

  if (loading === 'eager' && !sizes && import.meta.env?.DEV) {
    console.warn(
      '[imageProps] eager image without explicit `sizes` — falling back to "100vw". ' +
        '`sizes="auto"` only works with loading="lazy".',
      image.url
    );
  }

  props.src = imageUrl(image, { ...transform, w: largest });
  props.srcset = imageSrcset(image, widthList, transform);
  props.sizes = sizes ?? (loading === 'lazy' ? 'auto' : '100vw');
  if (image.width && image.height) {
    props.width = image.width;
    props.height = image.height;
  }
  return props;
}

/**
 * @typedef {Object} PictureSource
 * @property {string} srcset
 * @property {string} type    - MIME type, e.g. "image/avif"
 * @property {string} [sizes]
 */

/**
 * @typedef {Object} PictureProps
 * @property {PictureSource[]} sources - One `<source>` per format in the cascade
 * @property {{ src: string, srcset?: string, sizes?: string, width?: number, height?: number, alt: string, loading: 'lazy'|'eager', decoding: 'async'|'sync'|'auto', fetchpriority?: 'high'|'low'|'auto', style?: string }} img - Fallback `<img>` props (jpg); `style` carries focal-point `object-position` when set
 */

/*
 * Focal-point cropping for responsive images is handled client-side via CSS
 * `object-position` (see `focalPointToObjectPosition`), which `imageProps` bakes into
 * the returned `img.style` so a plain `{...img}` spread applies it automatically.
 *
 * The `fpx`/`fpy` URL params ARE still appended to proxy URLs for Sharp, but Sharp's
 * focal-point crop only activates when both `w` and `h` are present. In responsive
 * width-descriptor srcsets, `imageSrcset` passes a single `h` from opts to every entry,
 * meaning 400×h, 800×h, 1200×h would all get different aspect ratios — breaking layout.
 *
 * A future refactor could add an `aspectRatio` option to `imageSrcset`/`pictureProps`
 * that computes a proportional `h` per width candidate (e.g. h = w * 9/16). This would
 * let Sharp pre-crop around the focal point server-side, reducing transferred image data.
 * Until then, CSS object-position handles the visual crop correctly at all viewport sizes.
 */

/**
 * Convert a Strapi focalPoint to a CSS object-position value.
 * Returns undefined when no focal point is set, so the browser default (center) applies.
 * Accepts 0–1 fractions or 0–100 percentages.
 *
 * @param {{ x: number, y: number } | null | undefined} focalPoint
 * @returns {string | undefined}
 */
export function focalPointToObjectPosition(focalPoint) {
  if (!focalPoint) return undefined;
  const x = focalPoint.x > 1 ? focalPoint.x : focalPoint.x * 100;
  const y = focalPoint.y > 1 ? focalPoint.y : focalPoint.y * 100;
  return `${Math.round(x)}% ${Math.round(y)}%`;
}

/**
 * Build props for a <picture> element.
 * sources: avif, then webp. img: jpg fallback from imageProps (includes object-position).
 *
 * Do not pass a single h into a responsive width list. For a fixed box, pass w and h
 * and omit widths so each format uses a DPR srcset with both dimensions scaled.
 *
 * @param {StrapiImage | null | undefined} image
 * @param {ImagePropsOptions & ImageTransformOptions & { formats?: Array<'avif'|'webp'|'png'|'tiff'|'gif'> }} [opts]
 * @returns {PictureProps}
 */
export function pictureProps(image, opts = {}) {
  const {
    formats = DEFAULT_FORMAT_CASCADE,
    widths,
    dpr = DEFAULT_DPR,
    sizes,
    loading = 'lazy',
    decoding = 'async',
    alt,
    ...transform
  } = opts;

  const fallback = {
    sources: [],
    img: { src: '', alt: alt ?? '', loading, decoding },
  };

  if (!image?.url) return fallback;

  const useDpr = !widths && transform.w != null;

  const srcsetFor = (fmt) => {
    if (useDpr) {
      const w = /** @type {number} */ (transform.w);
      const h = transform.h;
      return imageDprSrcset(image, w, h, dpr, { ...transform, format: fmt });
    }
    const widthList = widths ?? DEFAULT_WIDTHS;
    return imageSrcset(image, widthList, { ...transform, format: fmt });
  };

  const resolvedSizes = useDpr ? undefined : (sizes ?? (loading === 'lazy' ? 'auto' : '100vw'));

  const sources = formats.map((fmt) => {
    const entry = {
      srcset: srcsetFor(fmt),
      type: FORMAT_MIME[fmt] ?? `image/${fmt}`,
    };
    if (resolvedSizes) entry.sizes = resolvedSizes;
    return entry;
  });

  const imgProps = imageProps(image, { ...opts, format: 'jpg' });
  return { sources, img: imgProps };
}
```

> **Note:** `strapiMedia()` resolves relative `/uploads/...` paths to full URLs using your `PUBLIC_STRAPI_URL` env variable. If you don't have this helper, replace `strapiMedia(image.url)` with `image.url` for same-origin setups.

> **Strapi field selection:** include `updatedAt`, `focalPoint`, `width`, and `height` so cache busting, `object-position`, and CLS-preventing intrinsic dimensions all work. All fields except `url` are optional. The helper skips any that are missing:
> ```js
> image: { fields: ['url', 'alternativeText', 'updatedAt', 'focalPoint', 'width', 'height'] }
> ```

### Usage: responsive `<picture>` (recommended)

For content images, use the format cascade. Below the fold, `loading="lazy"` and `sizes="auto"` let the browser measure the rendered size and pick a candidate. That is the [pattern Mat Marquis describes](https://piccalil.li/blog/the-end-of-responsive-images/) now that Gecko and WebKit ship `sizes="auto"`.

Keep `object-cover` on the `<img>`. The helper's `style` is the focal-point `object-position`. Do not pass `h` here.

```svelte
<script>
  import { pictureProps } from '$lib/image';
  let { image } = $props();
  const pic = $derived(pictureProps(image));
</script>

<picture>
  {#each pic.sources as source}
    <source srcset={source.srcset} type={source.type} sizes={source.sizes} />
  {/each}
  <img {...pic.img} class="h-full w-full object-cover" />
</picture>
```

That yields:

- avif and webp `srcset`s at `400w / 800w / 1200w / 1920w` (override with `widths`)
- a jpg `srcset` on the `<img>`, quality 70
- `sizes="auto"` on lazy images
- `width` / `height` from the Strapi file, for layout
- `object-position` when `focalPoint` is set

### Usage: responsive `<img>`

Same layout contract, one format (jpg at quality 70 unless you pass `format` or `q`):

```svelte
<script>
  import { imageProps } from '$lib/image';
  let { image } = $props();
</script>

<img {...imageProps(image)} class="h-full w-full object-cover" />
```

### Usage: above-the-fold / LCP

Eager images are requested before layout, so the browser cannot compute `sizes="auto"`. Pass an explicit `sizes` and, for the LCP image, `fetchpriority="high"`. Still omit `h`.

```svelte
<script>
  import { pictureProps } from '$lib/image';
  let { image } = $props();
  const pic = $derived(pictureProps(image, {
    widths: [600, 1220, 1920],
    loading: 'eager',
    fetchpriority: 'high',
    sizes: '(min-width: 1024px) 1220px, 100vw',
  }));
</script>

<picture>
  {#each pic.sources as source}
    <source srcset={source.srcset} type={source.type} sizes={source.sizes} />
  {/each}
  <img {...pic.img} class="h-full w-full object-cover" />
</picture>
```

### Usage: fixed-size image (DPR srcset)

For a constant CSS size (avatars, portraits, icons), pass `w` and `h` and omit `widths`. Each format gets a DPR srcset (`1x` / `2x` / ...), and Sharp crops with the 3×3 focal gravity because both dimensions are on the URL. Omit `h` only when you do not want that server crop.

```svelte
<script>
  import { pictureProps } from '$lib/image';
  let { image } = $props();
  const pic = $derived(pictureProps(image, { w: 336, h: 432, dpr: [1, 2, 3] }));
</script>

<picture>
  {#each pic.sources as source}
    <source srcset={source.srcset} type={source.type} />
  {/each}
  <img {...pic.img} class="rounded-sm object-cover" />
</picture>
```

### Usage: just the URL

For background images, `<picture>` source elements, or any custom markup:

```svelte
<div
  style:background-image="url({imageUrl(image, { w: 1920, h: 1080 })})"
  class="bg-cover bg-center h-screen"
/>
```

`imageUrl` accepts every plugin-whitelisted param — see the [Supported Parameters](#supported-parameters) section above for the full list (blur, grayscale, tint, withoutEnlargement, keepExif, etc.).

---

## Admin API

All endpoints require admin authentication (admin JWT in `Authorization: Bearer <token>`). They are mounted on the admin server, **not** under `/api`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/image-proxy/cache/stats` | Cache file count and total size |
| `DELETE` | `/image-proxy/cache/:hash` | Invalidate all variants for one image |
| `DELETE` | `/image-proxy/cache` | Flush entire cache |

### Calling the admin API

```bash
# 1. Get an admin JWT
TOKEN=$(curl -s -X POST https://your-strapi-host/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"YourPassword"}' \
  | jq -r '.data.token')

# 2. Call the endpoint
curl -s https://your-strapi-host/image-proxy/cache/stats \
  -H "Authorization: Bearer $TOKEN" | jq
```

From browser DevTools while logged into the Strapi admin panel:
```js
const token = JSON.parse(sessionStorage.getItem('jwtToken') || localStorage.getItem('jwtToken'));
fetch('/image-proxy/cache/stats', {
  headers: { Authorization: `Bearer ${token}` },
}).then(r => r.json()).then(console.log);
```

---

## How source selection works

To avoid processing huge originals at request time, the plugin checks if Strapi has already generated a smaller format that is large enough for the requested output size. For example, a `?w=800` request will use the Strapi `large` (1000px) format as its Sharp input rather than a 50MP original. Sharp processes 1000px instead of 50MP — negligible memory, fast response.

If no suitable Strapi format exists, the original is used with `sequentialRead: true` and `limitInputPixels` set to the configured maximum. If the original exceeds the pixel limit, the request falls through to Strapi's default static handler — the original is still served, just unprocessed.

## Upload provider support (local, S3, Cloudinary, …)

The plugin works with any Strapi V5 upload provider. The `plugin::upload.file` record's `url` field is the source of truth:

- **Relative URLs** (e.g. `/uploads/foo_abc123.jpg`) — local disk provider. The file is read from `<publicDir><url>` and streamed into Sharp.
- **Absolute URLs** (e.g. `https://my-bucket.s3.amazonaws.com/foo.jpg`) — remote provider. The plugin fetches the source over HTTPS (10 s timeout), processes it, and caches the result locally. Subsequent requests for the same variant are served from the local disk cache without hitting the remote provider.

For the proxy to fire, your frontend must request images through the **Strapi origin**, not directly from the cloud bucket. This typically means leaving `image.url` as-is in your API responses and ensuring your frontend helper points to your Strapi domain. The included SvelteKit helper does this via `strapiMedia()`.

If your provider serves uploads from a path other than `/uploads/` (e.g. `/media/` or `/static/uploads/`), set `urlPrefix` accordingly in plugin config.

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
nginx proxy_cache (optional, dropped after 30 days without requests)
  ↓ miss
Plugin disk cache (30 day TTL)
  ↓ miss
Sharp processing → cached to disk → response flows back up
```

Only processed images get the 1-year header. Originals requested without parameters are served by Strapi's static handler with its own `Cache-Control` (`max-age=0` by default), and the nginx config below does not cache them.

### nginx proxy_cache (optional, recommended)

By default, even cache HITs go through Node.js. Adding `proxy_cache` lets nginx serve cached images directly without touching Strapi.

nginx needs two pieces in two places. `proxy_cache_path` is only allowed in the `http {}` block, and nginx rejects it inside `server {}`. The `location` goes into your Strapi `server {}` block:

```nginx
# 1) Inside http {}, once per server.
#    On Debian/Ubuntu, a file under /etc/nginx/conf.d/ is read there.
proxy_cache_path /var/cache/nginx-image-proxy levels=1:2
                 keys_zone=image_proxy:10m max_size=2g inactive=30d;

# 2) Inside your Strapi server {} block.
location ^~ /uploads/ {
    proxy_pass http://127.0.0.1:1337;   # your Strapi port
    proxy_set_header Host $host;

    proxy_cache image_proxy;
    proxy_cache_key "$host$uri$is_args$args";
    proxy_cache_valid 200 30d;
    proxy_cache_use_stale error timeout updating;
    proxy_cache_lock on;

    add_header X-Image-Cache $upstream_cache_status always;
}
```

What each part does:

- `/var/cache/nginx-image-proxy` sits directly under `/var/cache`, which always exists. nginx creates only the last folder of a cache path, and hands it to its worker user. A path such as `/var/cache/nginx/image-proxy` fails to start when `/var/cache/nginx` is missing.
- `^~` makes this location win over regex locations, such as `location ~* \.(jpe?g|png|webp)$`. A plain `location /uploads/` loses to them, and nothing gets cached.
- nginx keeps the plugin's `Cache-Control: public, max-age=31536000, immutable`, so a processed image stays in nginx while it keeps being requested. `inactive=30d` drops it after 30 days without requests, and `max_size` caps the disk use.
- Strapi sends `max-age=0` for originals, so nginx passes them through uncached. Error responses are not cached either. If Sharp fails, the plugin falls through to the original and sends `X-Accel-Expires: 0`, so that response is not cached.
- `$host` in the key keeps several sites apart when they share one zone.
- `proxy_cache_lock` lets one request for a new variant run Sharp while other requests for that URL wait for its result.
- `X-Image-Cache` shows `MISS`, `HIT`, or `EXPIRED` on each response.

Notes:

- nginx does not inherit `add_header` or `proxy_set_header` into a `location` that sets its own. If your `server {}` block sets security headers or `X-Forwarded-*` headers, repeat them inside this location.
- If you change `urlPrefix`, change the location to match.
- Use a zone name and a directory that no other `proxy_cache_path` uses. nginx refuses to start when two zones share a name or a path. If the server already caches media in another zone, use that zone instead of adding this block.

Check it with a URL that has not been requested yet:

```bash
curl -sI "https://your-strapi-host/uploads/<file>.jpg?w=320&v=check1" | grep -iE "cache-control|x-image-cache"
```

The first request shows `X-Image-Cache: MISS`, the second `HIT`. Both show `max-age=31536000`.

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

### Tuning `sharpConcurrency` and `maxConcurrentJobs`

Two independent knobs control Sharp's resource usage:

- **`sharpConcurrency`** — libvips threads used **per image**. More threads make a single image faster but proportionally hungrier.
- **`maxConcurrentJobs`** — how many images can be processed **at the same time**. Anything over this limit is queued (FIFO). Prevents traffic spikes from spawning unbounded pipelines and starving the libuv thread pool.

Effective thread usage at peak load is approximately `sharpConcurrency × maxConcurrentJobs`. Set `UV_THREADPOOL_SIZE` to at least that value. The plugin warns at boot if it isn't.

| Scenario | `sharpConcurrency` | `maxConcurrentJobs` | Product | `UV_THREADPOOL_SIZE` |
|---|---|---|---|---|
| Default / shared VPS (1–2 cores) | `2` | `2` | `4` | `4` (Node default) |
| Small dedicated (4 cores) | `2` | `4` | `8` | `8` |
| Medium dedicated (8 cores) | `2` | `8` | `16` | `16` |
| Large dedicated (16+ cores) | `4` | `8` | `32` | `32` |

The plugin warns at boot if `UV_THREADPOOL_SIZE < sharpConcurrency × maxConcurrentJobs`. Keep that product at or below your core count to avoid contention with the rest of the libuv pool (DNS, fs, crypto).
