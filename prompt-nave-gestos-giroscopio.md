# Prompt maestro: Simulador de nave 3D controlada por gestos (cámara) o giroscopio (celular)

> Copia todo lo que está debajo de la línea y pégalo en tu IA de programación (Claude Code, Cursor, etc.).

---

## ROL

Actúa como desarrollador senior de gráficos 3D y visión por computador en la web. Construye una aplicación web completa, funcional y lista para ejecutar localmente. Si algo es ambiguo, toma la decisión más razonable, anótala en el README y continúa; solo pregunta si es un bloqueo real.

## OBJETIVO

Un simulador 3D en el navegador donde el usuario pilota una nave por un escenario aleatorio de cubos, con **dos métodos de control intercambiables**:

1. **Control por cámara**: reconocimiento de brazos/manos (mano izquierda y derecha) con la webcam.
2. **Control por celular**: el celular actúa como control remoto usando su giroscopio, en tiempo real, entrando a un link o escaneando un QR.

## STACK SUGERIDO

- Frontend: **Vite + TypeScript + Three.js**.
- Visión: **MediaPipe Tasks Vision** (`PoseLandmarker` para brazos/hombros/codos/muñecas y `HandLandmarker` para gestos de dedos). Ejecutar en el navegador con GPU delegate y cámara frontal.
- Tiempo real: **Node.js + Express + `ws` (WebSocket)** en un servidor propio.
- QR: librería `qrcode` (generar en pantalla del PC).
- Todo en un solo repo con `npm run dev` que levante frontend y servidor juntos.

---

## 1. ESCENA 3D Y NAVE

- Nave low-poly construida con geometrías básicas de Three.js (sin assets externos), con inclinación visual (roll/pitch) que responde al control, estela o partículas simples y luz direccional + niebla para dar profundidad.
- Cámara en tercera persona siguiendo a la nave con suavizado (lerp).
- La nave avanza automáticamente hacia adelante (eje -Z) a una velocidad base; el usuario controla lateral, altura y velocidad.
- HUD: velocidad, altitud, modo de control activo, estado de detección, FPS y latencia (en modo celular).

## 2. ESCENARIO ALEATORIO DE CUBOS

- Generación **procedural infinita por chunks**: cubos de tamaño, posición, rotación y color aleatorios (semilla configurable para reproducir un mismo escenario).
- Reciclar chunks: crear delante de la nave, eliminar o reutilizar los que quedan atrás (usar `InstancedMesh` para rendimiento, objetivo 60 FPS).
- Densidad y rango de tamaño configurables en un panel.
- Detección de colisión simple (AABB o esfera contra cubos): al chocar, efecto visual, pequeña penalización de velocidad y contador de choques. Opción para activar/desactivar colisiones.
- Suelo o grilla de referencia y algunos cubos grandes lejanos como puntos de referencia.

---

## 3. MODO CÁMARA: TRES IDEAS DE INTERACCIÓN

Crear un menú para elegir entre las tres. Todas comparten la **pose inicial "candelabro"**: ambos brazos arriba, codos doblados ~90°, antebrazos verticales, muñecas por encima de los codos. Esa pose es la posición neutra (calibración).

### Idea A: "Candelabro / Alas" (la idea principal)

- **Dirección (izquierda/derecha):**
  - Estirar o bajar el brazo derecho hacia el lado derecho → la nave se mueve a la derecha.
  - Estirar o bajar el brazo izquierdo hacia el lado izquierdo → la nave se mueve a la izquierda.
  - Cálculo: ángulo de cada antebrazo respecto a la vertical (codo→muñeca). La diferencia de ángulos (derecho − izquierdo) da el giro lateral, con zona muerta del ~10%.
- **Subir/bajar la nave:** subir ambas muñecas a la vez por encima de la altura neutra → sube; bajar ambas → baja (relativo a la altura de hombros calibrada).
- **Velocidad:** distancia entre ambas muñecas. Muñecas juntas = frenar/lento, separadas = rápido. Mapear con curva suave entre mínimo y máximo.

### Idea B: "Avión" (brazos extendidos horizontales)

- Posición neutra: brazos extendidos en cruz a la altura de los hombros.
- **Giro (roll):** inclinación de la línea entre ambas muñecas. Brazo derecho abajo / izquierdo arriba → gira a la derecha, y viceversa.
- **Subir/bajar (pitch):** mover ambos brazos al mismo tiempo hacia arriba por encima de los hombros → sube; hacia abajo → baja.
- **Velocidad:** inclinación del torso hacia adelante (hombros más cerca de la cámara = acelerar) o hacia atrás (frenar), usando el cambio del ancho de hombros.

### Idea C: "Joystick con manos" (gestos de dedos)

- Usar `HandLandmarker` para identificar mano izquierda y mano derecha por separado.
- **Mano derecha = dirección y altura:** posición de la palma en pantalla como joystick (X = lateral, Y = subir/bajar) respecto al punto neutro calibrado.
- **Mano izquierda = velocidad:** palma abierta = acelerar, puño = frenar, y altura de la mano para dosificar la velocidad (más arriba = más rápido).
- Gesto extra opcional: pellizco (pulgar-índice) = turbo temporal con enfriamiento.

### Reglas comunes para los tres modos

