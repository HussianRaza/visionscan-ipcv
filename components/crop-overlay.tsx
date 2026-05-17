'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Point = [number, number];

interface CropOverlayProps {
  corners: Point[];                                        // [TL, TR, BR, BL] in image pixel space
  naturalWidth: number;
  naturalHeight: number;
  imgRef: React.RefObject<HTMLImageElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onChange: (corners: Point[]) => void;
}

export function CropOverlay({
  corners,
  naturalWidth,
  naturalHeight,
  imgRef,
  containerRef,
  onChange,
}: CropOverlayProps) {
  // imgRect: image's rendered bounds relative to the container div
  const [imgRect, setImgRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const measure = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;
    const iB = img.getBoundingClientRect();
    const cB = container.getBoundingClientRect();
    setImgRect({ x: iB.left - cB.left, y: iB.top - cB.top, w: iB.width, h: iB.height });
  }, [imgRef, containerRef]);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (imgRef.current) ro.observe(imgRef.current);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [measure, imgRef, containerRef]);

  if (!imgRect || imgRect.w === 0 || naturalWidth === 0) return null;

  const scaleX = imgRect.w / naturalWidth;
  const scaleY = imgRect.h / naturalHeight;
  const HANDLE_R = Math.max(9, Math.min(imgRect.w, imgRect.h) * 0.025);

  const toSvg = ([ix, iy]: Point): Point => [ix * scaleX, iy * scaleY];
  const displayPts = corners.map(toSvg);
  const polygon = displayPts.map(([x, y]) => `${x},${y}`).join(' ');

  const startDrag = (idx: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const onMove = (ev: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const cB = container.getBoundingClientRect();
      const rx = ev.clientX - cB.left - imgRect.x;
      const ry = ev.clientY - cB.top - imgRect.y;
      const ix = Math.max(0, Math.min(naturalWidth, rx / scaleX));
      const iy = Math.max(0, Math.min(naturalHeight, ry / scaleY));
      onChange(corners.map((c, i) => (i === idx ? [ix, iy] : c)) as Point[]);
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const strokeW = Math.max(1.5, HANDLE_R * 0.2);

  return (
    <svg
      className="absolute pointer-events-none select-none"
      style={{ left: imgRect.x, top: imgRect.y, width: imgRect.w, height: imgRect.h }}
    >
      {/* Dim the area outside the crop quad */}
      <defs>
        <clipPath id="crop-hole">
          <polygon points={polygon} />
        </clipPath>
        <mask id="outside-mask">
          <rect width="100%" height="100%" fill="white" />
          <polygon points={polygon} fill="black" />
        </mask>
      </defs>
      <rect
        width="100%" height="100%"
        fill="rgba(0,0,0,0.4)"
        mask="url(#outside-mask)"
      />

      {/* Crop boundary */}
      <polygon
        points={polygon}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={strokeW}
        strokeLinejoin="round"
      />

      {/* Corner handles */}
      {displayPts.map(([x, y], i) => (
        <g
          key={i}
          style={{ pointerEvents: 'all', cursor: 'grab', touchAction: 'none' }}
          onPointerDown={startDrag(i)}
        >
          {/* Larger invisible hit area */}
          <circle cx={x} cy={y} r={HANDLE_R * 2} fill="transparent" />
          {/* Visible handle */}
          <circle
            cx={x} cy={y} r={HANDLE_R}
            fill="white"
            stroke="#3b82f6"
            strokeWidth={strokeW}
          />
          {/* Crosshair */}
          <line x1={x - HANDLE_R * 0.35} y1={y} x2={x + HANDLE_R * 0.35} y2={y}
            stroke="#3b82f6" strokeWidth={Math.max(1, strokeW * 0.8)} />
          <line x1={x} y1={y - HANDLE_R * 0.35} x2={x} y2={y + HANDLE_R * 0.35}
            stroke="#3b82f6" strokeWidth={Math.max(1, strokeW * 0.8)} />
        </g>
      ))}
    </svg>
  );
}
