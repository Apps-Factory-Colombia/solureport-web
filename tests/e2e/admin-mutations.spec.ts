import { test, expect } from "@playwright/test";
import {
  getGroupActivitySnapshot,
  OPEN_SHARED_ACTIVITY,
  resetOpenSharedActivityBaseline,
  restoreGroupActivitySnapshot,
} from "./helpers/supabase-admin";

const LEADER_TECH_ID = "3f4ae540-9d3c-4390-a80f-b44359715719";
const MEMBER_TECH_ID = "ebbedef3-4cf6-4628-aed4-43d03861f97a";
const OPEN_LEADER_TECH_ID = "2dc94aad-8eb9-446e-9087-21c19fec7ad5";
const OPEN_MEMBER_TECH_ID = "ad411607-b5bf-4081-ab10-626d90d219cc";

async function waitForOpenSnapshot(target: {
  registroId: string;
  groupId: string;
  periodId: string;
  clientId: string;
  date: string;
  description: string;
  sourceReportId: string;
  memberReportId: string;
}, predicate: (snapshot: Awaited<ReturnType<typeof getGroupActivitySnapshot>>) => boolean) {
  await expect.poll(async () => {
    const snapshot = await getGroupActivitySnapshot(target);
    return predicate(snapshot);
  }, { timeout: 15000 }).toBeTruthy();
}

async function openApprovalCase(page: import("@playwright/test").Page, target = OPEN_SHARED_ACTIVITY) {
  await page.goto("/admin/aprobaciones");
  await expect(page.getByText("Aprobaciones de Actividades").first()).toBeVisible();
  await page.getByRole("combobox").nth(0).click();
  await page.getByRole("option", { name: target.periodId === OPEN_SHARED_ACTIVITY.periodId ? "2026-04-18 al 2026-05-01" : "2026-04-04 al 2026-04-18" }).click();
  await expect(page.getByText(target.periodId === OPEN_SHARED_ACTIVITY.periodId ? "Período actual: 2026-04-18 al 2026-05-01" : "Período actual: 2026-04-04 al 2026-04-18")).toBeVisible();
  await page.getByRole("tab", { name: /Act\. Grupal/i }).click();
  await page.locator('input[type="date"]').fill(target.date);
  await page.getByPlaceholder("Buscar por cliente, grupo, descripción o fecha...").fill(target.description.split(" - ")[0]);
  await expect(page.getByTestId(`approval-open-actividad_grupal:group:${target.registroId}`)).toBeVisible();
  await page.getByTestId(`approval-open-actividad_grupal:group:${target.registroId}`).click();
  await expect(page.getByTestId("approval-detail-dialog")).toBeVisible();
}

