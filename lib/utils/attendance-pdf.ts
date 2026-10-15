import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { AttendanceFortnightlyReport, AttendanceMemo, CompanySettings, User } from "@/lib/types";

type AttendanceReportRow = AttendanceFortnightlyReport["trabajadores"][number]["registros"][number];

function safe(value: unknown, fallback = "-") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function dateLabel(value?: string) {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function dateLong(value?: string) {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeZone: "America/Bogota" }).format(new Date(Date.UTC(year, month - 1, day, 17)));
}

function reportHeader(doc: jsPDF, company: CompanySettings, title: string, subtitle: string) {
  doc.setTextColor(24, 34, 54);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(safe(company.nombre, "SoluReport"), 14, 12);
  if (company.correoEmpresa) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(company.correoEmpresa, 196, 12, { align: "right" });
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  const lines = doc.splitTextToSize(title, 180);
  doc.text(lines, 14, 21);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const y = 21 + lines.length * 5.5;
  doc.text(subtitle, 14, y);
  doc.setDrawColor(27, 38, 61);
  doc.setLineWidth(0.6);
  doc.line(14, y + 4, 196, y + 4);
  doc.setTextColor(30, 38, 53);
  return y + 9;
}

function addFooter(doc: jsPDF, company: CompanySettings, label: string) {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    const height = doc.internal.pageSize.getHeight();
    doc.setDrawColor(215, 220, 228);
    doc.setLineWidth(0.2);
    doc.line(14, height - 14, 196, height - 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 112, 133);
    doc.text(`${safe(company.nombre, "SoluReport")} - ${label}`, 14, height - 8);
    doc.text(`Pagina ${page} de ${pages}`, 196, height - 8, { align: "right" });
  }
}

function isIncident(row: AttendanceReportRow) {
  return row.estadoEntrada === "tarde" || row.estadoEntrada === "no_reportado"
    || ["tardanza_leve", "tardanza_mayor", "reposicion", "no_reportado"].includes(row.categoriaLlegada || "");
}

function categoryLabel(row: AttendanceReportRow) {
  if (row.categoriaLlegada === "no_reportado" || row.estadoEntrada === "no_reportado") return "No reportado";
  if (row.categoriaLlegada === "reposicion") return "Fuera del corte";
  if (row.categoriaLlegada === "tardanza_mayor") return "Retardo severo";
  if (row.categoriaLlegada === "tardanza_leve") return "Retardo leve";
  return row.estadoEntrada === "tarde" ? "Tarde" : "A tiempo";
}

function timeMinutes(value?: string) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function minuteBefore(value?: string) {
  const total = timeMinutes(value);
  if (total == null) return "08:29";
  const previous = (total + 1439) % 1440;
  return `${String(Math.floor(previous / 60)).padStart(2, "0")}:${String(previous % 60).padStart(2, "0")}`;
}

