# Órbita · simulador de vuelo por movimiento

Aplicación web de vuelo 3D con control por cuerpo, manos, teclado o giroscopio del celular. La detección se ejecuta localmente en el navegador de la computadora. Nave, cubos y efectos son provisionales para poder sustituir el arte después.

Esta actualización prioriza fluidez en laptop: métricas reales, memoria reutilizada, preparación de modelos y gráficos, resolución adaptativa y mando directo con respaldo por servidor. No promete un número de FPS o una latencia sin medir el dispositivo real.

## Requisitos e instalación

- Node.js 20.19 o posterior; Chrome o Edge moderno con WebGL 2 y aceleración gráfica.
- Webcam para gestos. Teléfono con sensores de orientación para mando móvil.
- HTTPS para dispositivos remotos; `localhost` sirve para probar en la computadora.

```sh
git clone https://github.com/gasteluivan/simulador-de-vuelo.git
cd simulador-de-vuelo
npm ci
npm run dev
```

Abre **http://localhost:5173**. `npm run dev` ejecuta Vite y el servidor Node.js de salas. Los modelos y archivos WASM están incluidos en `client/public`; para recuperarlos o descargarlos de nuevo:

```sh
npm run assets
```

El video permanece en la computadora; el servidor recibe señalización y controles del celular, no la imagen de cámara.

## Primera prueba

**Teclado:** selecciona Teclado, espera la preparación de gráficos y pulsa Iniciar vuelo. WASD o flechas controlan lateral/altura; `+` y `−`, potencia; espacio, turbo; `P`, pausa; Esc, regreso al panel.

**Cámara:** activa el acceso y espera la preparación de recursos y detector. En el estilo A, muestra hombros, codos y muñecas, levanta los brazos en candelabro y mantén dos segundos. Después pulsa Iniciar vuelo.

**Celular:** selecciona Celular y abre el enlace/QR desde un origen HTTPS accesible para ambos equipos. Activa sensores, centra el teléfono en posición cómoda y después inicia el vuelo en el PC.

## Cámara, esqueleto y calibración

La vista del piloto muestra video espejado, esqueleto corporal y, en C, las manos. Puedes ocultarla o reactivarla en Ajustes → Mostrar cámara y esqueleto. Ocultarla suspende el dibujo del esqueleto y mantiene la detección; Apagar cámara libera el dispositivo.

| Estilo | Postura para calibrar | Dirección y altura | Potencia |
| --- | --- | --- | --- |
| A · Candelabro / Alas | Codos doblados, muñecas encima de codos durante 2 s | Extender/bajar cada brazo dirige a su lado; elevar/bajar ambas muñecas cambia altura | Separación de muñecas |
| B · Avión | Brazos en cruz durante 2 s | Desnivel entre brazos dirige; elevar/bajar ambos cambia altura | Cambio del ancho visible de hombros al acercar/alejar el torso |
| C · Joystick con manos | Candelabro durante 2 s, luego mostrar ambas palmas | Posición de palma derecha respecto al centro inicial | Izquierda abierta acelera según altura; puño frena |

En C, el primer resultado con ambas manos visibles fija el centro del joystick. Pellizco derecho solicita turbo: 1,8 s de duración y 7 s de enfriamiento. Cambiar de estilo requiere recalibración; el modelo de manos se prepara antes de habilitar C.

Comienza aproximadamente entre 1,5 y 3 m con buena iluminación. El rango real depende de lente y encuadre: la aplicación estima distancia mediante ancho de hombros, no mide metros. Ajusta sus límites en Ajustes.

La selección inicial prioriza la persona centrada. Tras calibrar se sigue continuidad de centro y escala de hombros. Si el piloto se aleja demasiado puede exigir recalibración. No es identificación biométrica: personas superpuestas pueden confundirlo.

MediaPipe Pose utiliza índices anatómicos: 16 es muñeca derecha y 15 izquierda. Se refleja la vista, no el video que recibe el detector. Las etiquetas del modelo de manos se compensan para la entrada sin espejo. El mapeo básico está probado automáticamente; la lateralidad de manos y ergonomía requieren comprobación física.

Si faltan articulaciones, están fuera de rango o los resultados llegan con más de 750 ms de antigüedad, se rechaza el control. La nave se estabiliza y se pausa tras tres segundos sin control válido. Recupera la señal y continúa manualmente.

## Movimiento suave y mando móvil