test.describe("Admin E2E mutations", () => {
  test("edits shared base and split in approvals, then restores real state", async ({ page }) => {
    test.setTimeout(90_000);

    const originalSnapshot = await getGroupActivitySnapshot(OPEN_SHARED_ACTIVITY);

    try {
      await resetOpenSharedActivityBaseline();
      await waitForOpenSnapshot(OPEN_SHARED_ACTIVITY, (current) => (
        current.appliedValue === 50000
        && current.reports.every((report) => report.estado === "pendiente" && report.costoActividad === 25000)
        && Number(current.participants.find((item) => item.tecnicoId === OPEN_LEADER_TECH_ID)?.amount || 0) === 25000
        && Number(current.participants.find((item) => item.tecnicoId === OPEN_MEMBER_TECH_ID)?.amount || 0) === 25000
      ));

      const baselineSnapshot = await getGroupActivitySnapshot(OPEN_SHARED_ACTIVITY);
      const nextBase = baselineSnapshot.appliedValue + 10000;
      const nextLeaderAmount = Math.floor(nextBase / 2);
      const nextTechAmount = nextBase - nextLeaderAmount;

      await openApprovalCase(page, OPEN_SHARED_ACTIVITY);

      await page.getByTestId("approval-cost-input").fill(String(nextBase));
      await page.getByTestId(`approval-participant-amount-${OPEN_SHARED_ACTIVITY.sourceReportId}`).fill(String(nextLeaderAmount));
      await page.getByTestId(`approval-participant-amount-${OPEN_SHARED_ACTIVITY.memberReportId}`).fill(String(nextTechAmount));
      await page.getByTestId("approval-save-split").click();

      await waitForOpenSnapshot(OPEN_SHARED_ACTIVITY, (current) => (
        current.appliedValue === nextBase
        && Number(current.participants.find((item) => item.tecnicoId === OPEN_LEADER_TECH_ID)?.amount || 0) === nextLeaderAmount
        && Number(current.participants.find((item) => item.tecnicoId === OPEN_MEMBER_TECH_ID)?.amount || 0) === nextTechAmount
      ));
    } finally {
      await restoreGroupActivitySnapshot(originalSnapshot, OPEN_SHARED_ACTIVITY);
      await waitForOpenSnapshot(OPEN_SHARED_ACTIVITY, (current) => (
        current.appliedValue === originalSnapshot.appliedValue
        && current.participants.every((participant, index) => participant.amount === originalSnapshot.participants[index]?.amount)
      ));
    }

    const restored = await getGroupActivitySnapshot(OPEN_SHARED_ACTIVITY);
    expect(restored.appliedValue).toBe(originalSnapshot.appliedValue);
    expect(restored.participants.map((item) => item.amount)).toEqual(originalSnapshot.participants.map((item) => item.amount));
  });

  test("reopens and approves the shared activity, then restores real state", async ({ page }) => {
    test.setTimeout(90_000);

    const originalSnapshot = await getGroupActivitySnapshot(OPEN_SHARED_ACTIVITY);

    try {
      await resetOpenSharedActivityBaseline();
      await waitForOpenSnapshot(OPEN_SHARED_ACTIVITY, (current) => (
        current.appliedValue === 50000
        && current.reports.every((report) => report.estado === "pendiente" && report.costoActividad === 25000)
        && current.approvalItems.every((item) => item.estado === "pendiente" && item.valor === 25000)
        && current.liquidationItems.every((item) => item.estado === "pendiente" && item.valorBase === 50000 && item.valorGanado === 25000)
      ));

      await openApprovalCase(page, OPEN_SHARED_ACTIVITY);

      await page.route("**/api/send-email", async (route) => {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      });
      await page.getByTestId("approval-approve").click();

      await waitForOpenSnapshot(OPEN_SHARED_ACTIVITY, (current) => (
        current.reports.every((report) => report.estado === "aprobado")
          && current.approvalItems.every((item) => item.estado === "aprobada")
          && current.liquidationItems.every((item) => item.estado === "aprobado")
      ));

      await openApprovalCase(page, OPEN_SHARED_ACTIVITY);
      await page.getByTestId("approval-reactivate").click();

      await waitForOpenSnapshot(OPEN_SHARED_ACTIVITY, (current) => (
        current.reports.every((report) => report.estado === "pendiente")
          && current.approvalItems.every((item) => item.estado === "pendiente")
          && current.liquidationItems.every((item) => item.estado === "pendiente")
      ));
    } finally {
      await restoreGroupActivitySnapshot(originalSnapshot, OPEN_SHARED_ACTIVITY);
      await waitForOpenSnapshot(OPEN_SHARED_ACTIVITY, (current) => (
        current.reports.every((report, index) => report.estado === originalSnapshot.reports[index]?.estado)
      ));
    }

    const restored = await getGroupActivitySnapshot(OPEN_SHARED_ACTIVITY);
    expect(restored.reports.map((report) => report.estado)).toEqual(originalSnapshot.reports.map((report) => report.estado));
  });

  test("validates liquidation totals and comprobante for the real leader case", async ({ page }) => {
    await page.goto("/admin/liquidacion");
    await expect(page.getByText("Liquidación de Actividades")).toBeVisible();

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "2026-04-04 → 2026-04-18 (Cerrado)" }).click();

    await page.getByRole("tab", { name: /Comprobantes/i }).click();
    await page.getByPlaceholder("Buscar técnico para comprobante...").fill("Lider Grupo Prueba");
    const leaderCard = page.getByTestId(`liquidation-comprobante-card-${LEADER_TECH_ID}`);
    await expect(leaderCard).toBeVisible();
    await expect(leaderCard.getByText(/EXTRA LÍDER/i)).toBeVisible();
    await expect(leaderCard.getByText(/\$\s*6\.000/)).toBeVisible();
    await expect(leaderCard.getByText(/\$\s*96\.000/)).toBeVisible();

    await leaderCard.click();
    const dialog = page.getByTestId("liquidation-comprobante-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/TOTAL A LIQUIDAR/i)).toBeVisible();
    await expect(dialog.getByText(/\$\s*96\.000/)).toBeVisible();

    const download = page.waitForEvent("download");
    await dialog.getByTestId("liquidation-download-comprobante").click();
    const comprobante = await download;
    expect(comprobante.suggestedFilename().toLowerCase()).toContain("comprobante");
  });
});
