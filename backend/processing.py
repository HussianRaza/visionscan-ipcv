import cv2
import numpy as np
import base64

def _decode_image(img_bytes):
    nparr = np.frombuffer(img_bytes, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)

def _encode_image(img):
    _, buffer = cv2.imencode('.jpg', img)
    return buffer.tobytes()

def process_image(img_bytes, options):
    img = _decode_image(img_bytes)
    
    if img is None:
        raise ValueError("Invalid image")

    # Document Crop
    if options.get("crop"):
        img = apply_document_crop(img)
    
    # Deskew
    if options.get("deskew"):
        img = apply_deskew(img)
    
    # Grayscale
    if options.get("grayscale") or options.get("threshold"):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        img = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR) # keep 3 channels for consistency unless stated otherwise
    
    # Contrast Enhancement (CLAHE)
    if options.get("enhance"):
        if len(img.shape) == 3 and img.shape[2] == 3:
            lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
            cl = clahe.apply(l)
            limg = cv2.merge((cl, a, b))
            img = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
        else:
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
            img = clahe.apply(img)
            
    # Denoise
    if options.get("denoise"):
        if len(img.shape) == 3:
            img = cv2.fastNlMeansDenoisingColored(img, None, 10, 10, 7, 21)
        else:
            img = cv2.fastNlMeansDenoising(img, None, 10, 7, 21)
            
    # Sharpen
    if options.get("sharpen"):
        kernel = np.array([[0, -1, 0], 
                           [-1, 5,-1], 
                           [0, -1, 0]])
        img = cv2.filter2D(img, -1, kernel)
        
    # Thresholding / Binarization (Adaptive)
    if options.get("threshold"):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        img_blur = cv2.GaussianBlur(gray, (5, 5), 0)
        binary = cv2.adaptiveThreshold(img_blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
        img = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
        
    # Watermark
    if options.get("watermark"):
        text = options.get("watermark_text", "CONFIDENTIAL")
        h, w = img.shape[:2]
        # Calculate font scale based on image dimensions
        font_scale = w / 1000.0 * 2
        thickness = max(1, int(font_scale * 2))
        
        # We put a semi-transparent watermark
        overlay = img.copy()
        text_size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)[0]
        text_x = (w - text_size[0]) // 2
        text_y = (h + text_size[1]) // 2
        # Draw rotated text by creating a separate transparent layer and rotating via warpAffine
        blank = np.zeros((h, w, 3), dtype=np.uint8)
        cv2.putText(blank, text, (text_x, text_y), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (200, 200, 200), thickness, cv2.LINE_AA)
        
        # Rotate watermark by 45 degrees
        M = cv2.getRotationMatrix2D((w//2, h//2), 45, 1.0)
        blank_rotated = cv2.warpAffine(blank, M, (w, h))
        
        # Add overlay
        mask = cv2.cvtColor(blank_rotated, cv2.COLOR_BGR2GRAY)
        ret, mask = cv2.threshold(mask, 10, 255, cv2.THRESH_BINARY)
        
        alpha = 0.3 # Watermark intensity
        for c in range(3):
            img[:, :, c] = np.where(mask == 255, 
                                    img[:, :, c] * (1 - alpha) + blank_rotated[:, :, c] * alpha, 
                                    img[:, :, c])

    return _encode_image(img)

def auto_scan(img_bytes, mode='color'):
    img = _decode_image(img_bytes)
    if img is None:
        raise ValueError("Invalid image")

    img = apply_document_crop(img)
    img = apply_deskew(img)

    if mode == 'bw':
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        binary = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
        img = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
    elif mode == 'grayscale':
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)
        blurred = cv2.GaussianBlur(gray, (0, 0), 3)
        gray = cv2.addWeighted(gray, 1.5, blurred, -0.5, 0)
        img = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    else:  # color — magic color mode
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b_ch = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        l = clahe.apply(l)
        img = cv2.cvtColor(cv2.merge((l, a, b_ch)), cv2.COLOR_LAB2BGR)
        blurred = cv2.GaussianBlur(img, (0, 0), 3)
        img = cv2.addWeighted(img, 1.5, blurred, -0.5, 0)

    return _encode_image(img)

def _auto_canny(gray, sigma=0.33):
    """Adaptive Canny thresholds based on median pixel intensity."""
    v = np.median(gray)
    lower = int(max(0, (1.0 - sigma) * v))
    upper = int(min(255, (1.0 + sigma) * v))
    return cv2.Canny(gray, lower, upper)

def _order_points(pts):
    """Return corners in (top-left, top-right, bottom-right, bottom-left) order."""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect

def _score_quad(approx, img_area):
    """
    Score a 4-point contour. Returns -1 to reject, or a positive float (higher = better).
    Criteria: minimum area coverage, convexity, and near-rectangular angles.
    """
    area = cv2.contourArea(approx)
    if area < img_area * 0.05:
        return -1
    if not cv2.isContourConvex(approx):
        return -1

    pts = _order_points(approx.reshape(4, 2).astype("float32"))
    cos_angles = []
    for i in range(4):
        v1 = pts[(i + 1) % 4] - pts[i]
        v2 = pts[(i - 1) % 4] - pts[i]
        denom = np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-6
        cos_angles.append(abs(np.dot(v1, v2) / denom))

    # cos near 0 means angle near 90°; reject very non-rectangular quads
    if np.mean(cos_angles) > 0.5:
        return -1

    return (area / img_area) * (1 - np.mean(cos_angles))

def _find_best_quad(edges, img_area, upscale=1.0):
    """Scan contours in edge image and return the best document quad (scaled back up)."""
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:20]

    best_score, best_quad = -1, None
    for c in contours:
        peri = cv2.arcLength(c, True)
        for eps in [0.01, 0.02, 0.03, 0.04, 0.06]:
            approx = cv2.approxPolyDP(c, eps * peri, True)
            if len(approx) == 4:
                score = _score_quad(approx, img_area)
                if score > best_score:
                    best_score = score
                    best_quad = approx
                break  # one quad per contour

    if best_quad is not None:
        return (best_quad.reshape(4, 2) * upscale).astype("float32")
    return None