- **Suavizado:** filtro de media móvil o *One Euro Filter* sobre los landmarks para evitar temblor.
- **Zona muerta + curva de respuesta** (no lineal) para precisión fina cerca del centro.
- **Calibración:** al detectar la pose inicial por 2 segundos, guardar valores neutros (altura de hombros, ángulos, distancia de muñecas). Botón para recalibrar.
- **Cámara espejada:** corregir la lateralidad. Asegurar que "mi derecha" en la vida real = derecha en pantalla (MediaPipe etiqueta Left/Right desde la perspectiva de la imagen; verificarlo y documentarlo).
- Mostrar en una esquina un **preview de la cámara con el esqueleto dibujado** y un panel de debug con los valores (ángulos, altura, velocidad calculada).

---

## 4. DETECCIÓN DE LA PERSONA Y RANGO DE DISTANCIA

- Estimar la distancia con una proxy sin hardware extra: **ancho de hombros normalizado** (distancia entre landmarks 11 y 12 / ancho del frame) y/o altura de la cabeza al torso.
- Definir un **rango válido moderado** (aprox. 1.5 a 3 metros de la cámara) y configurarlo con un control de calibración, ya que la proxy es aproximada.
- Estados con mensaje visible en pantalla y aviso sonoro corto:
  - `Buscando persona...` (nadie detectado)
  - `Persona detectada ✓` (aviso al detectarla por primera vez) → empieza a guiar para calibrar.
  - `Acércate` / `Aléjate` (fuera de rango, con indicador visual de barra).
  - `Listo: en rango ✓` → habilita el control.
  - `Persona perdida` → la nave se pone en piloto automático estable (sin giros) y pausa tras 3 segundos.
- Si hay varias personas, **bloquear al piloto**: la más centrada/cercana al momento de la calibración, y ignorar a las demás.
- Solo aceptar el control cuando brazos y hombros tengan visibilidad suficiente (`visibility` > 0.6).

---

## 5. MODO CELULAR: GIROSCOPIO COMO CONTROL REMOTO EN TIEMPO REAL

### Flujo

1. En el PC aparece una pantalla con un **código QR y un link corto** con un ID de sala único (ej. `https://<host>/controller?room=AB12`).
2. El usuario escanea el QR o abre el link en su celular → se abre la página del **mando**.
3. El mando pide el permiso de sensores con un botón "Activar control" (en iOS requiere `DeviceOrientationEvent.requestPermission()` tras un gesto del usuario; en Android funciona directo).
4. El PC muestra `Celular conectado ✓` y el HUD pasa a modo celular.
5. El celular envía datos de orientación por WebSocket a 30-60 Hz; el PC los aplica a la nave en vivo.

### Mapeo de movimiento

- **Inclinar el celular a izquierda/derecha (roll / gamma):** mover la nave lateralmente y girar su alabeo.
- **Inclinar hacia adelante/atrás (pitch / beta):** bajar/subir la nave.
- **Velocidad:** opción 1, **slider vertical táctil** en el mando; opción 2, botones **Acelerar / Frenar** mantenidos; ofrecer ambas y permitir elegir.
- Botón de **recalibrar**: toma la orientación actual como neutra (el usuario sostiene el celular en la posición cómoda).
- Botón de **turbo** y vibración (`navigator.vibrate`) al chocar con un cubo.

### Requisitos técnicos

- Filtrar los datos (low-pass / complementario) y enviar solo cambios relevantes; incluir timestamp para medir **latencia** y descartar paquetes antiguos.
- Reconexión automática si se cae el WebSocket; el PC muestra el estado de la conexión.
- **HTTPS obligatorio** para que los sensores funcionen en el celular: documentar en el README cómo exponerlo (por ejemplo túnel de Cloudflare, ngrok o un certificado local con `mkcert`) y cómo usar la IP de la red local.
- Seguridad básica: IDs de sala aleatorios, una sola sesión de mando por sala y expiración si no hay actividad.
- Pantalla del mando en vertical/horizontal, con feedback visual de los valores de inclinación en tiempo real.

---

## 6. UI GENERAL

- Pantalla de inicio con selector: **Cámara (A / B / C)** o **Celular (QR)**.
- Panel de ajustes: sensibilidad, zona muerta, rango de distancia, densidad de cubos, semilla, colisiones on/off, velocidad mínima/máxima.
- Persistir ajustes en `localStorage`.
- Todo el texto de la interfaz en **español**.

## 7. ENTREGABLES

- Código completo organizado por carpetas (`/client`, `/server`) con TypeScript.
- `README.md` con instalación, comandos, cómo probar cada modo, cómo habilitar HTTPS para el celular y cómo calibrar.
- Scripts `npm run dev` y `npm run build`.
- Código comentado en los puntos clave: cálculo de ángulos, filtro de suavizado, estimación de distancia y mapeo giroscopio → nave.

## CRITERIOS DE ACEPTACIÓN

- [ ] Con la pose "candelabro", el brazo derecho mueve la nave a la derecha y el izquierdo a la izquierda.
- [ ] Subida/bajada y velocidad funcionan en las tres ideas de interacción.
- [ ] Aviso claro al detectar a la persona y al estar dentro/fuera del rango de distancia.
- [ ] El escenario de cubos se genera aleatoriamente y de forma continua sin caídas de FPS.
- [ ] El celular se conecta por QR/link y controla la nave con latencia visible baja (objetivo < 100 ms en red local).
- [ ] Se puede cambiar de modo sin recargar la página.

---

## NOTAS PARA TI (no incluir en el prompt)

- La estimación de distancia por ancho de hombros es aproximada; por eso se deja el rango calibrable.
- Para probar el giroscopio necesitas HTTPS; la forma más rápida es un túnel de Cloudflare apuntando al puerto del servidor.
- Si la IA se pasa de ambiciosa, pídele que construya primero el escenario + nave + Idea A, y luego añada B, C y el modo celular por fases.
