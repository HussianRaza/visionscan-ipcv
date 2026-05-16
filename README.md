# IPCV DocuScan - Image-to-PDF Web App

A full-stack web application designed for Image Processing & Computer Vision (IPCV). It allows users to upload images, apply OpenCV-based processing operations (such as document cropping, deskewing, binarization, and denoising), run OCR to extract text, and export everything into a PDF file.

## 🌟 Features

- **Drag-and-Drop Image Upload:** Seamlessly upload and preview JPG, PNG, and WebP images.
- **Reorder Pages:** Intuitive drag-and-drop interface to reorder images before PDF generation.
- **Image Processing (OpenCV):**
  - **Grayscale Conversion**
  - **Auto Contrast Enhancement** (CLAHE)
  - **Denoising**
  - **Edge Sharpening**
  - **Document Crop & Perspective Fix** using Contours
  - **Auto Deskew**
  - **Thresholding/Binarization**
  - **Watermarking**
- **OCR Text Extraction:** Powered by Tesseract OCR to extract text directly from processed document images.
- **Convert to PDF:** Export your processed image queue directly to a downloadable PDF.

## 🛠️ Tech Stack

- **Frontend:** React.js, Next.js (App Router), Tailwind CSS, shadcn/ui, dnd-kit, react-dropzone
- **Backend:** Python, FastAPI, OpenCV (`cv2`), Tesseract OCR, Pillow, fpdf2
- **Deployment Strategy:** Vercel (Frontend), Hugging Face Spaces Docker (Backend)

## 🚀 Live Demo

- **Frontend (Vercel):** *[Insert your Vercel URL here]*
- **Backend (Hugging Face API):** *[Insert your Hugging Face Space URL here]*

## 💻 Local Setup

### Frontend Setup

1. Install Node.js dependencies:
    ```bash
    npm install
    ```
2. Start the Next.js development server:
    ```bash
    npm run dev
    ```
3. The frontend will be available at `http://localhost:3000`.

### Backend Setup

1. Navigate to the `/backend` directory.
2. Ensure you have `Python 3` and the Tesseract binary (`tesseract-ocr`) installed on your system.
3. Install Python dependencies:
    ```bash
    pip install -r requirements.txt
    ```
4. Start the FastAPI development server:
    ```bash
    uvicorn app:app --reload --port 8000
    ```
5. The backend will be available at `http://localhost:8000`.

*Note: In the React App UI, you can click the Settings gear icon in the top right to configure the URL of your FastAPI backend.*

## 📦 Deployment Instructions

1. **Frontend to Vercel:** Import your GitHub repository to Vercel. Set the framework preset to "Next.js". Add the environment variable `NEXT_PUBLIC_API_URL` pointing to your deployed FastAPI backend.
2. **Backend to Hugging Face Spaces:** Create a new Space on [Hugging Face](https://huggingface.co/spaces) and choose the **Docker** SDK. Upload the contents of the `/backend` directory. The included `Dockerfile` will automatically install the system-level `tesseract-ocr` dependency and start the server.
# visionscan-ipcv
