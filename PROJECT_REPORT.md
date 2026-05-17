# VisionScan — Project Report

**Course:** Image Processing and Computer Vision (IPCV)
**Course Code:** CT-467
**Instructor:** Dr. Waseemullah
**Group Members:** Syed Hussain Raza | Turki Ahmed Al Sharmodein | Agah Mir Hasan Khan

---

## Table of Contents

1. [Abstract](#1-abstract)
2. [Introduction](#2-introduction)
3. [Problem Statement](#3-problem-statement)
4. [Objectives](#4-objectives)
5. [System Architecture](#5-system-architecture)
6. [Computer Vision Pipeline](#6-computer-vision-pipeline)
7. [Image Enhancement Techniques](#7-image-enhancement-techniques)
8. [OCR and PDF Export](#8-ocr-and-pdf-export)
9. [Frontend Implementation](#9-frontend-implementation)
10. [Backend Implementation](#10-backend-implementation)
11. [Deployment](#11-deployment)
12. [Results and Discussion](#12-results-and-discussion)
13. [Conclusion](#13-conclusion)
14. [References](#14-references)

---

## 1. Abstract

VisionScan is a full-stack web application that replicates the functionality of a professional document scanner using a smartphone camera and computer vision. Users upload photos of physical documents and the system automatically detects document boundaries, corrects perspective distortion, enhances image quality, and exports the result as a clean, searchable PDF. The core processing pipeline applies course concepts from Image Processing and Computer Vision including GrabCut segmentation, Canny edge detection, contour analysis, homographic perspective transformation, CLAHE contrast enhancement, and Hough line-based deskewing. The application is deployed publicly with a Next.js frontend on Vercel and a FastAPI backend on Hugging Face Spaces.

---

## 2. Introduction

Physical documents — receipts, notes, forms, books — are frequently captured with smartphone cameras for digital storage. However, raw phone photos suffer from perspective distortion, uneven lighting, skew, and background clutter, making them unsuitable for professional or archival use.

Traditional desktop scanning software requires dedicated hardware and is platform-specific. Mobile scanning apps (CamScanner, Adobe Scan) are closed-source, require accounts, and impose storage limits. VisionScan addresses these gaps by providing a free, open, browser-based scanning tool that runs entirely client-side (no data stored on servers) and produces output quality comparable to dedicated scanning hardware.

The project serves as a practical application of the image processing and computer vision algorithms studied in CT-467, implemented in a production-ready system.

---

## 3. Problem Statement

Capturing documents with a smartphone introduces several image quality problems:

| Problem | Cause | Effect |
|---|---|---|
| Perspective distortion | Camera angle relative to document | Trapezoidal rather than rectangular appearance |
| Rotational skew | Slight tilt of camera or document | Tilted text lines |
| Uneven lighting | Ambient light gradients, shadows | Low local contrast |
| Background clutter | Desk, table surface visible | Difficulty isolating document boundary |
| Image noise | Low-light conditions, sensor noise | Grainy text |

No single classical algorithm handles all of these robustly. The challenge is designing a pipeline that chains multiple techniques with intelligent fallbacks, and making it accessible as a no-install web application.

---

## 4. Objectives

- Implement automatic document boundary detection using GrabCut segmentation and Canny edge detection
- Apply homographic perspective transformation to produce a flat, top-down view of the document
- Implement rotational deskew using Hough line detection and minAreaRect fallback
- Apply contrast enhancement (CLAHE) and sharpening for improved readability
- Provide an interactive corner editor so users can manually adjust auto-detected boundaries
- Integrate Tesseract OCR to produce searchable, accessible PDF output
- Deploy the full system as a publicly accessible web application

---

## 5. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (Client)                      │
│                                                             │
│   Next.js 15 (React 19, TypeScript, Tailwind CSS)          │
│   ┌──────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│   │ Thumbnail│  │ Preview +    │  │ Controls Panel       │ │
│   │ Sidebar  │  │ Crop Overlay │  │ Scan modes / Filters │ │
│   └──────────┘  └──────────────┘  └──────────────────────┘ │
│                                                             │
│   Images stored as browser Object URLs (never persisted)   │
└──────────────────────┬──────────────────────────────────────┘
                       │  HTTP multipart/form-data
                       │  (image bytes + options/corners)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│            Hugging Face Docker Space (FastAPI)               │
│                                                             │
│   POST /detect-corners  →  GrabCut + Canny corner finder   │
│   POST /auto-scan       →  Full pipeline + enhancement     │
│   POST /process         →  Manual filter application       │
│   POST /ocr             →  Tesseract text extraction       │
│   POST /export-pdf      →  fpdf2 / pytesseract PDF build   │
│   GET  /health          →  Keepalive ping target           │
└─────────────────────────────────────────────────────────────┘
```

**Key design decisions:**

- **Stateless API:** No session state, no database. Every request is self-contained — the image bytes are sent with each call. This simplifies scaling and eliminates privacy concerns around stored documents.
- **Decoupled deployment:** The frontend requires no system packages; the backend requires `tesseract-ocr`, `libgl1`, and `libglib2.0-0` (APT packages). Separating them allows each to use the optimal host.
- **Client-side image management:** All images are stored as browser `Object URLs` created with `URL.createObjectURL()`. They exist only in the browser's memory and are revoked on component unmount.

---

## 6. Computer Vision Pipeline

All processing is implemented in `backend/processing.py` using OpenCV and NumPy.

### 6.1 Document Corner Detection

The corner detector runs four strategies in order, returning the result of the first that succeeds:

#### Strategy 1: GrabCut Segmentation (Primary)

Inspired by the LearnOpenCV automatic document scanner approach. GrabCut is an iterative graph-cut algorithm that models foreground and background colour distributions using Gaussian Mixture Models.

```
Input image
    │
    ▼
Morphological Closing (5×5 kernel, 3 iterations)
    │   Removes text detail → document surface becomes a uniform blob
    ▼
GrabCut (rect inset 20px from edges, 5 iterations)
    │   Separates document (foreground) from desk/background
    ▼
Foreground mask × closed image
    │
    ▼
Gaussian Blur (11×11) → Canny Edge Detection (0–200)
    │
    ▼
Elliptical Dilation (5×5)
    │
    ▼
Contour → Quad detection
```

Morphological closing is applied before GrabCut to suppress text — individual letter strokes would otherwise confuse the foreground/background model.

#### Strategy 2: Bilateral Filter + Adaptive Canny

`cv2.bilateralFilter` preserves sharp edges while smoothing flat regions, unlike Gaussian blur which blurs edges too. Canny thresholds are computed adaptively from the image median intensity:

```python
v = np.median(gray)
lower = int(max(0, (1.0 - 0.33) * v))
upper = int(min(255, (1.0 + 0.33) * v))
```

This handles both dark and bright document backgrounds without manual threshold tuning.

#### Strategy 3: Gaussian Blur + Morphological Closing

Standard Gaussian preprocessing followed by morphological closing (`cv2.MORPH_CLOSE`) to bridge gaps in detected edges caused by document texture.

#### Strategy 4: Adaptive Threshold + Canny

`cv2.adaptiveThreshold` with Gaussian weighting computes a local threshold for each pixel based on its neighbourhood. Effective for documents with uneven illumination (shadows, gradients).

#### Quad Scoring and Validation

For each strategy, contours are sorted by area (top 20 retained). Each is approximated at five different epsilon values (1%–6% of perimeter) using `cv2.approxPolyDP`. A 4-point result is scored on:

1. **Minimum area:** must cover ≥ 5% of image area
2. **Convexity:** `cv2.isContourConvex` must return true
3. **Angle regularity:** mean cosine of interior angles must be < 0.5 (angles near 90°)
4. **Final score:** `(area_ratio) × (1 − mean_cos_angle)` — larger, more rectangular quads score higher

The highest-scoring valid quad across all epsilon values is selected.

### 6.2 Perspective Transformation

Once four corners are identified (ordered TL → TR → BR → BL by coordinate sum/difference), a perspective warp is applied:

```python
maxWidth  = max(‖BR − BL‖, ‖TR − TL‖)
maxHeight = max(‖TR − BR‖, ‖TL − BL‖)

dst = [[0,0], [W-1,0], [W-1,H-1], [0,H-1]]

M = cv2.getPerspectiveTransform(src_corners, dst)
warped = cv2.warpPerspective(img, M, (W, H))
```

`maxWidth` and `maxHeight` are computed from the actual edge lengths of the detected quadrilateral, preserving the document's true aspect ratio rather than squashing it to a fixed size.

### 6.3 Deskew

After cropping, residual rotational skew (from a tilted camera) is corrected.

**Primary method — Hough Lines:**

```
Gaussian Blur → Canny Edges → HoughLines
    │
    ▼
Extract angles from all lines, keep those in [−20°, 20°]
    │
    ▼
Median angle (robust to outlier lines)
    │
    ▼
Rotate by median angle if |angle| ∈ [0.3°, 20°]
```

The median is preferred over the mean because it is unaffected by outlier lines from non-text elements (borders, figures).

**Fallback — minAreaRect:**

If fewer than 3 Hough lines are detected, `cv2.minAreaRect` is fitted to all thresholded foreground pixels. The angle of the minimum bounding rectangle approximates the dominant text orientation.

### 6.4 Interactive Crop Editor

A `POST /detect-corners` endpoint exposes the corner detection result as JSON before any scan is performed. The frontend renders the 4 corners as draggable SVG handles overlaid on the original image preview. When the user clicks Scan, the (possibly adjusted) corner coordinates are sent alongside the image. The backend then uses `_four_point_transform` with the user-provided corners instead of running auto-detection.

---

## 7. Image Enhancement Techniques

### 7.1 CLAHE — Contrast Limited Adaptive Histogram Equalization

Applied to the L (lightness) channel in LAB colour space. Unlike global histogram equalization, CLAHE divides the image into a grid of tiles (8×8) and equalises each independently, with a clip limit of 3.0 to prevent over-amplifying noise in uniform regions. Working in LAB isolates luminance from chrominance, preserving colour fidelity.

### 7.2 Unsharp Masking

Applied after CLAHE in colour and grayscale auto-scan modes:

```python
blurred = cv2.GaussianBlur(img, (0, 0), 3)
sharpened = cv2.addWeighted(img, 1.5, blurred, -0.5, 0)
```

This is equivalent to adding a scaled high-frequency residual back to the image: `output = 1.5×original − 0.5×blurred`.

### 7.3 Adaptive Thresholding (B&W Mode)

For the Black & White scan mode, `cv2.adaptiveThreshold` with Gaussian weighting and an 11×11 neighbourhood window produces a binary image that handles local lighting variation. A constant C=2 is subtracted from each local mean to reduce noise in uniform regions.

### 7.4 Manual Filters

The manual processing endpoint supports:

| Filter | Method |
|---|---|
| Grayscale | `cv2.cvtColor(BGR→GRAY→BGR)` |
| Contrast | CLAHE on LAB L-channel |
| Denoise | `cv2.fastNlMeansDenoisingColored`, h=10 |
| Sharpen | 3×3 Laplacian kernel convolution |
| Deskew | Hough lines / minAreaRect |
| Crop | Full corner detection pipeline |
| Binarize | Adaptive Gaussian threshold |
| Watermark | Rotated text composited at 30% opacity |

---

## 8. OCR and PDF Export

### 8.1 OCR

`pytesseract.image_to_string()` is called on a grayscale version of the image. Tesseract's internal preprocessing handles most remaining lighting issues. The result is returned as plain text for display or download.

### 8.2 PDF Export — Image Only

`fpdf2` assembles one A4 page per image. Each image is scaled to fit within the printable area while preserving aspect ratio, then centred on the page.

### 8.3 PDF Export — Searchable

`pytesseract.image_to_pdf_or_hocr(extension='pdf')` produces a single-page PDF with the document image as a background and an invisible text layer aligned to detected words. All pages are merged using `pypdf.PdfWriter`. The resulting PDF supports Ctrl+F search and screen readers.

---

## 9. Frontend Implementation

### Tech Stack

| Package | Version | Purpose |
|---|---|---|
| Next.js | 15 | React framework, App Router |
| React | 19 | UI runtime |
| Tailwind CSS | 4 | Utility-first styling |
| @dnd-kit | 6/10 | Drag-and-drop page reordering |
| react-dropzone | 15 | File upload zone |
| sonner | 2 | Toast notifications |
| next-themes | 0.4 | Light/dark theme switching |

### Crop Overlay Component

The interactive crop editor is implemented as a React component (`components/crop-overlay.tsx`) rendering an SVG positioned exactly over the preview image. Key implementation details:

- **Coordinate mapping:** `ResizeObserver` tracks the image's rendered bounds relative to the container. Scale factors `scaleX = displayWidth / naturalWidth` and `scaleY = displayHeight / naturalHeight` map between image-pixel and display-pixel space.
- **Dragging:** `document.addEventListener('pointermove')` is used rather than SVG-level events, so dragging remains smooth even if the pointer moves outside the handle.
- **Dimming:** An SVG mask covers the area outside the crop quad with a semi-transparent overlay, giving a clear visual indication of what will be cropped.
- **Hit area:** Each handle has an invisible circle at 2× the visual radius for easy touch/mouse targeting.

### State Management

All application state is managed with React `useState`. Images are stored as `ImageItem` objects containing the original `File`, Object URLs for original and processed versions, detected corners, and extracted text. No external state library is used.

---

## 10. Backend Implementation

### Tech Stack

| Package | Purpose |
|---|---|
| FastAPI | HTTP framework with automatic OpenAPI docs |
| Uvicorn | ASGI server |
| OpenCV (`opencv-python-headless`) | Image processing |
| NumPy | Array operations |
| pytesseract | Python binding for Tesseract |
| Pillow | Image format handling |
| fpdf2 | Image-only PDF generation |
| pypdf | PDF merging for searchable output |
| httpx | Async HTTP client for self-ping keepalive |

### Keepalive

Hugging Face Spaces (free tier) hibernates after approximately 15 minutes of inactivity. A background asyncio task pings `localhost:7860/health` every 4 minutes, starting 30 seconds after server boot, keeping the Space permanently warm:

```python
async def _keepalive():
    await asyncio.sleep(30)
    async with httpx.AsyncClient() as client:
        while True:
            try:
                await client.get("http://localhost:7860/health", timeout=10)
            except Exception:
                pass
            await asyncio.sleep(240)
```

### API Endpoints

| Method | Endpoint | Input | Output |
|---|---|---|---|
| GET | `/health` | — | `{"status": "ok"}` |
| POST | `/detect-corners` | image file | corners JSON + image size |
| POST | `/auto-scan` | image + mode + corners? | JPEG bytes |
| POST | `/process` | image + options JSON | JPEG bytes |
| POST | `/ocr` | image file | `{"text": "..."}` |
| POST | `/export-pdf` | image files + searchable flag | PDF bytes |

---

## 11. Deployment

### Backend — Hugging Face Spaces (Docker SDK)

The `backend/` directory is a self-contained Docker Space. The `Dockerfile`:

1. Installs system APT packages from `packages.txt` (`tesseract-ocr`, `libgl1`, `libglib2.0-0`)
2. Creates a non-root user (UID 1000, required by HF Spaces)
3. Installs Python dependencies from `requirements.txt`
4. Runs Uvicorn on port 7860

Deployment uses git subtree push to push only the `backend/` subdirectory to the HF Space remote:

```bash
git subtree push --prefix backend hf main
```

### Frontend — Vercel

Standard Next.js deployment connected to the GitHub repository. The environment variable `NEXT_PUBLIC_API_URL` points to the HF Space URL. Every push to `main` triggers an automatic production deploy.

### Vercel Cron Job

`vercel.json` configures a scheduled job that calls `/api/keepalive` every 5 minutes as an additional warm-up mechanism:

```json
{
  "crons": [{ "path": "/api/keepalive", "schedule": "*/5 * * * *" }]
}
```

---

## 12. Results and Discussion

### Corner Detection Performance

The multi-strategy pipeline significantly improves robustness over single-method approaches:

- **GrabCut (Strategy 1)** handles the most common case: document on a contrasting desk or table surface. The morphological pre-closing step that removes text detail was the key insight from the LearnOpenCV reference — without it, GrabCut over-segments the foreground.
- **Bilateral + adaptive Canny (Strategy 2)** handles cases where the document fills the frame (no background visible), where GrabCut finds no clear foreground/background boundary.
- **Strategies 3 and 4** handle very low-contrast and shadowed documents.

### Known Limitations

- **Curved documents:** The pipeline assumes a planar quadrilateral. Curved pages (books) are partially corrected but not fully rectified without a thin-plate spline warp.
- **Heavily textured backgrounds:** GrabCut can fail if the background has similar colour distribution to the document.
- **Very small documents:** The minimum area threshold (5% of image) rejects very small documents photographed from far away.

### Cold Start Latency

The self-ping mechanism successfully keeps the HF Space active. In testing, warm requests complete in 1–4 seconds depending on image size and selected pipeline.

---

## 13. Conclusion

VisionScan demonstrates that production-quality document scanning is achievable with classical computer vision techniques, without requiring deep learning models or dedicated hardware. The multi-strategy pipeline — GrabCut segmentation, adaptive Canny, contour analysis, perspective transformation, Hough deskew, and CLAHE enhancement — directly applies the core algorithms from the CT-467 Image Processing and Computer Vision curriculum.

The interactive crop overlay bridges the gap between fully automatic detection and user control, a pattern used by professional scanning apps. The full-stack deployment on Vercel and Hugging Face Spaces demonstrates how computationally intensive CV workloads can be separated from frontend delivery for cost-effective production hosting.

**Concepts applied from CT-467:**

- Image segmentation (GrabCut)
- Edge detection (Canny with adaptive thresholds)
- Morphological operations (closing, dilation)
- Contour analysis and polygon approximation
- Homographic perspective transformation
- Histogram equalization (CLAHE)
- Frequency-domain sharpening (Laplacian / unsharp mask)
- Hough transform (line detection for deskew)
- Adaptive thresholding
- Optical Character Recognition (Tesseract)

---

## 14. References

1. Bradski, G., & Kaehler, A. (2008). *Learning OpenCV: Computer Vision with the OpenCV Library.* O'Reilly Media.
2. Rother, C., Kolmogorov, V., & Blake, A. (2004). GrabCut: Interactive Foreground Extraction using Iterated Graph Cuts. *ACM SIGGRAPH 2004.*
3. Canny, J. (1986). A Computational Approach to Edge Detection. *IEEE Transactions on Pattern Analysis and Machine Intelligence, 8*(6), 679–698.
4. Zuiderveld, K. (1994). Contrast Limited Adaptive Histogram Equalization. *Graphics Gems IV.* Academic Press.
5. Hough, P. V. C. (1962). *Method and Means for Recognizing Complex Patterns.* U.S. Patent 3,069,654.
6. LearnOpenCV. (2023). Automatic Document Scanner using OpenCV. https://learnopencv.com/automatic-document-scanner-using-opencv/
7. OpenCV Documentation. https://docs.opencv.org/4.x/
8. FastAPI Documentation. https://fastapi.tiangolo.com/
9. Next.js Documentation. https://nextjs.org/docs
10. Smith, R. (2007). An Overview of the Tesseract OCR Engine. *Ninth International Conference on Document Analysis and Recognition (ICDAR 2007).*
