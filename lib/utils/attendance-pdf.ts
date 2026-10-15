import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { AttendanceFortnightlyReport, AttendanceMemo, CompanySettings, User } from "@/lib/types";

function safe(value: unknown, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function dateLabel(value?: string) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function addHeader(doc: jsPDF, company: CompanySettings, title: string, subtitle: string) {
  doc.setFillColor(22, 27, 38);
  doc.rect(0, 0, 210, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text(safe(company.nombre, "SoluReport"), 14, 12);
  doc.setFontSize(11);
  doc.text(title, 14, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(subtitle, 14, 26);
  doc.setTextColor(35, 39, 47);
}

function addFooter(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(115, 115, 115);
    doc.text(`Generado por SoluReport · Página ${page} de ${pages}`, 14, 287);
  }
}

async function imageDataFromUrl(url: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<{ data: string; format: "PNG" | "JPEG" } | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const data = String(reader.result || "");
        resolve(data ? { data, format: blob.type.includes("png") ? "PNG" : "JPEG" } : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function generateAttendanceMemoPDF({
  memo,
  user,
  company,
}: {
  memo: AttendanceMemo;
  user?: User;
  company: CompanySettings;
}) {
  const doc = new jsPDF();
  const employeeName = user ? `${user.nombre} ${user.apellido}` : safe(memo.usuarioId, "Trabajador");
  addHeader(doc, company, "Memorando individual de llamado de atención", `${memo.numero} · ${dateLabel(memo.generadoEn)}`);

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Trabajador", 14, 43);
  doc.setFont("helvetica", "normal");
  doc.text(employeeName, 45, 43);
  doc.setFont("helvetica", "bold");
  doc.text("Tipo", 14, 50);
  doc.setFont("helvetica", "normal");
  doc.text(memo.tipo.replaceAll("_", " "), 45, 50);
  doc.setFont("helvetica", "bold");
  doc.text("Estado", 115, 43);
  doc.setFont("helvetica", "normal");
  doc.text(memo.estado, 145, 43);

  const narrative = doc.splitTextToSize(safe(memo.narrativa), 180);
  doc.setFont("helvetica", "bold");
  doc.text("Descripción", 14, 62);
  doc.setFont("helvetica", "normal");
  doc.text(narrative, 14, 69);
  const tableY = 69 + narrative.length * 5 + 5;
  autoTable(doc, {
    startY: tableY,
    head: [["Fecha", "Programada", "Llegada", "Min. retraso", "Min. adeudados", "Regla", "Descuento"]],
    body: memo.eventos.map((event) => [
      dateLabel(event.fecha),
      safe(event.horaProgramada),
      safe(event.horaLlegada, "No reportó"),
      String(event.minutosRetraso),
      String(event.minutosAdeudados),
      safe(event.categoria).replaceAll("_", " "),
      `${event.porcentaje}%`,
    ]),
    theme: "grid",
    headStyles: { fillColor: [180, 135, 38], textColor: [255, 255, 255], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    styles: { cellPadding: 2.5 },
  });

  const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || tableY + 20;
  doc.setFont("helvetica", "bold");
  doc.text("Fundamento", 14, finalY + 12);
  doc.setFont("helvetica", "normal");
  const legal = doc.splitTextToSize(`${safe(memo.fundamento)}\n\n${safe(memo.regimenSancionatorio)}`, 180);
  doc.text(legal, 14, finalY + 19);
  const signY = Math.min(265, finalY + 19 + legal.length * 4.5 + 16);
  doc.line(18, signY, 88, signY);
  doc.line(122, signY, 192, signY);
  doc.setFontSize(8);
  doc.text("Firma representante de la empresa", 18, signY + 5);
  doc.text("Firma del trabajador", 122, signY + 5);

  const evidenceEvents = memo.eventos.filter((event) => event.fotoUrl);
  for (const event of evidenceEvents) {
    const image = await imageDataFromUrl(event.fotoUrl || "");
    doc.addPage();
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Anexo de evidencia fotográfica", 14, 18);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`${dateLabel(event.fecha)} · llegada ${safe(event.horaLlegada, "No reportó")}`, 14, 26);
    if (image) {
      doc.addImage(image.data, image.format, 14, 34, 182, 210, undefined, "MEDIUM");
    } else {
      doc.setDrawColor(190, 190, 190);
      doc.rect(14, 34, 182, 80);
      doc.setTextColor(115, 115, 115);
      doc.text("La evidencia está registrada en el sistema, pero no pudo cargarse al generar este PDF.", 22, 75, { maxWidth: 165, align: "center" });
      doc.setTextColor(35, 39, 47);
    }
  }
  addFooter(doc);
  doc.save(`memorando_${memo.numero}.pdf`);
}

export function generateAttendanceFortnightlyPDF({
  report,
  company,
}: {
  report: AttendanceFortnightlyReport;
  company: CompanySettings;
}) {
  const doc = new jsPDF({ orientation: "landscape" });
  addHeader(doc, company, "Reporte quincenal de llegadas tarde", `${dateLabel(report.fechaInicio)} al ${dateLabel(report.fechaFin)}`);
  autoTable(doc, {
    startY: 38,
    head: [["Trabajador", "Eventos", "Min. adeudados", "Tardanzas leves", "Reposiciones / severas", "No reportados", "% eventos"]],
    body: report.trabajadores.map((worker) => [
      worker.nombre,
      String(worker.eventos),
      String(worker.minutosAdeudados),
      String(worker.tardanzasLeves),
      String(worker.tardanzasMayores),
      String(worker.noReportados),
      `${worker.porcentajeDescuento}%`,
    ]),
    theme: "grid",
    headStyles: { fillColor: [180, 135, 38], textColor: [255, 255, 255] },
    styles: { fontSize: 9, cellPadding: 3 },
  });
  const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 55;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Resumen consolidado", 14, finalY + 14);
  doc.setFont("helvetica", "normal");
  doc.text(`Eventos: ${report.summary.eventos} · Trabajadores: ${report.summary.trabajadores} · Minutos adeudados: ${report.summary.minutosAdeudados} · Descuento acumulado: ${report.summary.descuentoTotal}%`, 14, finalY + 21);
  addFooter(doc);
  doc.save(`reporte_quincenal_${report.fechaInicio}_${report.fechaFin}.pdf`);
}
