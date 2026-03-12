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

interface LiquidationClosedEmailProps {
  companyName?: string;
  tecnicoNombre: string;
  fechaInicio: string;
  fechaFin: string;
  actividades: number;
  total: string;
}

export default function LiquidationClosedEmail({
  companyName = "Soluciones & Automatizaciones S.A.S.",
  tecnicoNombre = "Técnico",
  fechaInicio = "2026-01-01",
  fechaFin = "2026-01-15",
  actividades = 0,
  total = "$0",
}: LiquidationClosedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        Liquidación cerrada del período {fechaInicio} al {fechaFin}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={eyebrow}>{companyName}</Text>
            <Heading style={heading}>Liquidación cerrada</Heading>
          </Section>
          <Section style={content}>
            <Text style={greeting}>Hola {tecnicoNombre},</Text>
            <Text style={paragraph}>
              El período de liquidación comprendido entre el <strong>{fechaInicio}</strong> y el <strong>{fechaFin}</strong> ha sido cerrado.
            </Text>
            <Section style={infoBox}>
              <Text style={infoText}>
                <strong>Actividades liquidadas:</strong> {actividades}
              </Text>
              <Text style={totalText}>
                <strong>Total liquidado:</strong> {total}
              </Text>
            </Section>
            <Text style={paragraph}>
              Ingresa al aplicativo para revisar el detalle y descargar tu comprobante individual.
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
  backgroundColor: "#D4A843",
  padding: "30px 20px",
  textAlign: "center" as const,
};

const eyebrow = {
  color: "#422006",
  fontSize: "12px",
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  margin: "0 0 8px 0",
};

const heading = {
  color: "#111827",
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

const infoText = {
  fontSize: "15px",
  color: "#333333",
  margin: "0 0 8px 0",
};

const totalText = {
  fontSize: "16px",
  color: "#D4A843",
  margin: "0",
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