function durationLabel(totalMinutes: number) {
  const minutes = Math.max(0, Math.floor(Number(totalMinutes) || 0));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function addPolicyCards(doc: jsPDF, company: CompanySettings, startY: number) {
  const lateStart = safe(company.horaInicioDescuentoTardanza, "08:05");
  const cutoff = safe(company.horaDescuentoAutomatico, "08:30");
  const lateEnd = minuteBefore(cutoff);
  const latePercentage = Number(company.porcentajeDescuentoTardanza ?? 5);
  const noReportPercentage = Number(company.porcentajeDescuentoNoReportado ?? 30);
  const reposicionPercentage = Number(company.porcentajeDescuentoReposicion ?? 0);
  const noReportMinutes = Math.max(0, Number(company.minutosNoReportado ?? 30));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(24, 34, 54);
  doc.text("PACTO OPERATIVO DE HORARIOS Y CRITERIO DE LIQUIDACION DE ACTIVIDADES", 14, startY + 4);
  startY += 8;
  const bands: Array<{ title: string; detail: string; color: [number, number, number]; fill: [number, number, number] }> = [
    { title: "0% TOLERANCIA", detail: `Hasta ${minuteBefore(lateStart)}\nSin descuento`, color: [31, 158, 98], fill: [238, 250, 243] },
    { title: `RETARDO LEVE -${latePercentage}%`, detail: `${lateStart} a ${lateEnd}\nSi reporta su llegada`, color: [215, 132, 22], fill: [255, 248, 230] },
    { title: `RETARDO MAYOR / SIN REGISTRO -${noReportPercentage}%`, detail: `Sin registro al corte ${cutoff} (+${noReportMinutes} min)\nRegistro posterior: reposicion ${reposicionPercentage}%`, color: [202, 57, 57], fill: [255, 240, 240] },
  ];
  const gap = 4;
  const width = (182 - gap * 2) / 3;
  bands.forEach((band, index) => {
    const x = 14 + index * (width + gap);
    doc.setFillColor(...band.fill);
    doc.setDrawColor(...band.color);
    doc.roundedRect(x, startY, width, 25, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...band.color);
    const titleLines = doc.splitTextToSize(band.title, width - 6).slice(0, 2);
    doc.text(titleLines, x + 3, startY + 4.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(60, 72, 94);
    doc.text(band.detail.split("\n"), x + 3, startY + (titleLines.length > 1 ? 12 : 10));
  });
  doc.setTextColor(30, 38, 53);
  return startY + 30;
}

function addMetricCards(doc: jsPDF, metrics: Array<{ value: string; label: string; color: [number, number, number] }>, startY: number) {
  const gap = 3;
  const width = (182 - gap * 3) / 4;
  metrics.forEach((metric, index) => {
    const x = 14 + index * (width + gap);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(205, 214, 228);
    doc.roundedRect(x, startY, width, 19, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...metric.color);
    doc.text(metric.value, x + width / 2, startY + 8, { align: "center" });
    doc.setFontSize(7);
    doc.setTextColor(83, 98, 124);
    doc.text(doc.splitTextToSize(metric.label.toUpperCase(), width - 4), x + width / 2, startY + 13, { align: "center" });
  });
  doc.setTextColor(30, 38, 53);
  return startY + 24;
}

function workerIncidentSummary(rows: AttendanceReportRow[]) {
  const late = rows.filter((row) => row.categoriaLlegada === "tardanza_leve").length;
  const severe = rows.filter((row) => ["tardanza_mayor", "reposicion"].includes(row.categoriaLlegada || "")).length;
  const absent = rows.filter((row) => row.categoriaLlegada === "no_reportado" || row.estadoEntrada === "no_reportado").length;
  return [
    late ? `${late} retardo${late === 1 ? "" : "s"} leve${late === 1 ? "" : "s"}` : "",
    severe ? `${severe} fuera del corte` : "",
    absent ? `${absent} sin registro` : "",
  ].filter(Boolean).join("; ") || `${rows.length} incidencia${rows.length === 1 ? "" : "s"}`;
}

async function appendAttendanceMemo(doc: jsPDF, {
  memo,
  user,
  company,
}: {
  memo: AttendanceMemo;
  user?: User;
  company: CompanySettings;
}) {
  const employeeName = memo.usuarioNombre || (user ? `${user.nombre} ${user.apellido}` : safe(memo.usuarioId, "Trabajador"));
  const eventDates = memo.eventos.map((event) => event.fecha).filter(Boolean).sort();
  const periodStart = memo.periodoFechaInicio || eventDates[0];
  const periodEnd = memo.periodoFechaFin || eventDates[eventDates.length - 1];
  let y = reportHeader(doc, company, safe(memo.titulo, "Memorando y llamado de atencion"), `${memo.numero} | Quincena ${dateLabel(periodStart)} al ${dateLabel(periodEnd)}`);

  doc.setFillColor(242, 245, 250);
  doc.setDrawColor(205, 214, 228);
  doc.rect(14, y, 182, 27, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(58, 72, 96);
  doc.text("TRABAJADOR:", 17, y + 6);
  doc.text("FECHA:", 127, y + 6);
  doc.text("CARGO:", 17, y + 13);
  doc.text("PERIODO:", 127, y + 13);
  doc.text("REMITENTE:", 17, y + 21);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(28, 38, 56);
  doc.text(doc.splitTextToSize(employeeName, 96), 43, y + 6);
  doc.text(dateLong(memo.generadoEn), 148, y + 6);
  doc.text(user ? user.rol === "tecnico" ? "Tecnico de operaciones" : user.rol : "Personal operativo", 43, y + 13);
  doc.text(doc.splitTextToSize(`${dateLabel(periodStart)} al ${dateLabel(periodEnd)}`, 64), 148, y + 13);
  doc.text(safe(company.nombre, "Administracion de operaciones"), 43, y + 21);
  y += 34;

  if (memo.narrativa) {
    const narrative = doc.splitTextToSize(memo.narrativa, 180);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(35, 45, 63);
    doc.text(narrative, 14, y);
    y += narrative.length * 4.3 + 5;
  }

  const rows = memo.eventos.map((event) => [
    dateLabel(event.fecha),
    safe(event.horaProgramada),
    safe(event.horaLlegada, "Sin registro"),
    event.horaLlegada ? `+${numberText(event.minutosRetraso)} min` : `+${numberText(event.minutosAdeudados)} min imputados`,
    event.horaLlegada ? categoryLabel({ estadoEntrada: event.estado as AttendanceReportRow["estadoEntrada"], categoriaLlegada: event.categoria as AttendanceReportRow["categoriaLlegada"] } as AttendanceReportRow) : "No reportado",
    event.porcentaje > 0 ? `-${event.porcentaje}%` : `${event.porcentaje}%`,
  ]);
  autoTable(doc, {
    startY: y,
    head: [["Fecha", "Hora pactada", "Hora registro", "Retardo / deuda", "Estado", "Dcto."]],
    body: rows.length ? rows : [["-", "-", "-", "-", "Sin incidencias", "0%"]],
    theme: "grid",
    headStyles: { fillColor: [21, 31, 51], textColor: [255, 255, 255], fontSize: 7.5 },
    bodyStyles: { fontSize: 7.5, textColor: [35, 45, 63] },
    alternateRowStyles: { fillColor: [246, 248, 251] },
    styles: { cellPadding: 2, lineColor: [210, 218, 229], lineWidth: 0.15, overflow: "linebreak" },
    columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 25 }, 2: { cellWidth: 27 }, 3: { cellWidth: 34 }, 4: { cellWidth: 47 }, 5: { cellWidth: 20, halign: "center" } },
    margin: { left: 14, right: 14, bottom: 20 },
  });
  const lastTableY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y + 20;
  const totalMinutes = memo.eventos.reduce((sum, event) => sum + Number(event.minutosAdeudados || 0), 0);
  const percentage = Math.min(100, memo.eventos.reduce((sum, event) => sum + Number(event.porcentaje || 0), 0));
  y = lastTableY + 7;
  if (y + 22 > 263) { doc.addPage(); y = 20; }
  y = addMetricCards(doc, [
    { value: String(memo.eventos.length), label: "Incidencias quincenales", color: [189, 44, 44] },
    { value: `${totalMinutes} min`, label: "Tiempo adeudado", color: [184, 105, 18] },
    { value: `-${percentage}%`, label: "Descuento por actividades", color: [189, 44, 44] },
    { value: memo.estado.toUpperCase(), label: "Estado del documento", color: [53, 82, 128] },
  ], y);

  const addTextSection = (heading: string, text: string | undefined, color: [number, number, number]) => {
    if (!text?.trim()) return;
    const lines = doc.splitTextToSize(text.trim(), 174);
    const height = 8 + lines.length * 4;
    if (y + height > 265) { doc.addPage(); y = 20; }
    doc.setFillColor(247, 249, 252);
    doc.setDrawColor(...color);
    doc.roundedRect(14, y, 182, height, 1, 1, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...color);
    doc.text(heading, 17, y + 5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(42, 52, 70);
    doc.text(lines, 17, y + 10);
    y += height + 4;
  };
  addTextSection("FUNDAMENTO JURIDICO", memo.fundamento, [76, 96, 126]);
  addTextSection("REGIMEN O MEDIDAS INFORMADAS", memo.regimenSancionatorio, [193, 38, 62]);

  if (y + 34 > 268) { doc.addPage(); y = 22; }
  const signY = y + 7;
  doc.setDrawColor(32, 42, 62);
  doc.line(18, signY, 88, signY);
  doc.line(122, signY, 192, signY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(30, 40, 58);
  doc.text("POR LA EMPRESA", 18, signY + 5);
  doc.text("NOTIFICADO / TRABAJADOR", 122, signY + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(safe(company.nombre, "Administracion de operaciones"), 18, signY + 10);
  doc.text("Firma: __________________________", 122, signY + 10);
  doc.text("Nombre: " + employeeName, 122, signY + 15, { maxWidth: 72 });
  doc.text(`Documento: ${safe(memo.firmaTrabajadorDocumento, "________________")}`, 122, signY + 20);
  doc.text("Fecha: ____ / ____ / ______", 122, signY + 25);

  const evidence = await Promise.all(memo.eventos.filter((event) => event.fotoUrl).map(async (event) => ({ event, image: await imageDataFromUrl(event.fotoUrl || "") })));
  for (const { event, image } of evidence) {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(24, 34, 54);
    doc.text("ANEXO - EVIDENCIA DE ASISTENCIA", 14, 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`${employeeName} | ${dateLabel(event.fecha)} | Hora: ${safe(event.horaLlegada, "Sin registro")}`, 14, 25);
    if (image) {
      doc.addImage(image.data, image.format, 14, 33, 182, 230, undefined, "MEDIUM");
    } else {
      doc.setDrawColor(190, 198, 210);
      doc.rect(14, 33, 182, 80);
      doc.setTextColor(100, 112, 133);
      doc.text("La evidencia esta registrada en el sistema, pero no pudo cargarse en este anexo.", 105, 75, { maxWidth: 160, align: "center" });
    }
  }

}

export async function generateAttendanceMemoPDF({ memo, user, company }: { memo: AttendanceMemo; user?: User; company: CompanySettings }) {
  const doc = new jsPDF({ orientation: "portrait", format: "a4" });
  await appendAttendanceMemo(doc, { memo, user, company });
  addFooter(doc, company, "Memorando de asistencia - Documento para revision y firma");
  doc.save(`memorando_${memo.numero}.pdf`);
}

function numberText(value: number) {
  return String(Math.max(0, Number(value) || 0));
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

export function generateAttendanceFortnightlyPDF({
  report,
  company,
}: {
  report: AttendanceFortnightlyReport;
  company: CompanySettings;
}) {
  const doc = new jsPDF({ orientation: "portrait", format: "a4" });
  const employees = report.trabajadores.map((worker) => ({
    ...worker,
    incidencias: worker.registros.filter(isIncident),
  })).filter((worker) => worker.incidencias.length > 0);
  const events = employees.flatMap((worker) => worker.incidencias.map((row) => ({ ...row, nombreTrabajador: worker.nombre })));
  const minutes = events.reduce((sum, row) => sum + Number(row.minutosAdeudados ?? row.minutosRetraso ?? 0), 0);
  const discountedEvents = events.filter((row) => Number(row.porcentajeDescuento || 0) > 0).length;
  const title = "Informe Oficial de Control de Asistencia y Liquidacion de Retardos";
  let y = reportHeader(doc, company, title, `Reporte biometrico quincenal | Periodo del ${dateLong(report.fechaInicio)} al ${dateLong(report.fechaFin)}`);
  y = addPolicyCards(doc, company, y);
  y = addMetricCards(doc, [
    { value: durationLabel(minutes), label: "Tiempo adeudado total", color: [199, 39, 39] },
    { value: String(discountedEvents), label: "Eventos con descuento aplicado", color: [199, 39, 39] },
    { value: String(events.length), label: "Novedades registradas", color: [28, 38, 58] },
    { value: String(employees.length), label: "Trabajadores auditados", color: [28, 38, 58] },
  ], y);

  doc.setFillColor(21, 31, 51);
  doc.rect(14, y, 2, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(24, 34, 54);
  doc.text("LIQUIDACION INDIVIDUAL: TIEMPO ADEUDADO Y % A DESCONTAR", 19, y + 5);
  y += 11;

  const cardWidth = 89;
  const gap = 4;
  let cardY = y;
  employees.forEach((worker, index) => {
    const column = index % 2;
    if (column === 0 && index > 0) {
      cardY += 23;
      if (cardY + 19 > 267) {
        doc.addPage();
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(24, 34, 54);
        doc.text("LIQUIDACION INDIVIDUAL - CONTINUACION", 14, 18);
        cardY = 25;
      }
    }
    const x = 14 + column * (cardWidth + gap);
    const workerMinutes = worker.incidencias.reduce((sum, row) => sum + Number(row.minutosAdeudados ?? row.minutosRetraso ?? 0), 0);
    const percentage = Math.min(100, worker.incidencias.reduce((sum, row) => sum + Number(row.porcentajeDescuento || 0), 0));
    const hasNoReport = worker.incidencias.some((row) => row.estadoEntrada === "no_reportado" || row.categoriaLlegada === "no_reportado");
    const color: [number, number, number] = hasNoReport ? [193, 47, 47] : [205, 131, 21];
    const fill: [number, number, number] = hasNoReport ? [255, 244, 244] : [255, 249, 235];
    doc.setFillColor(...fill);
    doc.setDrawColor(...color);
    doc.roundedRect(x, cardY, cardWidth, 19, 1, 1, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(27, 38, 58);
    doc.text(doc.splitTextToSize(worker.nombre, 64)[0], x + 3, cardY + 5);
    doc.setFontSize(10);
    doc.setTextColor(...color);
    doc.text(`-${percentage}%`, x + cardWidth - 3, cardY + 6, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(67, 80, 104);
    doc.text(doc.splitTextToSize(workerIncidentSummary(worker.incidencias), 58).slice(0, 1), x + 3, cardY + 10);
    doc.setFont("helvetica", "bold");
    doc.text(`Debe ${workerMinutes} min`, x + cardWidth - 3, cardY + 15, { align: "right" });
  });
  if (employees.length > 0) cardY += 23;
  cardY += 3;

  if (cardY + 30 > 267) { doc.addPage(); cardY = 20; }
  doc.setFillColor(21, 31, 51);
  doc.rect(14, cardY, 2, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(24, 34, 54);
  doc.text("TABLA RESUMEN QUINCENAL", 19, cardY + 5);
  autoTable(doc, {
    startY: cardY + 9,
    head: [["Colaborador / Tecnico", "Eventos", "Tiempo adeudado", `Leves (-${Number(company.porcentajeDescuentoTardanza ?? 5)}%)`, `Mayores / no reg. (-${Number(company.porcentajeDescuentoNoReportado ?? 30)}%)`, "% descuento quincenal"]],
    body: employees.map((worker) => [
      worker.nombre,
      String(worker.incidencias.length),
      `${worker.incidencias.reduce((sum, row) => sum + Number(row.minutosAdeudados ?? row.minutosRetraso ?? 0), 0)} min`,
      String(worker.incidencias.filter((row) => row.categoriaLlegada === "tardanza_leve").length),
      String(worker.incidencias.filter((row) => ["tardanza_mayor", "reposicion", "no_reportado"].includes(row.categoriaLlegada || "") || row.estadoEntrada === "no_reportado").length),
      `-${Math.min(100, worker.incidencias.reduce((sum, row) => sum + Number(row.porcentajeDescuento || 0), 0))}%`,
    ]),
    foot: [["IMPACTO TOTAL (porcentajes individuales)", String(events.length), `${minutes} min`, String(events.filter((row) => row.categoriaLlegada === "tardanza_leve").length), String(events.filter((row) => ["tardanza_mayor", "reposicion", "no_reportado"].includes(row.categoriaLlegada || "") || row.estadoEntrada === "no_reportado").length), "—"]],
    theme: "grid",
    headStyles: { fillColor: [21, 31, 51], textColor: [255, 255, 255], fontSize: 7 },
    footStyles: { fillColor: [238, 242, 248], textColor: [30, 42, 65], fontStyle: "bold", fontSize: 7 },
    bodyStyles: { fontSize: 7, textColor: [35, 45, 63] },
    alternateRowStyles: { fillColor: [246, 248, 251] },
    styles: { cellPadding: 2, lineColor: [210, 218, 229], lineWidth: 0.15, overflow: "linebreak" },
    columnStyles: { 0: { cellWidth: 58 }, 1: { cellWidth: 18, halign: "center" }, 2: { cellWidth: 27 }, 3: { cellWidth: 16, halign: "center" }, 4: { cellWidth: 39 }, 5: { cellWidth: 24, halign: "center" } },
    margin: { left: 14, right: 14, bottom: 20 },
    showFoot: "lastPage",
  });

  doc.addPage();
  y = reportHeader(doc, company, "Auditoria cronologica de marcaciones e incidencias", `Historial del sistema movil de asistencia | Quincena ${dateLabel(report.fechaInicio)} al ${dateLabel(report.fechaFin)}`);
  autoTable(doc, {
    startY: y,
    head: [["Colaborador", "Fecha", "Prog.", "Entrada", "Retardo / deuda", "Estado", "Dcto."]],
    body: events.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.nombreTrabajador.localeCompare(b.nombreTrabajador, "es")).map((row) => [
      row.nombreTrabajador,
      dateLabel(row.fecha),
      safe(row.horaEsperada),
      safe(row.horaLlegada, "Sin registro"),
      row.estadoEntrada === "no_reportado" ? `+${numberText(row.minutosAdeudados ?? 30)} min imputados` : `+${numberText(row.minutosAdeudados ?? row.minutosRetraso)} min`,
      categoryLabel(row),
      Number(row.porcentajeDescuento || 0) > 0 ? `-${Number(row.porcentajeDescuento)}%` : row.categoriaLlegada === "reposicion" ? `0% (reposicion ${Number(company.porcentajeDescuentoReposicion ?? 0)}%)` : "0%",
    ]),
    theme: "grid",
    headStyles: { fillColor: [21, 31, 51], textColor: [255, 255, 255], fontSize: 7 },
    bodyStyles: { fontSize: 7, textColor: [35, 45, 63] },
    alternateRowStyles: { fillColor: [246, 248, 251] },
    styles: { cellPadding: 2, lineColor: [210, 218, 229], lineWidth: 0.15, overflow: "linebreak" },
    columnStyles: { 0: { cellWidth: 49 }, 1: { cellWidth: 23 }, 2: { cellWidth: 15 }, 3: { cellWidth: 18 }, 4: { cellWidth: 31 }, 5: { cellWidth: 28 }, 6: { cellWidth: 18, halign: "center" } },
    margin: { left: 14, right: 14, bottom: 20 },
    showHead: "everyPage",
  });
  const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y;
  if (finalY < 268) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(80, 94, 118);
    doc.text("El informe consolida las novedades registradas en la asistencia y su porcentaje de descuento aplicable a la liquidacion quincenal.", 14, finalY + 7, { maxWidth: 180 });
  }
  addFooter(doc, company, "Control de operaciones y liquidacion quincenal");
  doc.save(`informe_asistencia_quincenal_${report.fechaInicio}_${report.fechaFin}.pdf`);
}
