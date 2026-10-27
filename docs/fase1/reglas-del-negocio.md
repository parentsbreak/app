# Cómo funciona Parents' Break — reglas del negocio

Aprobadas por las dueñas el 21/10/2026, con cambios del 23/10 y del 25/10/2026. Toda la app (panel de admins, asistente y app de niñeras) se construye siguiendo estas reglas. Si algo de acá cambia, se actualiza este documento primero.

## 1. Niñeras y zonas
- Cada niñera hace sittings, carsittings (traslados) o ambos. Solo recibe pedidos del tipo que hace.
- Cada niñera tiene una o varias zonas (agrupadas por barrios).
- Punta del Este tiene temporada (quincenas). Punta como única zona y sin temporada cargada = está en Punta todo el año, con marca "sin temporada cargada". La que dijo "No va" no aparece en Punta en los meses de temporada.
- Activa o inactiva. Las inactivas no se borran: quedan al fondo de cualquier lista.
- La lista de niñeras se ordena por antigüedad (fecha de la entrevista), no por nombre; las viejas sin entrevista, al final.

## 2. Precios
- La familia paga siempre su tarifa fija por hora; no cambia según la niñera ni los chicos. Traslados: precio fijo por traslado.
- Lo que cobra la niñera cambia según cantidad de chicos, antigüedad de la familia y si es fuera de Montevideo.
- Se guarda por niñera + familia. Sale de lo ya cargado en el sistema; solo si nunca se cargó, la app pide los dos precios por hora y los guarda; las próximas veces los sugiere solos.
- Redondeo: niñera sin centavos bajando el ,5 (600,5 → 600); familia subiéndolo (600,5 → 601).
- Términos y condiciones: a la familia que los aceptó se le cobra hasta la media hora siguiente del fin (5 min de tolerancia); a la niñera siempre la hora real.
- Gastos extra con foto del ticket; se elige si lo paga la familia o Parents' Break; a la niñera se le reintegra junto al pago; sin ganancia sobre la comida.
- Variantes de precio por familia (ya existe la tabla `variantes_precio`).

## 3. Lo que ve la niñera (regla dura, 25/10)
- Nunca ve plata acumulada ni pagos: no hay "mis pagos", ni aviso de pago, ni "te pagamos", ni "esta semana llevás", ni cuándo se paga. Nada que parezca un recibo de sueldo ni que muestre que se le retiene dinero. Eso lo ven solo las admins.
- En pedidos y al quedar seleccionada solo ve el precio por hora.
- De la madre ve como mucho el nombre y la inicial del apellido. Los recordatorios no nombran a la familia.
- Solo recibe mensajes si tiene un pedido.
- Los textos de la app de niñeras van en "tú" (tienes, cuéntanos, completa).

## 4. Del pedido al sitting
1. La madre escribe por WhatsApp (no cambia nada para ella).
2. La admin pega el mensaje; el asistente arma el pedido (familia —reconocida por nombre o teléfono y confirmada por la admin con un toque—, día, hora de inicio y fin aproximado, chicos y edades, zona, precio para la madre). Lo dudoso queda "a confirmar".
3. La app sugiere niñeras en orden (sección 5), con el porqué.
4. Se manda a varias a la vez por la app de niñeras (nunca por WhatsApp), cada una con su precio por hora.
5. Cada vez que una acepta, aviso instantáneo a las admins.
6. Elige la madre: la app arma un mensaje con los CV de las que aceptaron para que la admin se lo mande por WhatsApp. Pedido para el mismo día: a los 15 minutos se manda lo que haya. Para otro día: a los 30 minutos.
7. La admin marca la elegida → le llega "¡Quedaste seleccionada!"; a las otras que aceptaron, "ya se cubrió". Queda asignada en la Agenda.
8. Las admins confirman a la madre con la plantilla.
- Nada se le manda a una madre ni a una niñera sin confirmación de una admin.
- Sin respuestas a los 30 minutos: aviso a las admins para mandar a otras. Pedido de hoy sin niñera: aviso 3 horas antes.

## 5. A quién se le manda el pedido
- Se sacan de la lista: ya tiene otro sitting en ese horario; no hace ese tipo de servicio.
- Bloque 1 — ya fueron a esa casa (la zona no importa): 1) la pidió la madre, 2) favorita de la familia (más veces + mejores comentarios), 3) ya fue (más veces, más arriba).
- Bloque 2 — nunca fueron, de esa zona: 1) más sittings en general, 2) experiencia con esa edad, 3) si son 3+ chicos, las que cuidaron a varios.
- — Fuera de zona —
- Bloque 3 — nunca fueron, de otra zona: mismo orden que el bloque 2.
- Al fondo: inactivas.
- Bajan dentro de su bloque sin sacarla: marcó que ese día no puede (se le manda igual), muchos "no" seguidos, incidente o queja con esa familia, varios sittings esa semana.
- Familias que "no aceptan nuevas": solo bloque 1; si todas dicen que no, recién ahí bloques 2 y 3.

## 6. El día y después del sitting
- Recordatorios a la niñera: 24 horas antes y 1 hora antes del sitting.
- Ella marca "Estoy saliendo" / "Voy a llegar tarde", y al llegar "Ya entré" (o "Estoy afuera y no me abren" / "No encuentro la casa"). Sin rastrear ubicación.
- Al final marca "Llegaron los padres" con hora real; si no cerró a los 30 minutos, recordatorio con opción "se extendió".
- Comentarios extras (llegan al instante a las admins), calificación de la familia, si volvería, a qué jugaron.
- Cobro a la familia: horas × tarifa (con regla de términos) + gastos de la familia. Pago a la niñera: horas reales × lo guardado para esa niñera con esa familia.
- Precio cambiado a mano: la app pide motivo.

## 7. Fijos, pagos y cobros
- Fijos: se cargan solos cada noche; al día siguiente la app pregunta la hora real.
- Pagos a niñeras a mano, por transferencia, sin pagos automáticos. Los fijos se intentan pagar los sábados (de lunes a sábado); lo trabajado en domingo se paga ese domingo.
- Todos los cobros entran a una sola cuenta del negocio (Mercado Pago).
- Por cobrar: tarjeta por familia con el total; se abre el desglose y se marca sitting por sitting.
