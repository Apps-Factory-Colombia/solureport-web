import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { render } from "@react-email/render";
import MaintenanceReportEmail from "@/components/emails/MaintenanceReportEmail";

const resend = new Resend(process.env.RESEND_API_KEY);
const resendFromEmail = process.env.RESEND_FROM_EMAIL || "noreply@appsfactory.com.co";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { to, subject, data: templateData, pdfAttachment } = body;

    if (!to || !subject || !templateData) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: to, subject, data" },
        { status: 400 }
      );
    }

    const html = await render(
      MaintenanceReportEmail({
        clienteNombre: templateData.clienteNombre,
        edificio: templateData.edificio,
        fecha: templateData.fecha,
        tecnicoNombre: templateData.tecnicoNombre,
        observaciones: templateData.observaciones,
      })
    );

    const attachments = [];
    if (pdfAttachment && pdfAttachment.base64 && pdfAttachment.filename) {
      attachments.push({
        filename: pdfAttachment.filename,
        content: pdfAttachment.base64,
      });
    }

    const { data, error } = await resend.emails.send({
      from: `SoluReport <${resendFromEmail}>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    if (error) {
      console.error("Error enviando email:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("Error en API send-email:", err);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
