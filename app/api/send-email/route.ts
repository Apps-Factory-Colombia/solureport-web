import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { render } from "@react-email/render";
import MaintenanceReportEmail from "@/components/emails/MaintenanceReportEmail";
import LiquidationClosedEmail from "@/components/emails/LiquidationClosedEmail";
import TechnicalVisitEmail from "@/components/emails/TechnicalVisitEmail";
import ApprovalReportEmail from "@/components/emails/ApprovalReportEmail";

const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const resendFromEmail = process.env.RESEND_FROM_EMAIL || "notificaciones@solucionesyautomatizaciones.com";
const resendReplyTo = process.env.RESEND_REPLY_TO || "solucionesyautomatizaciones@hotmail.com";

/**
 * Email is an optional notification side effect. A provider outage, quota
 * limit, missing key or rendering problem must never make the operation that
 * triggered the notification fail. Keep HTTP 200 so existing callers that
 * only await the notification can continue, while exposing `skipped` so a
 * manual sender does not mark the report as delivered.
 */
function skippedEmailResponse(reason: string, error?: unknown) {
  console.warn("Correo omitido; la operación principal continúa:", reason, error);
  return NextResponse.json({
    success: false,
    skipped: true,
    emailSent: false,
    warning: "El correo fue omitido porque el servicio de correo no está disponible. La operación principal sí se completó.",
  }, { status: 200 });
}

function normalizeRecipients(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  const values = Array.isArray(value) ? value : [value];
  const cleaned = values
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));
  const unique = Array.from(new Set(cleaned));
  return unique.length > 0 ? unique : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      to,
      cc,
      bcc,
      subject,
      template,
      data: templateData,
      html: providedHtml,
      pdfAttachment,
      replyTo,
      fromName,
    } = body;

    if (!to || !subject || (!template && !providedHtml)) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: to, subject y template o html" },
        { status: 400 }
      );
    }

    if (!resend) {
      return skippedEmailResponse("Falta RESEND_API_KEY.");
    }

    let html = providedHtml;

    if (!html && template === "maintenance-report") {
      html = await render(
        MaintenanceReportEmail({
          companyName: templateData?.companyName,
          clienteNombre: templateData?.clienteNombre,
          edificio: templateData?.edificio,
          fecha: templateData?.fecha,
          tecnicoNombre: templateData?.tecnicoNombre,
          observaciones: templateData?.observaciones,
        })
      );
    }

    if (!html && template === "liquidation-closed") {
      html = await render(
        LiquidationClosedEmail({
          companyName: templateData?.companyName,
          tecnicoNombre: templateData?.tecnicoNombre,
          fechaInicio: templateData?.fechaInicio,
          fechaFin: templateData?.fechaFin,
          actividades: templateData?.actividades,
          total: templateData?.total,
        })
      );
    }

    if (!html && template === "technical-visit-report") {
      html = await render(
        TechnicalVisitEmail({
          companyName: templateData?.companyName,
          clienteNombre: templateData?.clienteNombre,
          edificio: templateData?.edificio,
          fecha: templateData?.fecha,
          tecnicoNombre: templateData?.tecnicoNombre,
          tipoVisita: templateData?.tipoVisita,
          descripcion: templateData?.descripcion,
          observaciones: templateData?.observaciones,
        })
      );
    }

    if (!html && template === "approval-report") {
      html = await render(
        ApprovalReportEmail({
          companyName: templateData?.companyName,
          clienteNombre: templateData?.clienteNombre,
          edificio: templateData?.edificio,
          fecha: templateData?.fecha,
          tecnicoNombre: templateData?.tecnicoNombre,
          tipoInforme: templateData?.tipoInforme,
          resumen: templateData?.resumen,
          observaciones: templateData?.observaciones,
        })
      );
    }

    if (!html) {
      return skippedEmailResponse("No se pudo construir el contenido del correo.");
    }

    const toRecipients = normalizeRecipients(to);
    const ccRecipients = normalizeRecipients(cc);
    const bccRecipients = normalizeRecipients(bcc);

    if (!toRecipients || toRecipients.length === 0) {
      return NextResponse.json(
        { error: "Debes indicar al menos un destinatario válido." },
        { status: 400 }
      );
    }

    const attachments = [];
    if (pdfAttachment && pdfAttachment.base64 && pdfAttachment.filename) {
      attachments.push({
        filename: pdfAttachment.filename,
        content: pdfAttachment.base64,
      });
    }

    const { data, error } = await resend.emails.send({
      from: `${fromName || "SoluReport"} <${resendFromEmail}>`,
      to: toRecipients,
      cc: ccRecipients,
      bcc: bccRecipients,
      subject,
      html,
      replyTo: replyTo || resendReplyTo,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    if (error) {
      return skippedEmailResponse(error.message || "Resend devolvió un error.", error);
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return skippedEmailResponse("Error inesperado al preparar o enviar el correo.", err);
  }
}
