import { test as setup, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const authDir = path.join(process.cwd(), "playwright", ".auth");
const authFile = path.join(authDir, "admin.json");

const adminSnapshot = {
  id: "b874a090-f917-4c4c-81b8-e96e2036eaf0",
  nombre: "Administrador",
  apellido: "SoluReport",
  email: "admin@solureport.com",
  telefono: "",
  rol: "admin",
  estado: "activo",
  esLider: false,
  tieneRecorrido: false,
  tieneMoto: false,
  esSupervisor: true,
  fechaCreacion: "",
};

setup("persist authenticated admin session", async ({ page }) => {
  fs.mkdirSync(authDir, { recursive: true });

  await page.addInitScript((snapshot) => {
    window.localStorage.setItem("solureport_user_id", snapshot.id);
    window.localStorage.setItem("solureport_user_snapshot", JSON.stringify(snapshot));
  }, adminSnapshot);

  await page.goto("/admin");
  await expect(page.getByText("Dashboard").first()).toBeVisible();
  await page.context().storageState({ path: authFile });
});
