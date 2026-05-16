from fpdf import FPDF
import tempfile
import os

def create_pdf(images_bytes, page_size="A4"):
    # images_bytes is a list of byte strings (jpegs)
    pdf = FPDF(format=page_size)
    
    # Write bytes to temp files because fpdf2 expects file paths or BytesIO
    temp_files = []
    
    try:
        for img_data in images_bytes:
            fd, tmp_path = tempfile.mkstemp(suffix=".jpg")
            with os.fdopen(fd, 'wb') as f:
                f.write(img_data)
            temp_files.append(tmp_path)
            
            pdf.add_page()
            # To fit A4 or other size
            if page_size == "A4":
                # Default FPDF A4 size is 210x297 mm
                pdf.image(tmp_path, x=0, y=0, w=210, h=297)
            else:
                # auto scale
                pdf.image(tmp_path, x=0, y=0, w=pdf.w, h=pdf.h)
                
        output_bytes = pdf.output(dest='S')
        # fpdf2 `output(dest='S')` returns bytearray in modern versions, strings in older
        if isinstance(output_bytes, str):
            output_bytes = output_bytes.encode('latin1')
            
        return output_bytes
    finally:
        # Cleanup
        for path in temp_files:
            if os.path.exists(path):
                os.remove(path)