def _grabcut_quad(img, img_area, upscale=1.0):
    """
    Primary crop strategy from LearnOpenCV's automatic document scanner.
    Morphological closing wipes out text/detail so the document becomes a
    solid blob; GrabCut then isolates it from the background before Canny.
    Source: https://learnopencv.com/automatic-document-scanner-using-opencv/
    """
    h, w = img.shape[:2]
    kernel = np.ones((5, 5), np.uint8)
    closed = cv2.morphologyEx(img, cv2.MORPH_CLOSE, kernel, iterations=3)

    mask = np.zeros((h, w), np.uint8)
    bgd  = np.zeros((1, 65), np.float64)
    fgd  = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(closed, mask, (20, 20, w - 40, h - 40), bgd, fgd, 5, cv2.GC_INIT_WITH_RECT)
    except Exception:
        return None

    fg = closed * np.where((mask == 2) | (mask == 0), 0, 1).astype("uint8")[:, :, np.newaxis]

    gray = cv2.cvtColor(fg, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (11, 11), 0)
    canny = cv2.Canny(gray, 0, 200)
    canny = cv2.dilate(canny, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))

    return _find_best_quad(canny, img_area, upscale)

def apply_document_crop(img):
    orig = img.copy()
    h, w = img.shape[:2]

    # Downscale longest edge to 1080 px for fast processing
    scale = min(1.0, 1080.0 / max(h, w))
    small = cv2.resize(img, (int(w * scale), int(h * scale))) if scale < 1.0 else img.copy()
    sh, sw = small.shape[:2]
    small_area = sh * sw
    upscale = 1.0 / scale

    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))

    # Strategy 1 (primary): GrabCut — robust against complex backgrounds
    quad = _grabcut_quad(small, small_area, upscale)

    # Strategy 2: bilateral filter (edge-preserving) + adaptive Canny
    if quad is None:
        bilateral = cv2.bilateralFilter(small, 9, 75, 75)
        gray1 = cv2.cvtColor(bilateral, cv2.COLOR_BGR2GRAY)
        edges1 = _auto_canny(gray1)
        edges1 = cv2.dilate(edges1, np.ones((3, 3), np.uint8), iterations=1)
        quad = _find_best_quad(edges1, small_area, upscale)

    # Strategy 3: Gaussian + wider Canny + morphological closing
    if quad is None:
        gray2 = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        blur2 = cv2.GaussianBlur(gray2, (5, 5), 0)
        edges2 = cv2.Canny(blur2, 30, 90)
        edges2 = cv2.morphologyEx(edges2, cv2.MORPH_CLOSE, close_kernel)
        quad = _find_best_quad(edges2, small_area, upscale)

    # Strategy 4: adaptive threshold → Canny + aggressive closing
    if quad is None:
        gray3 = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        thresh = cv2.adaptiveThreshold(gray3, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                       cv2.THRESH_BINARY, 21, 10)
        edges3 = cv2.Canny(thresh, 10, 50)
        big_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
        edges3 = cv2.morphologyEx(edges3, cv2.MORPH_CLOSE, big_kernel)
        quad = _find_best_quad(edges3, small_area, upscale)

    if quad is None:
        return orig

    rect = _order_points(quad)
    tl, tr, br, bl = rect
    maxWidth  = max(int(np.linalg.norm(br - bl)), int(np.linalg.norm(tr - tl)))
    maxHeight = max(int(np.linalg.norm(tr - br)), int(np.linalg.norm(tl - bl)))

    if maxWidth < 100 or maxHeight < 100:
        return orig

    dst = np.array([[0, 0], [maxWidth - 1, 0],
                    [maxWidth - 1, maxHeight - 1], [0, maxHeight - 1]], dtype="float32")
    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(orig, M, (maxWidth, maxHeight))

def apply_deskew(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = img.shape[:2]

    # Primary: Hough lines give a robust median angle
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 50, 150)
    lines = cv2.HoughLines(edges, 1, np.pi / 180, threshold=max(50, min(h, w) // 4))
    if lines is not None:
        angles = []
        for line in lines:
            theta = line[0][1]
            angle = np.degrees(theta) - 90  # map to [-90, 90]
            # Only keep near-horizontal lines (document text rows)
            if -20 <= angle <= 20:
                angles.append(angle)
        if len(angles) >= 3:
            skew = np.median(angles)
            if 0.3 <= abs(skew) <= 20:
                M = cv2.getRotationMatrix2D((w / 2, h / 2), skew, 1.0)
                return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC,
                                      borderMode=cv2.BORDER_REPLICATE)

    # Fallback: minAreaRect on thresholded text pixels
    inv = cv2.bitwise_not(gray)
    thresh = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh > 0))
    if len(coords) == 0:
        return img
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    if abs(angle) < 0.3 or abs(angle) > 20:
        return img
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC,
                          borderMode=cv2.BORDER_REPLICATE)
