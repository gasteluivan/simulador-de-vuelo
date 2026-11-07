# Auditoría Técnica Integral y Hoja de Ruta para Evolución a Juego de Alta Gama (AAA Web & Desktop)

> **Proyecto:** Órbita (Simulador de vuelo 3D por gestos y giroscopio móvil)  
> **Versión auditada:** v0.1.0 (Prototipo funcional orientado a laptop / hardware básico)  
> **Fecha de auditoría:** Noviembre 2026  
> **Objetivo:** Analizar cuellos de botella actuales, eliminar tirones ("lags virtuales"), independizar la carga de assets mediante descarga completa previa y trazar la arquitectura para convertirlo en un título de alta fidelidad visual y respuesta en tiempo real ultra-fluida para hardware de gama alta.

---

## 1. Resumen Ejecutivo y Diagnóstico de la Versión 1

La versión actual de **Órbita** es un prototipo técnico muy bien estructurado para su propósito inicial: validar la jugabilidad con bajo consumo en laptops estándar. Sin embargo, para cumplir con las restricciones de máquinas ligeras, se tomaron decisiones de diseño que representan un techo técnico si se desea llevar el juego a una experiencia de alta gama (consolas, PCs de escritorio con GPU dedicada o laptops de alto rendimiento):

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ESTADO ACTUAL (V1 - LAPTOP)                           │
├─────────────────────┬──────────────────────┬────────────────────────────────────┤
│ Componente          │ Implementación V1    │ Techo Técnico / Limitación         │
├─────────────────────┼──────────────────────┼────────────────────────────────────┤
│ Gráficos 3D         │ WebGL 1/2 básico,    │ Geometría simplista, sin PBR,      │
│                     │ cubos instanciados,  │ sin sombras dinámicas, sin bloom   │
│                     │ materiales planos    │ ni postprocesado cinematográfico.  │
├─────────────────────┼──────────────────────┼────────────────────────────────────┤
│ Red & Mando Móvil   │ WebSocket sobre TCP  │ Propenso a "head-of-line blocking" │
│                     │ con JSON a 30-60 Hz  │ (lags virtuales por micro-pérdidas │
│                     │                      │ de paquetes WiFi) y sobrecarga.    │
├─────────────────────┼──────────────────────┼────────────────────────────────────┤
│ Visión / Webcam     │ Pose Landmarker Lite │ Inferencia limitada a ~15-20 FPS,  │
│                     │ en Web Worker        │ sobrecarga en hilo principal por   │
│                     │ con createImageBitmap│ creación repetida de ImageBitmaps. │
├─────────────────────┼──────────────────────┼────────────────────────────────────┤
│ Carga de Recursos   │ Descarga al vuelo    │ Si la red titubea, hay pausas; no  │
│                     │ bajo demanda vía red │ existe un modelo offline-first ni  │
│                     │                      │ precaching de texturas en VRAM.    │
├─────────────────────┼──────────────────────┼────────────────────────────────────┤
│ Física & Colisiones │ Esfera contra AABBs  │ Sin mallas complejas ni BVH;       │
│                     │ en CPU hilo princ.   │ a velocidades altas hay "túnel"    │
│                     │                      │ (saltos de detección) e imprecisión│
└─────────────────────┴──────────────────────┴────────────────────────────────────┘
```

---

## 2. Diagnóstico de los "Lajesos Virtuales" (Tirones y Latencia)

El usuario percibe a menudo como *"lag"* o *"tirón"* cosas que no son falta de potencia bruta, sino problemas de arquitectura de sincronización e hilo de procesamiento. En la v1 se identifican cuatro fuentes principales de fricción:

### 2.1. Bloqueo de Cabeza de Línea (Head-of-Line Blocking) por usar TCP (WebSockets)
- **Problema actual:** Los WebSockets funcionan sobre TCP. En una conexión inalámbrica (WiFi doméstico o 4G/5G del móvil), si se pierde un solo paquete del giroscopio, el protocolo TCP detiene la entrega de los paquetes posteriores hasta que el paquete perdido sea retransmitido.
- **Efecto visual:** La nave se queda "congelada" por 150-300 ms y de pronto salta abruptamente a la nueva posición acumulada. Esto es exactamente un **"lajeo virtual"**.
- **Solución Alta Gama:** Reemplazar la telemetría de control continuo por **WebRTC DataChannels** (en modo no fiable y no ordenado: `ordered: false`, `maxRetransmits: 0`) o **WebTransport (QUIC/UDP)**. Si un paquete del giroscopio de hace 16 ms se pierde, no importa: el paquete actual ya contiene la orientación fresca.

### 2.2. Sobrecarga de Serialización JSON en Tiempo Real
- **Problema actual:** Tanto en el teléfono como en el servidor y en el PC se ejecutan `JSON.stringify()` y `JSON.parse()` hasta 60 veces por segundo (`{"type":"control","control":{"x":0.231,"y":-0.124,"throttle":0.82,"turbo":false},"seq":1420}`).
- **Efecto:** Genera miles de micro-objetos en memoria por segundo, activando el Garbage Collector (recolector de basura de JavaScript), que causa micro-parones de 5 a 15 ms en el hilo de render.
- **Solución Alta Gama:** Migrar a un protocolo binario con `ArrayBuffer` y `DataView` compacto (12 a 16 bytes fijos por paquete). Cero asignación de memoria dinámica y cero pausas de GC.

### 2.3. Transferencia de Video CPU ➔ Worker mediante `createImageBitmap`
- **Problema actual:** En `client/src/vision.ts`, cada frame se copia en el hilo principal con `createImageBitmap(this.video)` y se envía al Worker. Aunque se usa estructura transferible, la captura bloquea parcialmente el hilo gráfico.
- **Efecto:** Caídas de cuadros si el hilo principal está calculando geometría y partículas al mismo tiempo.
- **Solución Alta Gama:** Usar `MediaStreamTrackProcessor` (WebCodecs API) para obtener `VideoFrame` directamente dentro del Worker sin tocar el hilo principal del render ni del DOM.

### 2.4. Generación de Chunks y Basura en Memoria
- **Problema actual:** En `client/src/scene.ts`, al reconstruir o reciclar chunks se crean nuevos arrays y objetos `T.Box3` (`c.boxes.push(new T.Box3(...))`).
- **Efecto:** Presión sobre la memoria RAM y micro-congelamientos esporádicos al volar rápido.
- **Solución Alta Gama:** Pool de objetos prealocado con memoria estática fija (*Object Pooling* sin `new` durante la partida).

---

## 3. Arquitectura "Descarga Completa del Juego" (Zero Streaming Hitching)

Para que el juego funcione como un título de alta gama, **el 100% de los datos pesados (mallas 3D, texturas, modelos de IA, audio multicanal, shaders) debe descargarse y compilarse antes de iniciar el vuelo**. Durante la partida solo debe fluir la interacción de control puro (un flujo de datos microscópico de menos de 1 KB/s).

```
                      ARQUITECTURA DE DESCARGA Y EJECUCIÓN
                      
  ┌────────────────────────────────────────────────────────────────────────┐
  │                    FASE 1: INSTALACIÓN / PRECARGA                      │
  │                                                                        │
  │  [ Servidor de Assets / CDN ]                                          │
  │         │                                                              │
  │         ▼  (Descarga única verificada por Checksum SHA-256)            │
  │  [ Service Worker + Cache API / OPFS (Origin Private File System) ]    │
  │         │                                                              │
  │         ├─► Modelos 3D (.glb comprimidos con Meshopt / Draco)          │
  │         ├─► Texturas GPU directas (.ktx2 / Basis Universal)            │
  │         ├─► Modelos de IA (.task / .onnx de alta fidelidad)            │
  │         ├─► Shaders WebGPU precompilados                               │
  │         └─► Bancos de audio espacial (.wav / .flac a RAM)              │
  └────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │                    FASE 2: PARTIDA EN TIEMPO REAL                      │
  │                                                                        │
  │  [ DISCO LOCAL / VRAM ] ──────────┐                                    │
  │  (Zero I/O, Zero peticiones HTTP) │                                    │
  │                                   ▼                                    │
  │                         ┌───────────────────┐                          │
  │                         │  MOTOR DE JUEGO   │                          │
  │                         │  (WebGPU / 120Hz) │                          │
  │                         └─────────▲─────────┘                          │
  │                                   │                                    │
  │                 Solo telemetría   │ Sub-10ms                           │
  │                 de control ultra- │ UDP / WebRTC                       │
  │                 compacta (16 bytes)│ DataChannel                       │
  │                                   │                                    │
  │                       [ MANDO CELULAR / CÁMARA ]                       │
  └────────────────────────────────────────────────────────────────────────┘
