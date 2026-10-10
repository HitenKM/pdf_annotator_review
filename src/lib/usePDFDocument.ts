import { useState, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Try to set worker from CDN, will gracefully fallback to main thread if it fails
try {
  const workerUrl = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
} catch (e) {
  console.warn('Could not set PDF.js worker URL, will use main thread fallback');
}

export interface PDFPageInfo {
  pageNumber: number;
  scaledWidth: number;
  scaledHeight: number;
  naturalWidth: number;
  naturalHeight: number;
}

export function usePDFDocument(pdfFile: File | string | null) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageInfos, setPageInfos] = useState<PDFPageInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const RENDER_SCALE = 2; // Render at 2x for crisp display at all zoom levels

  useEffect(() => {
    if (!pdfFile) {
      setPdfDoc(null);
      setPageInfos([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const loadPDF = async () => {
      const timeoutId = setTimeout(() => {
        if (!cancelled) {
          setError('PDF loading timed out. Please try again or check your internet connection.');
          setLoading(false);
        }
      }, 15000);

      try {
        let doc: pdfjsLib.PDFDocumentProxy;

        if (pdfFile instanceof File) {
          const arrayBuffer = await pdfFile.arrayBuffer();
          doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        } else {
          doc = await pdfjsLib.getDocument({ url: pdfFile }).promise;
        }

        if (cancelled) {
          clearTimeout(timeoutId);
          return;
        }
        setPdfDoc(doc);

        const infos: PDFPageInfo[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          infos.push({
            pageNumber: i,
            scaledWidth: viewport.width,
            scaledHeight: viewport.height,
            naturalWidth: viewport.width / RENDER_SCALE,
            naturalHeight: viewport.height / RENDER_SCALE,
          });
        }

        if (!cancelled) {
          setPageInfos(infos);
        }
      } catch (err: any) {
        console.error('PDF load error:', err);
        if (!cancelled) {
          let errorMessage = err?.message || 'Failed to load PDF';
          if (errorMessage.includes('worker')) {
            errorMessage = 'PDF worker failed to load. The PDF may still work on the main thread.';
          }
          setError(errorMessage);
        }
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPDF();
    return () => { cancelled = true; };
  }, [pdfFile]);

  const renderPage = useCallback(
    async (canvas: HTMLCanvasElement, pageNumber: number) => {
      if (!pdfDoc) return;
      try {
        const page = await pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const context = canvas.getContext('2d');
        if (!context) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport } as any).promise;
      } catch (err) {
        console.warn('Failed to render page', pageNumber, err);
      }
    },
    [pdfDoc]
  );

  return { pdfDoc, pageInfos, loading, error, renderPage, RENDER_SCALE };
}
