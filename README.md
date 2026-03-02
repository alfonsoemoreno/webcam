# Webcam Security (Vercel + Neon + Cloudflare TURN)

Aplicacion multicamara para que varios computadores actuen como host y el celular elija cual ver.

## Arquitectura

1. Vercel sirve frontend HTTPS y API serverless.
2. Neon guarda estado de senalizacion (`clients`, `messages`, `camera_hosts`).
3. Cloudflare TURN mejora conectividad WebRTC en redes complejas.

## Paso 1: Subir a GitHub

1. En local:

```bash
cd /Users/alfonsomoreno/Developer/webcam
git init
git add .
git commit -m "Initial webcam app for Vercel + Neon + Cloudflare"
```

2. Crea un repo vacio en GitHub, luego:

```bash
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git branch -M main
git push -u origin main
```

## Paso 2: Crear base en Neon

1. Crea proyecto en Neon.
2. Copia `DATABASE_URL`.
3. En SQL Editor de Neon ejecuta el schema de [db/schema.sql](/Users/alfonsomoreno/Developer/webcam/db/schema.sql).

## Paso 3: Configurar TURN en Cloudflare

1. En Cloudflare Realtime TURN crea una API key.
2. Te entregara:
- `Token ID`
- `API Token`
3. En Vercel usa esos valores como:

- `TURN_KEY_ID` = Token ID
- `TURN_KEY_API_TOKEN` = API Token
- `TURN_TTL_SECONDS` = `86400` (opcional)

La app genera credenciales TURN temporales automaticamente desde `/api/rtc-config`.

## Paso 4: Desplegar en Vercel

1. Importa el repo de GitHub en Vercel.
2. En `Environment Variables` agrega:

- `DATABASE_URL`
- `TURN_KEY_ID`
- `TURN_KEY_API_TOKEN`
- `TURN_TTL_SECONDS` (opcional)

3. Deploy.

## Paso 5: Uso

1. En cada computador host abre: `https://TU_APP_VERCEL/host.html`
2. Define:

- `Camara` (nombre visible)
- `ID camara` (unico: sala, entrada, cocina)

3. Pulsa `Iniciar camara` y permite camara/microfono.
4. En celular abre: `https://TU_APP_VERCEL/viewer.html`
5. Selecciona camara desde la lista.

## Variables locales

Puedes copiar [.env.example](/Users/alfonsomoreno/Developer/webcam/.env.example) a `.env.local` para pruebas.

## Notas tecnicas

1. Video y audio via WebRTC.
2. La app funciona en HTTPS sin hacks de Chrome.
3. Si no hay TURN, algunas redes no conectaran aunque STUN este activo.
