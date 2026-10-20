import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

function getLastTableBottom(doc: jsPDF) {
  return (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 0;
}

interface PDFReportData {
  titulo: string;
  subtitulo?: string;
  empresa: string;
  fecha: string;
  categoria?: string;
  tecnico?: string;
  cliente?: string;
  edificio?: string;
  valorActividad?: number;
  puertasDetalle?: string;
  direccionCliente?: string;
  correoCliente?: string;
  observaciones?: string;
  fotosAntes?: string[];
  fotosDespues?: string[];
  fotoBitacora?: string;
  evidenciasFotograficas?: Array<{ titulo: string; urls: string[] }>;
  firmaUrl?: string;
  receptor?: { nombre: string; cedula: string; cargo: string };
}

interface PDFTableData {
  titulo: string;
  subtitulo?: string;
  empresa: string;
  periodo?: string;
  headers: string[];
  rows: string[][];
  totales?: string[];
  summary?: Array<{ label: string; value: string }>;
  fileName?: string;
  landscape?: boolean;
}

function normalizePdfCellValue(value: string): string {
  // Remove zero-width characters and replace any unicode whitespace
  // (including non-breaking spaces) with regular spaces so jspdf-autotable
  // can wrap long text inside the cell.
  const cleaned = value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u00A0\u202F\u2007\u2009\u200A\u3000]/g, " ")
    .replace(/[\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Insert a real space inside very long tokens (URLs, slugs, words without
  // spaces) so jspdf-autotable can break them and they don't overflow the cell.
  return cleaned.replace(/(\S{30})(?=\S)/g, "$1 ");
}

function wrapPdfTextConservatively(value: string, maxCharsPerLine: number): string {
  const words = value.split(" ").filter(Boolean);
  const safeMaxChars = Math.max(maxCharsPerLine, 12);
  const lines: string[] = [];
  let currentLine = "";

  words.forEach((word) => {
    if (word.length > safeMaxChars) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = "";
      }

      const chunks = word.match(new RegExp(`.{1,${safeMaxChars}}`, "g")) || [word];
      lines.push(...chunks.slice(0, -1));
      currentLine = chunks[chunks.length - 1] || "";
      return;
    }

    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length > safeMaxChars && currentLine) {
      lines.push(currentLine);
      currentLine = word;
      return;
    }

    currentLine = nextLine;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.join("\n");
}

function collapseArtificialLetterSpacing(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length < 6) return normalized;

  const charLikeTokenCount = tokens.filter((token) => /^[\p{L}\p{N}]$|^[.:,;()/#-]$/u.test(token)).length;
  if (charLikeTokenCount / tokens.length < 0.7) {
    return normalized;
  }

  const joined = tokens.join("")
    .replace(/([:;,.])(?!\s|$)/g, "$1 ")
    .replace(/(\d+\.)(\p{L})/gu, "$1 $2")
    .replace(/([a-záéíóúüñ])([A-ZÁÉÍÓÚÜÑ]{1,4})(?=$|[^a-záéíóúüñ])/gu, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  return joined || normalized;
}

function normalizePdfMultilineText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u00A0\u202F\u2007\u2009\u200A\u3000]/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => collapseArtificialLetterSpacing(line))
    .join("\n")
    .trim();
}

function buildWrappedMultilineText(doc: jsPDF, value: string, maxWidth: number): string[] {
  const normalized = normalizePdfMultilineText(value);
  if (!normalized) return [];

  return normalized
    .split("\n")
    .flatMap((line) => {
      if (!line.trim()) return [""];
      const wrapped = doc.splitTextToSize(line, maxWidth);
      return Array.isArray(wrapped) ? wrapped : [String(wrapped)];
    });
}

function normalizePdfHeaderLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

type PdfTableColumnStyle = {
  cellWidth: number;
  halign?: "left" | "center" | "right";
  overflow?: "linebreak";
};

