'use client';

import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X, GripVertical } from 'lucide-react';
import Image from 'next/image';

interface SortableImageProps {
  id: string;
  url: string;
  onRemove: (id: string) => void;
  onClick: (id: string) => void;
  isActive: boolean;
}

export function SortableImage({ id, url, onRemove, onClick, isActive }: SortableImageProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group touch-none">
      <Card 
        className={`overflow-hidden cursor-pointer transition-all ${isActive ? 'ring-2 ring-primary ring-offset-2' : ''}`}
        onClick={() => onClick(id)}
      >
        <div className="relative aspect-[3/4] w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            src={url} 
            alt="Uploaded preview" 
            className="w-full h-full object-cover"
          />
        </div>
      </Card>
      
      <div 
        className="absolute top-2 left-2 bg-black/50 p-1.5 rounded text-white cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        {...attributes} 
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </div>
      
      <Button
        variant="destructive"
        size="icon"
        className="absolute top-2 right-2 w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(id);
        }}
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
