import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { Annotation, AnnotationsJSON, FieldType, PDFAnnotatorProps } from '../types';
import { normalizedToPixels, pixelsToNormalized } from '../types';
import { usePDFDocument } from './usePDFDocument';

const FIELD_COLORS: Record<FieldType, string> = {
  textbox: '#3b82f6',
  checkbox: '#10b981',
  radio: '#f59e0b',
};

const SELECTED_COLOR = '#ef4444';
const HANDLE_SIZE = 7;

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

type DragMode = 'none' | 'move' | 'resize' | 'create' | 'pan' | 'marquee';
type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

export function PDFAnnotator({ pdfFile, annotations, onAnnotationsChange, onSelectionChange, zoom = 1 }: PDFAnnotatorProps) {
  const { pageInfos, loading, error, renderPage } = usePDFDocument(pdfFile);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<FieldType | null>(null);
  const [panMode, setPanMode] = useState(false);
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragInitial, setDragInitial] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dragAnnotationId, setDragAnnotationId] = useState<string | null>(null);
  const [dragInitialPositions, setDragInitialPositions] = useState<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle | null>(null);
  const [createPage, setCreatePage] = useState<number | null>(null);
  const [creatingAnnotation, setCreatingAnnotation] = useState<Annotation | null>(null);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [marqueeStart, setMarqueeStart] = useState<{ x: number; y: number; page: number } | null>(null);
  const [marqueeEnd, setMarqueeEnd] = useState<{ x: number; y: number } | null>(null);

  // Render canvases when pages load
  useEffect(() => {
    pageInfos.forEach(({ pageNumber }) => {
      const canvas = canvasRefs.current.get(pageNumber);
      if (canvas) {
        renderPage(canvas, pageNumber);
      }
    });
  }, [pageInfos, renderPage]);

  const safePages = useCallback((ann: AnnotationsJSON): Record<string, Annotation[]> => {
    return ann?.pages ?? {};
  }, []);

  const getAllAnnotations = useCallback((): Annotation[] => {
    const all: Annotation[] = [];
    const p = safePages(annotations);
    for (const pageAnnotations of Object.values(p)) {
      if (Array.isArray(pageAnnotations)) {
        all.push(...pageAnnotations);
      }
    }
    return all;
  }, [annotations, safePages]);

  const getAnnotationsForPage = useCallback((pageIndex: number): Annotation[] => {
    const p = safePages(annotations);
    const result = p[String(pageIndex)];
    return Array.isArray(result) ? result : [];
  }, [annotations, safePages]);

  const updateAnnotation = useCallback((id: string, updates: Partial<Annotation>) => {
    const p = safePages(annotations);
    const newPages: Record<string, Annotation[]> = {};

    for (const [pageKey, pageAnnotations] of Object.entries(p)) {
      if (!Array.isArray(pageAnnotations)) {
        newPages[pageKey] = [];
        continue;
      }
      const idx = pageAnnotations.findIndex(a => a.id === id);
      if (idx !== -1) {
        newPages[pageKey] = pageAnnotations.map(a =>
          a.id === id ? { ...a, ...updates } : a
        );
      } else {
        newPages[pageKey] = pageAnnotations;
      }
    }
    onAnnotationsChange({ pages: newPages });
  }, [annotations, onAnnotationsChange, safePages]);

  const updateAnnotations = useCallback((ids: string[], updates: Partial<Annotation>) => {
    const p = safePages(annotations);
    const newPages: Record<string, Annotation[]> = {};

    for (const [pageKey, pageAnnotations] of Object.entries(p)) {
      if (!Array.isArray(pageAnnotations)) {
        newPages[pageKey] = [];
        continue;
      }
      newPages[pageKey] = pageAnnotations.map(a =>
        ids.includes(a.id) ? { ...a, ...updates } : a
      );
    }
    onAnnotationsChange({ pages: newPages });
  }, [annotations, onAnnotationsChange, safePages]);

  const deleteAnnotations = useCallback((ids: string[]) => {
    const p = safePages(annotations);
    const newPages: Record<string, Annotation[]> = {};

    for (const [pageKey, pageAnnotations] of Object.entries(p)) {
      if (!Array.isArray(pageAnnotations)) {
        newPages[pageKey] = [];
        continue;
      }
      newPages[pageKey] = pageAnnotations.filter(a => !ids.includes(a.id));
    }
    onAnnotationsChange({ pages: newPages });
    setSelectedIds([]);
  }, [annotations, onAnnotationsChange, safePages]);

  const addAnnotation = useCallback((pageIndex: number, normalizedBox: [number, number, number, number], type: FieldType) => {
    const newAnnotation: Annotation = {
      id: generateId(),
      type,
      normalizedBox,
      pageIndex,
    };
    const pageKey = String(pageIndex);
    const p = safePages(annotations);
    const existing = Array.isArray(p[pageKey]) ? p[pageKey] : [];
    onAnnotationsChange({
      pages: { ...p, [pageKey]: [...existing, newAnnotation] },
    });
    setSelectedIds([newAnnotation.id]);
    return newAnnotation.id;
  }, [annotations, onAnnotationsChange, safePages]);

  // Get mouse position in natural PDF coordinates relative to a page
  const getPageCoords = useCallback((e: React.MouseEvent | MouseEvent, pageIndex: number) => {
    const pageEl = document.getElementById(`page-${pageIndex}`);
    if (!pageEl) return { x: 0, y: 0 };
    const rect = pageEl.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom,
    };
  }, [zoom]);

  // Find which page the mouse is over
  const getPageAtPoint = useCallback((clientX: number, clientY: number): number | null => {
    for (const info of pageInfos) {
      const pageEl = document.getElementById(`page-${info.pageNumber}`);
      if (!pageEl) continue;
      const rect = pageEl.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return info.pageNumber;
      }
    }
    return null;
  }, [pageInfos]);

  // Mouse handlers
  const handlePageMouseDown = useCallback((e: React.MouseEvent, pageIndex: number) => {
    if (e.button !== 0) return;

    // Pan mode
    if (panMode) {
      setDragMode('pan');
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    const coords = getPageCoords(e, pageIndex);

    if (activeTool) {
      setDragMode('create');
      setCreatePage(pageIndex);
      setDragStart({ x: coords.x, y: coords.y });
      
      const pageInfo = pageInfos.find(p => p.pageNumber === pageIndex);
      if (!pageInfo) return;
      
      const normalizedBox = pixelsToNormalized(
        coords.x, coords.y, 0, 0,
        pageInfo.naturalWidth, pageInfo.naturalHeight
      );
      
      setCreatingAnnotation({
        id: 'preview',
        type: activeTool,
        normalizedBox,
        pageIndex,
      });
      
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Start marquee selection
    if (!e.shiftKey) {
      setSelectedIds([]);
    }
    setDragMode('marquee');
    setMarqueeStart({ x: coords.x, y: coords.y, page: pageIndex });
    setMarqueeEnd({ x: coords.x, y: coords.y });
    e.preventDefault();
  }, [panMode, panOffset, activeTool, getPageCoords, pageInfos]);

  const handleAnnotationMouseDown = useCallback((e: React.MouseEvent, annotation: Annotation) => {
    e.stopPropagation();
    if (activeTool || panMode) return;

    const isAlreadySelected = selectedIds.includes(annotation.id);

    if (e.shiftKey) {
      // Toggle selection
      if (isAlreadySelected) {
        setSelectedIds(prev => prev.filter(id => id !== annotation.id));
      } else {
        setSelectedIds(prev => [...prev, annotation.id]);
      }
      return;
    }

    const currentSelectedIds = isAlreadySelected ? selectedIds : [annotation.id];
    if (!isAlreadySelected) {
      setSelectedIds(currentSelectedIds);
    }

    // Start move
    const pageInfo = pageInfos.find(p => p.pageNumber === annotation.pageIndex);
    if (!pageInfo) return;

    setDragMode('move');
    setDragAnnotationId(annotation.id);
    const coords = getPageCoords(e, annotation.pageIndex);
    setDragStart({ x: coords.x, y: coords.y });
    
    const pixels = normalizedToPixels(annotation.normalizedBox, pageInfo.naturalWidth, pageInfo.naturalHeight);
    setDragInitial({ x: pixels.x, y: pixels.y, w: pixels.width, h: pixels.height });

    // Store initial positions for all selected annotations
    const initialPositions = new Map<string, { x: number; y: number; w: number; h: number }>();
    currentSelectedIds.forEach(id => {
      const ann = getAllAnnotations().find(a => a.id === id);
      if (ann) {
        const annPageInfo = pageInfos.find(p => p.pageNumber === ann.pageIndex);
        if (annPageInfo) {
          const annPixels = normalizedToPixels(ann.normalizedBox, annPageInfo.naturalWidth, annPageInfo.naturalHeight);
          initialPositions.set(id, { x: annPixels.x, y: annPixels.y, w: annPixels.width, h: annPixels.height });
        }
      }
    });
    setDragInitialPositions(initialPositions);

    e.preventDefault();
  }, [activeTool, panMode, selectedIds, getPageCoords, pageInfos, getAllAnnotations]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, annotation: Annotation, handle: ResizeHandle) => {
    e.stopPropagation();
    if (panMode) return;
    
    const pageInfo = pageInfos.find(p => p.pageNumber === annotation.pageIndex);
    if (!pageInfo) return;

    setSelectedIds([annotation.id]);
    setDragMode('resize');
    setDragAnnotationId(annotation.id);
    setResizeHandle(handle);
    const coords = getPageCoords(e, annotation.pageIndex);
    setDragStart({ x: coords.x, y: coords.y });
    
    const pixels = normalizedToPixels(annotation.normalizedBox, pageInfo.naturalWidth, pageInfo.naturalHeight);
    setDragInitial({ x: pixels.x, y: pixels.y, w: pixels.width, h: pixels.height });
    e.preventDefault();
  }, [panMode, getPageCoords, pageInfos]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragMode === 'none') return;

    // Pan mode
    if (dragMode === 'pan') {
      const newX = e.clientX - panStart.x;
      const newY = e.clientY - panStart.y;
      setPanOffset({ x: newX, y: newY });
      return;
    }

    // Marquee selection
    if (dragMode === 'marquee' && marqueeStart) {
      const coords = getPageCoords(e, marqueeStart.page);
      setMarqueeEnd({ x: coords.x, y: coords.y });
      return;
    }

    // Create mode
    if (dragMode === 'create' && createPage !== null && activeTool) {
      const coords = getPageCoords(e, createPage);
      const pageInfo = pageInfos.find(p => p.pageNumber === createPage);
      if (!pageInfo) return;

      const x = Math.min(dragStart.x, coords.x);
      const y = Math.min(dragStart.y, coords.y);
      const w = Math.abs(coords.x - dragStart.x);
      const h = Math.abs(coords.y - dragStart.y);

      const normalizedBox = pixelsToNormalized(x, y, w, h, pageInfo.naturalWidth, pageInfo.naturalHeight);
      
      setCreatingAnnotation({
        id: 'preview',
        type: activeTool,
        normalizedBox,
        pageIndex: createPage,
      });
      return;
    }

    // Move/Resize
    if (!dragAnnotationId || !dragInitial) return;

    const annotation = getAllAnnotations().find(a => a.id === dragAnnotationId);
    if (!annotation) return;

    const pageInfo = pageInfos.find(p => p.pageNumber === annotation.pageIndex);
    if (!pageInfo) return;

    const pageCoords = getPageCoords(e, annotation.pageIndex);
    const dx = pageCoords.x - dragStart.x;
    const dy = pageCoords.y - dragStart.y;

    if (dragMode === 'move') {
      // Move all selected annotations using their INITIAL positions
      const p = safePages(annotations);
      const newPages: Record<string, Annotation[]> = {};

      for (const [pageKey, pageAnnotations] of Object.entries(p)) {
        if (!Array.isArray(pageAnnotations)) {
          newPages[pageKey] = [];
          continue;
        }
        newPages[pageKey] = pageAnnotations.map(a => {
          if (!selectedIds.includes(a.id)) return a;
          const aInfo = pageInfos.find(pg => pg.pageNumber === a.pageIndex);
          if (!aInfo) return a;
          
          // Use INITIAL position from drag start, not current position
          const initialPos = dragInitialPositions.get(a.id);
          if (!initialPos) return a;
          
          const newX = Math.max(0, initialPos.x + dx);
          const newY = Math.max(0, initialPos.y + dy);
          const normalizedBox = pixelsToNormalized(
            newX, newY, initialPos.w, initialPos.h,
            aInfo.naturalWidth, aInfo.naturalHeight
          );
          return { ...a, normalizedBox };
        });
      }
      onAnnotationsChange({ pages: newPages });
    } else if (dragMode === 'resize' && resizeHandle) {
      let newX = dragInitial.x;
      let newY = dragInitial.y;
      let newW = dragInitial.w;
      let newH = dragInitial.h;

      if (resizeHandle.includes('e')) { newW = Math.max(10, dragInitial.w + dx); }
      if (resizeHandle.includes('w')) { newX = dragInitial.x + dx; newW = Math.max(10, dragInitial.w - dx); }
      if (resizeHandle.includes('s')) { newH = Math.max(10, dragInitial.h + dy); }
      if (resizeHandle.includes('n')) { newY = dragInitial.y + dy; newH = Math.max(10, dragInitial.h - dy); }

      const normalizedBox = pixelsToNormalized(
        newX, newY, newW, newH,
        pageInfo.naturalWidth, pageInfo.naturalHeight
      );
      
      updateAnnotation(dragAnnotationId, { normalizedBox });
    }
  }, [dragMode, panStart, marqueeStart, createPage, activeTool, dragAnnotationId, dragInitial, dragStart, resizeHandle, getPageCoords, updateAnnotation, getAllAnnotations, pageInfos, selectedIds, safePages, annotations, onAnnotationsChange, dragInitialPositions]);

  const handleMouseUp = useCallback(() => {
    // Marquee selection complete
    if (dragMode === 'marquee' && marqueeStart && marqueeEnd) {
      const minX = Math.min(marqueeStart.x, marqueeEnd.x);
      const minY = Math.min(marqueeStart.y, marqueeEnd.y);
      const maxX = Math.max(marqueeStart.x, marqueeEnd.x);
      const maxY = Math.max(marqueeStart.y, marqueeEnd.y);

      // Only select if marquee is big enough
      if (maxX - minX > 3 && maxY - minY > 3) {
        const pageInfo = pageInfos.find(p => p.pageNumber === marqueeStart.page);
        if (pageInfo) {
          const pageAnnotations = getAnnotationsForPage(marqueeStart.page);
          const intersecting = pageAnnotations.filter(a => {
            const pixels = normalizedToPixels(a.normalizedBox, pageInfo.naturalWidth, pageInfo.naturalHeight);
            return (
              pixels.x < maxX &&
              pixels.x + pixels.width > minX &&
              pixels.y < maxY &&
              pixels.y + pixels.height > minY
            );
          });
          const ids = intersecting.map(a => a.id);
          setSelectedIds(prev => {
            const combined = new Set([...prev, ...ids]);
            return Array.from(combined);
          });
        }
      }
    }

    if (dragMode === 'create' && createPage !== null && creatingAnnotation && activeTool) {
      const [ymin, xmin, ymax, xmax] = creatingAnnotation.normalizedBox;
      const w = xmax - xmin;
      const h = ymax - ymin;
      
      if (w > 5 && h > 5) {
        addAnnotation(createPage, creatingAnnotation.normalizedBox, activeTool);
      }
      setActiveTool(null);
    }
    setDragMode('none');
    setDragInitial(null);
    setDragInitialPositions(new Map());
    setResizeHandle(null);
    setCreatePage(null);
    setCreatingAnnotation(null);
    setMarqueeStart(null);
    setMarqueeEnd(null);
    setDragAnnotationId(null);
  }, [dragMode, marqueeStart, marqueeEnd, createPage, creatingAnnotation, activeTool, addAnnotation, pageInfos, getAnnotationsForPage]);

  // Keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0 && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
          deleteAnnotations(selectedIds);
        }
      }
      if (e.key === 'Escape') {
        setSelectedIds([]);
        setActiveTool(null);
        setPanMode(false);
      }
      if (e.key === 'h' || e.key === 'H') {
        if (!(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
          setPanMode(p => !p);
        }
      }
      // Ctrl/Cmd+A to select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        if (!(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          const allIds = getAllAnnotations().map(a => a.id);
          setSelectedIds(allIds);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, deleteAnnotations, getAllAnnotations]);

  // Notify parent of selection changes
  useEffect(() => {
    onSelectionChange?.(selectedIds);
  }, [selectedIds, onSelectionChange]);

  // Render annotation overlay for a page
  const renderAnnotations = (pageIndex: number) => {
    const pageAnnotations = getAnnotationsForPage(pageIndex);
    const pageInfo = pageInfos.find(p => p.pageNumber === pageIndex);
    if (!pageInfo) return null;

    const svgWidth = pageInfo.naturalWidth;
    const svgHeight = pageInfo.naturalHeight;

    return (
      <svg
        className="absolute inset-0 pointer-events-none"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ width: svgWidth, height: svgHeight }}
      >
        {pageAnnotations.map(annotation => {
          const isSelected = selectedIds.includes(annotation.id);
          const color = isSelected ? SELECTED_COLOR : FIELD_COLORS[annotation.type];
          const fillColor = isSelected ? `${SELECTED_COLOR}15` : `${FIELD_COLORS[annotation.type]}08`;

          const pixels = normalizedToPixels(annotation.normalizedBox, svgWidth, svgHeight);

          return (
            <g key={annotation.id}>
              {/* Main rect - solid thin border */}
              <rect
                x={pixels.x}
                y={pixels.y}
                width={pixels.width}
                height={pixels.height}
                fill={fillColor}
                stroke={color}
                strokeWidth={isSelected ? 1.5 : 1}
                rx={annotation.type === 'radio' ? Math.min(pixels.width, pixels.height) / 2 : 2}
                className="pointer-events-auto cursor-move"
                style={{ transition: 'fill 0.15s, stroke 0.15s' }}
                onMouseDown={(e) => handleAnnotationMouseDown(e, annotation)}
              />

              {/* Label tab - only show when selected */}
              {isSelected && annotation.label && (
                <g>
                  <rect
                    x={pixels.x}
                    y={pixels.y - 9}
                    width={Math.max(annotation.label.length * 3 + 6, 20)}
                    height={9}
                    fill={color}
                    rx={1.5}
                    opacity={0.95}
                  />
                  <text
                    x={pixels.x + 3}
                    y={pixels.y - 2.5}
                    fontSize={5}
                    fill="white"
                    fontFamily="system-ui, -apple-system, sans-serif"
                    fontWeight={500}
                    style={{ userSelect: 'none' }}
                  >
                    {annotation.label}
                  </text>
                </g>
              )}

              {/* Type indicator when no label and not selected */}
              {!isSelected && !annotation.label && (
                <text
                  x={pixels.x + 3}
                  y={pixels.y + Math.min(pixels.height * 0.65, 10)}
                  fontSize={7}
                  fill={color}
                  fontFamily="system-ui, sans-serif"
                  fontWeight={600}
                  opacity={0.5}
                  style={{ userSelect: 'none' }}
                >
                  {annotation.type === 'textbox' ? 'T' : annotation.type === 'checkbox' ? '☐' : '◉'}
                </text>
              )}

              {/* Radio group indicator */}
              {isSelected && annotation.radioGroup && (
                <g>
                  <circle
                    cx={pixels.x + pixels.width - 4}
                    cy={pixels.y + 4}
                    r={3}
                    fill="#f59e0b"
                    stroke="white"
                    strokeWidth={0.5}
                  />
                </g>
              )}

              {/* Resize handles for selected */}
              {isSelected && (
                <>
                  {([
                    { handle: 'nw' as ResizeHandle, cx: pixels.x, cy: pixels.y },
                    { handle: 'ne' as ResizeHandle, cx: pixels.x + pixels.width, cy: pixels.y },
                    { handle: 'sw' as ResizeHandle, cx: pixels.x, cy: pixels.y + pixels.height },
                    { handle: 'se' as ResizeHandle, cx: pixels.x + pixels.width, cy: pixels.y + pixels.height },
                  ]).map(({ handle, cx, cy }) => (
                    <rect
                      key={handle}
                      x={cx - HANDLE_SIZE / 2}
                      y={cy - HANDLE_SIZE / 2}
                      width={HANDLE_SIZE}
                      height={HANDLE_SIZE}
                      fill="white"
                      stroke={SELECTED_COLOR}
                      strokeWidth={1}
                      rx={1}
                      className="pointer-events-auto"
                      style={{ cursor: handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize' }}
                      onMouseDown={(e) => handleResizeMouseDown(e, annotation, handle)}
                    />
                  ))}
                  {([
                    { handle: 'n' as ResizeHandle, cx: pixels.x + pixels.width / 2, cy: pixels.y },
                    { handle: 's' as ResizeHandle, cx: pixels.x + pixels.width / 2, cy: pixels.y + pixels.height },
                    { handle: 'e' as ResizeHandle, cx: pixels.x + pixels.width, cy: pixels.y + pixels.height / 2 },
                    { handle: 'w' as ResizeHandle, cx: pixels.x, cy: pixels.y + pixels.height / 2 },
                  ]).map(({ handle, cx, cy }) => (
                    <rect
                      key={handle}
                      x={cx - HANDLE_SIZE / 2}
                      y={cy - HANDLE_SIZE / 2}
                      width={HANDLE_SIZE}
                      height={HANDLE_SIZE}
                      fill="white"
                      stroke={SELECTED_COLOR}
                      strokeWidth={1}
                      rx={1}
                      className="pointer-events-auto"
                      style={{ cursor: handle === 'n' || handle === 's' ? 'ns-resize' : 'ew-resize' }}
                      onMouseDown={(e) => handleResizeMouseDown(e, annotation, handle)}
                    />
                  ))}
                </>
              )}
            </g>
          );
        })}

        {/* Creation preview */}
        {dragMode === 'create' && creatingAnnotation && activeTool && createPage === pageIndex && (
          (() => {
            const pixels = normalizedToPixels(creatingAnnotation.normalizedBox, svgWidth, svgHeight);
            return (
              <rect
                x={pixels.x}
                y={pixels.y}
                width={pixels.width}
                height={pixels.height}
                fill={`${FIELD_COLORS[activeTool]}20`}
                stroke={FIELD_COLORS[activeTool]}
                strokeWidth={1}
                rx={activeTool === 'radio' ? Math.min(pixels.width, pixels.height) / 2 : 2}
              />
            );
          })()
        )}

        {/* Marquee selection rectangle */}
        {dragMode === 'marquee' && marqueeStart && marqueeEnd && marqueeStart.page === pageIndex && (
          <rect
            x={Math.min(marqueeStart.x, marqueeEnd.x)}
            y={Math.min(marqueeStart.y, marqueeEnd.y)}
            width={Math.abs(marqueeEnd.x - marqueeStart.x)}
            height={Math.abs(marqueeEnd.y - marqueeStart.y)}
            fill="rgba(59, 130, 246, 0.1)"
            stroke="#3b82f6"
            strokeWidth={0.5}
            strokeDasharray="3 2"
          />
        )}
      </svg>
    );
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900 text-red-400 p-8">
        <div className="text-center">
          <p className="text-lg font-semibold">Error loading PDF</p>
          <p className="text-sm mt-2 opacity-70">{error}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900">
        <div className="flex items-center gap-3 text-gray-400">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Loading PDF...</span>
        </div>
      </div>
    );
  }

  if (!pdfFile) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900">
        <div className="text-center text-gray-500">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm">Upload a PDF to get started</p>
          <p className="text-xs mt-1 opacity-60">Use the button in the toolbar above</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: panMode ? (dragMode === 'pan' ? 'grabbing' : 'grab') : activeTool ? 'crosshair' : 'default' }}
    >
      {/* Toolbar */}
      <div className="w-11 bg-gray-900/95 backdrop-blur flex flex-col items-center py-3 gap-1.5 border-r border-gray-800 shrink-0">
        <button
          onClick={() => { setActiveTool(null); setPanMode(false); }}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-all duration-150 ${!activeTool && !panMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'}`}
          title="Select tool (Esc)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
          </svg>
        </button>

        <button
          onClick={() => { setPanMode(!panMode); setActiveTool(null); }}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-all duration-150 ${panMode ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'}`}
          title="Pan tool (H)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M18 11V6a2 2 0 00-2-2v0a2 2 0 00-2 2v0M14 10V4a2 2 0 00-2-2v0a2 2 0 00-2 2v2M10 10.5V6a2 2 0 00-2-2v0a2 2 0 00-2 2v8" />
            <path d="M18 8a2 2 0 012 2v4.5a6.5 6.5 0 01-13 0V13a2 2 0 014 0v.5" />
          </svg>
        </button>

        <div className="w-5 h-px bg-gray-800 my-1" />

        <button
          onClick={() => { setActiveTool(activeTool === 'textbox' ? null : 'textbox'); setPanMode(false); }}
          className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold transition-all duration-150 ${activeTool === 'textbox' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'}`}
          title="Add Textbox"
        >
          T
        </button>
        <button
          onClick={() => { setActiveTool(activeTool === 'checkbox' ? null : 'checkbox'); setPanMode(false); }}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-all duration-150 ${activeTool === 'checkbox' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'}`}
          title="Add Checkbox"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </button>
        <button
          onClick={() => { setActiveTool(activeTool === 'radio' ? null : 'radio'); setPanMode(false); }}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-all duration-150 ${activeTool === 'radio' ? 'bg-amber-600 text-white shadow-lg shadow-amber-600/30' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'}`}
          title="Add Radio Button"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="4" fill="currentColor" />
          </svg>
        </button>

        <div className="flex-1" />

        {selectedIds.length > 0 && (
          <button
            onClick={() => deleteAnnotations(selectedIds)}
            className="w-8 h-8 rounded-md flex items-center justify-center text-red-400 hover:bg-red-900/40 hover:text-red-300 transition-all duration-150"
            title={`Delete selected (${selectedIds.length})`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>

      {/* PDF Viewer */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-gray-800/50"
      >
        <div
          className="flex flex-col items-center py-8 gap-8 min-w-fit px-8"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
            transformOrigin: 'center top',
          }}
        >
          {pageInfos.map(({ pageNumber, naturalWidth, naturalHeight }) => (
            <div key={pageNumber} className="relative">
              <div
                id={`page-${pageNumber}`}
                className="relative shadow-2xl shadow-black/40 bg-white rounded-sm overflow-hidden"
                style={{ width: naturalWidth, height: naturalHeight }}
                onMouseDown={(e) => handlePageMouseDown(e, pageNumber)}
              >
                <canvas
                  ref={(el) => {
                    if (el) canvasRefs.current.set(pageNumber, el);
                  }}
                  style={{ width: naturalWidth, height: naturalHeight, display: 'block' }}
                />
                {renderAnnotations(pageNumber)}
              </div>
              <div className="text-center mt-3 text-xs text-gray-500 font-medium">
                {pageNumber}
              </div>
            </div>
          ))}
          <div className="h-8" />
        </div>
      </div>
    </div>
  );
}