function getTableColumnStyles(headers: string[], availableWidth: number) {
  const columnStyles: Record<number, PdfTableColumnStyle> = {};
  const flexibleIndexes: number[] = [];
  const prioritizedFlexibleIndexes: number[] = [];
  let fixedWidth = 0;
  const normalizedHeaders = headers.map(normalizePdfHeaderLabel);

  const isSixColumnDetailReport =
    normalizedHeaders.length === 6
    && normalizedHeaders[0]?.includes("fecha")
    && normalizedHeaders[1]?.includes("tecnico")
    && (normalizedHeaders[2]?.includes("cliente") || normalizedHeaders[2]?.includes("proyecto") || normalizedHeaders[2]?.includes("grupo"))
    && normalizedHeaders[3]?.includes("detalle")
    && normalizedHeaders[4]?.includes("estado")
    && (normalizedHeaders[5]?.includes("costo") || normalizedHeaders[5]?.includes("valor") || normalizedHeaders[5]?.includes("total"));

  if (isSixColumnDetailReport && availableWidth >= 269) {
    const fixedDetailLayout: Record<number, PdfTableColumnStyle> = {
      0: { cellWidth: 20 },
      1: { cellWidth: 30, overflow: "linebreak" },
      2: { cellWidth: 28, overflow: "linebreak" },
      3: { cellWidth: 150, overflow: "linebreak" },
      4: { cellWidth: 17, halign: "center" },
      5: { cellWidth: 24, halign: "right" },
    };

    return fixedDetailLayout;
  }

  headers.forEach((header, index) => {
    const normalizedHeader = normalizedHeaders[index] || "";

    if (normalizedHeader.includes("fecha")) {
      columnStyles[index] = { cellWidth: 22 };
      fixedWidth += 22;
      return;
    }

    if (normalizedHeader.includes("tecnico")) {
      columnStyles[index] = { cellWidth: 32, overflow: "linebreak" };
      fixedWidth += 32;
      return;
    }

    if (normalizedHeader.includes("cliente") || normalizedHeader.includes("proyecto") || normalizedHeader.includes("grupo")) {
      columnStyles[index] = { cellWidth: 30, overflow: "linebreak" };
      fixedWidth += 30;
      return;
    }

    if (normalizedHeader.includes("estado")) {
      columnStyles[index] = { cellWidth: 18, halign: "center" };
      fixedWidth += 18;
      return;
    }

    if (normalizedHeader.includes("tipo")) {
      columnStyles[index] = { cellWidth: 28, overflow: "linebreak" };
      fixedWidth += 28;
      return;
    }

    if (normalizedHeader.includes("costo") || normalizedHeader.includes("valor") || normalizedHeader.includes("total")) {
      const width = normalizedHeader.length > 10 ? 30 : 24;
      columnStyles[index] = { cellWidth: width, halign: "right" };
      fixedWidth += width;
      return;
    }

    if (
      normalizedHeader.includes("detalle")
      || normalizedHeader.includes("actividad")
      || normalizedHeader.includes("descripcion")
      || normalizedHeader.includes("observaciones")
      || normalizedHeader.includes("resumen")
    ) {
      prioritizedFlexibleIndexes.push(index);
      return;
    }

    flexibleIndexes.push(index);
  });

  const allFlexibleIndexes = [...prioritizedFlexibleIndexes, ...flexibleIndexes];
  const remainingWidth = Math.max(availableWidth - fixedWidth, allFlexibleIndexes.length * 20);
  const weightedSlots = prioritizedFlexibleIndexes.length * 1.8 + flexibleIndexes.length;
  const baseFlexibleWidth = remainingWidth / Math.max(weightedSlots, 1);

  prioritizedFlexibleIndexes.forEach((index) => {
    columnStyles[index] = { cellWidth: Math.max(baseFlexibleWidth * 1.8, 48), overflow: "linebreak" };
  });

  flexibleIndexes.forEach((index) => {
    columnStyles[index] = { cellWidth: Math.max(baseFlexibleWidth, 20), overflow: "linebreak" };
  });

  return columnStyles;
}

function buildWrappedTableRows(
  doc: jsPDF,
  headers: string[],
  rows: string[][],
  columnStyles: Record<number, PdfTableColumnStyle>,
) {
  const normalizedHeaders = headers.map(normalizePdfHeaderLabel);
  const horizontalPadding = 6;

  return rows.map((row) => row.map((cell, index) => {
    const value = normalizePdfCellValue(cell || "");
    if (!value) return "";

    const header = normalizedHeaders[index] || "";
    const isLongTextColumn =
      header.includes("detalle")
      || header.includes("actividad")
      || header.includes("descripcion")
      || header.includes("observaciones")
      || header.includes("resumen");
    const shouldKeepSingleLine =
      header.includes("fecha") ||
      header.includes("estado") ||
      header.includes("costo") ||
      header.includes("valor") ||
      header.includes("total");

    if (shouldKeepSingleLine) {
      return value;
    }

    const maxTextWidth = Math.max((columnStyles[index]?.cellWidth || 24) - horizontalPadding, 10);
    const wrappedLines = doc.splitTextToSize(value, maxTextWidth);

    if (isLongTextColumn) {
      const conservativeCharLimit = Math.max(Math.floor(maxTextWidth / 2.6), 18);
      return wrapPdfTextConservatively(value, conservativeCharLimit);
    }

    return Array.isArray(wrappedLines) ? wrappedLines.join("\n") : value;
  }));
}

