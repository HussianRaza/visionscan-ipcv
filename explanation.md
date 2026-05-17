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
      │  HTTP multipart/form-data  (images + options/corners)
      │
      ▼
Hugging Face Docker Space (FastAPI / Uvicorn, port 7860)
      │
      ├── /health          Keepalive ping target
      ├── /detect-corners  Return auto-detected document corners as JSON
      ├── /auto-scan       Full document pipeline (crop → deskew → enhance)
      ├── /process         OpenCV manual filters
      ├── /ocr             Tesseract text extraction
      └── /export-pdf      fpdf2 or pytesseract PDF assembly
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
  layout.tsx          Root layout — font loading, ThemeProvider, metadata
  page.tsx            Entire application (single-page, client component)
  globals.css         Tailwind imports + CSS variable theme tokens
  api/
    keepalive/
      route.ts        Edge API route — pings backend /health (Vercel Cron target)

components/
  sortable-image.tsx    Draggable thumbnail card
  crop-overlay.tsx      Interactive SVG crop boundary with draggable corners
  theme-toggle.tsx      Light/dark toggle button
  theme-provider.tsx    next-themes wrapper
  ui/                   shadcn primitives (button, switch, input, etc.)

vercel.json             Vercel Cron Job — calls /api/keepalive every 5 minutes
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

Two refs are used by the crop overlay:
```ts
previewContainerRef: RefObject<HTMLDivElement>  // Outer preview area div
previewImgRef: RefObject<HTMLImageElement>      // The preview <img> element
```

`ImageItem` is the central data type:

```ts
interface ImageItem {
  id: string               // crypto.randomUUID()
  file: File               // Original File object from the OS
  originalUrl: string      // Object URL of the original (for Before toggle)
  processedUrl?: string    // Object URL of the last processed version
  extractedText?: string   // Raw OCR text (advanced section)
  corners?: Corner[]       // [TL, TR, BR, BL] in image pixel coords
  naturalSize?: { width: number; height: number }  // Image pixel dimensions
}
```

`Corner` is `[number, number]` (x, y). `corners` and `naturalSize` are populated by the `detectCorners()` function when an image is first selected or uploaded.

Object URLs are created with `URL.createObjectURL()` and revoked on component unmount to avoid memory leaks.

### Layout Structure

