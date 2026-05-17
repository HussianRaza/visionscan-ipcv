'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableImage } from '@/components/sortable-image';
import { CropOverlay } from '@/components/crop-overlay';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  UploadCloud,
  Download,
  Loader2,
  ScanLine,
  ChevronDown,
  ChevronRight,
  Copy,
  ImagePlus,
} from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { ThemeToggle } from '@/components/theme-toggle';

type Corner = [number, number];

interface ImageItem {
  id: string;
  file: File;
  originalUrl: string;
  processedUrl?: string;
  extractedText?: string;
  corners?: Corner[];
  naturalSize?: { width: number; height: number };
}

interface ProcessingOptions {
  grayscale: boolean;
  enhance: boolean;
  denoise: boolean;
  sharpen: boolean;
  deskew: boolean;
  crop: boolean;
  threshold: boolean;
  watermark: boolean;
  watermark_text: string;
}

const DEFAULT_OPTIONS: ProcessingOptions = {
  grayscale: false,
  enhance: false,
  denoise: false,
  sharpen: false,
  deskew: false,
  crop: false,
  threshold: false,
  watermark: false,
  watermark_text: 'CONFIDENTIAL',
};

const SCAN_MODES = [
  { value: 'color' as const, label: 'Color', desc: 'Photos & mixed documents' },
  { value: 'grayscale' as const, label: 'Grey', desc: 'Printed text & forms' },
  { value: 'bw' as const, label: 'B&W', desc: 'Maximum contrast' },
];

const MANUAL_FILTERS = [
  { id: 'grayscale', label: 'Convert to grey', desc: 'Remove all color' },
  { id: 'enhance', label: 'Fix lighting', desc: 'Improve contrast and brightness' },
  { id: 'denoise', label: 'Remove noise', desc: 'Reduce grain and artifacts' },
  { id: 'sharpen', label: 'Sharpen text', desc: 'Make edges crisper' },
  { id: 'deskew', label: 'Straighten tilt', desc: 'Correct skewed pages' },
  { id: 'crop', label: 'Detect borders', desc: 'Auto-crop to document edges' },
  { id: 'threshold', label: 'High contrast', desc: 'Pure black and white pixels' },
] as const;

