import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Heading,
  Hr,
  Preview,
} from "@react-email/components";
import * as React from "react";

interface TechnicalVisitEmailProps {
  companyName?: string;
  clienteNombre: string;
  edificio: string;
  fecha: string;
  tecnicoNombre: string;
  tipoVisita: string;
  descripcion: string;
  observaciones?: string;
}

export default function TechnicalVisitEmail({
  companyName = "Soluciones & Automatizaciones S.A.S.",
  clienteNombre = "Cliente",
  edificio = "Edificio",
  fecha = "2026-01-01",
  tecnicoNombre = "Técnico",
  tipoVisita = "imprevisto",
  descripcion = "Sin descripción registrada.",
  observaciones,
}: TechnicalVisitEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Reporte de visita técnica - {edificio}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={eyebrow}>{companyName}</Text>
            <Heading style={heading}>Reporte de visita técnica</Heading>
          </Section>
          <Section style={content}>
            <Text style={greeting}>Hola {clienteNombre},</Text>
            <Text style={paragraph}>
              Se registró una visita técnica relacionada con sus instalaciones. A continuación encontrará el resumen principal y el soporte en PDF adjunto.
            </Text>

            <Section style={infoBox}>
              <Text style={infoText}><strong>Edificio:</strong> {edificio}</Text>
              <Text style={infoText}><strong>Fecha del servicio:</strong> {fecha}</Text>
              <Text style={infoText}><strong>Técnico responsable:</strong> {tecnicoNombre}</Text>
              <Text style={infoText}><strong>Tipo de visita:</strong> {tipoVisita}</Text>
            </Section>

            <Section style={summaryBox}>
              <Text style={infoText}><strong>Descripción del trabajo realizado:</strong></Text>
              <Text style={paragraph}>{descripcion}</Text>
            </Section>

            {observaciones && (
              <Section style={notesBox}>
                <Text style={infoText}><strong>Observaciones adicionales:</strong></Text>
                <Text style={paragraph}>{observaciones}</Text>
              </Section>
            )}

            <Text style={paragraph}>
              Este mensaje fue enviado a los contactos definidos para seguimiento operativo del servicio.
            </Text>
          </Section>
          <Hr style={hr} />
          <Section style={footer}>
            <Text style={footerText}>{companyName}</Text>
            <Text style={footerText}>Correo generado automáticamente por SoluReport.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
  padding: "20px 0",
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "0",
  borderRadius: "8px",
  overflow: "hidden",
  boxShadow: "0 4px 6px rgba(0,0,0,0.05)",
  maxWidth: "600px",
};

const header = {
  backgroundColor: "#14532d",
  padding: "30px 20px",
  textAlign: "center" as const,
};

const eyebrow = {
  color: "#dcfce7",
  fontSize: "12px",
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  margin: "0 0 8px 0",
};

const heading = {
  color: "#ffffff",
  fontSize: "24px",
  margin: "0",
  fontWeight: "bold",
};

const content = {
  padding: "30px 20px",
};

const greeting = {
  fontSize: "18px",
  color: "#333333",
  marginBottom: "16px",
};

const paragraph = {
  fontSize: "16px",
  lineHeight: "24px",
  color: "#555555",
  margin: "0 0 16px 0",
};

const infoBox = {
  backgroundColor: "#f8fafc",
  borderRadius: "6px",
  padding: "16px",
  marginBottom: "20px",
  border: "1px solid #e2e8f0",
};

const summaryBox = {
  backgroundColor: "#eff6ff",
  borderRadius: "6px",
  padding: "16px",
  marginBottom: "20px",
  border: "1px solid #bfdbfe",
};

const notesBox = {
  backgroundColor: "#fffbeb",
  borderRadius: "6px",
  padding: "16px",
  marginBottom: "20px",
  border: "1px solid #fef3c7",
};

const infoText = {
  fontSize: "15px",
  color: "#333333",
  margin: "0 0 8px 0",
};

const hr = {
  borderColor: "#e2e8f0",
  margin: "0",
};

const footer = {
  padding: "20px",
  backgroundColor: "#f8fafc",
  textAlign: "center" as const,
};

const footerText = {
  fontSize: "12px",
  color: "#888888",
  margin: "0 0 4px 0",
};
