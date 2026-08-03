import { test, expect } from "@playwright/test";

async function selectComboboxOption(page: import("@playwright/test").Page, comboboxIndex: number, optionLabel: string) {
  await page.getByRole("combobox").nth(comboboxIndex).click();
  await page.getByRole("option", { name: optionLabel }).click();
}

test.describe("Admin E2E", () => {
  test("shows dashboard for authenticated admin session", async ({ page }) => {
    await page.goto("/admin");

    await expect(page.getByText("Dashboard").first()).toBeVisible();
    await expect(page.getByText("Técnicos Activos")).toBeVisible();
    await expect(page.getByText("Reportes")).toBeVisible();
  });

  test("consolidates grouped approvals with the real period data", async ({ page }) => {
    await page.goto("/admin/aprobaciones");

    await expect(page.getByText("Aprobaciones de Actividades").first()).toBeVisible();

    await page.getByRole("tab", { name: /Act\. Grupal/i }).click();
    await page.locator('input[type="date"]').fill("2026-04-19");
    await page.getByPlaceholder("Buscar por cliente, grupo, descripción o fecha...").fill("CENTRO EJECUTIVO 96");

    await expect(page.getByText("4 técnicos:")).toBeVisible();
    await expect(page.getByText(/4 técnicos:.*CENTRO EJECUTIVO 96/i)).toBeVisible();
    await expect(page.getByText(/^4 técnicos:/)).toHaveCount(1);
  });

  test("shows the clarified extra leader base for the real leader case", async ({ page }) => {
    await page.goto("/admin/acumulados");

    await expect(page.getByText("Acumulados por Líder")).toBeVisible();

    await selectComboboxOption(page, 0, "2026-04-04 → 2026-04-18 (Cerrado)");

    await page.getByPlaceholder("Buscar líder...").fill("Lider Grupo Prueba");
    await page.getByRole("button", { name: /toggle/i }).first().click();

    const leaderCard = page.getByText("Lider Grupo Prueba").locator("xpath=ancestor::div[contains(@class,'rounded-lg') or contains(@class,'border-border')][1]");
    const extraLeaderMetric = leaderCard.getByText("Extra Líder", { exact: true }).locator("xpath=ancestor::div[contains(@class,'text-center')][1]");

    await expect(leaderCard.getByText(/Base extra:\s*\$\s*60\.000/)).toBeVisible();
    await expect(leaderCard.getByText("Aprobado Pago", { exact: true })).toBeVisible();
    await expect(leaderCard.getByText(/\$\s*150\.000/)).toBeVisible();
    await expect(extraLeaderMetric.getByText(/^\$\s*6\.000$/)).toBeVisible();
  });

  test("shows the attached tool photo in recorrido approval details", async ({ page }) => {
    await page.goto("/admin/aprobaciones");

    await expect(page.getByText("Aprobaciones de Actividades").first()).toBeVisible();
    await page.getByRole("tab", { name: /Recorrido/i }).click();

    const rowWithEvidence = page.getByRole("row").filter({ hasText: "Evidencia" }).first();
    await expect(rowWithEvidence).toBeVisible();
    await rowWithEvidence.locator('button[data-testid^="approval-open-"]').click();

    const detail = page.getByTestId("approval-detail-dialog");
    const toolPhoto = detail.getByRole("img", { name: "Foto de la herramienta utilizada en el recorrido" });
    await expect(toolPhoto).toBeVisible();
    await expect(toolPhoto).toHaveAttribute("src", /fotos-recorridos/);
  });

  test("shows contractual charged values for completed maintenances", async ({ page }) => {
    await page.goto("/admin/mantenimientos");

    await expect(page.getByText("Programación de Mantenimientos").first()).toBeVisible();
    await page.getByRole("tab", { name: /^Realizados/i }).click();

    const completedPanel = page.getByRole("tabpanel", { name: /^Realizados/i });
    await completedPanel.getByRole("combobox").click();
    await page.getByRole("option", { name: "2026-06-03 al 2026-06-17" }).click();

    await expect(completedPanel.getByText("$ 612.000", { exact: true }).first()).toBeVisible();
  });

  test("downloads maintenance PDFs from programados and calendario", async ({ page }) => {
    await page.goto("/admin/mantenimientos");

    await expect(page.getByText("Programación de Mantenimientos").first()).toBeVisible();

    await page.getByRole("tab", { name: /^Programados/i }).click();
    const firstDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar PDF" }).click();
    const programadosDownload = await firstDownload;
    expect(programadosDownload.suggestedFilename().toLowerCase()).toContain("mantenimientos_programados");

    await page.getByRole("tab", { name: /^Calendario/i }).click();
    const secondDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar PDF" }).click();
    const calendarioDownload = await secondDownload;
    expect(calendarioDownload.suggestedFilename().toLowerCase()).toContain("mantenimientos_calendario");
  });
});