```
<div h-screen flex flex-col>
  <header />                  ← App name + theme toggle
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
          <div flex-1 ref={previewContainerRef}>   ← Center: preview area
            <img ref={previewImgRef} />
            <CropOverlay />     ← SVG overlay (shown when viewing original)
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

### Corner Detection Flow

When an image is selected (`handleSetActive`) or first uploaded (`onDrop`), `detectCorners(img)` is called:

1. Sends `POST /detect-corners` with the image file.
2. Backend runs the full multi-strategy corner detector and returns `{ corners, width, height }`.
3. `corners` (4 × [x, y] in image pixel space) and `naturalSize` are stored on the `ImageItem`.
4. The `CropOverlay` component renders automatically since `corners` is now set.

If the image already has `corners`, the call is skipped (idempotent).

### Auto Scan Flow (Single Page)

1. User selects a scan mode (Color / Grey / B&W radio cards).
2. User optionally drags the crop overlay corners to adjust the document boundary.
3. User clicks "or scan this page only".
4. `handleAutoScan()` starts:
   - `setIsAutoScanning(true)` → progress banner appears.
   - Cold-start timer starts (5 s timeout → sets `isWakingUp(true)`).
   - `FormData` is built: `file`, `mode`, and `corners` (JSON-serialised if the image has corners).
   - `POST /auto-scan` is awaited.
   - On first response: timer is cancelled, `isWakingUp` reset.
   - Response blob → `URL.createObjectURL()` → stored as `processedUrl` on the image.
   - `showingOriginal` set to `false` so the after-state is shown immediately.
5. `isAutoScanning(false)` → banner disappears.

When `corners` are included, the backend skips auto-detection and uses the user-provided corners directly for the perspective transform.

### Batch Auto Scan Flow

Same as above but iterates all images in a `for` loop, updating `scanProgress` at each step. Each image's own `corners` (if set) are sent with its request. The cold-start timer is cancelled after the first successful response.

### `CropOverlay` Component (`components/crop-overlay.tsx`)

Renders an SVG positioned exactly over the preview image, showing the document boundary and 4 draggable corner handles.

**Coordinate mapping:**

The image is displayed with `object-contain` inside a padded flex container. Its actual rendered bounds (position + size relative to the container) are measured using `ResizeObserver`:

```ts
const iB = img.getBoundingClientRect();
const cB = container.getBoundingClientRect();
imgRect = { x: iB.left - cB.left, y: iB.top - cB.top, w: iB.width, h: iB.height }
```

Scale factors map between image-pixel and display-pixel space:
```ts
scaleX = imgRect.w / naturalWidth
scaleY = imgRect.h / naturalHeight
```

**SVG layout:**

- Positioned `absolute` within the preview container using `imgRect.x / y / w / h`.
- An SVG mask dims everything outside the crop quad, giving a clear visual crop preview.
- A blue polygon outlines the crop boundary.
- Each corner has a white circle handle with a crosshair, plus a larger invisible hit area (2× radius) for easy targeting.

**Dragging:**

`pointerdown` on a handle adds `document.addEventListener('pointermove')` and `pointerup`. This keeps dragging smooth even when the pointer moves outside the handle circle. On each `pointermove`, the raw client position is converted back to image-pixel space via the inverse scale factors, clamped to image bounds, and `onChange` is called to update React state.

**Visibility:**

The overlay is shown when `showingOriginal || !activeImage.processedUrl` — i.e. whenever the preview is displaying the original image. It hides when showing the processed "After" result.

### Drag-and-Drop Reordering

Uses `@dnd-kit`. The `DndContext` wraps the thumbnail list. `SortableContext` with `rectSortingStrategy` enables grid sorting. On `DragEndEvent`, `arrayMove()` reorders the `images` array in state, which reorders everything: thumbnails, export order, and page numbers.

### Before / After Toggle

The preview renders either `activeImage.originalUrl` or `activeImage.processedUrl` based on the `showingOriginal` boolean. The toggle only appears when `activeImage.processedUrl` exists. Switching pages resets `showingOriginal` to `false` (show the result by default).

### ScrollArea Fix

The left thumbnail sidebar uses `ScrollArea` from `@base-ui/react`. In CSS flexbox, a flex child's minimum height defaults to `auto` (intrinsic content size), which prevents the element from shrinking below its content and breaks scroll. The fix is `min-h-0` on the `ScrollArea` alongside `overflow-hidden` on the `aside`.

### `SortableImage` Component

Props: `id`, `url`, `pageNumber`, `isProcessed`, `isActive`, `onClick`, `onRemove`.

- Page number badge: permanent overlay at bottom-left (`bg-black/60`).
- Processed indicator: green checkmark at top-right, shown when `isProcessed` and not hovering.
- Drag handle: appears at top-left on hover (`group-hover:opacity-100`).
- Delete button: appears at top-right on hover, replacing the processed indicator.
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
| httpx | Async HTTP client used by the self-ping keepalive loop |

System packages (installed via APT in Docker):
- `tesseract-ocr` — OCR engine binary
- `libgl1` — OpenGL shared library required by OpenCV on headless servers
- `libglib2.0-0` — GLib runtime required by OpenCV

### Keepalive — Self-Ping

HF Spaces free tier hibernates after ~15 minutes of inactivity. On startup, `app.py` launches a background asyncio task that pings `localhost:7860/health` every 4 minutes, keeping the Space permanently warm:

```python
async def _keepalive():
    await asyncio.sleep(30)  # let server finish starting up
    async with httpx.AsyncClient() as client:
        while True:
            try:
                await client.get("http://localhost:7860/health", timeout=10)
            except Exception:
                pass
            await asyncio.sleep(240)

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_keepalive())
    yield
    task.cancel()
```

The task is registered via FastAPI's `lifespan` context manager and cancelled cleanly on shutdown.

### `app.py` — Endpoints

#### `GET /health`
Returns `{"status": "ok"}`. Target of the self-ping keepalive and the Vercel Cron job via `/api/keepalive`.

#### `POST /detect-corners`
Accepts: `file` (UploadFile).

Runs the full multi-strategy corner detector on the uploaded image. Returns the 4 document corners in image pixel coordinates plus the image's natural dimensions:

```json
{
  "corners": [[x0,y0], [x1,y1], [x2,y2], [x3,y3]],
  "width": 3024,
  "height": 4032
}
```

Corners are ordered TL → TR → BR → BL. If no document boundary is detected, returns full-image corners as a fallback so the frontend always has a valid quad to display.

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
Accepts: `file` (UploadFile), `mode` (form field, default `"color"`), `corners` (optional JSON form field).

Mode values: `"color"`, `"grayscale"`, `"bw"`.

If `corners` is provided (a JSON array of 4 `[x, y]` pairs), the backend skips auto-detection and uses those corners directly for the perspective transform. This allows user-adjusted corners from the crop overlay to be applied server-side.

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

All image processing lives in `backend/processing.py`. The public entry points are:

- `detect_document_corners(img)` — corner detection only, returns `(4,2) float32` or `None`
- `process_image(img_bytes, options)` — manual filter pipeline
- `auto_scan(img_bytes, mode, corners=None)` — full automated pipeline

### Image Encoding / Decoding

```python
def _decode_image(img_bytes):
    nparr = np.frombuffer(img_bytes, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)

