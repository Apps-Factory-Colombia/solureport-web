import { test, expect } from "@playwright/test";

test.describe("SoluReport web V2", () => {
  test("expone la salud de PostgreSQL V2", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({ ok: true, schema: "v2" });
  });

  test("muestra el acceso cuando no hay sesión", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
  });
});
