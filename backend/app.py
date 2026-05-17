from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from typing import List, Optional
from contextlib import asynccontextmanager
import asyncio
import httpx
import json

from processing import process_image, auto_scan
from ocr import extract_text
from pdf_export import create_pdf

PING_INTERVAL = 4 * 60  # 4 minutes — HF Spaces hibernates after ~15 min

async def _keepalive():
    await asyncio.sleep(30)  # let server finish starting up
    async with httpx.AsyncClient() as client:
        while True:
            try:
                await client.get("http://localhost:7860/health", timeout=10)
            except Exception:
                pass
            await asyncio.sleep(PING_INTERVAL)

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_keepalive())
    yield
    task.cancel()

app = FastAPI(title="IPCV Image-to-PDF API", version="1.0.0", lifespan=lifespan)

# Allow CORS for all domains
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health_check():
    return {"status": "ok", "message": "Backend is running"}

@app.post("/upload")
async def upload_images(files: List[UploadFile] = File(...)):
    # Simply validating upload in a real life scenario, but we process per image
    return {"message": f"Received {len(files)} files", "filenames": [f.filename for f in files]}

@app.post("/process")
async def process(
    file: UploadFile = File(...),
    options: str = Form(...)  # JSON string of options
):
    try:
        opts = json.loads(options)
        img_bytes = await file.read()
        
        processed_bytes = process_image(img_bytes, opts)
        
        return Response(content=processed_bytes, media_type="image/jpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ocr")
async def process_ocr(file: UploadFile = File(...)):
    try:
        img_bytes = await file.read()
        text = extract_text(img_bytes)
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/auto-scan")
async def auto_scan_endpoint(
    file: UploadFile = File(...),
    mode: str = Form(default="color"),
):
    try:
        img_bytes = await file.read()
        processed_bytes = auto_scan(img_bytes, mode)
        return Response(content=processed_bytes, media_type="image/jpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/export-pdf")
async def export_pdf(
    files: List[UploadFile] = File(...),
    searchable: str = Form(default="false"),
):
    try:
        images_bytes = []
        for file in files:
            img_bytes = await file.read()
            images_bytes.append(img_bytes)

        use_searchable = searchable.lower() == "true"
        pdf_bytes = create_pdf(images_bytes, searchable=use_searchable)

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=scanned_document.pdf"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