Se utiliza `DeviceOrientationEvent`, la orientación fusionada que expone el navegador a partir de los sensores. No se integra directamente un giroscopio bruto. En iPhone, el botón Activar control solicita permiso si el navegador lo exige. No todos los dispositivos o navegadores ofrecen sensores.

- Inclina a izquierda/derecha para dirigir y adelante/atrás para altura.
- Pulsa Centrar posición al cambiar la postura cómoda.
- Elige deslizador de potencia o botones mantenidos; puedes mantener Turbo.
- El teléfono solicita vibración en impactos cuando el navegador lo permite.

Los ejes se adaptan a la orientación de pantalla. El mando filtra más el temblor pequeño y responde más rápido a movimientos deliberados. La nave aplica una transición de control breve separada de su inclinación y del seguimiento visual de cámara. El cuerpo utiliza un filtro adaptativo dependiente del tiempo entre detecciones.

### Conexión directa y respaldo

La sala se vincula mediante WebSocket autenticado por el token del QR. Después se intenta un **WebRTC DataChannel no ordenado y sin retransmisiones** para controles directos. Si no conecta, falla o no está disponible, se utiliza **WebSocket** automáticamente. El HUD y el teléfono indican Directo/Servidor.

La configuración inicial usa candidatos locales y no requiere STUN/TURN de terceros. Funciona para probar conexión directa en LAN cuando el navegador y la red lo permiten; no garantiza P2P entre redes distintas. Por Internet puede funcionar mediante el respaldo del servidor. Para ampliar P2P público se debe configurar STUN/TURN y probar restricciones de cada red.

Cada control binario ocupa 24 bytes de contenido: versión, turbo, potencia, secuencia, instante de origen y ejes. Los encabezados y la señalización agregan tráfico. Se reutiliza el buffer de envío, se rechazan secuencias antiguas y se limita la cola. Solo queda un estado pendiente, que caduca a los 250 ms. La antigüedad de tránsito se estima respecto a un mínimo observado para evitar comparar relojes de PC y teléfono como si estuvieran sincronizados; no constituye una medición absoluta de latencia de ida.

Si no llegan controles durante 1,2 s se estabiliza el vuelo; después se aplica la pausa por pérdida de control. El teléfono intenta reconectar. Si se reinicia el servidor o se desconecta el host, se crea una sala nueva y debes utilizar su nuevo QR.

## Diagnóstico de fluidez

En Ajustes activa **Mostrar diagnóstico de fluidez**. Puedes descargar un informe JSON sin video, imágenes ni tokens de sala.

| Medición | Interpretación |
| --- | --- |
| FPS reales | Calculados con intervalos reales de animación, separados del tiempo limitado de la simulación |
| Media / P95 / P99 | Tiempo entre cuadros; los percentiles ayudan a localizar tirones que una media oculta |
| Cuadros >33 ms | Cuadros lentos dentro de la ventana de hasta 240 muestras |
| Resolución | Porcentaje respecto a la resolución base del perfil |
| Envío de render CPU | Tiempo del código que actualiza escena y envía trabajo al render; **no** tiempo de ejecución GPU |
| Reciclado | Duración del último reciclado de bloque |
| Cámara | Tiempo de inferencia, captura de imagen, frecuencia de resultados y antigüedad del resultado al recibirse |
| RTT del par | Viaje completo de un mensaje PC → teléfono → PC por el transporte disponible |
| Jitter y último paquete | Variación de llegadas y tiempo desde el último control aceptado |

El informe también conserva RTT al servidor para distinguirlo del RTT entre dispositivos. Ninguno mide por sí solo todo el trayecto físico gesto → sensores → procesamiento → pantalla. Antes de la primera medición, el RTT puede aparecer en cero. Las muestras se reinician al cambiar visibilidad de la pestaña para no contar su suspensión como una caída de rendimiento.

Para comparar, usa la misma densidad y semilla, prueba teclado, luego cámara y después celular durante sesiones de duración similar. Descarga un informe en cada modo. Un resultado de navegador automatizado con GPU por software no representa el rendimiento de la laptop con aceleración real.

## Qué se optimizó

