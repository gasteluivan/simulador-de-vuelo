# Resolución técnica del documento maestro

## Prioridad de esta primera versión

Validar la experiencia completa con una laptop: ver el propio cuerpo, calibrar, dirigir una nave con movimientos suaves y alternar a un mando de celular. El arte es temporal; las geometrías y los materiales se concentran en `client/src/scene.ts` para sustituirlos después.

## Distribución del trabajo

| Componente | Dónde se ejecuta | Motivo |
| --- | --- | --- |
| Escena, nave, colisiones y HUD | Navegador de la laptop | Respuesta visual inmediata; no requiere GPU en el servidor |
| Cámara, cuerpo y manos | Worker del navegador de la laptop | El video permanece local y la inferencia no bloquea directamente el bucle de render |
| Orientación y controles táctiles | Navegador del celular | Acceso a sensores tras autorización del usuario |
| Salas y retransmisión | Node.js local o VPS | Vincular PC y teléfono mediante WebSocket |
| HTTPS | Túnel/certificado local o Caddy en VPS | Habilitar permisos de cámara y sensores en orígenes remotos |

## Resolución de requisitos

| Área | Implementación inicial | Qué falta validar o ampliar |
| --- | --- | --- |
| Nave espacial | Geometrías simples, motores emisivos, inclinación y cámara suave | Modelo y dirección artística definitivos |
| Universo | Ocho chunks reciclados, semilla y cubos instanciados | Pruebas largas y origen flotante |
| Colisiones | Esfera contra AABB, impacto, contador y penalización | Ajustar margen con el modelo definitivo |
| Candelabro A | Diferencia de ángulos, muñecas para altura/separación para potencia | Prueba corporal de ergonomía y sensibilidad |
| Avión B | Desnivel de muñecas, elevación conjunta y escala del torso | Medir estabilidad de la potencia según distancia |
| Manos C | Dos manos, palma derecha como joystick, puño/palma izquierda y pellizco | Precisión de lateralidad y oclusiones en cámara real |
| Calibración | Dos segundos de pose estable, referencia neutra y recalibración | Ajustar tolerancias para distintas anatomías |
| Distancia | Proxy de ancho de hombros con límites configurables | No convertir a metros sin referencia física |
| Piloto | Elección centrada y continuidad espacial/escala tras calibrar | No garantiza identidad cuando dos personas se superponen |
| Cámara visible | Video espejado, esqueleto corporal/manos y diagnóstico; opción de ocultarlo | Verificación visual con persona real |
| Pérdida de señal | Control neutro y pausa tras tres segundos | Afinar los tiempos durante pruebas de uso |
| Giroscopio | Orientación fusionada del navegador, centro y adaptación de ejes de pantalla | Validar Android, iPhone y cambio físico vertical/horizontal |
| Suavidad | Zona muerta, curva progresiva y filtros exponenciales en mando y nave | Ajustar latencia percibida con cada teléfono |
| Conexión | QR, token aleatorio, un mando, secuencias y reconexión | Ensayo en Wi-Fi y por Internet |
| Latencia | RTT al servidor, etiquetado como tal | Medir también el recorrido completo gesto → imagen |
| Persistencia | Ajustes locales | No se requieren cuentas en esta etapa |
| Despliegue | Build Node.js y Docker Compose con Caddy | DNS, VPS y certificado real pendientes de elección/despliegue |

## Presupuesto visual inicial

No se aplican sombras dinámicas, bloom, reflejos en tiempo real ni texturas de gran tamaño. El detalle depende de geometría simple, colores, niebla y luz. La pose se limita aproximadamente a 15 Hz; el render busca 60 FPS de forma independiente. Es un objetivo de diseño, no una medición confirmada en el equipo destino.

Los modelos y archivos WASM se descargan al proyecto para evitar depender de una CDN al abrir la cámara. Las manos se cargan únicamente al seleccionar C. El perfil laptop limita la resolución; el perfil alto aumenta la resolución y habilita antialiasing al reiniciar la página.

## Siguiente validación con dispositivos reales

1. Probar A frente a la cámara con brazos completos visibles; confirmar derecha/izquierda.
2. Ajustar rango y registrar FPS sostenidos con cámara activa.
3. Probar B y C, incluidos puño, palma y pellizco.
4. Abrir PC y celular en el mismo origen HTTPS; centrar sensores y recorrer el rango de inclinación.
5. Ajustar filtros y sensibilidad según comodidad, observando retraso y temblor.
6. Simular pérdida de cámara, pantalla apagada del celular y caída de Wi-Fi.
7. Medir RTT y respuesta visual en LAN y en el VPS candidato antes de fijar alojamiento.

## Mejoras para una computadora más potente

Incorporarlas como perfiles opcionales y medir cada costo: nave GLB, materiales más detallados, bloom de resolución reducida, sombras limitadas por distancia, estelas con partículas y nebulosas con niveles de detalle. Pose Full y mayor frecuencia de detección requieren presupuesto aparte de GPU/CPU; mejorar el arte y aumentar la inferencia a la vez puede reducir los FPS.

Para crecimiento del servicio: salas compartidas con Redis/pubsub, límites de conexión, métricas y despliegue con varias instancias. Firebase puede incorporarse para cuentas/persistencia o alojamiento estático, pero ese trabajo no es necesario para comprobar la interacción inicial.
