export type FieldType = 'textbox' | 'checkbox' | 'radio';

/** Input format from user's JSON - normalized 0-1000 coordinates */
export interface InputField {
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000
  field_name?: string;
  label?: string;
  field_type?: string; // e.g. "Text Field", "Radio Button", "Checkbox", "text_input", "checkbox"
  page_no?: number;
  page_number?: number;
  row_index?: number;
}

/** PDF Form Filler v1 format */
export interface PDFFormFillerV1 {
  format: string;
  template_filename?: string;
  cached_at?: string;
  updated_at?: string;
  entries: {
    analysis: {
      fields: InputField[];
      route?: {
        use_acroform: boolean;
        acroform_reason?: string;
        widget_pages?: number[];
        vision_pages?: number[];
      };
      page_count?: number;
    };
    labels?: Record<string, unknown>;
    feedback?: {
      settled?: boolean;
      rules?: Record<string, unknown>;
    };
  };
}

/** Internal annotation format - stores normalized coordinates */
export interface Annotation {
  id: string;
  type: FieldType;
  /** Normalized bounding box [ymin, xmin, ymax, xmax] in 0-1000 range */
  normalizedBox: [number, number, number, number];
  label?: string;
  pageIndex: number;
  /** Optional radio group name - links multiple radio buttons together */
  radioGroup?: string;
}

export interface AnnotationsJSON {
  pages: Record<string, Annotation[]>;
}

export interface PDFAnnotatorProps {
  pdfFile: File | string | null;
  annotations: AnnotationsJSON;
  onAnnotationsChange: (annotations: AnnotationsJSON) => void;
  onSelectionChange?: (annotationIds: string[]) => void;
  zoom?: number;
}

export interface PageDimensions {
  width: number;
  height: number;
}

/** Map input field_type strings to internal FieldType */
function mapFieldType(fieldType?: string): FieldType {
  if (!fieldType) return 'textbox';
  const normalized = fieldType.toLowerCase().trim();
  if (normalized.includes('radio')) return 'radio';
  if (normalized.includes('checkbox') || normalized.includes('check box') || normalized === 'checkbox') return 'checkbox';
  if (normalized.includes('text') || normalized.includes('signature') || normalized === 'text_input') return 'textbox';
  return 'textbox';
}

/** Extract a common prefix from a field name for radio grouping.
 *  e.g. "Applicant Housing Own" -> "Applicant Housing"
 *       "Finance Promotion Yes" -> "Finance Promotion"
 */
function extractRadioGroupPrefix(fieldName: string): string {
  const words = fieldName.trim().split(/\s+/);
  // Remove the last word (the variant like "Yes", "No", "Own", "Rent", etc.)
  if (words.length > 1) {
    return words.slice(0, -1).join(' ');
  }
  return fieldName;
}

/** Convert input JSON format to internal annotation format */
export function convertInputToAnnotations(input: InputField[]): AnnotationsJSON {
  const pages: Record<string, Annotation[]> = {};
  const timestamp = Date.now();

  // First pass: create annotations
  const allAnnotations: Annotation[] = input.map((field, index) => {
    const pageNumber = field.page_no ?? field.page_number ?? 1;
    const pageKey = String(pageNumber);
    const type = mapFieldType(field.field_type);
    const label = field.field_name ?? field.label ?? '';

    const annotation: Annotation = {
      id: `field_${index}_${timestamp}`,
      type,
      normalizedBox: field.box_2d,
      label,
      pageIndex: pageNumber,
    };

    if (!pages[pageKey]) {
      pages[pageKey] = [];
    }
    pages[pageKey].push(annotation);

    return annotation;
  });

  // Second pass: auto-group radio buttons by common prefix within each page
  for (const [pageKey, pageAnnotations] of Object.entries(pages)) {
    const radios = pageAnnotations.filter(a => a.type === 'radio');
    if (radios.length < 2) continue;

    // Group by prefix
    const prefixGroups: Record<string, Annotation[]> = {};
    for (const radio of radios) {
      const prefix = extractRadioGroupPrefix(radio.label || '');
      if (!prefixGroups[prefix]) {
        prefixGroups[prefix] = [];
      }
      prefixGroups[prefix].push(radio);
    }

    // Assign group names to groups with 2+ radios
    for (const [prefix, group] of Object.entries(prefixGroups)) {
      if (group.length >= 2) {
        const groupName = prefix.replace(/\s+/g, '_').toLowerCase();
        for (const radio of group) {
          radio.radioGroup = groupName;
        }
      }
    }
  }

  return { pages };
}

/** Convert normalized coordinates to actual pixel coordinates */
export function normalizedToPixels(
  normalizedBox: [number, number, number, number],
  pageWidth: number,
  pageHeight: number
): { x: number; y: number; width: number; height: number } {
  const [ymin, xmin, ymax, xmax] = normalizedBox;
  
  const x = (xmin / 1000) * pageWidth;
  const y = (ymin / 1000) * pageHeight;
  const width = ((xmax - xmin) / 1000) * pageWidth;
  const height = ((ymax - ymin) / 1000) * pageHeight;

  return { x, y, width, height };
}

/** Convert actual pixel coordinates back to normalized 0-1000 */
export function pixelsToNormalized(
  x: number,
  y: number,
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number
): [number, number, number, number] {
  const xmin = (x / pageWidth) * 1000;
  const ymin = (y / pageHeight) * 1000;
  const xmax = ((x + width) / pageWidth) * 1000;
  const ymax = ((y + height) / pageHeight) * 1000;

  return [
    Math.round(ymin),
    Math.round(xmin),
    Math.round(ymax),
    Math.round(xmax),
  ];
}

/** Export annotations back to input format */
export function exportToInputFormat(annotations: AnnotationsJSON): InputField[] {
  const result: InputField[] = [];

  // Map internal type back to string
  const typeToString: Record<FieldType, string> = {
    textbox: 'Text Field',
    checkbox: 'Checkbox',
    radio: 'Radio Button',
  };

  for (const [pageKey, pageAnnotations] of Object.entries(annotations.pages)) {
    for (const annotation of pageAnnotations) {
      result.push({
        box_2d: annotation.normalizedBox,
        field_name: annotation.label || '',
        field_type: typeToString[annotation.type],
        page_no: annotation.pageIndex,
        page_number: annotation.pageIndex,
      });
    }
  }

  return result;
}
