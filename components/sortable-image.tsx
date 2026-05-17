'use client';

import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X, GripVertical, Check } from 'lucide-react';

interface SortableImageProps {
  id: string;
  url: string;
  onRemove: (id: string) => void;
  onClick: (id: string) => void;
  isActive: boolean;
  pageNumber: number;
  isProcessed: boolean;
}

export function SortableImage({ id, url, onRemove, onClick, isActive, pageNumber, isProcessed }: SortableImageProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group touch-none">
      <div
        className={`overflow-hidden rounded-lg cursor-pointer transition-all ${
          isActive
            ? 'ring-2 ring-primary ring-offset-2'
            : 'hover:ring-1 hover:ring-foreground/30 hover:ring-offset-1'
        }`}
        onClick={() => onClick(id)}
      >
        <div className="relative aspect-[3/4] w-full bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Page ${pageNumber}`}
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      {/* Page number */}
      <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] font-medium px-1.5 py-0.5 rounded pointer-events-none">
        {pageNumber}
      </div>

      {/* Processed indicator — hidden on hover so delete button can appear */}
      {isProcessed && (
        <div className="absolute top-2 right-2 w-5 h-5 bg-primary text-primary-foreground rounded-full flex items-center justify-center group-hover:hidden pointer-events-none">
          <Check className="w-3 h-3" />
        </div>
      )}

      {/* Drag handle */}
      <div
        className="absolute top-2 left-2 bg-black/50 p-1.5 rounded text-white cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-3 h-3" />
      </div>

      {/* Delete button */}
      <button
        className="absolute top-2 right-2 w-6 h-6 bg-destructive text-destructive-foreground rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={e => {
          e.stopPropagation();
          onRemove(id);
        }}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
