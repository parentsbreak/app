// Datos FICTICIOS para los tests. Nada de acá sale de la base real: nombres, teléfonos y
// cuentas son inventados. Cada test recibe una copia nueva (abrirApp hace structuredClone)
// y puede pisar cualquier tabla con sus propios datos.

const ID = {
  zPocitos: '10000000-0000-4000-8000-000000000001',
  zCarrasco: '10000000-0000-4000-8000-000000000002',
  zPunta: '10000000-0000-4000-8000-000000000003',
  fUno: '20000000-0000-4000-8000-000000000001',
  fDos: '20000000-0000-4000-8000-000000000002',
  nAna: '30000000-0000-4000-8000-000000000001',
  nBruno: '30000000-0000-4000-8000-000000000002',
  nCarla: '30000000-0000-4000-8000-000000000003',
  aFijo: '40000000-0000-4000-8000-000000000001',
  cIntake: '50000000-0000-4000-8000-000000000001',
  // Cuenta de la niñera en los tests de la app de niñeras (abrirAppNinera la ata a una niñera).
  uNinera: '00000000-0000-4000-8000-000000000002',
  // Cuenta de Carla (etapa 3, 30/10/2026): completó el perfil y escribe por el chat desde su app.
  uCarla: '00000000-0000-4000-8000-000000000003',
  // Chat y avisos (etapa 3, 30/10/2026).
  chAna1: '93000000-0000-4000-8000-000000000001',
  chAna2: '93000000-0000-4000-8000-000000000002',
  chAna3: '93000000-0000-4000-8000-000000000003',
  chCarla: '93000000-0000-4000-8000-000000000004',
  avAna: '94000000-0000-4000-8000-000000000001',
  avAnaChat: '94000000-0000-4000-8000-000000000002',
  avCarlaChat: '94000000-0000-4000-8000-000000000003',
};

function sitting(id, fecha, extra = {}) {
  return {
    id, tipo: 'sitting', registrado_por: 'Prueba', familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno',
    ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', fecha, hora_inicio: '16:00:00', hora_fin: '19:00:00',
    km: null, origen: null, destino: null, cobro_familia: 1140, pago_ninera: 750, notas: null,
    created_at: fecha + 'T22:00:00Z', termina_dia_siguiente: false, cobrado: false, pagado: false,
    fuente: 'app', asignacion_id: null, cancelado: false, ...extra,
  };
}

