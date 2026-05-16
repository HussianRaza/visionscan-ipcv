import pytesseract
import cv2
import numpy as np

def extract_text(img_bytes):
    try:
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            return "Error: Could not decode image"
            
        # Basic preprocessing for better OCR
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Determine contrast
        # Just pass through pytesseract
        text = pytesseract.image_to_string(gray)
        return text
    except Exception as e:
        return f"OCR Error: {str(e)}"
