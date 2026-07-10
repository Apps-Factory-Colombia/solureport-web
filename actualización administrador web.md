# Actualizacion administrador web

## Requerimiento implementado

Se agrego soporte para una foto de evidencia en las actividades grupales.

## Cambios realizados

1. Base de datos
- Se creo la migracion `supabase/migration_group_activity_evidence_photo.sql`.
- Se agrega la columna opcional `foto_evidencia_url` en `registros_actividades`.
- Se agrega la columna opcional `foto_evidencia_url` en `reportes_actividad`.
- La foto no es obligatoria, por lo tanto no rompe los datos existentes.

2. Storage de Supabase
- La evidencia de actividad grupal se guarda en el bucket `fotos-reportes`.
- Se agrego logica para reemplazar la foto anterior si el administrador carga una nueva.
- Se agrego limpieza de archivos cuando aplica borrado total del registro relacionado.

3. Web administrador
- En `admin/aprobaciones` ahora se puede cargar o reemplazar la foto de evidencia para actividades grupales.
- En el detalle del modulo de aprobacion ahora se visualiza la foto de evidencia.
- En `admin/informes` tambien se visualiza la foto de evidencia dentro del detalle del informe.

4. Tipos y servicios
- Se agrego `fotoEvidencia` al modelo `ActivityReport`.
- Se ajustaron los servicios para leer y sincronizar `foto_evidencia_url` desde `registros_actividades` y `reportes_actividad`.

## Archivos modificados

- `app/admin/aprobaciones/page.tsx`
- `app/admin/informes/page.tsx`
- `app/admin/mantenimientos/page.tsx`
- `lib/supabase/services/liquidacion.ts`
- `lib/supabase/services/reportes-actividad.ts`
- `lib/supabase/services/storage.ts`
- `lib/types/index.ts`
- `supabase/migration_group_activity_evidence_photo.sql`
- `supabase/seed.sql`

## Estado de la migracion

La migracion SQL ya esta lista y es segura para datos existentes porque no define `NOT NULL` ni valor obligatorio.

La migracion ya fue aplicada en la base real y se verifico que ambas columnas existen:

- `registros_actividades.foto_evidencia_url`
- `reportes_actividad.foto_evidencia_url`

## Verificacion funcional

Se valido que el administrador web ya quedo preparado para:

- cargar o reemplazar la foto de evidencia en actividades grupales desde `admin/aprobaciones`
- visualizar la foto en el detalle del modulo de aprobacion
- visualizar la foto tambien en `admin/informes`

## Nueva actualizacion solicitada

Se agrego una nueva vista en el modulo de mantenimientos para exportar los mantenimientos realizados por período.

Queda implementado en su propia pantalla de `mantenimientos` del administrador web este requerimiento:

"En el módulo de mantenimiento se puede exportar la información de los mantenimientos realizados en cada período y exportar únicamente el valor cobrado de cada mantenimiento."

### Incluye

- nueva pestaña `Realizados` dentro de `admin/mantenimientos`
- selector de período de liquidacion
- tabla de mantenimientos realizados dentro del período seleccionado
- exportacion PDF por período
- el PDF exporta unicamente el `valor cobrado` de cada mantenimiento

### Campos exportados

- fecha realizada
- cliente
- tecnico
- avance
- estado
- valor cobrado

### Regla aplicada

Para esta exportacion no se usa el valor tecnico. Se usa solamente el valor cobrado de cada mantenimiento.

## Validacion tecnica

- La base remota ya refleja las columnas nuevas de evidencia.
- La nueva exportacion quedó integrada en el administrador web.

## Validacion contra requerimientos del cliente

### 1. En las actividades de grupo se incorpore una foto de evidencia del trabajo y esta foto debe de verse en el módulo de aprobación (administrador web y app movil)

#### Estado en este repositorio

- Cumplido para `administrador web`.
- Se incorporo la foto de evidencia en actividades grupales.
- La foto se guarda en Supabase Storage.
- La foto se visualiza en `admin/aprobaciones`.
- La foto tambien se visualiza en `admin/informes`.

#### Alcance real de la validacion

- La base de datos ya tiene `foto_evidencia_url` en `registros_actividades` y `reportes_actividad`.
- Desde este repositorio no se puede certificar la interfaz de `app movil` porque ese codigo no esta aqui.
- Lo que si queda cubierto a nivel compartido es la persistencia y disponibilidad del dato para ser consumido por la app movil.

### 3. En el módulo de mantenimiento se puede exportar la información de los mantenimientos realizados en cada periodo y exporte el valor del mantenimiento únicamente el valor cobrado de cada mantenimiento (administrador web)

#### Estado en este repositorio

- Cumplido para `administrador web`.
- Se agrego una pestaña propia de `Realizados` dentro de `admin/mantenimientos`.
- Se puede seleccionar un período de liquidacion.
- Se puede exportar la informacion de los mantenimientos realizados en ese período.
- La exportacion usa unicamente el `valor cobrado` de cada mantenimiento.
- No usa el valor tecnico para este reporte.

### 5. Actualmente cuando una persona selecciona modificar el valor y ellos colocan el costo el aplicativo automáticamente les suma el valor que ellos sugieren necesitamos el valor cambie hasta que no haya una aprobación (administrador web y app móvil tambien)

#### Estado en este repositorio

- Cumplido en la logica de `administrador web` y en la capa de datos compartida que maneja sugerencia vs valor real.

#### Verificacion tecnica

- La sugerencia se maneja por separado del valor real aplicado.
- Para actividades grupales legacy se usan campos distintos:
  - `valor_sugerido`
  - `valor_actividad_aplicado`
- En `lib/supabase/services/reportes-actividad.ts` el valor real del reporte se construye desde `valor_actividad_aplicado` y no desde `valor_sugerido`.
- En `app/admin/aprobaciones/page.tsx` se muestra el mensaje: `La sugerencia enviada desde la app es solo informativa. Solo administración cambia el valor real aplicado.`
- En `app/admin/informes/page.tsx` se muestra el mensaje: `La sugerencia enviada desde la app no cambia este valor. Solo administración define y guarda el valor real aplicado.`

#### Alcance real de la validacion

- En este repositorio se valida el comportamiento del `administrador web` y de la logica compartida.
- No se puede certificar la interfaz de `app movil` desde aqui porque ese codigo no esta incluido en este proyecto.
