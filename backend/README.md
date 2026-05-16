---
title: IPCV PDF Tools Backend
emoji: 📄
colorFrom: blue
colorTo: green
sdk: docker
app_file: app.py
pinned: false
---

# IPCV Image-to-PDF Backend

This is the backend for the IPCV Image-to-PDF Web App. It is built using FastAPI, OpenCV, and Tesseract OCR.

## Features
- **OpenCV Image Processing:** Grayscale, denoise, enhance, edge sharpen, deskew, document crop, thresholding, watermark.
- **Tesseract OCR:** Text extraction from images.
- **PDF Export:** Merging processed images into a PDF with optional embedded OCR text.

## Local Setup
1. Install Python 3.9+
2. Install system dependencies: `tesseract-ocr` and `libgl1-mesa-glx`
3. Install Python dependencies: `pip install -r requirements.txt`
4. Run the development server: `uvicorn app:app --reload --port 8000`

## Deployment to Hugging Face Spaces
This app is configured to be deployed as a Docker Space on Hugging Face because it requires `tesseract-ocr` system packages.

1. Create a new Space on [Hugging Face](https://huggingface.co/spaces) and select **Docker** as the SDK.
2. Upload the contents of this `backend` directory to the Space.
3. The Space will automatically build the Dockerfile and start the FastAPI server on port 7860.
4. Copy the URL of your deployed Space and configure your frontend to use it.
