# Textos provisorios de la fase 1 (para que los vean Paulina y Delfina)

Textos que la app necesitó y no están en `textos.md`. Los escribió Claude siguiendo las reglas de
ese archivo (en "tú", sin plata, sin suponer que quien lee es admin). Si las dueñas cambian
alguno, se corrige en el código en un PR y se mueve a `textos.md`. Se van sumando por etapa.

## Etapa 1: cuenta, invitación, instalar, avisos

Pantalla de invitación y contraseña:
- "Repite la contraseña" (segundo campo).
- "Entrarás con tu celular ••• 001 y esta contraseña." (debajo de los campos; los 3 números son los
  últimos del celular de la niñera).
- "Guardar contraseña" (botón).
- Cuando el link es para cambiar la contraseña (ya tenía cuenta): título "Crea una contraseña nueva"
  y texto "[nombre], con esta contraseña vas a entrar a la app de Parents' Break."
- Link inválido (no vencido): "Este link no es válido. Pídele uno nuevo al equipo por WhatsApp."
- Cuenta dada de baja: "Tu cuenta no está activa. Escríbenos por WhatsApp."
- Celular mal cargado en la ficha: "Tu número de celular no es válido. Avísale al equipo para
  corregirlo."
- Falla al crear la cuenta, error del servidor: "No pudimos crear tu cuenta. Avisa al equipo de
  Parents' Break."
- Falla al crear la cuenta, sin internet: "No pudimos crear tu cuenta. Revisa tu conexión a internet
  y vuelve a intentar."
- Desde un link vencido o inválido, botón "Entrar con mi celular".

Entrar:
- "Entra a tu cuenta", "Celular", "Contraseña", "Escribe tu contraseña", botón "Entrar".
- Celular mal escrito: "Revisa el número de celular".
- Contraseña incorrecta: "El celular o la contraseña no son correctos".
- Muchos intentos seguidos: "Demasiados intentos. Espera un minuto y vuelve a intentar."
- Sin internet: "No pudimos entrar. Revisa tu conexión a internet y vuelve a intentar."
- "¿Olvidaste tu contraseña?" → "Pídele un link nuevo al equipo por WhatsApp."

Instalar:
- Después de los 4 pasos: "Después de instalarla, entra con tu celular y la contraseña que creaste."
  (en el iPhone, la app instalada no comparte la sesión con Safari).
- Botón "Ya la instalé".
- En el inicio, si abrió la app en el navegador sin instalarla: "Instala la app para recibir los
  pedidos." con el botón "Ver cómo".

Avisos:
- Botón "Activar avisos" y link "Ahora no".
- "Avisos activados."
- "Los avisos siguen apagados. Actívalos en Ajustes."
- "Este celular no puede recibir avisos desde el navegador. Instala la app y ábrela desde el ícono."
- "No pudimos activar los avisos. Revisa tu conexión a internet y vuelve a intentar."

Inicio y cuenta:
- Saludo "Hola, [nombre]" (solo "Hola" si no tenemos el nombre).
- "Mi cuenta" (link al pie) → "Cerrar sesión".
- "No pudimos cerrar la sesión. Revisa tu conexión a internet y vuelve a intentar."
- "No pudimos abrir la app." (error de arranque, con "Reintentar").
- Copiar un texto cuando el celular no deja usar el portapapeles: "Cópialo de aquí", "Copiar el
  link", "Link copiado."

Mensaje de WhatsApp para cambiar la contraseña (lo manda la admin desde la ficha):
- "¡Hola [niñera]! Con este link puedes crear una contraseña nueva: [link]. Vale por [N] días."

## Etapa 2: perfil

Los títulos y campos fijos ("Completa esto una sola vez", "¿Qué servicios realizas?", "Sittings /
Carsittings / Ambos", "Zonas donde puedes tomar servicios", "Datos bancarios para pagarte") son los
de `textos.md`. Lo que se sumó:
- Debajo de los datos bancarios: "Una cuenta por renglón: banco, tipo y número (por ejemplo: BROU caja
  de ahorro 001234567)." (cada renglón es una cuenta aparte en Por pagar, con su "Copiar").
- Con más de 10 cuentas: "Puedes cargar hasta 10 cuentas."
- "Tu foto (opcional)" y debajo "La ve el equipo y, si la aprueban, pasa a tu perfil."
- Si ya mandó una foto: "Foto enviada el [dd/mm], el equipo la va a revisar."
- Al marcar Carsittings o Ambos: "Pronto vas a poder cargar los datos del auto desde aquí."
- Botón "Guardar". En "Mi perfil" (la misma pantalla para cambiar algo después), además "Volver".
- Sin zona marcada: "Elige al menos una zona." Sin servicio marcado: "Elige qué servicios realizas."
- Al guardar: "¡Listo! Tu perfil quedó guardado."
- Si la foto no es una imagen que se pueda subir (por ejemplo HEIC o un PDF): "La foto tiene que ser
  JPG o PNG."
