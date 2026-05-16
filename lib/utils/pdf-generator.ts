import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("Error loading image:", imageUrl, error);
    return null;
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

export async function generateReportePDF(data: PDFReportData, asBase64: boolean = false): Promise<string | void> {
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

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60);
    const lines = doc.splitTextToSize(data.observaciones, pageWidth - 28);
    doc.text(lines, 14, y);
    y += lines.length * 5 + 6;
  }

  // Helper to render images in a grid
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

      const url = urls[i];
      const base64 = await getBase64ImageFromUrl(url);

      if (base64) {
        const x = 14 + col * (imgWidth + margin);
        const imgType = getPdfImageFormat(base64);

        try {
          doc.addImage(base64, imgType, x, y, imgWidth, imgHeight);
          doc.setDrawColor(200);
          doc.rect(x, y, imgWidth, imgHeight);
        } catch (err) {
          console.error("Error adding image to PDF:", err);
          doc.setFontSize(8);
          doc.text("Error al cargar imagen", x + 5, y + 20);
        }
      }
      col++;
    }
    y += imgHeight + margin + 5;
  };

  await renderImageGrid(`Registro Fotográfico - Antes (${data.fotosAntes?.length || 0})`, data.fotosAntes || []);
  await renderImageGrid(`Registro Fotográfico - Después (${data.fotosDespues?.length || 0})`, data.fotosDespues || []);
  await renderImageGrid("Foto de Bitácora", data.fotoBitacora ? [data.fotoBitacora] : []);

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

  if (asBase64) {
    return doc.output("datauristring");
  }

  doc.save(`reporte_mantenimiento_${data.fecha || "sin_fecha"}.pdf`);
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
  cedula?: string;
  items: { actividad: string; fecha: string; valorBase: number; porcentaje: number; valorLiquidado: number }[];
  desplazamientos?: { descripcion: string; fecha: string; valor: number }[];
  totalAuxilio: number;
  totalDescuentoTardanza?: number;
  totalRodamiento: number;
  totalExtraLider?: number;
  grandTotal: number;
}): void {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 15;
  const tableMargin = { left: 14, right: 14 };
  const tableContentWidth = pageWidth - tableMargin.left - tableMargin.right;

  // Header
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(data.empresa, pageWidth / 2, y, { align: "center" });
  y += 8;
  doc.setFontSize(14);
  doc.setTextColor(30);
  doc.text("COMPROBANTE DE LIQUIDACIÓN", pageWidth / 2, y, { align: "center" });
  y += 6;
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Período: ${data.periodo}`, pageWidth / 2, y, { align: "center" });
  y += 10;

  // Technician info
  doc.setFontSize(10);
  doc.setTextColor(30);
  doc.text(`Técnico: ${data.tecnico}`, 14, y);
  if (data.cedula) {
    doc.text(`C.C.: ${data.cedula}`, pageWidth - 60, y);
  }
  y += 8;

  doc.setDrawColor(200);
  doc.line(14, y, pageWidth - 14, y);
  y += 5;

  // Items table
  doc.setFontSize(9);
  doc.setTextColor(60);
  doc.text("CONCEPTO: AUXILIO EXTRALEGAL POR PRODUCTIVIDAD Y RESPALDO DIGITAL", 14, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [["Actividad", "Fecha", "Valor Base", "%", "Valor Liquidado"]],
    body: data.items.map((item) => [
      item.actividad,
      item.fecha,
      formatCurrencyPDF(item.valorBase),
      `${item.porcentaje}%`,
      formatCurrencyPDF(item.valorLiquidado),
    ]),
    styles: { fontSize: 8, cellPadding: 2.5, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: [13, 138, 188], textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: tableContentWidth - 82 },
      1: { cellWidth: 24 },
      2: { cellWidth: 28, halign: "right" },
      3: { cellWidth: 10, halign: "center" },
      4: { cellWidth: 20, halign: "right" },
    },
    theme: "grid",
    margin: tableMargin,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;

  if ((data.desplazamientos || []).length > 0) {
    doc.setFontSize(9);
    doc.setTextColor(60);
    doc.text("CONCEPTO: RECORRIDOS Y DESPLAZAMIENTOS", 14, y);
    y += 6;

    autoTable(doc, {
      startY: y,
      head: [["Descripción", "Fecha", "Valor"]],
      body: (data.desplazamientos || []).map((item) => [
        item.descripcion || "Recorrido",
        item.fecha,
        formatCurrencyPDF(item.valor),
      ]),
      styles: { fontSize: 8, cellPadding: 2.5, overflow: "linebreak", valign: "middle" },
      headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255] },
      columnStyles: {
        0: { cellWidth: tableContentWidth - 52 },
        1: { cellWidth: 24 },
        2: { cellWidth: 28, halign: "right" },
      },
      theme: "grid",
      margin: tableMargin,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6;
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`Cantidad de desplazamientos: ${(data.desplazamientos || []).length}`, 14, y);
    y += 8;
  }

  // Totals
  const totalsX = pageWidth - 80;
  doc.setFontSize(9);

  doc.setTextColor(60);
  doc.text("Subtotal Auxilio:", totalsX, y);
  doc.setTextColor(30);
  doc.text(formatCurrencyPDF(data.totalAuxilio), pageWidth - 14, y, { align: "right" });
  y += 6;

  if ((data.totalDescuentoTardanza || 0) > 0) {
    doc.setTextColor(180, 50, 50);
    doc.text("Descuento por Tardanza:", totalsX - 5, y);
    doc.text(`-${formatCurrencyPDF(data.totalDescuentoTardanza || 0)}`, pageWidth - 14, y, { align: "right" });
    y += 6;

    doc.setTextColor(60);
    doc.text("Auxilio Neto:", totalsX, y);
    doc.setTextColor(30);
    doc.text(formatCurrencyPDF(data.totalAuxilio - (data.totalDescuentoTardanza || 0)), pageWidth - 14, y, { align: "right" });
    y += 6;
  }

  if (data.totalRodamiento > 0) {
    doc.setTextColor(60);
    doc.text("Comp. Rodamiento y Transporte:", totalsX - 30, y);
    doc.setTextColor(30);
    doc.text(formatCurrencyPDF(data.totalRodamiento), pageWidth - 14, y, { align: "right" });
    y += 6;
  }

  if ((data.totalExtraLider || 0) > 0) {
    doc.setTextColor(60);
    doc.text("Extra Líder:", totalsX, y);
    doc.setTextColor(30);
    doc.text(formatCurrencyPDF(data.totalExtraLider || 0), pageWidth - 14, y, { align: "right" });
    y += 6;
  }

  doc.setDrawColor(13, 138, 188);
  doc.line(totalsX, y, pageWidth - 14, y);
  y += 5;
  doc.setFontSize(11);
  doc.setTextColor(30);
  doc.text("TOTAL A PAGAR:", totalsX, y);
  doc.text(formatCurrencyPDF(data.grandTotal), pageWidth - 14, y, { align: "right" });

  // Signatures
  y += 25;
  if (y > 250) { doc.addPage(); y = 30; }
  doc.setDrawColor(150);
  doc.line(14, y, 80, y);
  doc.line(pageWidth - 80, y, pageWidth - 14, y);
  y += 5;
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text("Firma del Técnico", 14, y);
  doc.text("Firma Supervisor/Gerente", pageWidth - 80, y);
  y += 4;
  doc.text(data.tecnico, 14, y);
  doc.text(data.empresa, pageWidth - 80, y);

  // Legal
  y += 12;
  doc.setFontSize(7);
  doc.setTextColor(150);
  const legalLines = doc.splitTextToSize(
    "Este pago se realiza bajo los términos de la Cláusula Tercera del contrato de trabajo (Pagos No Prestacionales - Art. 128 CST). Los valores aquí descritos corresponden a auxilios extralegales y compensaciones que no constituyen salario ni factor prestacional.",
    pageWidth - 28
  );
  doc.text(legalLines, 14, y);

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(
      `${data.empresa} - Generado: ${new Date().toLocaleDateString("es-CO")} - Página ${i}/${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: "center" }
    );
  }

  const safeName = data.tecnico.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 30);
  doc.save(`comprobante_${safeName}_${new Date().toISOString().split("T")[0]}.pdf`);
}

function formatCurrencyPDF(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}
