# VisionScan — Implementation Reference

A document scanning web app that turns phone photos of documents into clean, searchable PDFs. The stack is a Next.js 15 frontend deployed on Vercel talking to a FastAPI backend deployed as a Docker Space on Hugging Face.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Frontend](#2-frontend)
3. [Backend](#3-backend)
4. [Image Processing Pipeline](#4-image-processing-pipeline)
5. [OCR](#5-ocr)
6. [PDF Export](#6-pdf-export)
7. [Deployment](#7-deployment)
8. [Local Development](#8-local-development)
9. [Environment Variables](#9-environment-variables)
10. [Data Flow — End to End](#10-data-flow--end-to-end)

---

## 1. Architecture Overview

```
Browser (Next.js)
      │
      │  HTTP multipart/form-data  (images + options)
      │
      ▼
Hugging Face Docker Space (FastAPI / Uvicorn, port 7860)
      │
      ├── /process        OpenCV manual filters
      ├── /auto-scan      Full document pipeline
      ├── /ocr            Tesseract text extraction
      └── /export-pdf     fpdf2 or pytesseract PDF assembly
```

The frontend and backend are completely decoupled. The frontend sends raw or processed images as binary blobs in `multipart/form-data` requests. The backend returns either a JPEG blob (for image endpoints) or a PDF blob. No session state, no database, no auth. Everything lives in the browser until the user downloads the PDF.

The split deployment exists because:
- Vercel runs Next.js natively and handles the frontend optimally (edge CDN, serverless, zero config).
- The backend requires `tesseract-ocr` and `libgl1` as system-level APT packages, which cannot run on Vercel. Hugging Face Spaces with the Docker SDK allows a fully custom environment and is free at the base tier.

---

## 2. Frontend

### Tech Stack

| Package | Version | Purpose |
|---|---|---|
| Next.js | 15 | React framework, App Router, standalone output |
| React | 19 | UI runtime |
| Tailwind CSS | 4 | Utility-first styling |
| shadcn/ui | — | Headless component primitives (Button, Switch, Input, Label, ScrollArea) |
| @base-ui/react | 1.4 | Base UI primitives (ScrollArea uses this) |
| @dnd-kit/core + sortable | 6/10 | Drag-and-drop page reordering |
| react-dropzone | 15 | File drag-and-drop upload zone |
| lucide-react | 0.553 | Icon set |
| sonner | 2 | Toast notifications |
| next-themes | 0.4 | Light/dark theme switching |

### Project Structure

```
app/
  layout.tsx        Root layout — font loading, ThemeProvider, metadata
  page.tsx          Entire application (single-page, client component)
  globals.css       Tailwind imports + CSS variable theme tokens

components/
  sortable-image.tsx    Draggable thumbnail card
  theme-toggle.tsx      Light/dark toggle button
  theme-provider.tsx    next-themes wrapper
  ui/                   shadcn primitives (button, switch, input, etc.)
```

### `app/page.tsx` — State

```ts
images: ImageItem[]            // All loaded pages in order
activeId: string | null        // Currently selected page for preview
options: ProcessingOptions     // Manual filter toggles + watermark text
scanMode: 'color'|'grayscale'|'bw'   // Auto scan output mode
isAutoScanning: boolean        // Single-page auto scan in progress
scanProgress: {current,total}  // Batch auto scan progress
isProcessing: boolean          // Single-page manual filter in progress
processProgress: {current,total}     // Batch manual filter progress
isExporting: boolean           // PDF export in progress
ocrProgress: {current,total}   // Batch OCR progress (advanced section)
showingOriginal: boolean        // Before/After toggle in preview
showAdvanced: boolean           // Advanced section collapsed/expanded
fileName: string               // Export filename (without .pdf)
searchablePdf: boolean          // Whether to embed OCR text layer in PDF
isWakingUp: boolean            // Cold-start warning (HF Spaces)
```

`ImageItem` is the central data type:

```ts
interface ImageItem {
  id: string          // crypto.randomUUID()
  file: File          // Original File object from the OS
  originalUrl: string // Object URL of the original (for Before toggle)
  processedUrl?: string  // Object URL of the last processed version
  extractedText?: string // Raw OCR text (advanced section)
}
```

Object URLs are created with `URL.createObjectURL()` and revoked on component unmount to avoid memory leaks.

### Layout Structure

```
<div h-screen flex flex-col>
  <header />                  ← App name + theme toggle (no settings gear)
  {anyActive && <ProgressBanner />}   ← Sticky top bar during any operation
  {images.length === 0
    ? <EmptyState />           ← Full-page drag-drop zone
    : <div flex>
        <aside w-52>           ← Left: thumbnail strip (desktop only, lg+)
          Upload zone
          DndContext > SortableImage list
        </aside>
        <div flex-1 flex flex-col lg:flex-row>
          Mobile strip          ← Horizontal scroll row (< lg only)
          <div flex-1>          ← Center: preview area
            <img />
            Before/After toggle (if processed)
          </div>
          <aside w-80>          ← Right: controls panel
            Auto Scan section
            Advanced (collapsed)
            Export section
          </aside>
        </div>
      </div>
  }
</div>
```

### Auto Scan Flow (Single Page)

1. User selects a scan mode (Color / Grey / B&W radio cards).
2. User clicks "or scan this page only".
3. `handleAutoScan()` starts:
   - `setIsAutoScanning(true)` → progress banner appears.
   - Cold-start timer starts (5 s timeout → sets `isWakingUp(true)` → banner gains "Server is starting up…" message).
   - `FormData` is built: `file` = `activeImage.file`, `mode` = selected mode string.
   - `POST /auto-scan` is awaited.
   - On first response: timer is cancelled, `isWakingUp` reset.
   - Response blob → `URL.createObjectURL()` → stored as `processedUrl` on the image.
   - `showingOriginal` set to `false` so the after-state is shown immediately.
4. `isAutoScanning(false)` → banner disappears.

### Batch Auto Scan Flow

Same as above but iterates all images in a `for` loop, updating `scanProgress` at each step. The cold-start timer is cancelled after the first successful response (server is warm for subsequent pages).

### Drag-and-Drop Reordering

Uses `@dnd-kit`. The `DndContext` wraps the thumbnail list. `SortableContext` with `rectSortingStrategy` enables grid sorting. On `DragEndEvent`, `arrayMove()` reorders the `images` array in state, which reorders everything: thumbnails, export order, and page numbers.

### Before / After Toggle

The preview renders either `activeImage.originalUrl` or `activeImage.processedUrl` based on the `showingOriginal` boolean. The toggle only appears when `activeImage.processedUrl` exists. Switching pages resets `showingOriginal` to `false` (show the result by default).

### ScrollArea Fix

The left thumbnail sidebar uses `ScrollArea` from `@base-ui/react`. In CSS flexbox, a flex child's minimum height defaults to `auto` (intrinsic content size), which prevents the element from shrinking below its content and breaks scroll. The fix is `min-h-0` on the `ScrollArea` alongside `overflow-hidden` on the `aside`. Without these, the ScrollArea expands to show all thumbnails rather than clipping and scrolling.

### `SortableImage` Component

Props: `id`, `url`, `pageNumber`, `isProcessed`, `isActive`, `onClick`, `onRemove`.

- Page number badge: permanent overlay at bottom-left (`bg-black/60`).
- Processed indicator: green checkmark at top-right, shown when `isProcessed` and not hovering.
- Drag handle: appears at top-left on hover (`group-hover:opacity-100`).
- Delete button: appears at top-right on hover, replacing the processed indicator (`group-hover:opacity-100` + `group-hover:hidden` on the checkmark).
- Active selection: `ring-2 ring-primary ring-offset-2` border.

---

## 3. Backend

### Tech Stack

| Package | Purpose |
|---|---|
| FastAPI | HTTP framework, automatic OpenAPI docs |
| Uvicorn | ASGI server |
| OpenCV (`opencv-python-headless`) | Image processing |
| NumPy | Array operations for image data |
| pytesseract | Python binding for Tesseract OCR |
| Pillow | Image format handling for PDF assembly |
| fpdf2 | PDF generation (image-only mode) |
| pypdf | PDF reading and merging (searchable mode) |
| python-multipart | FastAPI multipart form parsing |

System packages (installed via APT in Docker):
- `tesseract-ocr` — OCR engine binary
- `libgl1` — OpenGL shared library required by OpenCV on headless servers
- `libglib2.0-0` — GLib runtime required by OpenCV

### `app.py` — Endpoints

#### `GET /health`
Returns `{"status": "ok"}`. Used by the frontend to detect whether the server is alive (and implicitly to detect cold starts — a slow response to this endpoint is the first signal).

#### `POST /process`
Accepts: `file` (UploadFile), `options` (JSON string form field).

The `options` JSON maps directly to the `ProcessingOptions` interface from the frontend:
```json
{
  "grayscale": false,
  "enhance": true,
  "denoise": false,
  "sharpen": true,
  "deskew": false,
  "crop": true,
  "threshold": false,
  "watermark": false,
  "watermark_text": "CONFIDENTIAL"
}
```

Returns: JPEG bytes (`image/jpeg`).

#### `POST /auto-scan`
Accepts: `file` (UploadFile), `mode` (form field, default `"color"`).

Mode values: `"color"`, `"grayscale"`, `"bw"`.

Returns: JPEG bytes (`image/jpeg`).

#### `POST /ocr`
Accepts: `file` (UploadFile — can be original or processed image).

Returns: `{"text": "extracted text string"}`.

#### `POST /export-pdf`
Accepts: `files` (List[UploadFile] — all pages in order), `searchable` (form field `"true"` or `"false"`).

Returns: PDF bytes (`application/pdf`) with `Content-Disposition: attachment`.

#### CORS
`CORSMiddleware` is configured with `allow_origins=["*"]` to accept requests from any origin. This is intentional: the frontend URL can be any Vercel deployment preview URL, and there is no sensitive data to protect at the API level.

---

## 4. Image Processing Pipeline

All image processing lives in `backend/processing.py`. The two entry points are `process_image()` (manual filters) and `auto_scan()` (full automated pipeline).

### Image Encoding / Decoding

```python
def _decode_image(img_bytes):
    nparr = np.frombuffer(img_bytes, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)

def _encode_image(img):
    _, buffer = cv2.imencode('.jpg', img)
    return buffer.tobytes()
```

Images arrive as raw bytes from the HTTP body. `np.frombuffer` wraps them in a NumPy array without copying. `cv2.imdecode` decodes JPEG/PNG/WebP into a BGR NumPy array (height × width × 3, uint8). The output is re-encoded as JPEG for the HTTP response.

### `apply_document_crop()` — Perspective Transform

This is the most complex operation. It finds the document rectangle in the image and performs a perspective warp to produce a flat, top-down view.

**Steps:**

1. **Resize to 500px height** — Canny edge detection and contour finding are expensive. Working on a downscaled copy is fast and the result maps back to full resolution.

2. **Grayscale → Gaussian blur → Canny edges** — `cv2.Canny(blurred, 75, 200)` finds edges with hysteresis thresholding. The lower threshold (75) passes edges that connect to high-confidence edges (200).

3. **Find contours → sort by area → take top 5** — `cv2.findContours` with `RETR_LIST` (flat list, no hierarchy) and `CHAIN_APPROX_SIMPLE` (compress horizontal/vertical runs to endpoints). Taking the top 5 largest contours eliminates noise.

4. **Approximate polygon → find quadrilateral** — `cv2.approxPolyDP` with epsilon = 2% of perimeter simplifies each contour. The first contour that simplifies to exactly 4 points is the document boundary (`screenCnt`).

5. **Scale corners back to full resolution** — multiply the 4 corner points by the downscale ratio.

6. **Order corners** — four-point ordering: top-left (minimum sum of x+y), bottom-right (maximum sum), top-right (minimum diff of y-x), bottom-left (maximum diff). This works because sums/diffs are geometric invariants of a rectangle's corners.

7. **Compute output dimensions** — measure the widths and heights of the top/bottom and left/right edges of the detected quadrilateral. Take the maximum of each to produce an output rectangle that preserves as much resolution as possible.

8. **`cv2.getPerspectiveTransform` + `cv2.warpPerspective`** — compute the 3×3 homography matrix from the 4 source corners to the 4 destination corners, then apply it to the full-resolution original image.

If no quadrilateral is found (e.g., the document fills the frame, or the background is too complex), the function returns the original image unchanged — a safe fallback.

### `apply_deskew()` — Rotation Correction

Corrects small rotational skew caused by holding the camera at a slight angle.

**Steps:**

1. **Grayscale → invert → Otsu threshold** — `cv2.THRESH_BINARY | cv2.THRESH_OTSU` computes the optimal global threshold automatically. Inverting the image first makes dark text on white paper appear as white pixels on black — the convention needed for `minAreaRect`.

2. **Get all non-zero pixel coordinates** — `np.column_stack(np.where(thresh > 0))` returns an N×2 array of (y, x) pairs.

3. **`cv2.minAreaRect`** — fits the tightest possible rectangle around all text pixels. Its angle is the skew angle.

4. **Angle normalization** — OpenCV returns angles in [-90, 0). An angle < -45° means the rectangle is rotated the other way; adjust to get the true skew.

5. **Guard rails** — skip rotation if the angle is under 0.5° (negligible) or over 20° (likely wrong detection, not a skew). This prevents the function from catastrophically rotating a legitimately rotated document.

6. **`cv2.getRotationMatrix2D` + `cv2.warpAffine`** — rotate with cubic interpolation (`INTER_CUBIC`) and replicate border padding to avoid black edges.

### `process_image()` — Manual Filters

Operations are applied in a fixed order that mirrors their visual effect:

1. **Document Crop** (if enabled) — runs `apply_document_crop`. Done first so subsequent operations work on the already-corrected geometry.
2. **Deskew** — runs `apply_deskew` on the cropped image.
3. **Grayscale** — `cv2.cvtColor(BGR→GRAY→BGR)`. Converting back to BGR keeps the array 3-channel for downstream operations.
4. **Contrast Enhancement (CLAHE)** — Contrast Limited Adaptive Histogram Equalization. Works in LAB color space (for color images): only the L (lightness) channel is equalized, preserving hue and saturation. `clipLimit=3.0` caps the histogram redistribution to avoid over-amplifying noise. `tileGridSize=(8,8)` divides the image into an 8×8 grid of tiles processed independently, adapting to local lighting variation.
5. **Denoise** — `cv2.fastNlMeansDenoisingColored` (for color) or `fastNlMeansDenoising` (for grayscale). Non-local means: for each pixel, finds similar patches across the image and averages them. `h=10` is the filter strength (higher = more smoothing = more blur). Slow on large images.
6. **Sharpen** — convolution with a 3×3 sharpening kernel `[[0,-1,0],[-1,5,-1],[0,-1,0]]`. This is a Laplacian high-pass filter combined with the original signal (the center value 5 = 1 + 4, where 4 compensates the 4 negative neighbours).
7. **Binarize (Adaptive Threshold)** — Gaussian-weighted adaptive thresholding. Each pixel's threshold is the weighted mean of its 11×11 neighbourhood minus a constant C=2. Handles uneven lighting (e.g., shadows across a page) better than global thresholding.
8. **Watermark** — renders text onto a blank canvas, rotates it 45°, then composites it over the image at 30% opacity using per-channel NumPy operations.

### `auto_scan()` — Automated Pipeline

Runs `apply_document_crop` then `apply_deskew` unconditionally, then applies mode-specific enhancement:

**Color mode** — CLAHE on the LAB L-channel (preserves color), then unsharp masking via `addWeighted(img, 1.5, blurred, -0.5, 0)`. Unsharp masking = original × 1.5 − Gaussian-blurred × 0.5. Equivalent to adding the high-frequency detail signal back with amplification.

**Grayscale mode** — Convert to gray, CLAHE, then unsharp masking on the gray channel.

**B&W mode** — Convert to gray, Gaussian blur (removes noise before thresholding), adaptive threshold, convert back to BGR (3-channel) for consistent JPEG encoding.

---

## 5. OCR

`backend/ocr.py` wraps `pytesseract.image_to_string()`.

Pre-processing: convert to grayscale. Tesseract internally handles most lighting issues, so minimal preprocessing is done here. The gray image is passed directly to `pytesseract.image_to_string()` which calls the `tesseract` binary via subprocess, returns a plain text string.

In the searchable PDF path (`pdf_export.py`), `pytesseract.image_to_pdf_or_hocr(pil_img, extension='pdf')` is used instead. This returns a PDF with an invisible text layer overlaid on the image — the format that PDF readers use for Ctrl+F search. Multiple such single-page PDFs are merged using `pypdf.PdfWriter`.

---

## 6. PDF Export

Two code paths in `backend/pdf_export.py`:

### Image-only PDF (`_create_image_pdf`)

Uses `fpdf2`. For each image:
1. Open with Pillow to get pixel dimensions.
2. Write the raw bytes to a temp file (fpdf2 requires a file path, not bytes).
3. Compute the draw dimensions: fit the image within the printable area while preserving aspect ratio (compare image AR vs page AR to decide whether to fit width or height).
4. Center on the page: `x = (page_w - draw_w) / 2`, `y = (page_h - draw_h) / 2`.
5. `pdf.image(path, x, y, w, h)`.

Output is `pdf.output(dest='S')` (return as string), encoded to `latin-1` bytes if needed (fpdf2 internal format).

### Searchable PDF (`_create_searchable_pdf`)

Uses pytesseract + pypdf. For each image:
1. Decode with OpenCV, convert BGR→RGB, create a Pillow Image.
2. `pytesseract.image_to_pdf_or_hocr(pil_img, extension='pdf')` — Tesseract generates a PDF with the original image as the page background and an invisible text layer aligned to the detected words.
3. Wrap in a `PdfReader`, append to `PdfWriter`.

All pages are merged into one PDF via `writer.write(output_buffer)`.

---

## 7. Deployment

### Backend — Hugging Face Spaces (Docker SDK)

The `backend/` directory is a self-contained Docker Space.

**`backend/README.md`** contains the HF Space metadata header:
```yaml
---
title: IPCV PDF Tools Backend
sdk: docker
app_file: app.py
pinned: false
---
```

**`backend/Dockerfile`** build process:

```dockerfile
FROM python:3.10-slim

# Install APT packages from packages.txt
COPY packages.txt /tmp/packages.txt
RUN apt-get update && xargs -a /tmp/packages.txt apt-get install -y --no-install-recommends

# Create non-root user (HF Spaces requirement)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH
WORKDIR $HOME/app

# Python dependencies
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code
COPY --chown=user . .

EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
```

Key points:
- **Port 7860** — HF Spaces Docker SDK routes external traffic to port 7860. The app must bind there.
- **Non-root user** — HF Spaces requires UID 1000. The Dockerfile creates a `user` account with that UID and switches to it before installing Python packages and running the app. Files are `--chown=user` to ensure the process can read them.
- **`packages.txt`** — APT package list read by `xargs` in the RUN command. Current contents: `tesseract-ocr`, `libgl1`, `libglib2.0-0`. This pattern allows adding system packages without editing the Dockerfile.
- **Layer caching** — `requirements.txt` is copied and installed before the application code so that code changes don't invalidate the Python dependency layer.

**Deploying backend changes:**
```bash
# From the repo root, push only the backend/ subdirectory to the HF Space remote
git subtree push --prefix backend hf-backend main
```
(Where `hf-backend` is a git remote pointing to `https://huggingface.co/spaces/<username>/<space-name>`)

**Cold starts:** HF Spaces free tier hibernates after inactivity. The first request after hibernation takes 20–60 seconds to restart the Docker container. The frontend handles this with a 5-second timeout that shows "Waking up the server — about 30 seconds on first use" in the progress banner.

### Frontend — Vercel

Standard Next.js deployment.

1. Connect the GitHub repo to a Vercel project.
2. Framework preset: Next.js (auto-detected).
3. Add environment variable `NEXT_PUBLIC_API_URL` = your HF Space URL (e.g., `https://username-space-name.hf.space`).
4. Every push to `main` triggers a production deploy.

`next.config.ts` sets `output: 'standalone'` which produces a self-contained Node.js bundle. This is required for Vercel's serverless deployment model.

---

## 8. Local Development

### Backend

```bash
cd backend

# Install system deps (Ubuntu/Debian)
sudo apt-get install -y tesseract-ocr libgl1 libglib2.0-0

# Python deps
pip install -r requirements.txt

# Run with hot reload
uvicorn app:app --reload --port 8000
```

API docs available at `http://localhost:8000/docs` (Swagger UI auto-generated by FastAPI).

### Frontend

```bash
# Install deps (use bun, not npm)
bun install

# Set the backend URL
cp .env.example .env.local
# Edit .env.local: NEXT_PUBLIC_API_URL=http://localhost:8000

# Start dev server
bun run dev
```

Frontend available at `http://localhost:3000`.

### Running Both Together

The frontend reads `NEXT_PUBLIC_API_URL` at build time for server components and at runtime for client components. When running locally, set it to `http://localhost:8000`. In production it points to the HF Space URL.

---

## 9. Environment Variables

| Variable | Where | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Frontend (Vercel) | Full URL to the FastAPI backend. No trailing slash. Must be set at build time for Next.js to embed it. |

The `NEXT_PUBLIC_` prefix is Next.js convention: variables with this prefix are inlined into the client-side bundle. Without it, the variable is only accessible in server-side code.

The `.env.example` file also contains `GEMINI_API_KEY` and `APP_URL` which are AI Studio scaffold artifacts and are not used by the current implementation.

---

## 10. Data Flow — End to End

### Uploading Pages

1. User drops files onto the upload zone (handled by `react-dropzone`'s `onDrop` callback).
2. Each `File` object gets a stable `id` (`crypto.randomUUID()`) and an `originalUrl` (`URL.createObjectURL(file)`).
3. The files are stored in React state (`images: ImageItem[]`). Nothing is sent to the server at this point.

### Auto Scanning a Page

1. Frontend sends `POST /auto-scan` with `file=<File>` and `mode=<string>`.
2. Backend reads the image bytes, calls `auto_scan(img_bytes, mode)`.
3. `apply_document_crop` finds the document contour and perspective-warps it.
4. `apply_deskew` corrects rotational skew.
5. Mode-specific enhancement (CLAHE + unsharp mask for color/grey; adaptive threshold for B&W).
6. Returns JPEG bytes.
7. Frontend creates a new object URL from the response blob, stores it as `processedUrl` on the `ImageItem`.
8. Preview switches to show the processed version (`showingOriginal = false`).

### Exporting as PDF

1. Frontend iterates `images` in order. For each: if `processedUrl` exists, fetch the blob from the object URL; otherwise use the original `File`.
2. All blobs are appended to a `FormData` under the key `files`. `searchable` is appended as a string.
3. Backend receives the ordered list of image bytes.
4. If `searchable=false`: `fpdf2` assembles a standard PDF — each image fitted to an A4 page.
5. If `searchable=true`: pytesseract converts each image to a single-page PDF with embedded text layer, `pypdf` merges them.
6. Frontend receives the PDF blob, creates a temporary `<a>` element with the user's chosen filename, triggers a click to download, then cleans up.

### Manual Filters

Same flow as Auto Scan but `POST /process` accepts a JSON `options` blob instead of a mode string. The options dict drives which OpenCV operations run and in what order.

### OCR (Advanced)

`POST /ocr` accepts one image, returns `{"text": "..."}`. The extracted text is stored on the `ImageItem` as `extractedText`. It can be copied to clipboard or downloaded as `.txt`. It is not used during PDF export — the searchable PDF path runs Tesseract independently inside the backend on the final image bytes.