function datosBase() {
  return {
    zona_grupos: [
      { id: ID.zPocitos, nombre: 'Pocitos', zonas: ['Pocitos', 'Punta Carretas'], orden: 1, fuera_de_montevideo: false, created_at: '2026-09-01T00:00:00Z' },
      { id: ID.zCarrasco, nombre: 'Carrasco', zonas: ['Carrasco', 'Olivos'], orden: 2, fuera_de_montevideo: false, created_at: '2026-09-01T00:00:00Z' },
      { id: ID.zPunta, nombre: 'Punta del Este', zonas: ['Punta del Este'], orden: 3, fuera_de_montevideo: true, created_at: '2026-09-01T00:00:00Z' },
    ],
    zonas_confirmadas: [],
    familias: [
      { id: ID.fUno, nombre: 'Familia Prueba Uno', zona: 'Pocitos', telefono: '099000001', ninos: null, notas: null, created_at: '2026-09-01T00:00:00Z', direccion: 'Calle Falsa 123', cuenta_bancaria: ['0001234567'], cobro_hora: 380, pago_hora: 250, frecuencia_cobro: 'mensual', contactada_riesgo_en: null, terminos_aceptados_el: null },
      { id: ID.fDos, nombre: 'Familia Prueba Dos', zona: 'Carrasco', telefono: '099000002', ninos: null, notas: null, created_at: '2026-09-01T00:00:00Z', direccion: null, cuenta_bancaria: [], cobro_hora: 400, pago_hora: 260, frecuencia_cobro: 'semanal', contactada_riesgo_en: null, terminos_aceptados_el: null },
    ],
    // Los chicos de la familia Prueba Uno (etapa 2, 27/10/2026): uno con edad declarada y otro con
    // fecha de nacimiento, para "2 chicos (3 y 5 años)" en los próximos sittings de la niñera.
    hijos_familia: [
      { id: '21000000-0000-4000-8000-000000000001', familia_id: ID.fUno, nombre: 'Lola Ficticia', fecha_nacimiento: null, colegio: null, orden: 1, created_at: '2026-09-01T00:00:00Z', edad_declarada: 3, edad_declarada_en: '2026-09-01' },
      { id: '21000000-0000-4000-8000-000000000002', familia_id: ID.fUno, nombre: 'Nico Ficticio', fecha_nacimiento: '2021-06-15', colegio: null, orden: 2, created_at: '2026-09-01T00:00:00Z', edad_declarada: null, edad_declarada_en: null },
    ],
    // Ana sin zona ni perfil: su primer ingreso a la app de niñeras (etapa 2, 27/10/2026). Carla ya
    // completó el perfil y tiene una foto propuesta esperando a la admin. Desde la etapa 3
    // (30/10/2026) Carla tiene su cuenta (user_id y app abierta): completó el perfil y escribe por el
    // chat desde la app, y una admin solo le puede escribir a una niñera con cuenta. Ana sigue sin
    // cuenta en el panel (los tests de "Invitar a la app" la usan así); abrirAppNinera le pone la suya.
    ninieras: [
      { id: ID.nAna, candidata_id: null, nombre: 'Ana Ficticia', telefono: '098000001', zona: null, tipo: 'Niñera', foto: null, cv_url: null, notas: null, activa: true, created_at: '2026-09-01T00:00:00Z', cuenta_bancaria: ['0099887766'], carsitting_mail_enviado_at: null, cv_generado_en: null, temporada: null, temporada_actualizada_en: null, temporada_propuesta: null, temporada_propuesta_en: null, temporada_token: '60000000-0000-4000-8000-000000000001', temporada_fuente: null, temporada_comentario: null, barrios: null, telefono_pendiente: null, telefono_pendiente_en: null, user_id: null, app_activada_en: null, perfil_app_en: null, perfil_actualizado_en: null, foto_propuesta_ruta: null, foto_propuesta_en: null },
      { id: ID.nBruno, candidata_id: null, nombre: 'Bruno Inventado', telefono: '098000002', zona: 'Carrasco', tipo: 'Traslados', foto: null, cv_url: null, notas: null, activa: true, created_at: '2026-09-01T00:00:00Z', cuenta_bancaria: [], carsitting_mail_enviado_at: null, cv_generado_en: null, temporada: null, temporada_actualizada_en: null, temporada_propuesta: null, temporada_propuesta_en: null, temporada_token: '60000000-0000-4000-8000-000000000002', temporada_fuente: null, temporada_comentario: null, barrios: null, telefono_pendiente: null, telefono_pendiente_en: null, user_id: null, app_activada_en: null, perfil_app_en: null, perfil_actualizado_en: null, foto_propuesta_ruta: null, foto_propuesta_en: null },
      { id: ID.nCarla, candidata_id: null, nombre: 'Carla Ejemplo', telefono: '098000003', zona: 'Pocitos/Carrasco', tipo: 'Ambas', foto: null, cv_url: null, notas: null, activa: true, created_at: '2026-09-01T00:00:00Z', cuenta_bancaria: [], carsitting_mail_enviado_at: null, cv_generado_en: null, temporada: null, temporada_actualizada_en: null, temporada_propuesta: null, temporada_propuesta_en: null, temporada_token: '60000000-0000-4000-8000-000000000003', temporada_fuente: null, temporada_comentario: null, barrios: null, telefono_pendiente: null, telefono_pendiente_en: null, user_id: ID.uCarla, app_activada_en: '2026-10-02T14:00:00+00:00', perfil_app_en: '2026-10-02T15:00:00+00:00', perfil_actualizado_en: '2026-10-02T15:00:00+00:00', foto_propuesta_ruta: `fotos/${ID.nCarla}/propuesta.jpg`, foto_propuesta_en: '2026-10-02T15:00:00+00:00' },
    ],
    asignaciones: [
      { id: ID.aFijo, familia_id: ID.fUno, ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', cobro_hora: null, pago_hora: null, created_at: '2026-09-01T00:00:00Z', dias: ['L', 'X'], hora_inicio: '16:00:00', hora_fin: '19:00:00', vigente_desde: '2026-09-01', vigente_hasta: null, tipo: 'sitting' },
    ],
    sittings_traslados: [
      sitting('70000000-0000-4000-8000-000000000001', '2026-09-14', { cobrado: true, pagado: true }),
      sitting('70000000-0000-4000-8000-000000000002', '2026-09-16', { pagado: true }),
      sitting('70000000-0000-4000-8000-000000000003', '2026-09-28', {}),
      sitting('70000000-0000-4000-8000-000000000004', '2026-09-19', { tipo: 'traslado', familia_id: ID.fDos, familia_nombre: 'Familia Prueba Dos', ninera_id: ID.nBruno, ninera_nombre: 'Bruno Inventado', hora_inicio: '08:00:00', hora_fin: null, km: 12, origen: 'Casa', destino: 'Colegio', cobro_familia: 450, pago_ninera: 250 }),
      // Próximos sittings de Ana para su app (etapa 2, 27/10/2026): hoy confirmado, mañana previsto
      // que cruza la medianoche y uno a 70 días (no sale: la app muestra hasta 60). En $0 para no
      // mover los totales de Finanzas ni Por cobrar / Por pagar. El de mañana (lunes) va con solo el
      // nombre de una familia que no está en la lista: en Prueba Uno taparía ese día del fijo de
      // Ana, y en Prueba Dos se mezclaría con el traslado de Bruno en los tests que la buscan.
      sitting('70000000-0000-4000-8000-000000000005', '2026-10-04', { hora_inicio: '18:00:00', hora_fin: '22:00:00', cobro_familia: 0, pago_ninera: 0, estado: 'confirmado', created_at: '2026-10-01T12:00:00Z' }),
      sitting('70000000-0000-4000-8000-000000000006', '2026-10-05', { familia_id: null, familia_nombre: 'Familia Prueba Tres', hora_inicio: '22:00:00', hora_fin: '02:00:00', termina_dia_siguiente: true, cobro_familia: 0, pago_ninera: 0, estado: 'previsto', created_at: '2026-10-01T12:00:00Z' }),
      sitting('70000000-0000-4000-8000-000000000007', '2026-12-13', { cobro_familia: 0, pago_ninera: 0, estado: 'confirmado', created_at: '2026-10-01T12:00:00Z' }),
    ],
    solicitudes: [
      { id: '80000000-0000-4000-8000-000000000001', familia_id: ID.fDos, familia_nombre: 'Familia Prueba Dos', tipo: 'sitting', zona: 'Carrasco', fecha: '2026-10-06', hora_inicio: '20:00:00', hora_fin: '23:00:00', cobro_familia: null, estado: 'sin_asignar', notas: null, created_at: '2026-10-01T00:00:00Z', termina_dia_siguiente: false },
    ],
    solicitud_ninieras: [],
    candidatas: [
      { id: ID.cIntake, nombre: 'Lucía', apellido: 'Muestra', telefono: '097000001', mail: null, zona: 'Pocitos', zona_sitting: null, edad: '22', disponibilidad: null, bachillerato: null, universidad: null, cocina: null, idiomas: null, licencia: null, cambia_panales: null, dispone_traslados: null, disponible_tipo: null, fechas_punta: null, experiencia: 'Cuidó primos', patologias: null, trabaja_actualmente: null, primeros_auxilios: null, capacitacion_extra: null, comentarios: null, tipo: 'Niñera', origen: 'Instagram / Form', estado: 'intake', created_at: '2026-10-01T12:00:00Z', foto_url: null, autoriza_foto: null, carsitting_mail_enviado_at: null, fecha_nacimiento: null, cuenta_bancaria: null, notas_ficha: {}, temporada_quincenas: null, zona_barrios: null, zona_sitting_barrios: null },
    ],
    entrevistas: [],
    entrevista_preguntas: [],
    carsitting_datos: [],
    resenas_ninieras: [],
    incidentes: [],
    gastos_generales: [
      { id: '90000000-0000-4000-8000-000000000001', fecha: '2026-09-07', concepto: 'Insumos', monto: 500, notas: null, created_at: '2026-09-07T12:00:00Z' },
    ],
    gastos_fijos: [
      { id: '90000000-0000-4000-8000-000000000002', concepto: 'Suscripción', monto: 800, desde: '2026-09-01', activo: true, notas: null, created_at: '2026-09-01T00:00:00Z' },
    ],
    fechas_marketing: [
      { id: '91000000-0000-4000-8000-000000000001', fecha: '2026-10-20', titulo: 'Fecha de prueba', sugerencia: null, publicado: false, notas: null, created_at: '2026-09-01T00:00:00Z' },
    ],
    contratos: [],
    juguetes: [],
    juguetes_movimientos: [],
    tarifas_traslado_config: [
      { id: '92000000-0000-4000-8000-000000000001', tarifa_base: 200, precio_km: 20, rec1_desde: null, rec1_hasta: null, rec1_mult: 1, rec2_desde: null, rec2_hasta: null, rec2_mult: 1, margen_premium: 1, updated_at: '2026-09-01T00:00:00Z', margen_ninera: 0.15 },
    ],
    // Configuración de la app de niñeras (fase 1): días que dura un link de invitación.
    app_config: [
      { id: 'ninieras_app', valor: { vigencia_dias: 7 }, actualizado_at: '2026-10-01T00:00:00Z' },
    ],
    notificaciones_leidas: [],
    notif_push_preferencias: [],
    push_subscriptions: [],
    intermediaciones_enrique: [],
    intermediaciones_enrique_pool: [],
    intermediaciones_eventos: [],
    intermediaciones_eventos_ninieras: [],
    variantes_precio: [],
    // Precio por hora de una niñera con una familia (01/11/2026): vacío; cada test carga los suyos.
    precios_ninera_familia: [],
    ninera_invitaciones: [],
    // Chat (etapa 3, 30/10/2026): el hilo de Ana con una admin, el último sin leer por Ana, y un
    // mensaje de Carla que las admins todavía no leyeron. Todo antes del reloj de los tests
    // (04/10 a las 12:00 de Montevideo): lo que se manda en un test queda después.
    chat_mensajes: [
      { id: ID.chAna1, ninera_id: ID.nAna, de: 'admin', autor: 'Paula Prueba', texto: 'Hola Ana, ¿te queda bien el sitting de mañana?', creado_en: '2026-10-03T13:00:00+00:00', leido_ninera_en: '2026-10-03T13:10:00+00:00', leido_admin_en: null },
      { id: ID.chAna2, ninera_id: ID.nAna, de: 'ninera', autor: 'Ana Ficticia', texto: 'Sí, ahí estaré.', creado_en: '2026-10-03T13:15:00+00:00', leido_ninera_en: null, leido_admin_en: '2026-10-03T14:00:00+00:00' },
      { id: ID.chAna3, ninera_id: ID.nAna, de: 'admin', autor: 'Paula Prueba', texto: 'Gracias, te mandamos la dirección más tarde.', creado_en: '2026-10-04T13:00:00+00:00', leido_ninera_en: null, leido_admin_en: null },
      { id: ID.chCarla, ninera_id: ID.nCarla, de: 'ninera', autor: 'Carla Ejemplo', texto: 'Hola, ¿me confirman el horario del lunes?', creado_en: '2026-10-04T14:00:00+00:00', leido_ninera_en: null, leido_admin_en: null },
    ],
    // Avisos (etapa 3): uno sin leer para Ana, y los dos que el trigger del chat encoló para las
    // admins por los mensajes de las niñeras (el de Ana ya leído en el chat, el de Carla no). Los
    // avisos de chat para Ana no se cargan: su lista arranca con uno solo, y cada test suma los que
    // necesite.
    avisos: [
      { id: ID.avAna, clave: 'sitting:70000000-0000-4000-8000-000000000005:recordatorio', para_ninera_id: ID.nAna, para_admin: null, tipo: 'recordatorio', titulo: 'Hoy tienes un sitting', cuerpo: 'A las 18:00 en Pocitos.', url: '#inicio', datos: { sitting_id: '70000000-0000-4000-8000-000000000005' }, enviar_desde: '2026-10-04T12:00:00+00:00', enviado_en: '2026-10-04T12:00:00+00:00', error: null, intentos: 1, leido_en: null, creado_en: '2026-10-04T12:00:00+00:00' },
      { id: ID.avAnaChat, clave: `admin:chat:${ID.chAna2}`, para_ninera_id: null, para_admin: 'todas', tipo: 'chat', titulo: 'Ana Ficticia', cuerpo: 'Sí, ahí estaré.', url: `?ir=ninieras&ninera=${ID.nAna}`, datos: { mensaje_id: ID.chAna2, ninera_id: ID.nAna }, enviar_desde: '2026-10-03T13:15:00+00:00', enviado_en: '2026-10-03T13:15:00+00:00', error: null, intentos: 1, leido_en: null, creado_en: '2026-10-03T13:15:00+00:00' },
      { id: ID.avCarlaChat, clave: `admin:chat:${ID.chCarla}`, para_ninera_id: null, para_admin: 'todas', tipo: 'chat', titulo: 'Carla Ejemplo', cuerpo: 'Hola, ¿me confirman el horario del lunes?', url: `?ir=ninieras&ninera=${ID.nCarla}`, datos: { mensaje_id: ID.chCarla, ninera_id: ID.nCarla }, enviar_desde: '2026-10-04T14:00:00+00:00', enviado_en: '2026-10-04T14:00:00+00:00', error: null, intentos: 1, leido_en: null, creado_en: '2026-10-04T14:00:00+00:00' },
    ],
  };
}

module.exports = { datosBase, sitting, ID };
