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
    hijos_familia: [],
    ninieras: [
      { id: ID.nAna, candidata_id: null, nombre: 'Ana Ficticia', telefono: '098000001', zona: 'Pocitos', tipo: 'Niñera', foto: null, cv_url: null, notas: null, activa: true, created_at: '2026-09-01T00:00:00Z', cuenta_bancaria: ['0099887766'], carsitting_mail_enviado_at: null, cv_generado_en: null, temporada: null, temporada_actualizada_en: null, temporada_propuesta: null, temporada_propuesta_en: null, temporada_token: '60000000-0000-4000-8000-000000000001', temporada_fuente: null, temporada_comentario: null, barrios: null, telefono_pendiente: null, telefono_pendiente_en: null, user_id: null, app_activada_en: null },
      { id: ID.nBruno, candidata_id: null, nombre: 'Bruno Inventado', telefono: '098000002', zona: 'Carrasco', tipo: 'Traslados', foto: null, cv_url: null, notas: null, activa: true, created_at: '2026-09-01T00:00:00Z', cuenta_bancaria: [], carsitting_mail_enviado_at: null, cv_generado_en: null, temporada: null, temporada_actualizada_en: null, temporada_propuesta: null, temporada_propuesta_en: null, temporada_token: '60000000-0000-4000-8000-000000000002', temporada_fuente: null, temporada_comentario: null, barrios: null, telefono_pendiente: null, telefono_pendiente_en: null, user_id: null, app_activada_en: null },
      { id: ID.nCarla, candidata_id: null, nombre: 'Carla Ejemplo', telefono: '098000003', zona: 'Pocitos', tipo: 'Ambas', foto: null, cv_url: null, notas: null, activa: true, created_at: '2026-09-01T00:00:00Z', cuenta_bancaria: [], carsitting_mail_enviado_at: null, cv_generado_en: null, temporada: null, temporada_actualizada_en: null, temporada_propuesta: null, temporada_propuesta_en: null, temporada_token: '60000000-0000-4000-8000-000000000003', temporada_fuente: null, temporada_comentario: null, barrios: null, telefono_pendiente: null, telefono_pendiente_en: null, user_id: null, app_activada_en: null },
    ],
    asignaciones: [
      { id: ID.aFijo, familia_id: ID.fUno, ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', cobro_hora: null, pago_hora: null, created_at: '2026-09-01T00:00:00Z', dias: ['L', 'X'], hora_inicio: '16:00:00', hora_fin: '19:00:00', vigente_desde: '2026-09-01', vigente_hasta: null, tipo: 'sitting' },
    ],
    sittings_traslados: [
      sitting('70000000-0000-4000-8000-000000000001', '2026-09-14', { cobrado: true, pagado: true }),
      sitting('70000000-0000-4000-8000-000000000002', '2026-09-16', { pagado: true }),
      sitting('70000000-0000-4000-8000-000000000003', '2026-09-28', {}),
      sitting('70000000-0000-4000-8000-000000000004', '2026-09-19', { tipo: 'traslado', familia_id: ID.fDos, familia_nombre: 'Familia Prueba Dos', ninera_id: ID.nBruno, ninera_nombre: 'Bruno Inventado', hora_inicio: '08:00:00', hora_fin: null, km: 12, origen: 'Casa', destino: 'Colegio', cobro_familia: 450, pago_ninera: 250 }),
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
    ninera_invitaciones: [],
  };
}

module.exports = { datosBase, sitting, ID };
