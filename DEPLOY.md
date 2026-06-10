# Deploy a Vercel (Serverless)

La API está lista para correr como **Vercel Serverless Function**. Toda la app Express se monta en un solo handler en `api/index.ts`, y `vercel.json` reescribe cualquier ruta a esa función.

## Estructura relevante

```
api/index.ts          ← entrypoint serverless (Vercel)
src/app.ts            ← app Express (sin listen) — usado por ambos entornos
src/index.ts          ← entrypoint local (npm run dev)
vercel.json           ← rewrites + config de la función
```

## ¿Por qué funciona en serverless?

- `@neondatabase/serverless` usa HTTP/WebSocket (no TCP persistente), ideal para funciones de corta vida.
- Drizzle con `neon-http` no abre pools — cada invocación crea su consulta y termina.
- No usamos `app.listen()` en producción: Vercel invoca la app como handler `(req, res)`.
- El módulo de la app es **idempotente y stateless**: se reusa entre invocaciones calientes (warm starts).

## Pasos

1. **Crear proyecto en Vercel** apuntando a este repo (`MobelTech-API`).
2. En *Project Settings → Environment Variables* agregar:
   - `DATABASE_URL` (cadena de conexión Neon — usa la variante `?sslmode=require`)
   - `JWT_SECRET`
   - `JWT_EXPIRES_IN` (opcional, default `7d`)
   - `CORS_ORIGIN` — lista separada por comas, ej:
     `https://mobeltech-front.vercel.app,http://localhost:3000`
   - `NODE_ENV=production`
3. **Deploy**. Vercel detecta `api/index.ts` y `vercel.json` automáticamente; no hace falta `build`.
4. Health check: `https://<tu-api>.vercel.app/health`.
5. Endpoints API: `https://<tu-api>.vercel.app/api/...`.

## Frontend (Next.js)

En el proyecto del front, define:

```
NEXT_PUBLIC_API_URL=https://<tu-api>.vercel.app
```

y úsalo en los fetchs (`${process.env.NEXT_PUBLIC_API_URL}/api/...`). Asegúrate que el dominio del front esté listado en `CORS_ORIGIN` de la API.

## Migraciones de DB

Las migraciones de Drizzle **no** se ejecutan en runtime serverless. Corre localmente:

```bash
npm run db:generate    # crea migraciones a partir del schema
npm run db:push        # aplica directo a Neon (dev)
npm run db:migrate     # aplica migraciones generadas (prod)
```

apuntando a la `DATABASE_URL` de producción cuando toque.

## Limitaciones a tener en cuenta

- **Cold starts**: primer hit tras inactividad puede tardar ~500-1500ms.
- **Timeout**: configurado a 30s en `vercel.json` (plan Hobby permite hasta 10s; ajusta si hace falta).
- **Sin estado en memoria** entre invocaciones: nada de caches in-process largos, sesiones en RAM, etc.
- **Tamaño**: el bundle de la función debe pesar < 50MB comprimido. Express + Drizzle + Neon caben sin problema.
