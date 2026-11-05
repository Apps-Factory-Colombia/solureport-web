import assert from "node:assert/strict";
import test from "node:test";
import { hasSubmittedMaintenanceDelivery, pickGroupLeadReport } from "../../lib/utils/report-filters.ts";

// Solo los campos que usa la regla; el resto del reporte no afecta la decisión.
const report = (overrides: Record<string, unknown>) => ({
  id: "x",
  tipo: "mantenimiento_preventivo",
  tecnicoId: "t",
  fechaCreacion: "2026-11-03",
  estadoEntrega: "pendiente",
  costoActividad: 0,
  ...overrides,
}) as any;

test("un técnico que sí envió es el principal, aunque sea más antiguo o tenga id menor", () => {
  const sinEnvio = report({ id: "b", tecnicoId: "santiago", fechaCreacion: "2026-11-03T12:00" });
  const enviado = report({ id: "a", tecnicoId: "laura", estadoEntrega: "enviada", entregaId: "e1", costoActividad: 12500, fechaCreacion: "2026-11-03T09:00" });
  assert.equal(pickGroupLeadReport([sinEnvio, enviado]).tecnicoId, "laura");
  assert.equal(pickGroupLeadReport([enviado, sinEnvio]).tecnicoId, "laura");
});

test("solo cuenta como reportado un estado de entrega enviado o aprobado", () => {
  assert.equal(hasSubmittedMaintenanceDelivery({ estadoEntrega: "pendiente" }), false);
  assert.equal(hasSubmittedMaintenanceDelivery({ estadoEntrega: undefined }), false);
  assert.equal(hasSubmittedMaintenanceDelivery({ estadoEntrega: "enviada" }), true);
  assert.equal(hasSubmittedMaintenanceDelivery({ estadoEntrega: "aprobada" }), true);
});

test("si nadie envió, se mantiene el criterio anterior (fecha y id)", () => {
  const a = report({ id: "a", tecnicoId: "a", fechaCreacion: "2026-11-01" });
  const b = report({ id: "b", tecnicoId: "b", fechaCreacion: "2026-11-02" });
  assert.equal(pickGroupLeadReport([a, b]).tecnicoId, "b");
});