async function getBase64ImageFromUrl(imageUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(imageUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Image request failed with status ${response.status}`);
    }

    const blob = await response.blob();
    if (!blob.size) throw new Error("Image response was empty");

    // Re-encode asynchronously to JPEG so WebP is supported and large phone
    // photos don't make jsPDF downloads unnecessarily heavy.
    const bitmap = await createImageBitmap(blob);
    try {
      const maxDimension = 1280;
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create image canvas");

      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const compressedBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error("Could not compress evidence image")),
          "image/jpeg",
          0.8,
        );
      });

      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error("Could not encode evidence image"));
        reader.onerror = () => reject(reader.error || new Error("Could not read compressed evidence image"));
        reader.readAsDataURL(compressedBlob);
      });
    } finally {
      bitmap.close();
    }
  } catch (error) {
    // Avoid logging the URL; storage URLs may contain signed access tokens.
    console.error("Error loading evidence image for PDF:", error);
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getPdfImageFormat(base64DataUrl: string): "PNG" | "JPEG" {
  const match = base64DataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,/);
  const mimeSubtype = match?.[1]?.toLowerCase() || "jpeg";

  if (mimeSubtype === "png") {
    return "PNG";
  }

  return "JPEG";
}

export async function generateReportePDF(
  data: PDFReportData,
  asBase64: boolean = false,
  options?: {
    onEvidenceLoadError?: (count: number) => void;
    onProgress?: (percent: number) => void;
  },
): Promise<string | void> {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 15;

  const checkPageBreak = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - 20) {
      doc.addPage();
      y = 15;
    }
  };

  // Header
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(data.empresa, pageWidth / 2, y, { align: "center" });
  y += 8;

  doc.setFontSize(16);
  doc.setTextColor(30);
  doc.text(data.titulo, pageWidth / 2, y, { align: "center" });
  y += 7;

  if (data.subtitulo) {
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(data.subtitulo, pageWidth / 2, y, { align: "center" });
    y += 7;
  }

  // Line separator
  doc.setDrawColor(200);
  doc.line(14, y, pageWidth - 14, y);
  y += 8;

  // Info grid
  doc.setFontSize(10);
  const infoItems: [string, string][] = [];
  if (data.fecha) infoItems.push(["Fecha:", data.fecha]);
  if (data.categoria) infoItems.push(["Categoría:", data.categoria]);
  if (data.tecnico) infoItems.push(["Técnico:", data.tecnico]);
  if (data.cliente) infoItems.push(["Cliente:", data.cliente]);
  if (data.edificio) infoItems.push(["Edificio:", data.edificio]);
  if (data.valorActividad != null) infoItems.push(["Valor real:", formatCurrencyPDF(data.valorActividad)]);
  if (data.puertasDetalle) infoItems.push(["Puertas:", data.puertasDetalle]);
  if (data.direccionCliente) infoItems.push(["Dirección:", data.direccionCliente]);
  if (data.correoCliente) infoItems.push(["Correo:", data.correoCliente]);

  const gridStartX = 14;
  const gridWidth = pageWidth - 28;
  const columnGap = 10;
  const columnWidth = (gridWidth - columnGap) / 2;
  const labelWidth = 22;
  const lineHeight = 5;
  let currentY = y;

  for (let index = 0; index < infoItems.length; index += 2) {
    const rowItems = infoItems.slice(index, index + 2);
    const rowHeight = Math.max(
      ...rowItems.map((item) => {
        const valueLines = doc.splitTextToSize(item[1], columnWidth - labelWidth - 2);
        return Math.max(1, valueLines.length) * lineHeight;
      })
    );

    rowItems.forEach((item, columnIndex) => {
      const xPos = gridStartX + columnIndex * (columnWidth + columnGap);
      const valueLines = doc.splitTextToSize(item[1], columnWidth - labelWidth - 2);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(100);
      doc.text(item[0], xPos, currentY);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(30);
      doc.text(valueLines, xPos + labelWidth, currentY);
    });

    currentY += rowHeight + 3;
  }

  y = currentY + 6;

  // Observaciones
  if (data.observaciones) {
    checkPageBreak(30);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30);
    doc.text("Observaciones", 14, y);
    y += 6;

    const observationLines = buildWrappedMultilineText(doc, data.observaciones, pageWidth - 28);
    const observationFontSize = observationLines.length > 28 ? 9 : 10;
    const observationLineHeight = observationFontSize === 9 ? 4.3 : 4.8;

    doc.setFontSize(observationFontSize);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60);

    observationLines.forEach((line) => {
      checkPageBreak(observationLineHeight + 1);
      if (line) {
        doc.text(line, 14, y);
        y += observationLineHeight;
        return;
      }

      y += observationLineHeight * 0.6;
    });

    y += 4;
  }

  // Helper to render images in a grid
  let failedEvidenceCount = 0;
  const photoSections = data.evidenciasFotograficas || [
    { titulo: `Registro Fotográfico - Antes (${data.fotosAntes?.length || 0})`, urls: data.fotosAntes || [] },
    { titulo: `Registro Fotográfico - Después (${data.fotosDespues?.length || 0})`, urls: data.fotosDespues || [] },
    { titulo: "Foto de Bitácora", urls: data.fotoBitacora ? [data.fotoBitacora] : [] },
  ];
  const uniquePhotoUrls = Array.from(new Set(photoSections.flatMap((section) => section.urls).filter(Boolean)));
  const loadedImages = new Map<string, string | null>();
  const imageBatchSize = 4;
  let embeddedImageCount = 0;
  options?.onProgress?.(0);

  // Fetch across all participant sections together to avoid serial network
  // waits, while keeping a small cap so many photos don't spike browser memory.
  for (let index = 0; index < uniquePhotoUrls.length; index += imageBatchSize) {
    const batchUrls = uniquePhotoUrls.slice(index, index + imageBatchSize);
    const batchImages = await Promise.all(batchUrls.map((url) => getBase64ImageFromUrl(url)));
    batchUrls.forEach((url, batchIndex) => loadedImages.set(url, batchImages[batchIndex]));
    const completed = index + batchUrls.length;
    options?.onProgress?.(uniquePhotoUrls.length
      ? Math.round((completed / uniquePhotoUrls.length) * 90)
      : 90);
  }

  const renderImageGrid = async (title: string, urls: string[]) => {
    if (!urls || urls.length === 0) return;

    checkPageBreak(30);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30);
    doc.text(title, 14, y);
    y += 8;

    const imgWidth = 55;
    const imgHeight = 40;
    const margin = 5;
    const maxCols = 3;
    let col = 0;

    for (let i = 0; i < urls.length; i++) {
      if (col >= maxCols) {
        col = 0;
        y += imgHeight + margin;
      }

      checkPageBreak(imgHeight + margin + 10);

      const base64 = loadedImages.get(urls[i]) || null;
      const x = 14 + col * (imgWidth + margin);

      if (base64) {
        const imgType = getPdfImageFormat(base64);

        try {
          doc.addImage(base64, imgType, x, y, imgWidth, imgHeight);
          doc.setDrawColor(200);
          doc.rect(x, y, imgWidth, imgHeight);
        } catch (err) {
          console.error("Error adding evidence image to PDF:", err);
          failedEvidenceCount += 1;
          doc.setFillColor(248, 245, 239);
          doc.setDrawColor(200);
          doc.rect(x, y, imgWidth, imgHeight, "FD");
          doc.setFontSize(8);
          doc.setTextColor(100);
          doc.text("Evidencia no disponible", x + imgWidth / 2, y + 20, { align: "center" });
        }
      } else {
        failedEvidenceCount += 1;
        doc.setFillColor(248, 245, 239);
        doc.setDrawColor(200);
        doc.rect(x, y, imgWidth, imgHeight, "FD");
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.text("Evidencia no disponible", x + imgWidth / 2, y + 20, { align: "center" });
      }
      col++;
      embeddedImageCount += 1;
      if (embeddedImageCount % 6 === 0) {
        const denominator = Math.max(uniquePhotoUrls.length, 1);
        options?.onProgress?.(Math.min(99, 90 + Math.floor((embeddedImageCount / denominator) * 9)));
        // Let React paint progress updates while jsPDF embeds large photo sets.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }
    y += imgHeight + margin + 5;
  };

  for (const section of photoSections) {
    await renderImageGrid(section.titulo, section.urls);
  }

  // Receptor & Firma
  checkPageBreak(60);

  if (data.receptor || data.firmaUrl) {
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30);
    doc.text("Receptor", 14, y);
    y += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60);
    if (data.receptor?.nombre) {
      doc.text(`Nombre: ${data.receptor.nombre}`, 14, y); y += 6;
    }
    if (data.receptor?.cedula) {
      doc.text(`Cédula/NIT: ${data.receptor.cedula}`, 14, y); y += 6;
    }
    if (data.receptor?.cargo) {
      doc.text(`Cargo: ${data.receptor.cargo}`, 14, y); y += 6;
    }
  }

  // Firmas
  y += 18;
  checkPageBreak(58);

  const firmaWidth = 62;
  const firmaHeight = 30;
  const firmaLineY = y + 18;
  const leftSignatureX = 14;
  const rightSignatureX = pageWidth - 14 - firmaWidth;
  const tecnicoNombre = data.tecnico || "No registrado";
  const receptorNombre = data.receptor?.nombre || "No registrado";
  const tecnicoLines = doc.splitTextToSize(tecnicoNombre, firmaWidth);
  const receptorLines = doc.splitTextToSize(receptorNombre, firmaWidth);

  if (data.firmaUrl) {
    try {
      const base64Firma = await getBase64ImageFromUrl(data.firmaUrl);
      if (base64Firma) {
        doc.addImage(
          base64Firma,
          getPdfImageFormat(base64Firma),
          rightSignatureX,
          firmaLineY - firmaHeight - 2,
          firmaWidth,
          firmaHeight
        );
      }
    } catch (err) {
      console.error("Error cargando firma:", err);
    }
  }

  doc.setFont("times", "italic");
  doc.setFontSize(13);
  doc.setTextColor(40);
  doc.text(tecnicoLines, leftSignatureX, firmaLineY - 6);
  doc.text(receptorLines, rightSignatureX, firmaLineY - 6);

  doc.setDrawColor(100);
  doc.line(leftSignatureX, firmaLineY, leftSignatureX + firmaWidth, firmaLineY);
  doc.line(rightSignatureX, firmaLineY, rightSignatureX + firmaWidth, firmaLineY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text("Firma Técnico", leftSignatureX, firmaLineY + 6);
  doc.text("Firma Receptor", rightSignatureX, firmaLineY + 6);
  y = firmaLineY + 12;

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `${data.empresa} - Generado: ${new Date().toLocaleDateString("es-CO")} - Página ${i}/${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: "center" }
    );
  }

  if (failedEvidenceCount > 0) {
    options?.onEvidenceLoadError?.(failedEvidenceCount);
    console.warn(`PDF generated with ${failedEvidenceCount} unavailable evidence image(s).`);
  }

  if (asBase64) {
    options?.onProgress?.(100);
    return doc.output("datauristring");
  }

  doc.save(`reporte_mantenimiento_${data.fecha || "sin_fecha"}.pdf`);
  options?.onProgress?.(100);
}

