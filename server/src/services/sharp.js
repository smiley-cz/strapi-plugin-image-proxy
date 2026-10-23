'use strict';

const path = require('path');
const sharp = require('sharp');
const createLimit = require('../utils/limit');

const VALID_FITS = new Set(['cover', 'contain', 'fill', 'inside', 'outside']);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

//% ============================================
//% Numeric helpers
//% ============================================

function int(val, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function float(val, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

//% ============================================
//% Focal point
//% ============================================

/*
 * 0–1 fractions stay as they are. Values above 1 are percentages
 * (Strapi sometimes stores 41.25 rather than 0.4125). 1 itself stays
 * the right/bottom edge of the 0–1 scale.
 */
function focalFraction(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  const fraction = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, fraction));
}

/*
 * metadata() reports stored pixels. autoOrient has already turned the
 * pipeline into display space, so orientations 5–8 need their axes swapped
 * before the crop window is measured.
 */
function orientedDimensions(meta) {
  const width = meta?.width || 0;
  const height = meta?.height || 0;
  const orientation = meta?.orientation || 0;
  if (orientation >= 5 && orientation <= 8) {
    return { width: height, height: width };
  }
  return { width, height };
}

/*
 * Cover window in source pixels, aligned like CSS object-position.
 * 0 keeps the start edge, 1 keeps the far edge, and 0.4 sits 40% of
 * the way between those two crops.
 *
 * Centring the window on the point instead pins every value outside the
 * middle of the travel (often the old 0.33 / 0.67 thirds) to one edge.
 * A 3:2 photo cropped toward a square does that to 0.4, while 0.41 still
 * moves. fpx/fpy stay at full float precision. Only the pixel edges are
 * rounded. Null means the window is the whole frame.
 */
function focalCoverRegion(srcW, srcH, destW, destH, fpx, fpy) {
  if (!srcW || !srcH || !destW || !destH) return null;
  if (fpx == null || fpy == null) return null;

  const destAspect = destW / destH;
  let cropW;
  let cropH;
  if (srcW / srcH > destAspect) {
    cropH = srcH;
    cropW = srcH * destAspect;
  } else {
    cropW = srcW;
    cropH = srcW / destAspect;
  }

  const width = Math.max(1, Math.min(srcW, Math.round(cropW)));
  const height = Math.max(1, Math.min(srcH, Math.round(cropH)));
  if (width === srcW && height === srcH) return null;

  let left = Math.round((srcW - width) * fpx);
  let top = Math.round((srcH - height) * fpy);
  left = Math.max(0, Math.min(left, srcW - width));
  top = Math.max(0, Math.min(top, srcH - height));

  return { left, top, width, height };
}

module.exports = ({ strapi }) => {
  const config = strapi.config.get('plugin::image-proxy');

  /*
   * One semaphore per plugin instance, gating concurrent Sharp pipelines.
   * sharp.concurrency() only controls libvips threads PER pipeline; without
   * this gate, a traffic spike can spawn N pipelines × sharpConcurrency
   * threads each, oversubscribing the libuv thread pool and starving every
   * other I/O op in Strapi.
   */
  const limit = createLimit(config.maxConcurrentJobs);

  return {
    //% ============================================
    //% validateDimensions
    //% ============================================
    validateDimensions(w, h) {
      const { maxOutputWidth, maxOutputHeight } = strapi.config.get('plugin::image-proxy');
      if (w && w > maxOutputWidth) {
        throw new Error(`Requested width ${w} exceeds maximum ${maxOutputWidth}`);
      }
      if (h && h > maxOutputHeight) {
        throw new Error(`Requested height ${h} exceeds maximum ${maxOutputHeight}`);
      }
    },

    //% ============================================
    //% pickBestSource — smallest Strapi-generated format that still covers
    //%                  the target size; avoids re-processing huge originals
    //% ============================================
    pickBestSource(formats, targetWidth, targetHeight) {
      if (!formats) return null;
      const target = Math.max(targetWidth || 0, targetHeight || 0);
      if (target === 0) return null;
      const candidates = Object.values(formats)
        .filter(f => f.width >= target)
        .sort((a, b) => a.width - b.width);
      return candidates[0] ?? null;
    },

    //% ============================================
    //% process — accepts a local path (string) or an in-memory Buffer
    //%           (used when the source lives on a remote provider, e.g. S3)
    //% ============================================
    process(source, params) {
      return limit(() => runPipeline(source, params, strapi));
    },
  };
};

