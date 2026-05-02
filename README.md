# strapi-plugin-image-proxy

On-demand image processing and disk caching for Strapi V5, powered by Sharp.

Intercepts requests to `/uploads/` URLs that contain valid transformation parameters. Images without parameters are served normally by Strapi's static file handler — zero overhead, zero breaking changes.

---

## Features

- On-demand resize, crop, format conversion, blur, sharpen, rotate, flip, grayscale, and more
- Focal point-aware cropping via `fpx`/`fpy` params
- Disk cache with configurable TTL
- Automatically uses Strapi-generated thumbnail formats as source where possible (avoids processing large originals at request time)
- Path-based Sharp input with `sequentialRead` — memory-efficient, handles large files safely
- Safety limits: max input megapixels, max output dimensions, Sharp concurrency cap
- Auto-invalidates cache when files are deleted or replaced in Strapi
- Admin API endpoints for cache invalidation, flush, and stats
- Falls through gracefully on any error — never breaks image delivery

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
      // Directory where processed images are cached on disk
      cacheDir: '/var/cache/strapi-image-proxy',

      // Cache TTL in seconds (default: 30 days)
      ttl: 60 * 60 * 24 * 30,

      // Default output format when none specified in request
      defaultFormat: 'webp',

      // Default output quality when none specified in request
      defaultQuality: 85,

      // Maximum input image size in megapixels
      // Images exceeding this will not be processed dynamically
      maxInputPixels: 500_000_000,

      // Maximum allowed output dimensions
      maxOutputWidth: 4000,
      maxOutputHeight: 4000,

      // Sharp thread concurrency — keep low on shared VPS
      sharpConcurrency: 2,
    }
  }
};
```

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
```

---

## Supported Parameters

### Resize
| Param | Type | Description |
|---|---|---|
| `w` | number | Output width in pixels |
| `h` | number | Output height in pixels |
| `fit` | string | Sharp fit mode: `cover`, `contain`, `fill`, `inside`, `outside` (default: `cover`) |
| `fpx` | number | Focal point X as a decimal 0–1 (default: `0.5`) |
| `fpy` | number | Focal point Y as a decimal 0–1 (default: `0.5`) |
| `withoutEnlargement` | boolean | Never upscale beyond original dimensions |

### Format
| Param | Type | Description |
|---|---|---|
| `format` | string | Output format: `webp`, `avif`, `jpg`, `png`, `tiff` |
| `q` | number | Quality 1–100 (default: `85`) |
| `lossless` | boolean | Lossless compression (webp only) |
| `effort` | number | Compression effort 0–6 (webp/avif) |
| `compressionLevel` | number | Compression level 0–9 (png only) |

### Color & Tone
| Param | Type | Description |
|---|---|---|
| `grayscale` | boolean | Convert to grayscale |
| `negate` | boolean | Invert colors |
| `normalize` | boolean | Enhance contrast by stretching luminance |
| `tint` | string | Tint with hex color e.g. `tint=%23ff0000` |
| `gamma` | number | Apply gamma correction |

### Blur & Sharpen
| Param | Type | Description |
|---|---|---|
| `blur` | number | Gaussian blur sigma (0.3–1000) |
| `sharpen` | boolean | Apply unsharp mask |
| `median` | number | Median filter kernel size |

### Orientation
| Param | Type | Description |
|---|---|---|
| `flip` | boolean | Flip vertically |
| `flop` | boolean | Flip horizontally |
| `rotate` | number | Rotate by degrees |

---

## SvelteKit helper

A utility for building image URLs with focal point support from Strapi image objects:

```js
// src/lib/image.js
export function imageUrl(image, { w, h, format } = {}) {
  if (!image?.url) return '';

  const base = image.url; // already includes /uploads/
  const params = new URLSearchParams();

  if (w) params.set('w', w);
  if (h) params.set('h', h);
  if (format) params.set('format', format);

  if (image.focalPoint) {
    params.set('fpx', image.focalPoint.x);
    params.set('fpy', image.focalPoint.y);
  }

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
```

Usage in a Svelte component:

```svelte
<script>
  import { imageUrl } from '$lib/image';
  export let image;
</script>

<img
  src={imageUrl(image, { w: 800, h: 600 })}
  alt={image.alternativeText}
  class="w-full h-full object-cover"
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

## Cache invalidation

Cache is invalidated automatically via Strapi lifecycle hooks when:
- A file is deleted from the media library
- A file is replaced (updated) in the media library

Manual invalidation is available via the admin API endpoints above, or by deleting files directly from `cacheDir`.