export function generateTablePDF(data: PDFTableData): void {
  const doc = new jsPDF({ orientation: data.landscape ? "landscape" : "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const tableMargin = { left: 14, right: 14, bottom: 16, top: 10 };
  const tableContentWidth = pageWidth - tableMargin.left - tableMargin.right;
  let y = 15;

  doc.setFillColor(15, 23, 42);
  doc.roundedRect(12, 10, pageWidth - 24, 28, 4, 4, "F");

  doc.setFontSize(9);
  doc.setTextColor(191, 219, 254);
  doc.text(data.empresa, 18, 18);

  doc.setFontSize(17);
  doc.setTextColor(255, 255, 255);
  doc.text(data.titulo, 18, 27);

  if (data.subtitulo) {
    doc.setFontSize(9);
    doc.setTextColor(203, 213, 225);
    doc.text(data.subtitulo, 18, 34);
  }

  y = 46;

  if (data.periodo) {
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(14, y - 4, pageWidth - 28, 10, 3, 3, "F");
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`Período consultado: ${data.periodo}`, 18, y + 2);
    y += 12;
  }

  if ((data.summary || []).length > 0) {
    const summaryItems = data.summary || [];
    const gap = 4;
    const cardWidth = (pageWidth - 28 - gap * (summaryItems.length - 1)) / summaryItems.length;

    summaryItems.forEach((item, index) => {
      const x = 14 + index * (cardWidth + gap);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(x, y, cardWidth, 18, 3, 3, "FD");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(item.label, x + 4, y + 6);
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text(item.value, x + 4, y + 13);
    });

    y += 24;
  }

  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(`Fecha de generación: ${new Date().toLocaleDateString("es-CO")}`, pageWidth - 14, y, { align: "right" });
  y += 6;

  const columnStyles = getTableColumnStyles(data.headers, tableContentWidth);
  const previousFontSize = doc.getFontSize();
  doc.setFontSize(7.5);
  const wrappedRows = buildWrappedTableRows(doc, data.headers, data.rows, columnStyles);
  const wrappedFoot = data.totales ? buildWrappedTableRows(doc, data.headers, [data.totales], columnStyles) : undefined;
  doc.setFontSize(previousFontSize);

  autoTable(doc, {
    startY: y,
    head: [data.headers],
    body: wrappedRows,
    foot: wrappedFoot,
    styles: {
      fontSize: 7,
      cellPadding: 3,
      minCellHeight: 8,
      overflow: "linebreak",
      textColor: [43, 50, 61],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      valign: "middle",
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      overflow: "linebreak",
    },
    footStyles: {
      fillColor: [226, 232, 240],
      textColor: [15, 23, 42],
      fontStyle: "bold",
      overflow: "linebreak",
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles,
    tableWidth: tableContentWidth,
    theme: "grid",
    margin: tableMargin,
    rowPageBreak: "avoid",
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(
      `${data.empresa} - Generado: ${new Date().toLocaleDateString("es-CO")} - Página ${i}/${pageCount}`,
      pageWidth / 2,
      pageHeight - 8,
      { align: "center" }
    );
  }

  const safeTitulo = (data.fileName || data.titulo).replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 70);
  doc.save(`${safeTitulo}_${new Date().toISOString().split("T")[0]}.pdf`);
}

export function generateComprobantePDF(data: {
  empresa: string;
  periodo: string;
  tecnico: string;
  cedula: string;
  items: { actividad: string; fecha: string; valorBase: number; porcentaje: number; valorLiquidado: number }[];
  desplazamientos?: { descripcion: string; fecha: string; valor: number; descuento?: number }[];
  totalAuxilio: number;
  totalDescuentoTardanza?: number;
  totalRodamiento: number;
  totalDescuentoRecorridos?: number;
  totalExtraLider?: number;
  grandTotal: number;
}): void {
  const company = "SOLUCIONES & AUTOMATIZACIONES S.A.S.";
  const nit = "900.758.272-5";
  const legalDeclaration = "DECLARACIÓN DE CONFORMIDAD (CLÁUSULA TERCERA Y OTROSÍ - ART. 128 C.S.T.): Este pago se realiza bajo los términos de la Cláusula Tercera del contrato de trabajo y su Otrosí vigente (Pagos No Constitutivos de Salario - Art. 128 C.S.T. y Ley 1393 de 2010). Los valores aquí descritos corresponden al Auxilio Extralegal por Productividad y Respaldo Digital (condicionado al reporte y trazabilidad en la aplicación corporativa) y al Auxilio de Rodamiento y Movilización Operativa (otorgado como medio de transporte y herramienta de trabajo indispensable para el desempeño de las funciones, sin enriquecer el patrimonio del trabajador), por lo cual no constituyen salario, factor prestacional ni base de aportes (IBC).";
  const employeeName = formatReceiptName(data.tecnico);
  const employeeDocument = data.cedula.trim();
  if (!employeeDocument) {
    throw new Error("Completa la cédula del trabajador antes de generar el comprobante.");
  }

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const tableMargin = { left: 14, right: 14, top: 18, bottom: 22 };
  const tableContentWidth = pageWidth - tableMargin.left - tableMargin.right;
  const contentBottomY = pageHeight - 21;
  const resetPageY = 18;
  let y = 17;
  const ensurePageSpace = (requiredHeight: number) => {
    if (y + requiredHeight <= contentBottomY) return;
    doc.addPage();
    y = resetPageY;
  };

  // Encabezado del comprobante y datos identificatorios del trabajador.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(31, 41, 55);
  doc.text(company, 14, y);
  y += 6;
  doc.setFontSize(9);
  doc.text(`NIT: ${nit}`, 14, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.text("COMPROBANTE DE LIQUIDACIÓN DE AUXILIOS EXTRALEGALES Y RODAMIENTO (ART. 128 C.S.T.)", 14, y + 6, { maxWidth: 120 });
  doc.setFont("helvetica", "bold");
  doc.text("Período:", pageWidth - 67, 18);
  doc.setFont("helvetica", "normal");
  doc.text(data.periodo, pageWidth - 67, 23, { maxWidth: 53 });
  doc.setFont("helvetica", "bold");
  doc.text("Fecha de generación:", pageWidth - 67, 31);
  doc.setFont("helvetica", "normal");
  doc.text(new Date().toLocaleDateString("es-CO", { timeZone: "America/Bogota" }), pageWidth - 67, 36);
  y += 23;
  doc.setDrawColor(13, 138, 188);
  doc.setLineWidth(1.1);
  doc.line(14, y, pageWidth - 14, y);
  y += 7;
  doc.setFillColor(245, 247, 250);
  doc.setDrawColor(220, 226, 234);
  doc.roundedRect(14, y, tableContentWidth, 19, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(31, 41, 55);
  doc.text("Técnico / Colaborador(a):", 19, y + 7);
  doc.setFont("helvetica", "normal");
  doc.text(employeeName, 58, y + 7, { maxWidth: tableContentWidth - 49 });
  doc.setFont("helvetica", "bold");
  doc.text("C.C. No:", 19, y + 14);
  doc.setFont("helvetica", "normal");
  doc.text(employeeDocument, 38, y + 14);
  y += 25;

  const addSectionTitle = (title: string) => {
    ensurePageSpace(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    const lines = doc.splitTextToSize(title, tableContentWidth - 10);
    const height = Math.max(10, lines.length * 4.5 + 4);
    doc.setFillColor(31, 41, 55);
    doc.rect(14, y, tableContentWidth, height, "F");
    doc.text(lines, 19, y + 6, { maxWidth: tableContentWidth - 10 });
    y += height + 3;
  };

  addSectionTitle("1. CONCEPTO: AUXILIO EXTRALEGAL POR PRODUCTIVIDAD Y RESPALDO DIGITAL (CLÁUSULA TERCERA - ART. 128 C.S.T.)");
  autoTable(doc, {
    startY: y,
    head: [["Actividad (Registro de Respaldo Digital en App)", "Fecha", "Valor Base", "%", "Valor Liquidado"]],
    body: data.items.map((item) => [
      item.actividad,
      item.fecha,
      formatCurrencyPDF(item.valorBase),
      `${item.porcentaje}%`,
      formatCurrencyPDF(item.valorLiquidado),
    ]),
    styles: { fontSize: 8, cellPadding: 2.3, overflow: "linebreak", valign: "middle", textColor: [31, 41, 55], lineColor: [210, 219, 229], lineWidth: 0.25 },
    headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 249, 252] },
    columnStyles: {
      0: { cellWidth: 94 },
      1: { cellWidth: 24, halign: "center" },
      2: { cellWidth: 25, halign: "right" },
      3: { cellWidth: 13, halign: "center" },
      4: { cellWidth: tableContentWidth - 156, halign: "right" },
    },
    theme: "grid",
    margin: tableMargin,
    rowPageBreak: "avoid",
  });

  y = getLastTableBottom(doc) + 8;

  const movements = data.desplazamientos || [];
  addSectionTitle("2. CONCEPTO: AUXILIO DE RODAMIENTO Y MOVILIZACIÓN OPERATIVA (HERRAMIENTA DE TRABAJO - ART. 128 C.S.T.)");
  autoTable(doc, {
    startY: y,
    head: [["Subtipo / Descripción", "Fecha", "Valor base", "Descuento", "Valor liquidado"]],
    body: movements.length > 0
      ? movements.map((item) => [
          formatReceiptRouteDescription(item.descripcion),
          item.fecha,
          formatCurrencyPDF(item.valor),
          item.descuento ? `-${formatCurrencyPDF(item.descuento)}` : formatCurrencyPDF(0),
          formatCurrencyPDF(Math.max(0, item.valor - (item.descuento || 0))),
        ])
      : [[{ content: "Sin recorridos registrados en el período.", colSpan: 5, styles: { halign: "center", textColor: [100, 116, 139] } }]],
    styles: { fontSize: 8, cellPadding: 2.3, overflow: "linebreak", valign: "middle", textColor: [31, 41, 55], lineColor: [210, 219, 229], lineWidth: 0.25 },
    headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 249, 252] },
    columnStyles: {
      0: { cellWidth: 78 },
      1: { cellWidth: 24, halign: "center" },
      2: { cellWidth: 25, halign: "right" },
      3: { cellWidth: 27, halign: "right" },
      4: { cellWidth: tableContentWidth - 154, halign: "right" },
    },
    theme: "grid",
    margin: tableMargin,
    rowPageBreak: "avoid",
  });
  y = getLastTableBottom(doc) + 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text(`Total actividades en Auxilio de Rodamiento y Movilización: ${movements.length}`, 14, y);
  y += 8;

  const totalRows: Array<[string, string, boolean]> = [
    ["Subtotal Auxilio Extralegal por Productividad y Respaldo Digital:", formatCurrencyPDF(data.totalAuxilio), false],
  ];
  if ((data.totalDescuentoTardanza || 0) > 0) {
    totalRows.push(["Descuento por tardanza en Auxilio Extralegal:", `-${formatCurrencyPDF(data.totalDescuentoTardanza || 0)}`, false]);
    totalRows.push(["Auxilio Extralegal Neto:", formatCurrencyPDF(data.totalAuxilio - (data.totalDescuentoTardanza || 0)), false]);
  }
  totalRows.push(["Subtotal Auxilio de Rodamiento y Movilización Operativa:", formatCurrencyPDF(data.totalRodamiento), false]);
  if ((data.totalDescuentoRecorridos || 0) > 0) {
    totalRows.push(["Descuento por tardanza en Auxilio de Rodamiento:", `-${formatCurrencyPDF(data.totalDescuentoRecorridos || 0)}`, false]);
    totalRows.push(["Auxilio de Rodamiento Neto:", formatCurrencyPDF(data.totalRodamiento - (data.totalDescuentoRecorridos || 0)), false]);
  }
  if ((data.totalExtraLider || 0) > 0) totalRows.push(["Extra Líder:", formatCurrencyPDF(data.totalExtraLider || 0), false]);
  totalRows.push(["TOTAL A PAGAR:", formatCurrencyPDF(data.grandTotal), true]);

  const legalLines = doc.splitTextToSize(legalDeclaration, tableContentWidth - 10);
  const legalBlockHeight = legalLines.length * 4 + 10;
  const estimatedTotalsHeight = totalRows.length * 7 + 4;
  // Reserve the actual vertical footprint of the complete closing section.
  // The previous 31 mm signature estimate forced short receipts onto a second
  // page even when totals, declaration, and signatures fit below the tables.
  const totalsToLegalGap = 7;
  const legalToSignatureGap = 8;
  const signatureBlockHeight = 17;
  ensurePageSpace(
    estimatedTotalsHeight + totalsToLegalGap + legalBlockHeight + legalToSignatureGap + signatureBlockHeight
  );

  autoTable(doc, {
    startY: y,
    body: totalRows.map(([label, amount, grand]) => [
      { content: label, styles: { fontStyle: "bold", textColor: grand ? [255, 255, 255] : [31, 41, 55] } },
      { content: amount, styles: { halign: "right", fontStyle: "bold", textColor: grand ? [255, 255, 255] : [31, 41, 55] } },
    ]),
    styles: { fontSize: 8, cellPadding: 2.2, lineColor: [210, 219, 229], lineWidth: 0.25 },
    columnStyles: { 0: { cellWidth: 124 }, 1: { cellWidth: 38, halign: "right" } },
    margin: { left: pageWidth - 14 - 162, right: 14, top: 18, bottom: 22 },
    theme: "grid",
    didParseCell: (hookData) => {
      const isGrandTotal = hookData.row.index === totalRows.length - 1;
      if (isGrandTotal) {
        hookData.cell.styles.fillColor = [17, 24, 39];
        hookData.cell.styles.fontSize = 10;
      } else if (hookData.row.index % 2 === 0) {
        hookData.cell.styles.fillColor = [247, 249, 252];
      }
    },
    rowPageBreak: "avoid",
  });
  y = getLastTableBottom(doc) + totalsToLegalGap;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(31, 41, 55);
  doc.setDrawColor(210, 219, 229);
  doc.setFillColor(247, 249, 252);
  doc.roundedRect(14, y, tableContentWidth, legalBlockHeight, 1.5, 1.5, "FD");
  doc.text(legalLines, 19, y + 5, { maxWidth: tableContentWidth - 10, lineHeightFactor: 1.25 });
  y += legalBlockHeight + legalToSignatureGap;

  ensurePageSpace(signatureBlockHeight);
  const signatureWidth = (tableContentWidth - 26) / 2;
  const rightSignatureX = 14 + signatureWidth + 26;
  doc.setDrawColor(100, 116, 139);
  doc.line(14, y, 14 + signatureWidth, y);
  doc.line(rightSignatureX, y, pageWidth - 14, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(31, 41, 55);
  doc.text("Firma del trabajador", 14, y);
  doc.text("Firma Supervisor / Gerente", rightSignatureX, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(employeeName, 14, y, { maxWidth: signatureWidth });
  doc.text(company, rightSignatureX, y, { maxWidth: signatureWidth });
  y += 5;
  doc.text("C.C. No: ___________________________", 14, y);
  doc.text(`NIT: ${nit}`, rightSignatureX, y);

  // Pie contractual fijo; fecha y paginación se mantienen como dato separado.
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(210, 219, 229);
    doc.line(14, pageHeight - 15, pageWidth - 14, pageHeight - 15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`${company} - NIT: ${nit}`, 14, pageHeight - 8);
    doc.text(`Generado: ${new Date().toLocaleDateString("es-CO", { timeZone: "America/Bogota" })} · Página ${i}/${pageCount}`, pageWidth - 14, pageHeight - 8, { align: "right" });
  }

  const safeName = employeeName.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 30);
  doc.save(`comprobante_${safeName}_${new Date().toISOString().split("T")[0]}.pdf`);
}

export function formatReceiptName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("es-CO")
    .replace(/(^|[\s'’-])([a-záéíóúüñ])/gu, (_match, boundary: string, letter: string) => `${boundary}${letter.toLocaleUpperCase("es-CO")}`);
}

function formatReceiptRouteDescription(value: string): string {
  const [rawSubtype, ...detailParts] = value.split("·");
  const detail = detailParts.join("·").trim();
  const subtype = rawSubtype.trim().toLowerCase();
  if (subtype === "recorrido-normal") return `Recorrido normal:${detail ? ` ${detail}` : ""}`;
  if (subtype === "recorrido-con-herramienta") return `Recorrido con herramienta:${detail ? ` ${detail}` : ""}`;
  if (subtype === "recorrido-visita-tecnica") return `Visita técnica:${detail ? ` ${detail}` : ""}`;
  return value.trim() || "Recorrido normal:";
}

function formatCurrencyPDF(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}
