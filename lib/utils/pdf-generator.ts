import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface PDFReportData {
  titulo: string;
  subtitulo?: string;
  empresa: string;
  fecha: string;
  tecnico?: string;
  cliente?: string;
  edificio?: string;
  observaciones?: string;
  fotosAntes?: string[];
  fotosDespues?: string[];
  firmaUrl?: string;
  receptor?: { nombre: string; cedula: string; cargo: string };
}

interface PDFTableData {
  titulo: string;
  empresa: string;
  periodo?: string;
  headers: string[];
  rows: string[][];
  totales?: string[];
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
  if (data.tecnico) infoItems.push(["Técnico:", data.tecnico]);
  if (data.cliente) infoItems.push(["Cliente:", data.cliente]);
  if (data.edificio) infoItems.push(["Edificio:", data.edificio]);

  // Cuadrícula para información (2 columnas)
  const col1X = 14;
  const col2X = pageWidth / 2;
  let currentY = y;

  infoItems.forEach((item, index) => {
    const isLeft = index % 2 === 0;
    const xPos = isLeft ? col1X : col2X;

    if (!isLeft && index > 0) {
      // Misma línea
    } else if (index > 0) {
      currentY += 8;
    }

    doc.setFont("helvetica", "bold");
    doc.setTextColor(100);
    doc.text(item[0], xPos, currentY);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(30);
    doc.text(item[1], xPos + 20, currentY);
  });

  y = currentY + 12;

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
        // Intentar adivinar tipo por la URL, por defecto JPEG
        const imgType = url.toLowerCase().includes(".png") ? "PNG" : "JPEG";

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
  y += 20;
  checkPageBreak(40);

  const firmaWidth = 60;
  const firmaHeight = 25;

  if (data.firmaUrl) {
    try {
      const base64Firma = await getBase64ImageFromUrl(data.firmaUrl);
      if (base64Firma) {
        doc.addImage(base64Firma, "PNG", pageWidth - 14 - firmaWidth, y - firmaHeight, firmaWidth, firmaHeight);
      }
    } catch (err) {
      console.error("Error cargando firma:", err);
    }
  }

  doc.setDrawColor(100);
  doc.line(14, y, 14 + firmaWidth, y);
  doc.line(pageWidth - 14 - firmaWidth, y, pageWidth - 14, y);
  y += 5;

  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text("Firma Técnico", 14, y);
  doc.text("Firma Receptor", pageWidth - 14 - firmaWidth, y);

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
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 15;

  // Header
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(data.empresa, pageWidth / 2, y, { align: "center" });
  y += 8;

  doc.setFontSize(14);
  doc.setTextColor(30);
  doc.text(data.titulo, pageWidth / 2, y, { align: "center" });
  y += 7;

  if (data.periodo) {
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Período: ${data.periodo}`, pageWidth / 2, y, { align: "center" });
    y += 5;
  }

  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(`Fecha de generación: ${new Date().toLocaleDateString("es-CO")}`, pageWidth / 2, y, { align: "center" });
  y += 8;

  // Table
  autoTable(doc, {
    startY: y,
    head: [data.headers],
    body: data.rows,
    foot: data.totales ? [data.totales] : undefined,
    styles: {
      fontSize: 8,
      cellPadding: 3,
      textColor: [50, 50, 50],
    },
    headStyles: {
      fillColor: [13, 138, 188],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    footStyles: {
      fillColor: [240, 240, 240],
      textColor: [30, 30, 30],
      fontStyle: "bold",
    },
    alternateRowStyles: {
      fillColor: [248, 248, 248],
    },
    theme: "grid",
  });

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

  const safeTitulo = data.titulo.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50);
  doc.save(`${safeTitulo}_${new Date().toISOString().split("T")[0]}.pdf`);
}

export function generateComprobantePDF(data: {
  empresa: string;
  periodo: string;
  tecnico: string;
  cedula?: string;
  items: { actividad: string; fecha: string; valorBase: number; porcentaje: number }[];
  desplazamientos?: { descripcion: string; fecha: string; valor: number }[];
  totalAuxilio: number;
  totalDescuentoTardanza?: number;
  totalRodamiento: number;
  grandTotal: number;
}): void {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 15;

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
      formatCurrencyPDF(item.valorBase),
    ]),
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [13, 138, 188], textColor: [255, 255, 255] },
    theme: "grid",
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
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255] },
      theme: "grid",
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