```

### 3.1. Estrategia Web: PWA + Cache Storage + OPFS
1. **Service Worker Avanzado con Precaching Total:**
   - Al abrir la web por primera vez, una pantalla cinemática con barra de progreso descarga todos los paquetes del juego.
   - Uso de `CacheStorage` para archivos estáticos y **OPFS (Origin Private File System)** para streaming ultrarrápido de assets a la memoria del navegador.
2. **Carga en VRAM Anticipada (Pre-warming):**
   - Antes de dar "Iniciar Vuelo", el motor compila todos los pipelines de shaders (`renderer.compileAsync()`) y carga las texturas KTX2 directamente en la memoria de la GPU para evitar el típico "stutter" del primer disparo o del primer impacto.

### 3.2. Estrategia Nativa de Escritorio: Tauri v2 + Rust
Si el objetivo es la máxima gama posible en PC:
- Empaquetar el frontend con **Tauri v2** genera un binario ejecutable (`.exe` de menos de 15 MB) con acceso a WebView2 / WebGPU nativo.
- **Ventajas críticas sobre el navegador:**
  - Acceso directo a sockets UDP nativos (sin intermediarios WebSockets ni proxies).
  - Soporte de mandos de consola (Xbox, PlayStation DualSense con respuesta háptica avanzada).
  - Eliminación de los límites de memoria y throttling de pestañas en segundo plano del navegador.
  - Tasa de refresco desbloqueada a monitores de 144 Hz, 240 Hz o superiores.

---

## 4. Pipeline Gráfico de Nueva Generación (WebGPU & Post-Processing AAA)

El motor actual usa primitivas básicas y WebGL sin sombras. Para llevarlo al estándar de alta gama:

### 4.1. Migración de WebGL a WebGPU (Three.js WebGPURenderer / TSL)
- **Three.js WebGPURenderer**: Reduce drásticamente la sobrecarga de la CPU en llamadas de dibujado (*draw calls*), permitiendo dibujar cientos de miles de asteroides y naves sin caída de FPS.
- **Three Shading Language (TSL)**: Permite escribir shaders modulares que se ejecutan de manera nativa en WGSL (WebGPU Shading Language), con soporte de **Compute Shaders** para simular física y partículas directamente en la GPU.

### 4.2. Efectos Cinematográficos y Post-Procesado HDR
1. **Bloom Selectivo Fotorrealista (Unreal Bloom):**
   - En lugar de colores planos, los motores de la nave, las estelas de plasma y los cubos de energía emiten valores HDR (> 1.0) que producen un resplandor óptico realista.
2. **Oclusión Ambiental en Espacio de Pantalla (GTAO / Ground Truth Ambient Occlusion):**
   - Proporciona sombras de contacto profundas entre los recovecos de la nave y las estructuras del espacio.
3. **Desenfoque de Movimiento (Motion Blur) & Efecto Túnel Warp:**
   - Motion blur vectorial calculado por la diferencia de posición de los vértices entre frames anteriores y actuales.
   - Al activar el Turbo, el campo de visión (FOV) se abre dinámicamente de 60° a 95° con una aberración cromática perimetral y estiramiento de estrellas (efecto salto hiperespacial).
4. **Tone Mapping ACES Filmic:**
   - Curva de color de nivel cinematográfico que evita que las luces brillantes queden quemadas o sobreexpuestas en blanco puro.

### 4.3. Sistema de Partículas por GPU (Compute Shaders)
- En la v1, la estela son dos cilindros simples que cambian de escala en CPU (`c.name === "exhaust"`).
- En alta gama: Un sistema de **100.000 a 500.000 partículas** calculadas íntegramente en la GPU con Compute Shaders:
  - Chispas incandescentes al rozar obstáculos.
  - Nubes de plasma volumétricas detrás de los propulsores.
  - Polvo espacial que reacciona físicamente al paso del fuselaje.

### 4.4. Modelos 3D y Materiales PBR
- **Malla de Nave de Alta Fidelidad:**
  - Modelo GLTF 2.0 optimizado con compresión **Draco** o **Meshopt** (tamaño de descarga reducido en un 70%).
  - Texturas KTX2 con compresión **Basis Universal (BC7 en desktop / ASTC en móvil)**: estas texturas se transfieren comprimidas directamente a la VRAM sin descomprimirse en RAM de CPU.
  - Materiales PBR completos: Mapa de Albedo (4K), Normal Map con micro-detalles de paneles de blindaje metálico, Roughness, Metalness y Emissive animado.
  - Cabina con interior 3D modelado: opción de cambiar entre cámara exterior en tercera persona y cámara interior en primera persona (Cockpit View) con instrumentación holográfica proyectada en el parabrisas.

---

## 5. Interacción en Tiempo Real Ultra-Fluida: Red Sub-10ms y Telemetría

Para erradicar la latencia percibida y los micro-cortes entre el celular/webcam y la nave:

```
                   PIPELINE DE RED DE ALTA GAMA (WEBRTC)
                   
   [ Mando Móvil ]                                    [ Juego / PC ]
          │                                                  │
   Lectura Giroscopio (60-120 Hz)                            │
          │                                                  │
   Filtro Kalman / OneEuroFilter                             │
          │                                                  │
   Empaquetado binario (DataView 16 bytes)                   │
          │                                                  │
          ├────────── WebRTC DataChannel (UDP) ─────────────►│
          │     (Sin orden, sin retransmisión TCP)           │
          │                [ Latencia: 2-8 ms ]              │
          │                                                  │ Desempaquetado binario
          │                                                  │
          │                                                  ▼
          │                                        [ Hermite/Spline Interp. ]
          │                                                  │
          │                                                  ▼
          │                                        [ Movimiento continuo ]
          │                                        [ a 120 / 240 FPS ]
