# Sorteo IG

Elige **2 ganadores distintos** entre quienes comentaron una publicación o reel de Instagram. Cada persona cuenta una sola vez, aunque haya comentado varias veces. Puedes repetir el sorteo y cambiar de URL las veces que quieras.

La app se ejecuta **en tu computadora** y lee los comentarios con **tu propia sesión de Instagram**. No necesita servicios de pago ni se puede publicar como sitio público: fuera de tu equipo, la API responde `403`.

## Requisitos

- [Node.js](https://nodejs.org/) 20 o superior (probado con Node 22)
- [pnpm](https://pnpm.io/installation)
- Google Chrome o Microsoft Edge instalado
- Una cuenta de Instagram

## Instalación

```bash
pnpm install
pnpm dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Cómo hacer un sorteo

1. Haz clic en **Conectar Instagram** y luego en **Iniciar sesión en navegador**. Tienes 3 minutos para entrar en la ventana que se abre. Solo hace falta una vez, mientras la sesión siga vigente.
2. Pega la URL de la publicación (`/p/...` o `/reel/...`) y presiona **Obtener comentarios**. Puede tardar un par de minutos.
3. Compara **Comentarios leídos** con el total que muestra Instagram. Si aparece una alerta amarilla, la lista puede estar incompleta: resuélvelo antes de sortear.
4. Presiona **Elegir 2 ganadores**. Puedes activar **No repetir ganadores de rondas previas** para hacer más rondas.

Para probar sin conectar una cuenta, usa **Probar con publicación de ejemplo** o **Pegar comentarios manualmente** (`@usuario: comentario`, CSV o JSON).

## Riesgos que debes conocer

- **Tu cuenta:** Instagram no ofrece una API oficial para leer comentarios de cualquier publicación. La app automatiza un navegador con tu sesión, oculta algunas señales de automatización y eso puede incumplir sus términos. Instagram podría limitar o bloquear la cuenta, así que es preferible usar una secundaria.
- **Tu sesión:** queda sin cifrar en `.ig-session/`, que da acceso a tu cuenta. No compartas esa carpeta. Ya está en `.gitignore`; para borrarla, usa **Cerrar sesión guardada**.
- **Publicaciones visibles:** solo se pueden leer las que tu cuenta puede ver.
- **Cambios en Instagram:** la extracción depende de cómo funciona hoy su sitio y puede dejar de funcionar sin aviso.

## Seguridad local

`pnpm dev` y `pnpm start` escuchan solo en `127.0.0.1`. La API de Instagram rechaza las solicitudes que no estén dirigidas a esta máquina o que vengan de otro sitio web. Por eso, tampoco funciona desde otro dispositivo de tu red.

## Pruebas

```bash
pnpm test
```