def _encode_image(img):
    _, buffer = cv2.imencode('.jpg', img)
    return buffer.tobytes()
```

Images arrive as raw bytes from the HTTP body. `np.frombuffer` wraps them in a NumPy array without copying. `cv2.imdecode` decodes JPEG/PNG/WebP into a BGR NumPy array (height × width × 3, uint8).

### `detect_document_corners()` — Multi-Strategy Corner Detection

Runs four strategies in order, returning the result of the first that succeeds. All strategies operate on a copy downscaled to a maximum of 1080px on the longest edge for speed; corners are scaled back to full resolution before returning.

#### Strategy 1 (Primary): GrabCut Segmentation

Inspired by the LearnOpenCV automatic document scanner. GrabCut is a graph-cut segmentation algorithm that iteratively models foreground and background colour distributions using Gaussian Mixture Models.

```
Morphological Closing (5×5, 3 iterations)
    │   Removes text/detail → document surface becomes a uniform blob
    ▼
GrabCut (rect inset 20px from edges, 5 iterations)
    │   Separates document (foreground) from desk/table (background)
    ▼
Foreground mask applied to closed image
    ▼
Gaussian Blur (11×11) → Canny (0–200) → Elliptical Dilation (5×5)
    ▼
Contour → Quad detection & scoring
```

Morphological closing before GrabCut is essential — it suppresses text strokes that would otherwise confuse the foreground/background colour model.

#### Strategy 2: Bilateral Filter + Adaptive Canny

`cv2.bilateralFilter(9, 75, 75)` preserves sharp edges while smoothing flat regions. Canny thresholds are derived adaptively from the image median:

```python
v = np.median(gray)
lower = int(max(0, (1 - 0.33) * v))
upper = int(min(255, (1 + 0.33) * v))
```

This handles both dark and bright document backgrounds automatically. Detected edges are dilated by a 3×3 kernel to bridge small gaps.

#### Strategy 3: Gaussian + Morphological Closing

Standard `GaussianBlur(5,5)` preprocessing, Canny with fixed thresholds (30–90), then `cv2.MORPH_CLOSE` with a 5×5 kernel to bridge edge gaps caused by document texture.

#### Strategy 4: Adaptive Threshold + Canny

`cv2.adaptiveThreshold` with Gaussian weighting computes a local threshold per pixel from its 21×21 neighbourhood. Effective for documents with shadows or uneven illumination. A 9×9 morphological close is applied after Canny.

#### Quad Scoring and Selection (`_find_best_quad`)

For each strategy, the top 20 contours by area are checked. Each is approximated at five epsilon values (1%, 2%, 3%, 4%, 6% of perimeter) using `cv2.approxPolyDP`. A 4-point result is scored by `_score_quad`:

1. **Minimum area:** must cover ≥ 5% of the working image area
2. **Convexity:** `cv2.isContourConvex` must return true
3. **Angle regularity:** mean cosine of interior angles must be < 0.5 (i.e. angles near 90°)
4. **Score:** `(area / img_area) × (1 − mean_cos_angle)` — larger, more rectangular quads score higher

The highest-scoring valid quad wins. Corners are scaled back to full-resolution coordinates via `upscale = 1.0 / scale`.

### `_four_point_transform()` — Perspective Warp

Given ordered corners [TL, TR, BR, BL], applies a homographic perspective warp:

```python
maxWidth  = max(‖BR − BL‖, ‖TR − TL‖)
maxHeight = max(‖TR − BR‖, ‖TL − BL‖)

dst = [[0,0], [W-1,0], [W-1,H-1], [0,H-1]]

