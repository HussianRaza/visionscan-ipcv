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

def apply_deskew(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.bitwise_not(gray)
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
    
    coords = np.column_stack(np.where(thresh > 0))
    angle = cv2.minAreaRect(coords)[-1]
    
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
        
    # If angle is too small or too large, don't deskew
    if abs(angle) < 0.5 or abs(angle) > 20: 
        return img
        
    (h, w) = img.shape[:2]
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return rotated

def apply_document_crop(img):
    orig = img.copy()
    ratio = img.shape[0] / 500.0
    
    # Resize down to fast processing
    h, w = img.shape[:2]
    resized = cv2.resize(img, (int(w/ratio), 500))
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    
    edged = cv2.Canny(blurred, 75, 200)
    
    contours, _ = cv2.findContours(edged.copy(), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
    
    screenCnt = None
    for c in contours:
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        
        if len(approx) == 4:
            screenCnt = approx
            break
            
    if screenCnt is None:
        return orig # No document found
        
    # Apply perspective transform
    pts = screenCnt.reshape(4, 2) * ratio
    
    # Order points: top-left, top-right, bottom-right, bottom-left
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    
    (tl, tr, br, bl) = rect
    widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
    widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
    maxWidth = max(int(widthA), int(widthB))
    
    heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
    heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
    maxHeight = max(int(heightA), int(heightB))
    
    dst = np.array([
        [0, 0],
        [maxWidth - 1, 0],
        [maxWidth - 1, maxHeight - 1],
        [0, maxHeight - 1]], dtype="float32")
        
    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(orig, M, (maxWidth, maxHeight))
    
    return warped