- Si falla la foto: "No pudimos subir tu foto. Revisa tu conexión a internet y vuelve a intentar."
- Si falla el perfil: "No pudimos guardar tu perfil. Revisa tu conexión a internet y vuelve a
  intentar."
- Si no se puede abrir "Mi perfil": "No pudimos abrir tu perfil. Revisa tu conexión a internet y
  vuelve a intentar."
- En el inicio, al pie: "Mi perfil" (al lado de "Mi cuenta").

## Etapa 2: próximos sittings

En el inicio, debajo de "No tienes pedidos por ahora.":
- Título "Próximos sittings" y, mientras carga, "Cargando…".
- Los días: "Hoy", "Mañana" o el día abreviado y la fecha ("jue 30/10").
- Cada sitting: el horario ("18:00 a 22:00"; sin hora de fin, "desde las 18:00"; si termina después
  de medianoche, "22:00 a 02:00, termina al día siguiente"; sin hora, "horario a confirmar"), "Sitting"
  o "Traslado" con la zona, "Madre: [nombre + inicial]" y "Chicos: [cantidad y edades]".
- Sin sittings: "No tienes sittings próximos."
- Si no carga: "No pudimos cargar tus sittings. Revisa tu conexión a internet y vuelve a intentar." con
  el botón "Reintentar".

Al tocar un sitting (detalle):
- Arriba "Sitting" o "Traslado" y "[día], [horario]"; después "Zona:", "Madre:", "Chicos:" y
  "Dirección:" (en un traslado, "Desde:" y "Hasta:").
- Si todavía no está confirmado: "La dirección aparece el día del sitting."
- Botones "Cómo llegar" (abre el mapa con la dirección; en un traslado, con el destino) y "Agregar al
  calendario".
- En el calendario el evento se llama "Sitting Parents' Break" (o "Traslado Parents' Break"), con la
  dirección y en la descripción la madre y los chicos.

## Etapa 3: chat y avisos

En el inicio, debajo de "Próximos sittings": dos botones grandes, "Mensajes" y "Avisos", cada uno con
un número si hay algo sin leer. Los avisos de mensajes del chat no se cuentan en "Avisos" (ya están en
"Mensajes").

El chat ("Mensajes"):
- Arriba "Volver", el título "Equipo de Parents' Break" y debajo "Contáctate con una operadora de
  Parents' Break." (de `textos.md`).
- Los mensajes del equipo a la izquierda con el nombre de quien escribió; los suyos a la derecha. Cada
  uno con la hora ("10:00") o, si no es de hoy, la fecha y la hora ("03/10 10:00").
- Mientras carga, "Cargando…". Sin mensajes: "Todavía no hay mensajes."
- Si no carga: "No pudimos cargar los mensajes. Revisa tu conexión a internet y vuelve a intentar." con
  el botón "Reintentar".
- Abajo, el campo con "Escribe tu mensaje" y el botón "Enviar".
- Si falla al mandar: "No pudimos enviar tu mensaje. Revisa tu conexión a internet y vuelve a
  intentar." (lo escrito queda).
- Si el mensaje pasa de 2.000 caracteres: "Tu mensaje es muy largo. Escríbelo en partes más cortas."

Los avisos ("Avisos"):
- Arriba "Volver" y el título "Avisos". Cada aviso con su título, el texto y la hora o la fecha (como
  en el chat); los que no había leído, marcados con una raya de color al costado.
- Sin avisos: "No tienes avisos."
- Si no carga: "No pudimos cargar tus avisos. Revisa tu conexión a internet y vuelve a intentar." con
  el botón "Reintentar".

## Etapa 9: temporada y avisos

Avisos obligatorios al entrar a la app (31/10/2026):
- La pantalla "Activa los avisos" sale cada vez que entra con los avisos apagados. Ya no tiene "Ahora no":
  queda solo "Activar avisos". El link chico "Seguir sin avisos" aparece recién si activarlos falló por la
  conexión o la base (así nunca queda atrapada); vale hasta cerrar sesión o recargar la app.
- Si el permiso quedó bloqueado: título "Los avisos están bloqueados" y "Para recibir tus pedidos, actívalos
  desde los Ajustes de tu celular."
