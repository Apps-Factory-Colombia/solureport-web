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

interface MaintenanceReportEmailProps {
  clienteNombre: string;
  edificio: string;
  fecha: string;
  tecnicoNombre: string;
  observaciones: string;
}

export default function MaintenanceReportEmail({
  clienteNombre = "Cliente",
  edificio = "Edificio",
  fecha = "2023-01-01",
  tecnicoNombre = "Técnico",
  observaciones = "Sin observaciones",
}: MaintenanceReportEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Reporte de mantenimiento preventivo - {edificio}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={heading}>Reporte de Mantenimiento</Heading>
          </Section>
          <Section style={content}>
            <Text style={greeting}>Hola {clienteNombre},</Text>
            <Text style={paragraph}>
              Se ha generado un nuevo reporte de mantenimiento preventivo para sus instalaciones.
              A continuación, encontrará los detalles principales y el reporte completo en formato PDF adjunto.
            </Text>

            <Section style={infoBox}>
              <Text style={infoText}><strong>Edificio:</strong> {edificio}</Text>
              <Text style={infoText}><strong>Fecha:</strong> {fecha}</Text>
              <Text style={infoText}><strong>Técnico:</strong> {tecnicoNombre}</Text>
            </Section>

            {observaciones && (
              <Section style={observacionesBox}>
                <Text style={infoText}><strong>Observaciones:</strong></Text>
                <Text style={paragraph}>{observaciones}</Text>
              </Section>
            )}

            <Text style={paragraph}>
              Si tiene alguna duda o comentario, no dude en contactarnos.
            </Text>
          </Section>
          <Hr style={hr} />
          <Section style={footer}>
            <Text style={footerText}>Soluciones & Automatizaciones S.A.S.</Text>
            <Text style={footerText}>Este es un correo generado automáticamente, por favor no responda directamente a esta dirección.</Text>
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
  backgroundColor: "#0d8abc",
  padding: "30px 20px",
  textAlign: "center" as const,
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

const observacionesBox = {
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