M = cv2.getPerspectiveTransform(src_corners, dst)
warped = cv2.warpPerspective(img, M, (maxWidth, maxHeight))
```

`maxWidth` and `maxHeight` are computed from the actual edge lengths of the detected quadrilateral, preserving the document's true aspect ratio.

### `apply_document_crop()`

Thin wrapper — calls `detect_document_corners`, then `_four_point_transform`. Returns the original image if no corners are found.

### `apply_deskew()` — Rotation Correction

Corrects small rotational skew caused by a tilted camera.

**Primary method — Hough Lines:**

```
GaussianBlur(5,5) → Canny(50,150) → HoughLines
    │
    ▼
Filter lines to those with angle in [−20°, 20°] (near-horizontal text rows)
    │
    ▼
Median angle across all qualifying lines (robust to outlier lines)
    │
    ▼
Rotate by median angle if |angle| ∈ [0.3°, 20°]
```

The median is used instead of the mean because it is unaffected by outlier lines from non-text elements (borders, figures, graphics).

**Fallback — minAreaRect:**

If fewer than 3 qualifying Hough lines are found, `cv2.minAreaRect` is fitted to all thresholded foreground pixels. The bounding rectangle's angle approximates the dominant text orientation. Applied if |angle| ∈ [0.3°, 20°].

Both methods use `cv2.INTER_CUBIC` interpolation and `cv2.BORDER_REPLICATE` border mode to avoid black edges.

### `auto_scan()` — Automated Pipeline

```python
def auto_scan(img_bytes, mode='color', corners=None):
```

If `corners` is provided (from the frontend crop overlay), the perspective transform uses those directly — auto-detection is skipped. Otherwise `apply_document_crop` runs the full detection pipeline.

After cropping, `apply_deskew` runs unconditionally, then mode-specific enhancement:

**Color mode** — CLAHE on the LAB L-channel (preserves colour), then unsharp masking via `addWeighted(img, 1.5, blurred, -0.5, 0)`.

**Grayscale mode** — Convert to gray, CLAHE, then unsharp masking on the gray channel.

**B&W mode** — Convert to gray, `GaussianBlur(5,5)`, adaptive threshold, convert back to BGR for consistent JPEG encoding.

### `process_image()` — Manual Filters

Operations are applied in a fixed order:

1. **Document Crop** (if enabled) — `apply_document_crop`
2. **Deskew** — `apply_deskew`
3. **Grayscale** — `cv2.cvtColor(BGR→GRAY→BGR)`
4. **Contrast Enhancement (CLAHE)** — LAB L-channel, clipLimit=3.0, tileGridSize=(8,8)
5. **Denoise** — `cv2.fastNlMeansDenoisingColored`, h=10
6. **Sharpen** — 3×3 Laplacian kernel `[[0,-1,0],[-1,5,-1],[0,-1,0]]`
7. **Binarize** — adaptive Gaussian threshold, 11×11 neighbourhood, C=2
8. **Watermark** — text rendered on blank canvas, rotated 45°, composited at 30% opacity

---

## 5. OCR

`backend/ocr.py` wraps `pytesseract.image_to_string()`.

Pre-processing: convert to grayscale. Tesseract internally handles most lighting issues, so minimal preprocessing is done here. The gray image is passed directly to `pytesseract.image_to_string()` which calls the `tesseract` binary via subprocess and returns a plain text string.

In the searchable PDF path (`pdf_export.py`), `pytesseract.image_to_pdf_or_hocr(pil_img, extension='pdf')` is used instead. This returns a PDF with an invisible text layer overlaid on the image — the format that PDF readers use for Ctrl+F search. Multiple such single-page PDFs are merged using `pypdf.PdfWriter`.

---

## 6. PDF Export

Two code paths in `backend/pdf_export.py`:

### Image-only PDF (`_create_image_pdf`)

Uses `fpdf2`. For each image:
1. Open with Pillow to get pixel dimensions.
2. Write the raw bytes to a temp file (fpdf2 requires a file path, not bytes).
3. Compute the draw dimensions: fit the image within the printable area while preserving aspect ratio.
4. Center on the page: `x = (page_w - draw_w) / 2`, `y = (page_h - draw_h) / 2`.
5. `pdf.image(path, x, y, w, h)`.

Output is `pdf.output(dest='S')` encoded to `latin-1` bytes (fpdf2 internal format).

### Searchable PDF (`_create_searchable_pdf`)

Uses pytesseract + pypdf. For each image:
1. Decode with OpenCV, convert BGR→RGB, create a Pillow Image.
2. `pytesseract.image_to_pdf_or_hocr(pil_img, extension='pdf')` — Tesseract generates a PDF with the image as background and an invisible text layer aligned to detected words.
3. Wrap in a `PdfReader`, append to `PdfWriter`.

All pages are merged via `writer.write(output_buffer)`.

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

COPY packages.txt /tmp/packages.txt
RUN apt-get update && xargs -a /tmp/packages.txt apt-get install -y --no-install-recommends

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH
WORKDIR $HOME/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=user . .

EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
```

