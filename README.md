# SoluReport Web

Aplicación Next.js para la gestión administrativa y la API de SoluReport.

## Desarrollo local

Las variables locales deben estar en `.env.local`. Ese archivo está ignorado por Git y no debe copiarse al contenedor.

```bash
npm ci
npm run dev
```

Abre http://localhost:3000.

## Despliegue en Dockploy/VPS

El repositorio incluye un `Dockerfile` de producción con el puerto `3000` y salida `standalone`. En Dockploy configura el proyecto para construir desde la rama `master`, publica el puerto del contenedor `3000` y agrega estas variables:

- Como variables de ejecución: `SOLUREPORT_SUPABASE_URL`, `SOLUREPORT_SUPABASE_PUBLISHABLE_KEY`, `SOLUREPORT_DATABASE_URL`, `SOLUREPORT_DATABASE_SSL=true`, `SOLUREPORT_DB_POOL_MAX=2`, `SOLUREPORT_COOKIE_SECURE=true`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` y `RESEND_REPLY_TO`.
- También puedes pasar `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` como argumentos de construcción; el contenedor los usará como ruta rápida, pero ya no son obligatorios para construir la imagen.

`SOLUREPORT_DATABASE_URL` debe ser la cadena real de Supabase, con el usuario y contraseña vigentes. No uses usuarios inventados como `app` o `guest`; la base actual no tiene esos roles. Para el pooler de transacciones usa la cadena oficial de Supabase y el puerto `6543`. No guardes contraseñas en el repositorio ni en argumentos visibles de la imagen.

La comprobación de salud es `GET /api/health`. Después de desplegar, debe responder HTTP 200 y mostrar `ok: true`; si responde 503, revisa primero `SOLUREPORT_DATABASE_URL`, SSL y la contraseña configurada en Dockploy.

## Comandos útiles

```bash
npm ci
npm run build
npm start
```
