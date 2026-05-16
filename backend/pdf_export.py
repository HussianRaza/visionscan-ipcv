from fpdf import FPDF
from PIL import Image
import tempfile
import os
import io


def create_pdf(images_bytes, page_size="A4", searchable=False):
    if searchable:
        return _create_searchable_pdf(images_bytes)
    return _create_image_pdf(images_bytes, page_size)


def _create_image_pdf(images_bytes, page_size="A4"):
    pdf = FPDF(format=page_size)
    page_w = pdf.w
    page_h = pdf.h
    margin = 10
    max_w = page_w - 2 * margin
    max_h = page_h - 2 * margin

    temp_files = []
    try:
        for img_data in images_bytes:
            pil_img = Image.open(io.BytesIO(img_data))
            img_w, img_h = pil_img.size

            fd, tmp_path = tempfile.mkstemp(suffix=".jpg")
            with os.fdopen(fd, 'wb') as f:
                f.write(img_data)
            temp_files.append(tmp_path)

            pdf.add_page()

            if (img_w / img_h) > (max_w / max_h):
                draw_w = max_w
                draw_h = max_w * img_h / img_w
            else:
                draw_h = max_h
                draw_w = max_h * img_w / img_h

            x = (page_w - draw_w) / 2
            y = (page_h - draw_h) / 2
            pdf.image(tmp_path, x=x, y=y, w=draw_w, h=draw_h)

        output_bytes = pdf.output(dest='S')
        if isinstance(output_bytes, str):
            output_bytes = output_bytes.encode('latin1')
        return output_bytes
    finally:
        for path in temp_files:
            if os.path.exists(path):
                os.remove(path)


def _create_searchable_pdf(images_bytes):
    import pytesseract
    import cv2
    import numpy as np
    from pypdf import PdfWriter, PdfReader

    writer = PdfWriter()

    for img_data in images_bytes:
        nparr = np.frombuffer(img_data, np.uint8)
        img_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        rgb = cv2.cvtColor(img_cv, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb)

        pdf_bytes = pytesseract.image_to_pdf_or_hocr(pil_img, extension='pdf')
        reader = PdfReader(io.BytesIO(pdf_bytes))
        writer.append(reader)

    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()