- Ocho bloques instanciados con capacidad fija de 80 cubos cada uno; la densidad inicial es 30. Se reutilizan cajas, vectores, geometría, material y buffers al reciclar o cambiar densidad.
- Los ajustes de densidad/semilla se aplican al terminar la edición o cerrar Ajustes, en lugar de reconstruir el escenario en cada paso del arrastre.
- Referencias a motores y nodos de HUD reutilizadas; valores numéricos actualizados sin reconstruir HTML continuamente.
- El lienzo del esqueleto se redimensiona solo al cambiar la resolución del video. Oculto, no se dibuja.
- Perfil laptop sin desenfoque de fondo de los paneles, sin sombras dinámicas ni posprocesado, con pixel ratio máximo base de 1,25.
- **Resolución adaptativa**, activada inicialmente: baja de forma gradual hasta el 60% de la base ante carga sostenida y recupera lentamente cuando sobra rendimiento. Se puede desactivar para comparar. No garantiza FPS si el límite está en CPU, inferencia o navegador.
- Preparación de shaders mediante `compileAsync`, descarga/validación de recursos y primer procesamiento del detector antes de habilitar vuelo.
- Colisiones por barrido contra cajas expandidas: detectan obstáculos cruzados entre posiciones, con margen conservador en esquinas. Las unidades son de simulación, no metros ni km/h.

La pose mantiene un máximo aproximado de 15 Hz con Pose Lite en Worker, con GPU y respaldo CPU. Manos utiliza CPU y solo se prepara en C. Render y detección se ejecutan por separado. El perfil Alto aumenta la resolución base y activa antialiasing tras recargar; no añade efectos pesados.

## Compilación, caché y uso sin Internet

```sh
npm run build
npm start
```

Abre **http://localhost:3001**. El build genera el manifiesto de recursos con SHA-256 y un Service Worker versionado. La aplicación, estilos, fuentes y Worker se guardan como base; los modelos y el runtime de visión se preparan al activar el modo correspondiente. La primera preparación verifica hashes de los recursos descargados. No se recargan modelos pesados como parte del vuelo ordinario.

Para preparar uso sin Internet, abre la versión compilada con conexión y activa la cámara en C para preparar cuerpo y manos. Espera a que termine. Luego podrás recargar esa misma dirección sin conexión y usar teclado o cámara si el navegador conserva la caché y mantiene los permisos. El servidor local debe seguir ejecutándose. **El mando móvil sigue requiriendo servidor/red para vincular la sala.**

La persistencia depende del espacio y políticas del navegador: puede eliminar la caché. No equivale a una instalación permanente ni garantiza cero pausas de GPU. En desarrollo no se instala Service Worker para evitar servir código antiguo durante las ediciones. Una actualización del Service Worker espera a que se cierren las pestañas anteriores, sin reemplazar el juego en pleno vuelo. Para resolver una caché problemática, usa las herramientas del navegador → Application → Service Workers/Storage y vuelve a abrir.

## Celular en red local con HTTPS

Ambos equipos deben poder acceder al mismo origen. `localhost` en el teléfono apunta al propio teléfono: no compartas ese QR. La aplicación muestra la IP de la laptop. HTTP por IP sirve para comprobar acceso, pero normalmente no habilita sensores.

Para una prueba rápida con Internet, instala Cloudflare Tunnel desde su sitio oficial:

```sh
cloudflared tunnel --url http://localhost:5173
```

Abre la dirección HTTPS generada en el PC, selecciona Celular y escanea ese QR. Conserva el túnel y `npm run dev` activos. El túnel necesita Internet; el respaldo WebSocket pasará por él y no representa latencia puramente LAN.

Para LAN sin Internet: genera con `mkcert` un certificado para la IP/nombre local, instala y confía su CA en PC y teléfono, y sirve la aplicación compilada mediante un proxy HTTPS con ese certificado. Permite el puerto elegido en el firewall para red privada. En iOS puede requerirse activar confianza completa. El campo de dirección del QR cambia el enlace, no instala certificados ni crea un túnel. No expongas Vite directamente a Internet.

## VPS y alojamiento

La laptop realiza render e inferencia. El VPS sirve archivos, salas, señalización y controles de respaldo; una GPU en el servidor no aumenta automáticamente los FPS locales. Recomiendo inicialmente un VPS cercano al lugar de uso, Docker y un dominio.

1. Copia o clona el repositorio, incluidos los modelos descargados.
2. Reemplaza `vuelo.ejemplo.com` en `deploy/Caddyfile` por tu dominio.
3. Apunta DNS al VPS y permite TCP 80/443. El puerto 3001 queda interno.
4. Ejecuta `docker compose up -d --build`.
5. Abre `https://tu-dominio` en el PC y vincula el teléfono con su QR.