Key points:
- **Port 7860** — HF Spaces routes external traffic to port 7860.
- **Non-root user** — HF Spaces requires UID 1000.
- **`packages.txt`** — `tesseract-ocr`, `libgl1`, `libglib2.0-0`.
- **Layer caching** — `requirements.txt` installed before application code.

**Deploying backend changes:**
```bash
git subtree push --prefix backend hf main
```
(Where `hf` is the git remote pointing to `https://huggingface.co/spaces/HussainR/visionscan-backend`)

**Keeping the Space warm:**

Two mechanisms prevent hibernation:

1. **Self-ping (backend):** An asyncio background task pings `localhost:7860/health` every 4 minutes — runs entirely inside the Docker container at zero network cost.

2. **Vercel Cron (frontend):** `vercel.json` schedules a Vercel-side cron job every 5 minutes that calls `GET /api/keepalive` on the Next.js app, which in turn calls the backend `/health` endpoint from outside:

```json
{
  "crons": [{ "path": "/api/keepalive", "schedule": "*/5 * * * *" }]
}
```

The `app/api/keepalive/route.ts` edge function fetches `NEXT_PUBLIC_API_URL/health` and returns the result.

**Cold starts:** Despite the keepalive, the very first request after a fresh deploy takes 20–60 seconds to restart the Docker container. The frontend handles this with a 5-second timeout that shows "Waking up the server…" in the progress banner.

### Frontend — Vercel

Standard Next.js deployment.

1. Connect the GitHub repo to a Vercel project.
2. Framework preset: Next.js (auto-detected).
3. Add environment variable `NEXT_PUBLIC_API_URL` = your HF Space URL.
4. Every push to `main` triggers a production deploy.

`next.config.ts` sets `output: 'standalone'` which produces a self-contained Node.js bundle.

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

---

## 9. Environment Variables

| Variable | Where | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Frontend (Vercel) | Full URL to the FastAPI backend. No trailing slash. Must be set at build time for Next.js to embed it. |

The `NEXT_PUBLIC_` prefix is Next.js convention: variables with this prefix are inlined into the client-side bundle.

---

## 10. Data Flow — End to End

### Uploading Pages

1. User drops files onto the upload zone (`react-dropzone` `onDrop`).
2. Each `File` gets a stable `id` and an `originalUrl` (`URL.createObjectURL`).
3. Files are stored in React state. `detectCorners` is called for the first (active) image.

### Corner Detection (Background)

1. Frontend sends `POST /detect-corners` with the image file.
2. Backend runs `detect_document_corners(img)` — GrabCut → bilateral Canny → Gaussian Canny → adaptive threshold Canny (first strategy that finds a valid quad wins).
3. Returns `{ corners: [[x,y]×4], width, height }`.
4. Frontend stores corners + naturalSize on the `ImageItem` and re-renders the `CropOverlay`.

### Auto Scanning a Page

1. User optionally adjusts the crop overlay corner handles.
2. Frontend sends `POST /auto-scan` with `file`, `mode`, and `corners` (if set).
3. Backend:
   - If `corners` provided: `_order_points` + `_four_point_transform` using user corners.
   - Otherwise: `apply_document_crop` runs the full detection pipeline.
   - `apply_deskew` corrects rotation.
   - Mode-specific enhancement (CLAHE + unsharp mask for color/grey; adaptive threshold for B&W).
4. Returns JPEG bytes.
5. Frontend creates a new object URL, stores as `processedUrl`, switches to "After" view.

### Exporting as PDF

1. Frontend iterates `images` in order. For each: if `processedUrl` exists, fetch the blob from the object URL; otherwise use the original `File`.
2. All blobs appended to `FormData` under key `files`. `searchable` appended as a string.
3. Backend assembles a PDF (image-only via fpdf2, or searchable via pytesseract + pypdf).
4. Frontend receives PDF blob, creates a temporary `<a>` element, triggers download, cleans up.

### Manual Filters

Same flow as Auto Scan but `POST /process` accepts a JSON `options` blob. The options dict drives which OpenCV operations run and in what order.

### OCR (Advanced)

`POST /ocr` accepts one image, returns `{"text": "..."}`. Stored on the `ImageItem` as `extractedText`. Can be copied to clipboard or downloaded as `.txt`.