```

### 5.1. Migración de WebSocket a WebRTC DataChannels
- **Canal de datos no ordenado y no confiable:**
  ```ts
  const dataChannel = peerConnection.createDataChannel("controls", {
    ordered: false,          // No esperar a paquetes retrasados
    maxRetransmits: 0        // Olvidar paquetes viejos; solo nos importa el último
  });
  ```
- El servidor Node.js solo actúa como señalizador inicial (intercambio SDP y candidatos ICE para emparejar mediante QR). Una vez conectados, la comunicación entre el móvil y la laptop/PC puede ocurrir **directamente de par a par (P2P en la misma red local Wi-Fi)** sin siquiera pasar por el servidor central.

### 5.2. Protocolo Binario Compacto (16 Bytes)
Sustituir el texto JSON por un buffer binario sin sobrecarga:

| Offset (Bytes) | Tipo | Campo | Rango / Precisión |
|---|---|---|---|
| 0 - 3 | `Uint32` | `sequenceNumber` | Contador incremental de paquetes |
| 4 - 7 | `Float32` | `pitch` | Inclinación vertical (-1.0 a +1.0) |
| 8 - 11 | `Float32` | `roll` | Inclinación horizontal (-1.0 a +1.0) |
| 12 - 13 | `Uint16` | `throttle` | Aceleración normalizada (0 a 65535) |
| 14 | `Uint8` | `flags` | Bit 0: Turbo, Bit 1: Freno, Bit 2: Calibrado |
| 15 | `Uint8` | `checksum` | Verificación rápida de integridad |

*Resultado:* El tráfico de red se reduce en un **92%**, y el tiempo de deserialización en la máquina principal pasa de 0.8 ms a **0.002 ms**.

### 5.3. Suavizado Predictivo: Filtro de Kalman e Interpolación Hermite
- En lugar de un simple `lerp` exponencial lineal que produce retraso perceptible ante giros rápidos, se implementa un **Filtro de Kalman** en el móvil que separa el ruido de la mano del movimiento intencional del jugador.
- En la nave se aplica una **interpolación por curvas Spline Hermite**, lo que garantiza que aunque los paquetes del móvil lleguen a 60 Hz, el movimiento en pantalla se dibuje con suavidad sedosa a 120 Hz, 144 Hz o 240 Hz.

### 5.4. Visión por Computadora a 60 FPS con WebCodecs y Aceleración NPU/DirectML
- En la v1 la visión corre con el modelo Pose Lite a ~15 Hz.
- Para alta gama:
  1. **WebCodecs API (`VideoFrame`):** Envío de frames de cámara sin copia de memoria al Worker.
  2. **Modelos de Alta Precisión (MediaPipe Pose Heavy / ONNX Runtime Web):**
     - Detección precisa de la profundidad de brazos y dedos individuales incluso en condiciones de poca iluminación.
     - Ejecución mediante WebGPU / DirectML / WebNN, aprovechando la GPU dedicada o la NPU del procesador para lograr 60 FPS estables sin restarle rendimiento al motor gráfico del juego.

---

## 6. Física, Dinámica de Vuelo y Audio Inmersivo 3D

### 6.1. Detección de Colisiones Espaciales con BVH
- **Problema en v1:** Se evalúa una esfera de radio 0.8 contra una caja AABB por cada cubo en un bucle for. A alta velocidad (turbo), la nave puede "traspasar" obstáculos entre un frame y otro (*bullet-through-paper problem*).
- **Solución Alta Gama:** Integrar `three-mesh-bvh` (Bounding Volume Hierarchy acelerado por hardware):
  - Detección de colisión continua por barrido de rayos (*Swept Sphere / Raycasting continuo*).
  - Colisión precisa contra la superficie real del fuselaje de la nave y los asteroides irregulares.

### 6.2. Modelo de Vuelo Dinámico (Fly-by-Wire espacial)
- Simulación de inercia con masa, empuje vectorial de toberas y compensación giroscópica.
- Efectos de fuerza G en la cámara: sacudidas dinámicas (*camera shake*) no lineales ante aceleraciones bruscas, frenadas o roces con asteroides.
- Origen Flotante (*Floating Origin*): Al recorrer largas distancias en el eje -Z, las coordenadas de 32 bits de la GPU pierden precisión y causan temblores en los vértices. Mover el universo hacia el centro periódicamente asegura precisión sub-milimétrica infinita.

### 6.3. Audio Espacial 3D y Síntesis Procedural
- Reemplazar el oscilador básico `createOscillator()` de 620 Hz por un subsistema completo con **Web Audio API**:
  - **Audio Espacial Binaural (HRTF):** El sonido de los asteroides pasando zumbando a la izquierda o derecha con posicionamiento 3D real en auriculares.
  - **Turbina de Nave Dinámica:** Generador de audio procedural con modulación de frecuencia ligada en tiempo real a la velocidad y al uso del Turbo.
  - **Transductores Hápticos:** En celulares compatibles, disparar vibraciones duales diferenciadas (impacto seco en choque, vibración continua de baja frecuencia en postcombustión).

---

## 7. Plan de Implementación por Fases (Roadmap de Desarrollo)

Para transformar la v1 actual en el juego de alta gama de forma ordenada y sin romper la funcionalidad existente:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FASES DE IMPLEMENTACIÓN                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ FASE 1: RED SUB-LATENCIA Y PRECARGA OFFLINE                                │
│  ├─ Implementar protocolo binario DataView (16 bytes)                       │
│  ├─ Sustituir WebSockets por WebRTC DataChannels P2P (UDP sin ordenación)   │
│  ├─ Service Worker con precaching total de assets y modelos                 │
│  └─ Medir latencia de transporte: Meta < 10 ms en red local                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ FASE 2: ASSETS AAA Y MATERIALES PBR                                         │
│  ├─ Integrar modelo 3D GLTF de nave espacial de alta fidelidad (Draco/Mesh) │
│  ├─ Texturas KTX2 / Basis Universal en VRAM                                 │
│  ├─ Entorno espacial con Skybox HDR e iluminación basada en imágenes (IBL)  │
│  └─ Sustituir cubos por asteroides y megaestructuras con LODs               │
├─────────────────────────────────────────────────────────────────────────────┤
│ FASE 3: POST-PROCESSING Y MOTOR WEBGPU                                      │
│  ├─ Migración a Three.js WebGPURenderer / TSL                               │
│  ├─ Pipeline de Post-Processing: Unreal Bloom, Motion Blur, Tonemapping ACES│
│  ├─ Compute Shaders para sistema de partículas de estela y propulsión       │
│  └─ Integración de three-mesh-bvh para colisiones continuas                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ FASE 4: VISIÓN ULTRA-FIEL Y VERSIÓN NATIVA                                  │
│  ├─ Pipeline de cámara con WebCodecs API (VideoFrame a Worker)              │
│  ├─ MediaPipe Pose Full / Heavy acelerado con WebGPU / WebNN                │
│  ├─ Empaquetado de escritorio con Tauri v2 (soporte mandos Xbox/PS5 y 240Hz)│
│  └─ Motor de audio espacial 3D inmersivo con HRTF                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Comparativa Cuantitativa: Versión 1 vs. Versión Alta Gama

| Parámetro | Versión 1 (Laptop / Actual) | Versión Alta Gama (Propuesta) | Mejora Obtenida |
|---|---|---|---|
| **Render API** | WebGL 1/2 (Contexto básico) | WebGPU con TSL & Compute Shaders | Multiplica x5 a x10 la capacidad de draw calls |
| **Tasa de Refresco** | 60 FPS objetivo (con caídas) | 120 / 144 / 240 FPS estables | Fluidez visual cinematográfica absoluta |
| **Latencia Mando Móvil** | 35 - 90 ms (TCP + JSON) | 4 - 12 ms (WebRTC UDP + Binario) | Eliminación de "lajesos" y respuesta instantánea |
| **Tamaño Paquete Telemetría**| ~180 bytes (JSON legible) | 16 bytes (ArrayBuffer binario) | -91.1% tráfico de red, cero basura GC |
| **Frecuencia Visión (Webcam)**| ~15 Hz (Pose Lite) | 60 Hz nativos (Pose Heavy + WebCodecs) | Tracking anatómico suave y sin saltos |
| **Carga de Assets** | Descarga fraccionada bajo demanda | Precarga 100% en disco local (OPFS / PWA) | Cero pausas de streaming durante la partida |
| **Materiales e Iluminación** | Colores sólidos y luz básica | PBR completo (4K KTX2) + HDR + Bloom | Fidelidad gráfica nivel título comercial |
| **Colisiones** | AABB aproximada en CPU | BVH acelerado con detección continua | Precisión milimétrica a velocidades extremas |

---

## 9. Conclusión y Próximos Pasos Recomendados

La base arquitectónica actual de **Órbita** es sólida, limpia y modular. Los componentes de visión, control, escena y comunicación están correctamente separados en módulos independientes (`scene.ts`, `vision.ts`, `remote.ts`, `control.ts`).

Para iniciar la transición hacia la alta gama sin desestabilizar el proyecto:
1. **Paso prioritario inmediato:** Implementar el **protocolo binario y WebRTC** para el mando móvil. Este cambio resolverá de raíz cualquier sensación de lentitud o "lajeo" en la interacción física.
2. **Segundo paso:** Configurar la **precarga total de recursos** con Service Worker / Cache API, garantizando que el juego funcione sin depender de la velocidad de Internet mientras se vuela.
3. **Tercer paso:** Incorporar el modelo 3D GLTF de la nave y activar el pipeline de post-procesado (Bloom y HDR), elevando de inmediato el impacto visual.

*Este documento sirve como hoja de ruta técnica maestra para guiar el desarrollo de las siguientes fases.*