export default function Home() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [options, setOptions] = useState<ProcessingOptions>(DEFAULT_OPTIONS);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [processProgress, setProcessProgress] = useState<{ current: number; total: number } | null>(null);
  const [ocrProgress, setOcrProgress] = useState<{ current: number; total: number } | null>(null);
  const [searchablePdf, setSearchablePdf] = useState(true);
  const [scanMode, setScanMode] = useState<'color' | 'grayscale' | 'bw'>('color');
  const [isAutoScanning, setIsAutoScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number } | null>(null);
  const [showingOriginal, setShowingOriginal] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fileName, setFileName] = useState('document');
  const [isWakingUp, setIsWakingUp] = useState(false);
  const coldStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const previewImgRef = useRef<HTMLImageElement | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  const detectCorners = useCallback(async (img: ImageItem) => {
    if (img.corners) return; // already detected
    try {
      const fd = new FormData();
      fd.append('file', img.file);
      const res = await fetch(`${apiUrl}/detect-corners`, { method: 'POST', body: fd });
      if (!res.ok) return;
      const data = await res.json();
      setImages(prev => prev.map(i =>
        i.id === img.id
          ? { ...i, corners: data.corners, naturalSize: { width: data.width, height: data.height } }
          : i
      ));
    } catch { /* silent */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    return () => {
      images.forEach(img => {
        URL.revokeObjectURL(img.originalUrl);
        if (img.processedUrl) URL.revokeObjectURL(img.processedUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newImages = acceptedFiles.map(file => ({
      id: crypto.randomUUID(),
      file,
      originalUrl: URL.createObjectURL(file),
    }));
    setImages(prev => [...prev, ...newImages]);
    setActiveId(prev => {
      const firstId = prev ?? (newImages.length > 0 ? newImages[0].id : null);
      if (!prev && newImages.length > 0) detectCorners(newImages[0]);
      return firstId;
    });
  }, [detectCorners]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.webp'] },
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setImages(items => {
        const oldIndex = items.findIndex(item => item.id === active.id);
        const newIndex = items.findIndex(item => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const removeImage = (id: string) => {
    setImages(prev => {
      const img = prev.find(i => i.id === id);
      if (img) {
        URL.revokeObjectURL(img.originalUrl);
        if (img.processedUrl) URL.revokeObjectURL(img.processedUrl);
      }
      const updated = prev.filter(i => i.id !== id);
      if (activeId === id) setActiveId(updated.length > 0 ? updated[0].id : null);
      return updated;
    });
  };

  const handleSetActive = (id: string) => {
    setActiveId(id);
    setShowingOriginal(false);
    const img = images.find(i => i.id === id);
    if (img) detectCorners(img);
  };

  const startColdStartTimer = () => {
    coldStartTimerRef.current = setTimeout(() => setIsWakingUp(true), 5000);
  };

  const cancelColdStartTimer = () => {
    if (coldStartTimerRef.current) {
      clearTimeout(coldStartTimerRef.current);
      coldStartTimerRef.current = null;
    }
    setIsWakingUp(false);
  };

  const handleProcess = async () => {
    if (!activeImage) return;
    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append('file', activeImage.file);
      formData.append('options', JSON.stringify(options));
      const response = await fetch(`${apiUrl}/process`, { method: 'POST', body: formData });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const processedUrl = URL.createObjectURL(blob);
      setImages(prev => prev.map(img => img.id === activeId ? { ...img, processedUrl } : img));
      setShowingOriginal(false);
      toast.success('Adjustments applied!');
    } catch {
      toast.error('Processing failed. Check backend connection.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProcessAll = async () => {
    if (images.length === 0) return;
    const snapshot = [...images];
    setProcessProgress({ current: 0, total: snapshot.length });
    for (let i = 0; i < snapshot.length; i++) {
      setProcessProgress({ current: i + 1, total: snapshot.length });
      const img = snapshot[i];
      try {
        const formData = new FormData();
        formData.append('file', img.file);
        formData.append('options', JSON.stringify(options));
        const response = await fetch(`${apiUrl}/process`, { method: 'POST', body: formData });
        if (!response.ok) throw new Error();
        const blob = await response.blob();
        const processedUrl = URL.createObjectURL(blob);
        setImages(prev => prev.map(item => item.id === img.id ? { ...item, processedUrl } : item));
      } catch {
        toast.error(`Failed to process page ${i + 1}.`);
      }
    }
    setProcessProgress(null);
    toast.success('All pages processed!');
  };

  const handleAutoScan = async () => {
    if (!activeImage) return;
    setIsAutoScanning(true);
    startColdStartTimer();
    try {
      const formData = new FormData();
      formData.append('file', activeImage.file);
      formData.append('mode', scanMode);
      if (activeImage.corners) formData.append('corners', JSON.stringify(activeImage.corners));
      const response = await fetch(`${apiUrl}/auto-scan`, { method: 'POST', body: formData });
      cancelColdStartTimer();
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const processedUrl = URL.createObjectURL(blob);
      setImages(prev => prev.map(img => img.id === activeId ? { ...img, processedUrl } : img));
      setShowingOriginal(false);
      toast.success('Page scanned!');
    } catch {
      cancelColdStartTimer();
      toast.error('Scan failed. Check backend connection.');
    } finally {
      setIsAutoScanning(false);
    }
  };

  const handleAutoScanAll = async () => {
    if (images.length === 0) return;
    const snapshot = [...images];
    setScanProgress({ current: 0, total: snapshot.length });
    startColdStartTimer();
    for (let i = 0; i < snapshot.length; i++) {
      setScanProgress({ current: i + 1, total: snapshot.length });
      const img = snapshot[i];
      try {
        const formData = new FormData();
        formData.append('file', img.file);
        formData.append('mode', scanMode);
        if (img.corners) formData.append('corners', JSON.stringify(img.corners));
        const response = await fetch(`${apiUrl}/auto-scan`, { method: 'POST', body: formData });
        cancelColdStartTimer();
        if (!response.ok) throw new Error();
        const blob = await response.blob();
        const processedUrl = URL.createObjectURL(blob);
        setImages(prev => prev.map(item => item.id === img.id ? { ...item, processedUrl } : item));
      } catch {
        toast.error(`Failed to scan page ${i + 1}.`);
      }
    }
    setScanProgress(null);
    toast.success('All pages scanned!');
  };

  const handleOCR = async () => {
    if (!activeImage) return;
    const fileToProcess = activeImage.processedUrl
      ? await fetch(activeImage.processedUrl).then(r => r.blob())
      : activeImage.file;
    try {
      const formData = new FormData();
      formData.append('file', fileToProcess as Blob, activeImage.file.name);
      const response = await fetch(`${apiUrl}/ocr`, { method: 'POST', body: formData });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setImages(prev => prev.map(img => img.id === activeId ? { ...img, extractedText: data.text } : img));
      toast.success('Text extracted!');
    } catch {
      toast.error('OCR failed. Check backend connection.');
    }
  };

  const handleOCRAll = async () => {
    const toProcess = images.filter(img => !img.extractedText);
    if (toProcess.length === 0) { toast.info('All pages already have text.'); return; }
    setOcrProgress({ current: 0, total: toProcess.length });
    for (let i = 0; i < toProcess.length; i++) {
      setOcrProgress({ current: i + 1, total: toProcess.length });
      const img = toProcess[i];
      const fileToProcess = img.processedUrl
        ? await fetch(img.processedUrl).then(r => r.blob())
        : img.file;
      try {
        const formData = new FormData();
        formData.append('file', fileToProcess as Blob, img.file.name);
        const response = await fetch(`${apiUrl}/ocr`, { method: 'POST', body: formData });
        if (!response.ok) throw new Error();
        const data = await response.json();
        setImages(prev => prev.map(item => item.id === img.id ? { ...item, extractedText: data.text } : item));
      } catch {
        // continue
      }
    }
    setOcrProgress(null);
    toast.success('Text extracted from all pages!');
  };

  const handleCopyAllText = () => {
    const allText = images
      .filter(img => img.extractedText)
      .map((img, i) => `--- Page ${i + 1} ---\n${img.extractedText}`)
      .join('\n\n');
    if (!allText) { toast.error('No extracted text to copy.'); return; }
    navigator.clipboard.writeText(allText);
    toast.success('Copied to clipboard!');
  };

  const handleDownloadText = () => {
    const allText = images
      .filter(img => img.extractedText)
      .map((img, i) => `--- Page ${i + 1} ---\n${img.extractedText}`)
      .join('\n\n');
    if (!allText) { toast.error('No extracted text to download.'); return; }
    const blob = new Blob([allText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.trim() || 'document'}_text.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = async () => {
    if (images.length === 0) return;
    setIsExporting(true);
    try {
      const formData = new FormData();
      for (const img of images) {
        const fileToUse = img.processedUrl
          ? await fetch(img.processedUrl).then(r => r.blob())
          : img.file;
        formData.append('files', fileToUse, img.file.name);
      }
      formData.append('searchable', searchablePdf ? 'true' : 'false');
      const response = await fetch(`${apiUrl}/export-pdf`, { method: 'POST', body: formData });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName.trim() || 'document'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('PDF downloaded!');
    } catch {
      toast.error('Failed to export PDF. Check backend connection.');
    } finally {
      setIsExporting(false);
    }
  };

  const activeImage = images.find(img => img.id === activeId);
  const isBatchAutoScan = scanProgress !== null;
  const isBatchProcessing = processProgress !== null;
  const isBatchOCR = ocrProgress !== null;
  const anyActive = isAutoScanning || isProcessing || isBatchAutoScan || isBatchProcessing;
  const hasAnyText = images.some(img => img.extractedText);

  // ─── Render ──────────────────────────────────────────────────────────────────

  const controlsPanel = (
    <div className="p-5 space-y-6">
      {/* Auto Scan */}
      <section className="space-y-4">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <ScanLine className="w-4 h-4" />
            Auto Scan
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Detect edges, fix perspective, and enhance in one step
          </p>
        </div>

        <div className="space-y-1.5">
          {SCAN_MODES.map(mode => (
            <button
              key={mode.value}
              onClick={() => setScanMode(mode.value)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                scanMode === mode.value
                  ? 'border-foreground bg-foreground/5 shadow-sm'
                  : 'border-border hover:border-foreground/30 hover:bg-muted/30'
              }`}
            >
              <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${
                scanMode === mode.value ? 'border-foreground' : 'border-muted-foreground'
              }`}>
                {scanMode === mode.value && (
                  <div className="w-1.5 h-1.5 rounded-full bg-foreground" />
                )}
              </div>
              <div>
                <div className="text-sm font-medium">{mode.label}</div>
                <div className="text-xs text-muted-foreground">{mode.desc}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <Button
            className="w-full"
            size="lg"
            onClick={handleAutoScanAll}
            disabled={images.length === 0 || isAutoScanning || isBatchAutoScan}
          >
            {isBatchAutoScan ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Scanning {scanProgress!.current} of {scanProgress!.total}</>
            ) : (
              <><ScanLine className="w-4 h-4 mr-2" />Scan All Pages {images.length > 0 && `(${images.length})`}</>
            )}
          </Button>
          <button
            className="w-full py-1.5 text-xs text-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={handleAutoScan}
            disabled={!activeImage || isAutoScanning || isBatchAutoScan}
          >
            {isAutoScanning ? (
              <span className="flex items-center justify-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Scanning this page…
              </span>
            ) : 'or scan this page only'}
          </button>
        </div>

        {isWakingUp && (
          <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
            Waking up the server — about 30 seconds on first use
          </p>
        )}
      </section>

      <div className="border-t border-border" />

      {/* Advanced */}
      <section>
        <button
          onClick={() => setShowAdvanced(v => !v)}
          className="w-full flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-0.5"
        >
          {showAdvanced
            ? <ChevronDown className="w-4 h-4" />
            : <ChevronRight className="w-4 h-4" />
          }
          Advanced adjustments
        </button>

        {showAdvanced && (
          <div className="mt-4 space-y-5">
            <div className="space-y-3">
              {MANUAL_FILTERS.map(filter => (
                <div key={filter.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm">{filter.label}</div>
                    <div className="text-[11px] text-muted-foreground">{filter.desc}</div>
                  </div>
                  <Switch
                    checked={options[filter.id as keyof ProcessingOptions] as boolean}
                    onCheckedChange={c => setOptions(prev => ({ ...prev, [filter.id]: c }))}
                  />
                </div>
              ))}

              <div>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm">Add watermark</div>
                    <div className="text-[11px] text-muted-foreground">Stamp text on each page</div>
                  </div>
                  <Switch
                    checked={options.watermark}
                    onCheckedChange={c => setOptions(prev => ({ ...prev, watermark: c }))}
                  />
                </div>
                {options.watermark && (
                  <Input
                    value={options.watermark_text}
                    onChange={e => setOptions(prev => ({ ...prev, watermark_text: e.target.value }))}
                    className="mt-2 h-8 text-sm"
                    placeholder="Watermark text"
                  />
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline" size="sm" className="flex-1 text-xs"
                onClick={handleProcess}
                disabled={!activeImage || isProcessing || isBatchProcessing}
              >
                {isProcessing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                This page
              </Button>
              <Button
                variant="outline" size="sm" className="flex-1 text-xs"
                onClick={handleProcessAll}
                disabled={images.length === 0 || isProcessing || isBatchProcessing}
              >
                {isBatchProcessing
                  ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />{processProgress!.current}/{processProgress!.total}</>
                  : 'All pages'
                }
              </Button>
            </div>

            <div className="pt-3 border-t border-border space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Extract text (OCR)</p>
              <div className="flex gap-2">
                <Button
                  variant="outline" size="sm" className="flex-1 text-xs"
                  onClick={handleOCR}
                  disabled={!activeImage || isBatchOCR}
                >
                  This page
                </Button>
                <Button
                  variant="outline" size="sm" className="flex-1 text-xs"
                  onClick={handleOCRAll}
                  disabled={images.length === 0 || isBatchOCR}
                >
                  {isBatchOCR
                    ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />{ocrProgress!.current}/{ocrProgress!.total}</>
                    : 'All pages'
                  }
                </Button>
              </div>
              {hasAnyText && (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="flex-1 text-xs" onClick={handleCopyAllText}>
                    <Copy className="w-3 h-3 mr-1" />Copy text
                  </Button>
                  <Button variant="ghost" size="sm" className="flex-1 text-xs" onClick={handleDownloadText}>
                    <Download className="w-3 h-3 mr-1" />Save .txt
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="border-t border-border" />

      {/* Export */}
      <section className="space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Download className="w-4 h-4" />
          Export
        </h2>

        <div className="flex">
          <Input
            value={fileName}
            onChange={e => setFileName(e.target.value)}
            className="rounded-r-none text-sm h-9"
            placeholder="document"
          />
          <span className="flex items-center px-3 border border-l-0 border-input bg-muted rounded-r-md text-xs text-muted-foreground shrink-0">
            .pdf
          </span>
        </div>

        <div className="flex items-center justify-between py-3 px-3 bg-muted/40 rounded-lg">
          <div>
            <Label htmlFor="searchable-pdf" className="text-sm cursor-pointer">Searchable PDF</Label>
            <p className="text-[11px] text-muted-foreground">Embed selectable text via OCR</p>
          </div>
          <Switch
            id="searchable-pdf"
            checked={searchablePdf}
            onCheckedChange={setSearchablePdf}
          />
        </div>

        <Button
          className="w-full"
          size="lg"
          onClick={handleExportPDF}
          disabled={images.length === 0 || isExporting}
        >
          {isExporting
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating PDF…</>
            : <><Download className="w-4 h-4 mr-2" />Export as PDF</>
          }
        </Button>
      </section>
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-background text-foreground font-sans overflow-hidden">
      {/* Header */}
      <header className="shrink-0 h-14 border-b border-border px-5 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <ScanLine className="w-5 h-5" />
          VisionScan
        </div>
        <ThemeToggle />
      </header>

      {/* Progress banner */}
      {anyActive && (
        <div className="shrink-0 bg-primary text-primary-foreground px-6 py-2.5 flex items-center justify-center gap-3 text-sm">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span>
            {isBatchAutoScan
              ? `Scanning page ${scanProgress!.current} of ${scanProgress!.total}…`
              : isBatchProcessing
                ? `Processing page ${processProgress!.current} of ${processProgress!.total}…`
                : isAutoScanning
                  ? 'Scanning…'
                  : 'Processing…'
            }
            {isWakingUp && ' — Server is starting up, about 30 seconds'}
          </span>
        </div>
      )}

      {/* Empty state */}
      {images.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div
            {...getRootProps()}
            className={`max-w-md w-full rounded-2xl border-2 border-dashed p-16 text-center cursor-pointer transition-all select-none ${
              isDragActive
                ? 'border-primary bg-primary/5 scale-[1.01]'
                : 'border-border hover:border-foreground/40 hover:bg-muted/20'
            }`}
          >
            <input {...getInputProps()} />
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-6">
              <UploadCloud className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold mb-2">
              {isDragActive ? 'Drop to add pages' : 'Add your documents'}
            </h2>
            <p className="text-muted-foreground text-sm mb-6">
              Drag and drop photos here, or click to browse
            </p>
            <p className="text-xs text-muted-foreground">JPEG · PNG · WebP</p>
          </div>
        </div>
      ) : (
        /* Main app layout */
        <div className="flex flex-1 overflow-hidden">
          {/* Left: pages sidebar */}
          <aside className="hidden lg:flex flex-col w-52 shrink-0 border-r border-border bg-background overflow-hidden">
            <div className="p-3 border-b border-border shrink-0">
              <div
                {...getRootProps()}
                className={`border border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors ${
                  isDragActive
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                }`}
              >
                <input {...getInputProps()} />
                <UploadCloud className="w-4 h-4 mx-auto mb-1" />
                <p className="text-xs font-medium">Add pages</p>
              </div>
            </div>

            <ScrollArea className="flex-1 min-h-0">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={images.map(i => i.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="p-3 space-y-2">
                    {images.map((img, index) => (
                      <SortableImage
                        key={img.id}
                        id={img.id}
                        url={img.processedUrl || img.originalUrl}
                        onRemove={removeImage}
                        onClick={handleSetActive}
                        isActive={activeId === img.id}
                        pageNumber={index + 1}
                        isProcessed={!!img.processedUrl}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </ScrollArea>
          </aside>

          {/* Center + right: stacked on mobile, side-by-side on lg */}
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-w-0">
            {/* Mobile: horizontal thumbnail strip */}
            <div className="lg:hidden shrink-0 border-b border-border overflow-x-auto">
              <div className="flex gap-2 p-3">
                <div
                  {...getRootProps()}
                  className="shrink-0 w-14 h-20 rounded border-2 border-dashed border-border flex flex-col items-center justify-center cursor-pointer text-muted-foreground hover:border-foreground/40 transition-colors"
                >
                  <input {...getInputProps()} />
                  <UploadCloud className="w-4 h-4" />
                </div>
                {images.map((img, index) => (
                  <button
                    key={img.id}
                    onClick={() => handleSetActive(img.id)}
                    className={`shrink-0 relative w-14 h-20 rounded overflow-hidden transition-all ${
                      activeId === img.id ? 'ring-2 ring-primary ring-offset-1' : 'opacity-70 hover:opacity-100'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.processedUrl || img.originalUrl} alt={`Page ${index + 1}`} className="w-full h-full object-cover" />
                    <span className="absolute bottom-0.5 left-0.5 bg-black/60 text-white text-[9px] px-1 rounded">
                      {index + 1}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Preview area */}
            <div ref={previewContainerRef} className="flex-1 relative overflow-hidden bg-muted/20 min-h-0">
              {activeImage ? (
                <>
                  <div className="absolute inset-0 flex items-center justify-center p-6 lg:p-10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      ref={previewImgRef}
                      src={
                        showingOriginal
                          ? activeImage.originalUrl
                          : (activeImage.processedUrl || activeImage.originalUrl)
                      }
                      alt="Document preview"
                      className="max-w-full max-h-full object-contain drop-shadow-xl rounded-sm transition-opacity"
                      style={{ opacity: (isAutoScanning || isProcessing) ? 0.4 : 1 }}
                    />
                  </div>

                  {/* Crop overlay — shown when viewing the original */}
                  {(showingOriginal || !activeImage.processedUrl) &&
                   activeImage.corners && activeImage.naturalSize && (
                    <CropOverlay
                      corners={activeImage.corners}
                      naturalWidth={activeImage.naturalSize.width}
                      naturalHeight={activeImage.naturalSize.height}
                      imgRef={previewImgRef}
                      containerRef={previewContainerRef}
                      onChange={pts =>
                        setImages(prev => prev.map(i =>
                          i.id === activeId ? { ...i, corners: pts } : i
                        ))
                      }
                    />
                  )}

                  {/* Before/After toggle */}
                  {activeImage.processedUrl && (
                    <div className="absolute bottom-5 left-1/2 -translate-x-1/2">
                      <div className="flex rounded-full border border-border bg-background/95 backdrop-blur-sm shadow-lg overflow-hidden text-sm font-medium">
                        <button
                          onClick={() => setShowingOriginal(true)}
                          className={`px-5 py-2 transition-colors ${
                            showingOriginal
                              ? 'bg-foreground text-background'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          Before
                        </button>
                        <button
                          onClick={() => setShowingOriginal(false)}
                          className={`px-5 py-2 transition-colors ${
                            !showingOriginal
                              ? 'bg-foreground text-background'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          After
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                  <ImagePlus className="w-10 h-10 mb-3" />
                  <p className="text-sm">Select a page to preview</p>
                </div>
              )}
            </div>

            {/* Controls panel */}
            <aside className="lg:w-80 lg:shrink-0 lg:border-l border-t lg:border-t-0 border-border overflow-y-auto">
              {controlsPanel}
            </aside>
          </div>
        </div>
      )}

      <Toaster position="top-center" richColors />
    </div>
  );
}