//% ============================================
//% runPipeline — pure function; all knobs come from params + config
//% ============================================
async function runPipeline(source, params, strapi) {
  const config = strapi.config.get('plugin::image-proxy');

  const w = int(params.w, 1, config.maxOutputWidth);
  const h = int(params.h, 1, config.maxOutputHeight);

  /*
   * Single Sharp instance: limitInputPixels rejects oversized images,
   * failOn 'error' tolerates slightly corrupt uploads (phone cameras etc.),
   * autoOrient fixes EXIF rotation before any transforms.
   */
  let pipeline = sharp(source, {
    limitInputPixels: config.maxInputPixels,
    sequentialRead: true,
    failOn: 'error',
    autoOrient: true,
  });

  /*
   * Focal point only crops when both w and h are present. With one
   * dimension, Sharp derives the other from the source aspect ratio and
   * there is no window to slide. Width-descriptor srcsets must not share
   * one h across every width. Responsive callers should crop with CSS
   * object-position instead. See the README.
   *
   * cover uses the fraction as given (0.412 and 0.418 are different once
   * that gap is at least a pixel). The window is extracted, then scaled.
   * Other fits still map the point onto Sharp's 3×3 position gravity
   * (thresholds 0.33 and 0.67), because those modes do not crop to a
   * focal pixel.
   */
  //+ Resize + focal point
  if (w || h) {
    const fit = VALID_FITS.has(params.fit) ? params.fit : 'cover';
    const fpx = focalFraction(params.fpx) ?? 0.5;
    const fpy = focalFraction(params.fpy) ?? 0.5;
    const withoutEnlargement = params.withoutEnlargement !== 'false';
    const focalRequested = (params.fpx != null && params.fpx !== '')
      || (params.fpy != null && params.fpy !== '');

    //+ Exact cover crop from the full fpx/fpy fraction
    if (fit === 'cover' && w && h && focalRequested) {
      const meta = await sharp(source, {
        limitInputPixels: config.maxInputPixels,
        failOn: 'error',
      }).metadata();
      const { width: srcW, height: srcH } = orientedDimensions(meta);
      const region = focalCoverRegion(srcW, srcH, w, h, fpx, fpy);
      if (region) {
        pipeline = pipeline.extract(region);
        /*
         * fill scales the extracted window to w×h. A follow-up cover crop
         * would shave a rounded edge and slide the focal pixel.
         */
        pipeline = pipeline.resize(w, h, { fit: 'fill', withoutEnlargement });
      } else {
        pipeline = pipeline.resize(w, h, { fit: 'cover', withoutEnlargement });
      }
    } else {
      const col = fpx <= 0.33 ? 'left' : fpx >= 0.67 ? 'right' : '';
      const row = fpy <= 0.33 ? 'top' : fpy >= 0.67 ? 'bottom' : '';
      const position = col || row ? [col, row].filter(Boolean).join(' ') : 'centre';

      pipeline = pipeline.resize(w, h, {
        fit,
        position,
        withoutEnlargement,
      });
    }
  }

  //+ Color & tone
  if (params.grayscale === 'true')  pipeline = pipeline.grayscale();
  if (params.negate === 'true')     pipeline = pipeline.negate();
  if (params.normalize === 'true')  pipeline = pipeline.normalize();
  if (params.tint && HEX_COLOR_RE.test(params.tint)) {
    pipeline = pipeline.tint(params.tint);
  }
  if (params.gamma) {
    const g = float(params.gamma, 1.0, 3.0);
    if (g) pipeline = pipeline.gamma(g);
  }

  //+ Blur & sharpen
  if (params.blur) {
    const sigma = float(params.blur, 0.3, 1000);
    if (sigma) pipeline = pipeline.blur(sigma);
  }
  if (params.sharpen === 'true')    pipeline = pipeline.sharpen();
  if (params.median) {
    const m = int(params.median, 3, 99);
    if (m && m % 2 === 1) pipeline = pipeline.median(m);
  }

  //+ Orientation (manual — autoOrient already handled EXIF)
  if (params.flip === 'true')       pipeline = pipeline.flip();
  if (params.flop === 'true')       pipeline = pipeline.flop();
  if (params.rotate) {
    const deg = float(params.rotate, -360, 360);
    if (deg !== null) pipeline = pipeline.rotate(deg);
  }

  /*
   * Metadata: Sharp strips ALL metadata by default. We re-introduce specific
   * pieces only when the caller opts in. EXIF on photos can contain GPS
   * coordinates and device info, so default-strip is the safe choice.
   */
  if (params.keepMetadata === 'true') {
    pipeline = pipeline.keepMetadata();
  } else {
    if (params.keepExif === 'true') pipeline = pipeline.keepExif();
    if (params.keepIcc === 'true')  pipeline = pipeline.keepIccProfile();
    if (params.keepXmp === 'true')  pipeline = pipeline.keepXmp();
  }

  //+ Format (always last) — preserve source format unless explicitly overridden
  const sourceExt = typeof source === 'string'
    ? path.extname(source).slice(1).toLowerCase()
    : '';
  const format = params.format || params.f || sourceExt || config.defaultFormat;
  const quality = int(params.q, 1, 100) ?? config.defaultQuality;
  const formatOptions = { quality };

  if (format === 'webp') {
    formatOptions.effort = int(params.effort, 0, 6) ?? 4;
    if (params.lossless === 'true') formatOptions.lossless = true;
  }
  if (format === 'avif') {
    formatOptions.effort = int(params.effort, 0, 6) ?? 4;
  }
  if (format === 'png') {
    delete formatOptions.quality;
    formatOptions.compressionLevel = int(params.compressionLevel, 0, 9) ?? 6;
  }

  pipeline = pipeline.toFormat(format, formatOptions);

  return pipeline.toBuffer();
}