Caddy configura HTTPS y WebSockets. Esta configuración no despliega automáticamente desde GitHub. No se ha contratado ni publicado un servidor por subir el código.

Las salas viven en memoria; no se comparten entre réplicas y se pierden al reiniciar. Hay ID aleatorio, token en el enlace, un mando por sala, validación de paquetes, señalización limitada y expiración tras 30 minutos sin actividad. El máximo de mensaje es 20 KB para admitir SDP; el control binario es de 24 bytes. No compartas el enlace de mando públicamente. Para uso público amplio faltan límites globales/de conexión por IP, métricas operativas y estado compartido si se escala.

Firebase Hosting puede alojar el frontend, pero el backend actual requiere un servicio Node.js con WebSocket. Separar frontend y backend o utilizar Cloud Run exige adaptar origen de conexión y estado de salas. Esa adaptación no está incluida; VPS con un solo origen evita esa complejidad inicial.

## Pruebas

```sh
npm test
npx playwright install chromium
# Con npm run dev activo en otra terminal:
npm run test:browser
```

Las pruebas unitarias y de protocolo cubren mapeo de brazos, entradas inválidas, secuencias y paquetes binarios, cola de controles, señalización, métricas sin límite artificial de FPS, adaptación de resolución, filtro y colisión por barrido.

Las pruebas de navegador cubren vuelo, persistencia, mando con orientación simulada y conexión directa, respaldo sin WebRTC, cámara simulada, cambio a manos, diagnóstico y vista móvil. Para probar también caché offline contra la versión compilada, ejecuta `npm run build` y `npm start`; en PowerShell:

```powershell
$env:TEST_BASE_URL='http://localhost:3001'
npm run test:browser
Remove-Item Env:TEST_BASE_URL
```

Verificación de esta actualización: compilación correcta, **17 pruebas de lógica/protocolo**, **5 pruebas de navegador en desarrollo** y **6 pruebas de navegador contra la versión compilada**, incluida recarga offline con cuerpo y manos. Cámara y orientación de estas pruebas son simuladas; no sustituyen la validación física.

Pendiente de validación física: gestos/manos con webcam real, ergonomía, orientación de pantalla Android/iPhone, vibración, comportamiento con pérdida de Wi-Fi, latencia y FPS sostenidos del equipo destino. No se atribuyen mejoras porcentuales sin comparar mediciones equivalentes.

## Organización

- `client/src/scene.ts`: nave, bloques reutilizados, render y resolución adaptativa.
- `client/src/collision.ts`: barrido de colisiones.
- `client/src/performance.ts`: métricas y política de resolución.
- `client/src/vision.ts`, `vision.worker.ts`: cámara, dibujo, preparación e inferencia.
- `client/src/gestures.ts`: calibración y tres mapeos.
- `client/src/link.ts`, `remote.ts`: transportes y mando móvil.
- `client/src/resources.ts`, `scripts/offline.mjs`: preparación, manifiesto y caché compilada.
- `shared/`: contrato de control, filtro y protocolo binario.
- `server/index.ts`: salas, señalización, retransmisión y archivos compilados.
- `deploy/`, `Dockerfile`, `compose.yaml`: base para VPS.
- `ANALISIS.md`: resolución inicial del documento maestro.
- `AUDITORIA_ARQUITECTURA_Y_OPTIMIZACION_ALTA_GAMA.md`: auditoría externa como referencia; sus cifras de rendimiento son propuestas, no resultados medidos.

## Mejoras posteriores

Medir primero en la laptop real y ajustar los filtros con el usuario. Después: modelos GLB, materiales definitivos, bloom moderado, estelas y nebulosas con niveles de detalle, perfiles gráficos adicionales y origen flotante para sesiones largas. WebGPU, Pose Full/Heavy, altas frecuencias de detección y efectos costosos deben evaluarse por separado. WebCodecs/MediaStreamTrackProcessor requiere detección de compatibilidad y una ruta de respaldo; no sustituye universalmente la captura actual.

Para crecimiento del servicio: STUN/TURN configurable, salas compartidas, límites de conexión y métricas. Un empaquetado Tauri sería una opción de distribución; no garantiza por sí solo más FPS.

Referencias: [MediaPipe Pose Web](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js), [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer), [WebRTC](https://www.w3.org/TR/webrtc/), [Service Workers](https://www.w3.org/TR/service-workers/).