- "iPhone: Ajustes > Notificaciones > Parents' Break > Permitir notificaciones."
- "Android: mantén apretado el ícono de la app > Información de la app > Notificaciones > actívalas."
- Botón "Ya los activé" (vuelve a probar; si siguen apagados, "Los avisos siguen apagados. Actívalos en
  Ajustes.") y el mismo link "Seguir sin avisos".

La temporada en la app (31/10/2026, textos nuevos, a confirmar con las dueñas):
- Tarjeta del inicio sin cargar: "¿Dónde vas a estar esta temporada?" / "Marca dónde vas a estar cada
  quincena. Te lleva un minuto." y botón "Marcar". Al día: "Tu temporada", un renglón por lugar
  ("Punta del Este: enero y febrero completos") o "Toda la temporada en Montevideo.", y botón "Cambiar".
- Pantalla: "Ver el resto del año" / "Ocultar el resto del año", "Todo el verano en Punta", "¿Dónde?".
- Errores: "Te falta marcar 1 quincena." / "Te falta marcar N quincenas.", "Escribe dónde vas a estar.",
  "No pudimos guardar tu temporada. Revisa tu conexión a internet y vuelve a intentar.", "No pudimos abrir tu
  temporada. Revisa tu conexión a internet y vuelve a intentar." Si la base dice que falta el grupo de Punta
  (reintentar no sirve): "No pudimos guardar tu temporada. Avisa al equipo de Parents' Break." Al guardar: "¡Listo! Guardamos tu temporada."
- Toast al activar los avisos desde la pantalla obligatoria o desde "Ya los activé": "Avisos activados."
- Pantalla de temporada: encabezado "Marca dónde vas a estar cada quincena." y filas "1ra quincena de diciembre" /
  "2da quincena de diciembre" ... (de diciembre a marzo, y de abril a noviembre en "Ver el resto del año"); botones
  "Punta del Este", "Montevideo", "La Paloma", "Fuera del país", "Otro"; "Guardar" y "Volver".

Panel de las admins (voseo, 31/10/2026):
- Fila de una niñera con app en el panel de temporadas: "Se la pide la app" (en lugar de "Pedirle por WhatsApp").
- Fuente de la temporada: "la cargó ella en la app".
- Ficha de la niñera, sección "Temporada": "Sin temporada cargada" (también si es de la temporada anterior); si
  está al día, "Toda la temporada en Montevideo." o un renglón por lugar ("Fuera del país: 1ra de marzo", "Otro
  (Rocha): 2da de marzo", "La Paloma: enero") y la fuente.

## Etapa 5: pedidos (02/11/2026, esperan a las dueñas)

App de niñeras ("tú"):
- Tarjeta del pedido: "Responde lo antes posible" (cuando ya pasó la hora límite y el pedido sigue abierto).
- Pedido que ya se asignó o se canceló: "Este pedido ya no está abierto." (aviso arriba de las secciones).
- Pedido en "Esperando confirmación": "Dijiste que puedes".
- Fallas: "No pudimos cargar tus pedidos. Revisa tu conexión a internet y vuelve a intentar.", "No pudimos enviar tu
  respuesta. Revisa tu conexión a internet y vuelve a intentar.", "No pudimos guardar tus días. Revisa tu conexión a
  internet y vuelve a intentar." y "No pudimos cargar tus días. Revisa tu conexión a internet y vuelve a intentar."
- Campo "Otro motivo" (accesibilidad, no se ve): aria-label "Escribe el motivo". Si lo deja vacío, la respuesta se manda igual.

Panel de las admins (voseo):
- "Pegar WhatsApp" (Agenda): "Pegá el mensaje de la madre. Podés pegar varios mensajes seguidos.", botón "Armar pedido", error
  "Pegá el mensaje de la madre." y, sin conexión, "No se pudo conectar con el asistente: revisá internet y probá de nuevo.".
- Ticket: "Confirmá la familia ("Es esta") o elegí otra.", "Confirmá la familia para ver sus chicos.", "Elegí de la lista a la
  niñera que pidió la madre, o dejá el campo vacío.", "Esto parece [un cambio / una cancelación / otra cosa], no un pedido
  nuevo.", "No se creó nada: otra admin ya pasó este pedido a la Agenda (o lo descartó). Cerrá para ver cómo quedó.", "Falta
  actualizar la base: la solicitud se guardó sin [...] (quedan en el mensaje). Avisale a Diego."
- "Elegir niñeras": "Tildá al menos una niñera.", "Antes de mandar, resolvé las dudas del pedido.", "Falta el precio por hora de
  [niñera].", "Faltan los chicos de la familia: cargalos en su ficha.", "Este pedido no tiene una familia de la lista: para
  mandarlo por la app, la familia tiene que estar cargada.", "Por ahora, por la app solo se mandan pedidos de práctica. Para
  este, usá "Asignar" o WhatsApp.", "No se pudo leer todo el historial de las niñeras: el orden puede no ser el de siempre.".
- Errores de "Enviar a N": "No se mandó: mientras elegías, alguien asignó o canceló este pedido. Cerrá para ver cómo quedó.",
  "[Niñera] ya no puede recibir pedidos por la app: destildala.", "Hay niñeras reales tildadas junto con una de práctica.",
  "Este pedido es de un día que ya pasó.", "El precio por hora de [niñera] no es válido.", "Falta actualizar la base para mandar
  por la app: avisale a Diego.", "[Niñera] ya no está en la lista: destildala.", "Hasta 40 por vez." (también al querer tildar
  la número 41).
- Familia: casilla "No acepta niñeras nuevas"; "Se guardó lo demás. Falta actualizar la base y "No acepta niñeras nuevas" no se
  guardó. Avisale a Diego.".
- Preferencia de avisos "Pedidos de la app": "Cuando una niñera dice que puede o entra un pedido de WhatsApp".
