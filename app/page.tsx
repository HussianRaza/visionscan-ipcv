'use client';

import React, { useState, useCallback, useEffect } from 'react';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { UploadCloud, Wand2, FileText, Download, Settings, Loader2, ImagePlus } from 'lucide-react';
import { toast, Toaster } from 'sonner';

import { ThemeToggle } from '@/components/theme-toggle';

interface ImageItem {
  id: string;
  file: File;
  originalUrl: string;
  processedUrl?: string;
  extractedText?: string;
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

export default function Home() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [options, setOptions] = useState<ProcessingOptions>(DEFAULT_OPTIONS);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [apiUrl, setApiUrl] = useState(
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    // Cleanup object URLs to avoid memory leaks
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
      id: Math.random().toString(36).substring(7),
      file,
      originalUrl: URL.createObjectURL(file),
    }));
    
    setImages(prev => {
      const updated = [...prev, ...newImages];
      if (!activeId && updated.length > 0) {
        setActiveId(updated[0].id);
      }
      return updated;
    });
  }, [activeId]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp']
    }
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setImages((items) => {
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
      if (activeId === id) {
        setActiveId(updated.length > 0 ? updated[0].id : null);
      }
      return updated;
    });
  };

  const activeImage = images.find(img => img.id === activeId);

  const handleProcess = async () => {
    if (!activeImage) return;
    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append('file', activeImage.file);
      formData.append('options', JSON.stringify(options));

      const response = await fetch(`${apiUrl}/process`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Processing failed');
      }

      const blob = await response.blob();
      const processedUrl = URL.createObjectURL(blob);

      setImages(prev => prev.map(img => 
        img.id === activeId 
          ? { ...img, processedUrl } 
          : img
      ));
      toast.success('Image processed successfully!');
    } catch (error) {
      console.error(error);
      toast.error('Could not connect to the Python Backend. Make sure it is running or configured correctly in Settings.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOCR = async () => {
    if (!activeImage) return;
    const fileToProcess = activeImage.processedUrl 
      ? await fetch(activeImage.processedUrl).then(r => r.blob())
      : activeImage.file;

    try {
      toast.info('Running OCR...');
      const formData = new FormData();
      formData.append('file', fileToProcess as Blob, activeImage.file.name);

      const response = await fetch(`${apiUrl}/ocr`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('OCR failed');

      const data = await response.json();
      setImages(prev => prev.map(img => 
        img.id === activeId 
          ? { ...img, extractedText: data.text } 
          : img
      ));
      toast.success('Text extracted successfully!');
    } catch (error) {
      console.error(error);
      toast.error('OCR failed. Check backend connection.');
    }
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

      const response = await fetch(`${apiUrl}/export-pdf`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('PDF Export failed');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `document_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('PDF downloaded successfully!');
    } catch (error) {
      console.error(error);
      toast.error('Failed to export PDF. Check backend connection.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <header className="bg-background border-b border-border px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2 text-primary font-semibold text-lg tracking-tight">
          <div className="bg-primary/10 p-2 rounded-lg">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          IPCV DocuScan
        </div>
        
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Dialog>
            <DialogTrigger className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-10 w-10 text-muted-foreground">
                <Settings className="w-5 h-5" />
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Backend Configuration</DialogTitle>
              </DialogHeader>
              <div className="py-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="apiUrl">FastAPI Backend URL</Label>
                  <Input 
                    id="apiUrl" 
                    value={apiUrl} 
                    onChange={e => setApiUrl(e.target.value)} 
                    placeholder="https://your-space.hf.space"
                  />
                  <p className="text-xs text-muted-foreground">
                    Must point to your running Python backend (Local or Hugging Face Spaces).
                  </p>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Sidebar - Tools */}
        <div className="lg:col-span-3 space-y-6">
          <Card className="shadow-sm border-border">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Wand2 className="w-4 h-4" />
                IPCV Processing
              </CardTitle>
              <CardDescription>Apply OpenCV filters to selected image</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                {[
                  { id: 'grayscale', label: 'Grayscale', desc: 'Convert to black and white' },
                  { id: 'enhance', label: 'Auto Contrast', desc: 'Histogram equalization' },
                  { id: 'denoise', label: 'Denoise', desc: 'Remove grain/noise' },
                  { id: 'sharpen', label: 'Sharpen Edges', desc: 'Make text crisper' },
                  { id: 'deskew', label: 'Auto Deskew', desc: 'Straighten tilted text' },
                  { id: 'crop', label: 'Document Crop', desc: 'Auto detect borders' },
                  { id: 'threshold', label: 'Binarize', desc: 'High contrast document' },
                ].map((opt) => (
                  <div key={opt.id} className="flex items-center justify-between">
                    <div>
                      <Label htmlFor={opt.id} className="cursor-pointer">{opt.label}</Label>
                      <p className="text-[10px] text-muted-foreground">{opt.desc}</p>
                    </div>
                    <Switch 
                      id={opt.id} 
                      checked={options[opt.id as keyof ProcessingOptions] as boolean}
                      onCheckedChange={(c) => setOptions(prev => ({...prev, [opt.id]: c}))}
                    />
                  </div>
                ))}

                <div className="pt-4 border-t border-border">
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="watermark" className="cursor-pointer">Watermark</Label>
                    <Switch 
                      id="watermark" 
                      checked={options.watermark}
                      onCheckedChange={(c) => setOptions(prev => ({...prev, watermark: c}))}
                    />
                  </div>
                  {options.watermark && (
                    <Input 
                      value={options.watermark_text}
                      onChange={(e) => setOptions(prev => ({...prev, watermark_text: e.target.value}))}
                      className="h-8 text-sm mt-2"
                      placeholder="Enter watermark text"
                    />
                  )}
                </div>
              </div>

              <Button 
                className="w-full mt-4" 
                onClick={handleProcess}
                disabled={!activeImage || isProcessing}
              >
                {isProcessing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Apply to Selected
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Text Extraction
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button 
                variant="outline" 
                className="w-full"
                onClick={handleOCR}
                disabled={!activeImage}
              >
                Run Tesseract OCR
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Center - Preview area */}
        <div className="lg:col-span-6 space-y-6">
          <Tabs defaultValue="preview" className="w-full">
            <div className="flex items-center justify-between mb-4">
              <TabsList>
                <TabsTrigger value="preview">Live Preview</TabsTrigger>
                <TabsTrigger value="ocr">Extracted Text</TabsTrigger>
              </TabsList>
              {activeImage?.processedUrl && (
                <div className="text-xs bg-primary/10 text-primary px-2 py-1 rounded font-medium">
                  Processed
                </div>
              )}
            </div>

            <TabsContent value="preview" className="m-0">
              <Card className="border-border shadow-sm overflow-hidden bg-muted/30 relative">
                {activeImage ? (
                  <div className="relative aspect-[3/4] w-full flex items-center justify-center p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img 
                      src={activeImage.processedUrl || activeImage.originalUrl} 
                      alt="Preview" 
                      className="max-w-full max-h-[70vh] object-contain drop-shadow-sm transition-opacity"
                      style={{ opacity: isProcessing ? 0.5 : 1 }}
                    />
                    {isProcessing && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="aspect-[3/4] flex flex-col items-center justify-center text-muted-foreground p-8 text-center border-2 border-dashed border-border m-4 rounded-xl">
                    <ImagePlus className="w-12 h-12 mb-4 text-muted-foreground" />
                    <p className="font-medium text-muted-foreground mb-1">No image selected</p>
                    <p className="text-sm">Upload images to begin processing</p>
                  </div>
                )}
              </Card>
            </TabsContent>
            <TabsContent value="ocr" className="m-0">
              <Card className="min-h-[400px] border-border shadow-sm p-6 bg-card prose prose-sm max-w-none dark:prose-invert">
                {activeImage?.extractedText ? (
                  <pre className="whitespace-pre-wrap font-sans text-foreground">
                    {activeImage.extractedText}
                  </pre>
                ) : (
                  <div className="h-[400px] flex items-center justify-center text-muted-foreground text-sm">
                    No text extracted yet. Run OCR from the sidebar.
                  </div>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Sidebar - Pages & Export */}
        <div className="lg:col-span-3 flex flex-col h-[calc(100vh-8rem)]">
          <Card className="shadow-sm border-border flex-1 flex flex-col hidden lg:flex">
            <CardHeader className="pb-4 shrink-0">
              <CardTitle className="text-base font-medium">Pages ({images.length})</CardTitle>
              <CardDescription>Drag to reorder</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0 px-6 pb-6 flex flex-col gap-4">
              <div 
                {...getRootProps()} 
                className={`shrink-0 border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                  isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted'
                }`}
              >
                <input {...getInputProps()} />
                <UploadCloud className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground">Drop images here</p>
              </div>

              <ScrollArea className="flex-1 -mx-2 px-2">
                <DndContext 
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext 
                    items={images.map(i => i.id)}
                    strategy={rectSortingStrategy}
                  >
                    <div className="grid grid-cols-2 gap-3 pb-4">
                      {images.map((img) => (
                        <SortableImage 
                          key={img.id}
                          id={img.id}
                          url={img.processedUrl || img.originalUrl}
                          onRemove={removeImage}
                          onClick={setActiveId}
                          isActive={activeId === img.id}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </ScrollArea>
            </CardContent>
            
            <div className="p-4 border-t border-border bg-muted/50 shrink-0 rounded-b-lg">
              <Button 
                className="w-full" 
                size="lg"
                onClick={handleExportPDF}
                disabled={images.length === 0 || isExporting}
              >
                {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Export PDF
              </Button>
            </div>
          </Card>
        </div>
      </main>
      <Toaster position="top-center" richColors />
    </div>
  );
}
