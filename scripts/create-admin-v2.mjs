import { Client } from "pg";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const email = process.env.SOLUREPORT_ADMIN_EMAIL;
const password = process.env.SOLUREPORT_ADMIN_PASSWORD;
const nombre = process.env.SOLUREPORT_ADMIN_NOMBRE || "Administrador";
const apellido = process.env.SOLUREPORT_ADMIN_APELLIDO || "SoluReport";
const connectionString = process.env.SOLUREPORT_DATABASE_URL;

if (!connectionString || !email || !password) {
  throw new Error("Define SOLUREPORT_DATABASE_URL, SOLUREPORT_ADMIN_EMAIL y SOLUREPORT_ADMIN_PASSWORD.");
}

const salt = randomBytes(16).toString("hex");
const derived = await scrypt(password, salt, 64);
const passwordHash = `scrypt$1$${salt}$${derived.toString("hex")}`;
const client = new Client({ connectionString, ssl: process.env.SOLUREPORT_DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false });

await client.connect();
try {
  await client.query(
    `INSERT INTO public.usuarios (username, nombre, apellido, email, rol, estado, password_hash)
     VALUES ($1,$2,$3,$4,'admin','activo',$5)
     ON CONFLICT (lower(email)) DO UPDATE SET nombre=EXCLUDED.nombre, apellido=EXCLUDED.apellido, rol='admin', estado='activo', password_hash=EXCLUDED.password_hash, updated_at=clock_timestamp()`,
    [email.split("@")[0], nombre, apellido, email.toLowerCase(), passwordHash],
  );
  console.log(`Administrador V2 listo: ${email.toLowerCase()}`);
} finally {
  await client.end();
}
