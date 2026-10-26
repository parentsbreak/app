-- ============================================================================
-- Parents Break: estructura de la base (Supabase, proyecto "Parents-break",
-- Postgres 17). SOLO ESTRUCTURA, sin datos.
--
-- Foto tomada de producción el 04/10/2026 leyendo el catálogo de Postgres (solo
-- lectura), más la migración supabase/migraciones/20261005_vigencia_fijos_historial_sittings.sql
-- (vigencia y tipo de asignaciones, historial de sittings, cierre de candidatas-fotos).
--
-- El historial paso a paso son las 79 migraciones registradas en el proyecto
-- (supabase_migrations.schema_migrations). No se copiaron acá porque varias cargan
-- datos reales (nombres, cuentas bancarias). Cuando se cambie la estructura, actualizar
-- este archivo en el mismo PR.
--
-- Sirve para levantar un proyecto de prueba vacío con la misma forma que producción.
-- Pasos aparte (no son SQL): crear los usuarios en Authentication, desplegar las Edge
-- Functions y cargar los secretos (app_secrets / Vault).
--
-- Edge Functions (código en supabase/functions/ desde el 06/10/2026), todas con
-- verify_jwt = false:
--   candidatas-webhook, resenas-webhook, carsitting-webhook, carsitting-recordatorio,
--   whatsapp-webhook, enviar-push-urgentes, temporada-ninera
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

create table public.app_config (
  id text not null,
  valor jsonb default '{}'::jsonb not null,
  actualizado_at timestamp with time zone default now() not null,
  constraint app_config_pkey PRIMARY KEY (id)
);

-- Secretos que leen las Edge Functions. RLS activo y sin políticas: la app no la ve.
create table public.app_secrets (
  clave text not null,
  valor text not null,
  constraint app_secrets_pkey PRIMARY KEY (clave)
);

create table public.asignaciones (
  id uuid default gen_random_uuid() not null,
  familia_id uuid not null,
  ninera_id uuid,
  ninera_nombre text not null,
  cobro_hora numeric,
  pago_hora numeric,
  created_at timestamp with time zone default now() not null,
  dias jsonb default '[]'::jsonb not null,
  hora_inicio time without time zone,
  hora_fin time without time zone,
  -- Vigencia del fijo, ambos extremos inclusive (hasta vacío = sigue vigente). La Agenda
  -- solo lo dibuja dentro de estas fechas; cambiar de niñera cierra una y abre otra.
  vigente_desde date default ((now() at time zone 'America/Montevideo')::date),
  vigente_hasta date,
  tipo text default 'sitting'::text,
  -- Precio fijo de un traslado fijo (06/10/2026). Vacío = el del último traslado.
  cobro_traslado numeric,
  pago_traslado numeric,
  -- Fecha real de inicio si el fijo empezó antes de la app (10/10/2026). Solo se muestra;
  -- vigente_desde sigue siendo desde cuándo se registra en la app.
  inicio_real date,
  constraint asignaciones_pkey PRIMARY KEY (id),
  constraint asignaciones_tipo_check CHECK (((tipo IS NULL) OR (tipo = ANY (ARRAY['sitting'::text, 'traslado'::text])))),
  constraint asignaciones_vigencia_check CHECK (((vigente_hasta IS NULL) OR (vigente_desde IS NULL) OR (vigente_hasta >= vigente_desde)))
);

-- Borradores de lo que se está escribiendo (21/10/2026): una fila por usuaria y por formulario
-- ('entrevista:<id de la candidata>'). Copia en la base del borrador del dispositivo.
create table public.borradores (
  id uuid default gen_random_uuid() not null,
  usuaria uuid default auth.uid() not null,
  clave text not null,
  datos jsonb not null,
  actualizado_at timestamp with time zone default now() not null,
  constraint borradores_pkey PRIMARY KEY (id),
  constraint borradores_usuaria_clave_key UNIQUE (usuaria, clave),
  constraint borradores_clave_check CHECK ((char_length(clave) between 1 and 200)),
  constraint borradores_datos_check CHECK ((pg_column_size(datos) <= 500000))
);

create table public.candidatas (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  apellido text,
  telefono text,
  mail text,
  zona text,
  zona_sitting text,
  edad text,
  disponibilidad text,
  bachillerato text,
  universidad text,
  cocina text,
  idiomas text,
  licencia text,
  cambia_panales text,
  dispone_traslados text,
  disponible_tipo text,
  fechas_punta text,
  experiencia text,
  patologias text,
  trabaja_actualmente text,
  primeros_auxilios text,
  capacitacion_extra text,
  comentarios text,
  tipo text default 'Niñera'::text not null,
  origen text,
  estado text default 'intake'::text not null,
  created_at timestamp with time zone default now() not null,
  foto_url text,
  autoriza_foto boolean,
  carsitting_mail_enviado_at timestamp with time zone,
  fecha_nacimiento date,
  cuenta_bancaria text,
  notas_ficha jsonb default '{}'::jsonb not null,
  temporada_quincenas smallint[],
  zona_barrios text,
  zona_sitting_barrios text,
  constraint candidatas_pkey PRIMARY KEY (id),
  constraint candidatas_estado_check CHECK ((estado = ANY (ARRAY['intake'::text, 'entrevistada'::text, 'contratada'::text, 'descartada'::text]))),
  constraint candidatas_tipo_check CHECK ((tipo = ANY (ARRAY['Niñera'::text, 'Traslados'::text, 'Ambas'::text])))
);

create table public.carsitting_datos (
  id uuid default gen_random_uuid() not null,
  ninera_id uuid,
  ninera_nombre text,
  nombre_completo text,
  cedula text,
  modelo_auto text,
  padron text,
  compania_seguro text,
  tipo_seguro text,
  cantidad_asientos text,
  cantidad_cinturones text,
  anio_fabricacion text,
  color_auto text,
  matricula text,
  numero_licencia text,
  anio_licencia text,
  libreta_propiedad text,
  foto_licencia_url text,
  foto_libreta_url text,
  foto_asientos_url text,
  created_at timestamp with time zone default now() not null,
  constraint carsitting_datos_pkey PRIMARY KEY (id)
);

create table public.contratos (
  id uuid default gen_random_uuid() not null,
  tipo text not null,
  parte_nombre text not null,
  fecha date,
  estado text default 'borrador'::text not null,
  notas text,
  created_at timestamp with time zone default now(),
  constraint contratos_pkey PRIMARY KEY (id),
  constraint contratos_estado_check CHECK ((estado = ANY (ARRAY['borrador'::text, 'enviado'::text, 'firmado'::text]))),
  constraint contratos_tipo_check CHECK ((tipo = ANY (ARRAY['ninera'::text, 'traslado'::text])))
);

create table public.entrevista_preguntas (
  id uuid default gen_random_uuid() not null,
  competencia_key text not null,
  texto text not null,
  orden integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  constraint entrevista_preguntas_pkey PRIMARY KEY (id)
);

create table public.entrevistas (
  id uuid default gen_random_uuid() not null,
  candidata_id uuid not null,
  fecha date,
  entrevisto text,
  rol text,
  puntajes jsonb default '{}'::jsonb not null,
  redflags jsonb default '{}'::jsonb not null,
  referencias jsonb default '[]'::jsonb not null,
  psico jsonb default '{}'::jsonb not null,
  explicacion_juegos text,
  notas text,
  total numeric,
  recomendacion text,
  created_at timestamp with time zone default now() not null,
  -- Entrevista a medias (09/10/2026): 'en_curso' hasta que se completa; borrador = lo de la
  -- pantalla sin columna propia, para retomarla.
  estado text default 'completa'::text not null,
  borrador jsonb default '{}'::jsonb not null,
  actualizado_at timestamp with time zone default now() not null,
  constraint entrevistas_pkey PRIMARY KEY (id),
  constraint entrevistas_estado_check CHECK ((estado = ANY (ARRAY['en_curso'::text, 'completa'::text])))
);

create table public.familias (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  zona text,
  telefono text,
  ninos text,
  notas text,
  created_at timestamp with time zone default now() not null,
  direccion text,
  cuenta_bancaria text[],
  cobro_hora numeric,
  pago_hora numeric,
  frecuencia_cobro text default 'mensual'::text not null,
  contactada_riesgo_en date,
  -- Día en que aceptó los términos y condiciones (20/10/2026). Desde ese día el fin de cada
  -- sitting se le cobra redondeado (minutos_fin_cobro). Vacío = familia de siempre.
  terminos_aceptados_el date,
  constraint familias_pkey PRIMARY KEY (id),
  constraint familias_frecuencia_cobro_check CHECK ((frecuencia_cobro = ANY (ARRAY['diario'::text, 'semanal'::text, 'mensual'::text])))
);

create table public.fechas_marketing (
  id uuid default gen_random_uuid() not null,
  fecha date not null,
  titulo text not null,
  sugerencia text,
  publicado boolean default false,
  notas text,
  created_at timestamp with time zone default now(),
  constraint fechas_marketing_pkey PRIMARY KEY (id)
);

create table public.gastos_fijos (
  id uuid default gen_random_uuid() not null,
  concepto text not null,
  monto numeric default 0 not null,
  desde date default CURRENT_DATE not null,
  activo boolean default true not null,
  notas text,
  created_at timestamp with time zone default now() not null,
  constraint gastos_fijos_pkey PRIMARY KEY (id)
);

create table public.gastos_generales (
  id uuid default gen_random_uuid() not null,
  fecha date not null,
  concepto text not null,
  monto numeric default 0 not null,
  notas text,
  created_at timestamp with time zone default now(),
  constraint gastos_generales_pkey PRIMARY KEY (id)
);

create table public.hijos_familia (
  id uuid default gen_random_uuid() not null,
  familia_id uuid not null,
  nombre text,
  fecha_nacimiento date,
  colegio text,
  orden integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  edad_declarada integer,
  edad_declarada_en date,
  constraint hijos_familia_pkey PRIMARY KEY (id)
);

create table public.incidentes (
  id uuid default gen_random_uuid() not null,
  fecha date default CURRENT_DATE not null,
  tipo text default 'otro'::text not null,
  gravedad text default 'leve'::text not null,
  ninera_id uuid,
  ninera_nombre text,
  familia_id uuid,
  familia_nombre text,
  sitting_id uuid,
  descripcion text not null,
  registrado_por text,
  created_at timestamp with time zone default now() not null,
  constraint incidentes_pkey PRIMARY KEY (id),
  constraint incidentes_gravedad_check CHECK ((gravedad = ANY (ARRAY['leve'::text, 'moderado'::text, 'grave'::text]))),
  constraint incidentes_tipo_check CHECK ((tipo = ANY (ARRAY['accidente'::text, 'queja'::text, 'otro'::text])))
);

create table public.intermediaciones_enrique (
  id uuid default gen_random_uuid() not null,
  ninera_id uuid,
  ninera_nombre text not null,
  fecha date not null,
  monto numeric default 0 not null,
  comentarios text,
  registrado_por text,
  created_at timestamp with time zone default now() not null,
  cobrado boolean default false not null,
  constraint intermediaciones_enrique_pkey PRIMARY KEY (id)
);

create table public.intermediaciones_enrique_pool (
  id uuid default gen_random_uuid() not null,
  ninera_id uuid not null,
  ninera_nombre text not null,
  estado text default 'activa'::text not null,
  updated_at timestamp with time zone default now() not null,
  constraint intermediaciones_enrique_pool_ninera_id_key UNIQUE (ninera_id),
  constraint intermediaciones_enrique_pool_pkey PRIMARY KEY (id),
  constraint intermediaciones_enrique_pool_estado_check CHECK ((estado = ANY (ARRAY['activa'::text, 'disponible'::text])))
);

create table public.intermediaciones_eventos (
  id uuid default gen_random_uuid() not null,
  empresa text not null,
  fecha date not null,
  cobro_total numeric default 0 not null,
  comentarios text,
  registrado_por text,
  created_at timestamp with time zone default now() not null,
  cobrado boolean default false not null,
  constraint intermediaciones_eventos_pkey PRIMARY KEY (id)
);

create table public.intermediaciones_eventos_ninieras (
  id uuid default gen_random_uuid() not null,
  evento_id uuid not null,
  ninera_id uuid,
  ninera_nombre text not null,
  hora_inicio time without time zone,
  hora_fin time without time zone,
  pago numeric default 0 not null,
  pagado boolean default false not null,
  constraint intermediaciones_eventos_ninieras_pkey PRIMARY KEY (id)
);

create table public.juguetes (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  tipo text,
  genero text default 'unisex'::text not null,
  edad_desde integer,
  edad_hasta integer,
  foto_url text,
  ninera_id uuid,
  ninera_nombre text,
  estado text default 'disponible'::text not null,
  notas text,
  created_at timestamp with time zone default now() not null,
  constraint juguetes_pkey PRIMARY KEY (id),
  constraint juguetes_estado_check CHECK ((estado = ANY (ARRAY['disponible'::text, 'perdido'::text, 'roto'::text]))),
  constraint juguetes_genero_check CHECK ((genero = ANY (ARRAY['unisex'::text, 'ninas'::text, 'ninos'::text])))
);

create table public.juguetes_movimientos (
  id uuid default gen_random_uuid() not null,
  juguete_id uuid not null,
  ninera_anterior text,
  ninera_nueva text,
  fecha timestamp with time zone default now() not null,
  notas text,
  constraint juguetes_movimientos_pkey PRIMARY KEY (id)
);

create table public.ninieras (
  id uuid default gen_random_uuid() not null,
  candidata_id uuid,
  nombre text not null,
  telefono text,
  zona text,
  tipo text default 'Niñera'::text,
  foto text,
  cv_url text,
  notas text,
  activa boolean default true not null,
  created_at timestamp with time zone default now() not null,
  cuenta_bancaria text[],
  carsitting_mail_enviado_at timestamp with time zone,
  cv_generado_en date,
  temporada jsonb,
  temporada_actualizada_en timestamp with time zone,
  temporada_propuesta jsonb,
  temporada_propuesta_en timestamp with time zone,
  temporada_token uuid default gen_random_uuid() not null,
  temporada_fuente text,
  temporada_comentario text,
  barrios text,
  telefono_pendiente text,
  telefono_pendiente_en timestamp with time zone,
  cedula text, -- 21/10/2026: la de la ficha (antes solo en carsitting_datos)
  constraint ninieras_pkey PRIMARY KEY (id)
);

create table public.notif_push_enviadas (
  notif_id text not null,
  enviado_en timestamp with time zone default now() not null,
  constraint notif_push_enviadas_pkey PRIMARY KEY (notif_id)
);

create table public.notif_push_preferencias (
  usuario text not null,
  tipo text not null,
  activado boolean not null,
  constraint notif_push_preferencias_pkey PRIMARY KEY (usuario, tipo)
);

create table public.notificaciones_leidas (
  notif_id text not null,
  usuario text not null,
  leido_en timestamp with time zone default now() not null,
  constraint notificaciones_leidas_pkey PRIMARY KEY (notif_id, usuario)
);

-- Pedido desde WhatsApp (21/10/2026): ticket armado por la Edge Function pedido-whatsapp.
create table public.pedidos_whatsapp (
  id uuid default gen_random_uuid() not null,
  creado_el timestamp with time zone default now() not null,
  creado_por text,
  texto text not null,
  estado text default 'borrador'::text not null,
  tipo text,
  familia_id uuid,
  familia_texto text,
  servicio text,
  fecha date,
  hora_inicio time without time zone,
  hora_fin time without time zone,
  termina_dia_siguiente boolean default false not null,
  horario_aproximado boolean default false not null,
  horario_nota text,
  chicos_cantidad integer,
  chicos_edades text,
  zona text,
  notas text,
  dudas jsonb default '[]'::jsonb not null,
  cobro_estimado numeric,
  pago_estimado numeric,
  solicitud_id uuid,
  modelo text,
  respuesta jsonb,
  tokens_entrada integer,
  tokens_salida integer,
  constraint pedidos_whatsapp_pkey PRIMARY KEY (id),
  constraint pedidos_whatsapp_texto_check CHECK ((char_length(texto) between 1 and 6000)),
  constraint pedidos_whatsapp_estado_check CHECK ((estado = ANY (ARRAY['borrador'::text, 'confirmado'::text, 'descartado'::text]))),
  constraint pedidos_whatsapp_tipo_check CHECK ((tipo = ANY (ARRAY['pedido_nuevo'::text, 'cambio'::text, 'cancelacion'::text, 'otra_cosa'::text]))),
  constraint pedidos_whatsapp_servicio_check CHECK ((servicio = ANY (ARRAY['sitting'::text, 'traslado'::text]))),
  constraint pedidos_whatsapp_chicos_check CHECK ((chicos_cantidad between 1 and 12))
);
-- Una fila por llamada al modelo (pedidos guardados y pruebas): tope diario, reservar_llamada_pedido().
create table public.pedidos_whatsapp_uso (
  id uuid default gen_random_uuid() not null,
  creado_el timestamp with time zone default now() not null,
  creado_por text,
  probar boolean default false not null,
  tokens_entrada integer,
  tokens_salida integer,
  constraint pedidos_whatsapp_uso_pkey PRIMARY KEY (id)
);
create table public.push_subscriptions (
  id uuid default gen_random_uuid() not null,
  usuario text not null,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  creado_en timestamp with time zone default now() not null,
  constraint push_subscriptions_endpoint_key UNIQUE (endpoint),
  constraint push_subscriptions_pkey PRIMARY KEY (id)
);

create table public.resenas_ninieras (
  id uuid default gen_random_uuid() not null,
  ninera_nombre text not null,
  ninera_id uuid,
  presentacion text,
  puntualidad text,
  trato_ninos text,
  conformidad text,
  puntuacion integer,
  fecha date,
  origen text default 'Form (auto)'::text,
  created_at timestamp with time zone default now(),
  constraint resenas_ninieras_pkey PRIMARY KEY (id)
);

-- Respaldo previo a la migración del 05/10/2026 (misma forma que asignaciones antes de
-- agregar vigencia y tipo). Sin políticas: no lo ve la app.
create table public.respaldo_asignaciones_20261005 (
  id uuid,
  familia_id uuid,
  ninera_id uuid,
  ninera_nombre text,
  cobro_hora numeric,
  pago_hora numeric,
  created_at timestamp with time zone,
  dias jsonb,
  hora_inicio time without time zone,
  hora_fin time without time zone
);

-- Respaldos manuales de la reorganización de zonas del 30/09/2026 (sin políticas: no
-- los ve la app). Se pueden borrar cuando ya no hagan falta.
create table public.respaldo_zona_grupos_20260930 (
  id uuid,
  nombre text,
  zonas text[],
  orden integer,
  created_at timestamp with time zone,
  fuera_de_montevideo boolean
);

create table public.respaldo_zonas_20260930 (
  tabla text,
  id uuid,
  zona text,
  zona_sitting text
);

create table public.sittings_traslados (
  id uuid default gen_random_uuid() not null,
  tipo text not null,
  registrado_por text,
  familia_id uuid,
  familia_nombre text not null,
  ninera_id uuid,
  ninera_nombre text not null,
  fecha date not null,
  hora_inicio time without time zone,
  hora_fin time without time zone,
  km numeric,
  origen text,
  destino text,
  cobro_familia numeric default 0,
  pago_ninera numeric default 0,
  notas text,
  created_at timestamp with time zone default now(),
  termina_dia_siguiente boolean default false not null,
  cobrado boolean default false not null,
  pagado boolean default false not null,
  fuente text default 'app'::text not null,
  asignacion_id uuid,
  cancelado boolean default false not null,
  -- Fijos automáticos (06/10/2026): 'previsto' = lo cargó el proceso para un día que todavía
  -- no llegó (solo se ve en la Agenda); ese día pasa solo a 'confirmado'. Lo cargado a mano
  -- es 'confirmado'. generado_automatico: lo creó el proceso y nadie lo tocó (se puede
  -- recalcular). revisado_at: cuándo se revisó en Hoy un confirmado automático.
  estado text default 'confirmado'::text not null,
  generado_automatico boolean default false not null,
  revisado_at timestamp with time zone,
  -- Precio puesto a mano (21/10/2026): por qué el cobro o el pago no es el de la tarifa.
  -- Vacío = es el de la tarifa.
  precio_motivo text,
  -- Variantes de precio (23/10/2026): la base y cuáles se aplicaron, copiadas tal cual
  -- ({"base": {"cobro", "pago"}, "aplicadas": [...]}). Vacío = sin variantes.
  precio_variantes jsonb,
  constraint sittings_traslados_precio_motivo_check CHECK ((precio_motivo = ANY (ARRAY['descuento'::text, 'extra'::text, 'sin_servicio'::text, 'otro'::text]))),
  constraint sittings_traslados_pkey PRIMARY KEY (id),
  constraint sittings_traslados_estado_check CHECK ((estado = ANY (ARRAY['previsto'::text, 'confirmado'::text]))),
  constraint sittings_traslados_fuente_check CHECK ((fuente = ANY (ARRAY['app'::text, 'historico'::text]))),
  constraint sittings_traslados_tipo_check CHECK ((tipo = ANY (ARRAY['sitting'::text, 'traslado'::text])))
);

-- Respaldo previo a la migración del 06/10/2026 (sittings_traslados antes de los fijos
-- automáticos). Sin políticas: la app no la ve.
create table public.respaldo_sittings_traslados_20261006 (
  id uuid, tipo text, registrado_por text, familia_id uuid, familia_nombre text, ninera_id uuid,
  ninera_nombre text, fecha date, hora_inicio time without time zone, hora_fin time without time zone,
  km numeric, origen text, destino text, cobro_familia numeric, pago_ninera numeric, notas text,
  created_at timestamp with time zone, termina_dia_siguiente boolean, cobrado boolean, pagado boolean,
  fuente text, asignacion_id uuid, cancelado boolean
);

-- Pausas de un fijo (vacaciones, 06/10/2026): en ese rango no se generan previstos y la
-- Agenda no lo dibuja, sin terminarlo.
create table public.asignaciones_pausas (
  id uuid default gen_random_uuid() not null,
  asignacion_id uuid not null,
  desde date not null,
  hasta date not null,
  motivo text,
  creado_por text,
  created_at timestamp with time zone default now() not null,
  constraint asignaciones_pausas_pkey PRIMARY KEY (id),
  constraint asignaciones_pausas_rango_check CHECK ((hasta >= desde))
);

-- Saldo a favor (07/10/2026): ajustes que se suman (positivo) o descuentan (negativo) en el
-- próximo cobro de una familia o pago de una niñera. "aplicado" es cuánto ya se usó.
-- Variantes de precio de cada familia (23/10/2026, ver 20261023_variantes_precio.sql).
create table public.variantes_precio (
  id uuid default gen_random_uuid() not null,
  familia_id uuid not null,
  nombre text not null,
  -- 'sitting', 'traslado' o 'ambos'.
  aplica_a text default 'ambos'::text not null,
  -- Solo para ese fijo (opcional). Programada: se aplica sola a ese fijo desde auto_desde, hasta
  -- auto_hasta (opcional) y en los días auto_dias (códigos L M X J V S D; vacío = todos).
  asignacion_id uuid,
  -- Qué le hace al cobro y al pago: 'sumar' (valor puede ser negativo), 'total' o 'porcentaje'
  -- (-50 = la mitad). Vacío = ese lado no cambia.
  cobro_modo text,
  cobro_valor numeric,
  pago_modo text,
  pago_valor numeric,
  -- Mismo motivo que sittings_traslados.precio_motivo.
  motivo text,
  auto_desde date,
  auto_hasta date,
  auto_dias jsonb,
  activa boolean default true not null,
  creado_por text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint variantes_precio_pkey PRIMARY KEY (id),
  constraint variantes_precio_nombre_check CHECK ((length(btrim(nombre)) >= 1 AND length(nombre) <= 60)),
  constraint variantes_precio_aplica_a_check CHECK ((aplica_a = ANY (ARRAY['sitting'::text, 'traslado'::text, 'ambos'::text]))),
  constraint variantes_precio_cobro_modo_check CHECK ((cobro_modo = ANY (ARRAY['sumar'::text, 'total'::text, 'porcentaje'::text]))),
  constraint variantes_precio_pago_modo_check CHECK ((pago_modo = ANY (ARRAY['sumar'::text, 'total'::text, 'porcentaje'::text]))),
  constraint variantes_precio_cobro_check CHECK (((cobro_modo IS NULL) = (cobro_valor IS NULL))),
  constraint variantes_precio_pago_check CHECK (((pago_modo IS NULL) = (pago_valor IS NULL))),
  constraint variantes_precio_efecto_check CHECK (((cobro_modo IS NOT NULL) OR (pago_modo IS NOT NULL))),
  constraint variantes_precio_total_check CHECK ((((cobro_modo IS DISTINCT FROM 'total'::text) OR (cobro_valor >= (0)::numeric)) AND ((pago_modo IS DISTINCT FROM 'total'::text) OR (pago_valor >= (0)::numeric)))),
  constraint variantes_precio_motivo_check CHECK ((motivo = ANY (ARRAY['descuento'::text, 'extra'::text, 'sin_servicio'::text, 'otro'::text]))),
  constraint variantes_precio_auto_check CHECK (((auto_desde IS NULL) OR (asignacion_id IS NOT NULL))),
  constraint variantes_precio_auto_hasta_check CHECK (((auto_hasta IS NULL) OR ((auto_desde IS NOT NULL) AND (auto_hasta >= auto_desde)))),
  constraint variantes_precio_auto_dias_check CHECK (((auto_dias IS NULL) OR (jsonb_typeof(auto_dias) = 'array'::text)))
);

create table public.ajustes_saldo (
  id uuid default gen_random_uuid() not null,
  sujeto text not null,
  familia_id uuid,
  ninera_id uuid,
  nombre text not null,
  monto numeric not null,
  motivo text not null,
  fecha date default ((now() at time zone 'America/Montevideo')::date) not null,
  aplicado numeric default 0 not null,
  aplicaciones jsonb default '[]'::jsonb not null,
  creado_por text,
  created_at timestamp with time zone default now() not null,
  constraint ajustes_saldo_pkey PRIMARY KEY (id),
  constraint ajustes_saldo_sujeto_check CHECK ((((sujeto = 'familia'::text) AND (familia_id IS NOT NULL)) OR ((sujeto = 'ninera'::text) AND (ninera_id IS NOT NULL)))),
  constraint ajustes_saldo_monto_check CHECK ((monto <> (0)::numeric)),
  constraint ajustes_saldo_aplicado_check CHECK (((aplicado >= (0)::numeric) AND (aplicado <= abs(monto))))
);

-- Gastos extra con comprobante (08/10/2026): los paga la niñera (se cobran a la familia y se
-- le reintegran) o la familia (quedan como saldo a favor). No cuentan como ganancia. El
-- ticket está en el bucket privado "comprobantes".
create table public.gastos_extra (
  id uuid default gen_random_uuid() not null,
  sitting_id uuid not null,
  concepto text not null,
  monto numeric not null,
  pagado_por text not null,
  comprobante text not null,
  cobrado boolean default false not null,
  reintegrado boolean default false not null,
  ajuste_id uuid,
  creado_por text,
  created_at timestamp with time zone default now() not null,
  absorbe_pb boolean default false not null, -- lo absorbe Parents Break (14/10/2026)
  constraint gastos_extra_pkey PRIMARY KEY (id),
  constraint gastos_extra_monto_check CHECK ((monto > (0)::numeric)),
  constraint gastos_extra_pagado_por_check CHECK ((pagado_por = ANY (ARRAY['ninera'::text, 'familia'::text])))
);

-- Historial de cambios de sittings_traslados (lo escribe el trigger sittings_historial_trg).
create table public.sittings_historial (
  id bigint generated always as identity primary key,
  sitting_id uuid not null,
  accion text not null,
  usuario text,
  cuando timestamp with time zone default now() not null,
  cambios jsonb,
  fila jsonb,
  constraint sittings_historial_accion_check CHECK ((accion = ANY (ARRAY['alta'::text, 'cambio'::text, 'baja'::text])))
);

-- Historial de cambios de gastos generales, saldos a favor y gastos extra (15/10/2026, lo
-- escribe registrar_historial_finanzas).
create table public.finanzas_historial (
  id bigint generated always as identity primary key,
  tabla text not null,
  fila_id uuid not null,
  accion text not null,
  usuario text,
  cuando timestamp with time zone default now() not null,
  cambios jsonb,
  fila jsonb,
  constraint finanzas_historial_tabla_check CHECK ((tabla = ANY (ARRAY['gastos_generales'::text, 'ajustes_saldo'::text, 'gastos_extra'::text]))),
  constraint finanzas_historial_accion_check CHECK ((accion = ANY (ARRAY['alta'::text, 'cambio'::text, 'baja'::text])))
);

create table public.solicitud_ninieras (
  id uuid default gen_random_uuid() not null,
  solicitud_id uuid not null,
  ninera_id uuid,
  ninera_nombre text not null,
  pago_ninera numeric,
  estado text default 'invitada'::text not null,
  created_at timestamp with time zone default now() not null,
  constraint solicitud_ninieras_pkey PRIMARY KEY (id),
  constraint solicitud_ninieras_estado_check CHECK ((estado = ANY (ARRAY['invitada'::text, 'confirmada'::text, 'rechazada'::text])))
);

create table public.solicitudes (
  id uuid default gen_random_uuid() not null,
  familia_id uuid,
  familia_nombre text not null,
  tipo text not null,
  zona text,
  fecha date not null,
  hora_inicio time without time zone not null,
  hora_fin time without time zone,
  cobro_familia numeric,
  estado text default 'sin_asignar'::text not null,
  notas text,
  created_at timestamp with time zone default now() not null,
  termina_dia_siguiente boolean default false not null,
  constraint solicitudes_pkey PRIMARY KEY (id),
  constraint solicitudes_estado_check CHECK ((estado = ANY (ARRAY['sin_asignar'::text, 'pendiente_confirmar'::text, 'confirmada'::text, 'cancelada'::text]))),
  constraint solicitudes_tipo_check CHECK ((tipo = ANY (ARRAY['sitting'::text, 'traslado'::text])))
);

create table public.tarifas_traslado_config (
  id uuid default gen_random_uuid() not null,
  tarifa_base numeric default 0 not null,
  precio_km numeric default 0 not null,
  rec1_desde time without time zone,
  rec1_hasta time without time zone,
  rec1_mult numeric default 1 not null,
  rec2_desde time without time zone,
  rec2_hasta time without time zone,
  rec2_mult numeric default 1 not null,
  margen_premium numeric default 1 not null,
  updated_at timestamp with time zone default now() not null,
  margen_ninera numeric default 0.15,
  constraint tarifas_traslado_config_pkey PRIMARY KEY (id)
);

-- Eventos crudos del webhook de WhatsApp (sin políticas: solo Edge Functions).
create table public.whatsapp_eventos_raw (
  id uuid default gen_random_uuid() not null,
  payload jsonb not null,
  procesado boolean default false not null,
  created_at timestamp with time zone default now() not null,
  constraint whatsapp_eventos_raw_pkey PRIMARY KEY (id)
);

create table public.zona_grupos (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  zonas text[] default '{}'::text[] not null,
  orden integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  fuera_de_montevideo boolean default false not null,
  constraint zona_grupos_pkey PRIMARY KEY (id)
);

create table public.zonas_confirmadas (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  created_at timestamp with time zone default now() not null,
  constraint zonas_confirmadas_nombre_key UNIQUE (nombre),
  constraint zonas_confirmadas_pkey PRIMARY KEY (id)
);

-- ----------------------------------------------------------------------------
-- Claves foráneas
-- ----------------------------------------------------------------------------

alter table public.borradores add constraint borradores_usuaria_fkey FOREIGN KEY (usuaria) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.asignaciones add constraint asignaciones_familia_id_fkey FOREIGN KEY (familia_id) REFERENCES familias(id) ON DELETE CASCADE;
alter table public.asignaciones add constraint asignaciones_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id) ON DELETE SET NULL;
alter table public.carsitting_datos add constraint carsitting_datos_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id) ON DELETE SET NULL;
alter table public.entrevistas add constraint entrevistas_candidata_id_fkey FOREIGN KEY (candidata_id) REFERENCES candidatas(id) ON DELETE CASCADE;
alter table public.hijos_familia add constraint hijos_familia_familia_id_fkey FOREIGN KEY (familia_id) REFERENCES familias(id) ON DELETE CASCADE;
alter table public.incidentes add constraint incidentes_familia_id_fkey FOREIGN KEY (familia_id) REFERENCES familias(id) ON DELETE SET NULL;
alter table public.incidentes add constraint incidentes_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id) ON DELETE SET NULL;
alter table public.incidentes add constraint incidentes_sitting_id_fkey FOREIGN KEY (sitting_id) REFERENCES sittings_traslados(id) ON DELETE SET NULL;
alter table public.intermediaciones_enrique add constraint intermediaciones_enrique_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id);
alter table public.intermediaciones_enrique_pool add constraint intermediaciones_enrique_pool_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id);
alter table public.intermediaciones_eventos_ninieras add constraint intermediaciones_eventos_ninieras_evento_id_fkey FOREIGN KEY (evento_id) REFERENCES intermediaciones_eventos(id) ON DELETE CASCADE;
alter table public.intermediaciones_eventos_ninieras add constraint intermediaciones_eventos_ninieras_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id);
alter table public.juguetes add constraint juguetes_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id) ON DELETE SET NULL;
alter table public.juguetes_movimientos add constraint juguetes_movimientos_juguete_id_fkey FOREIGN KEY (juguete_id) REFERENCES juguetes(id) ON DELETE CASCADE;
alter table public.ninieras add constraint ninieras_candidata_id_fkey FOREIGN KEY (candidata_id) REFERENCES candidatas(id) ON DELETE SET NULL;
alter table public.resenas_ninieras add constraint resenas_ninieras_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id) ON DELETE SET NULL;
alter table public.asignaciones_pausas add constraint asignaciones_pausas_asignacion_id_fkey FOREIGN KEY (asignacion_id) REFERENCES asignaciones(id) ON DELETE CASCADE;
alter table public.ajustes_saldo add constraint ajustes_saldo_familia_id_fkey FOREIGN KEY (familia_id) REFERENCES familias(id);
alter table public.variantes_precio add constraint variantes_precio_familia_id_fkey FOREIGN KEY (familia_id) REFERENCES familias(id) ON DELETE CASCADE;
alter table public.variantes_precio add constraint variantes_precio_asignacion_id_fkey FOREIGN KEY (asignacion_id) REFERENCES asignaciones(id) ON DELETE SET NULL;
alter table public.ajustes_saldo add constraint ajustes_saldo_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id);
alter table public.gastos_extra add constraint gastos_extra_sitting_id_fkey FOREIGN KEY (sitting_id) REFERENCES sittings_traslados(id) ON DELETE CASCADE;
alter table public.gastos_extra add constraint gastos_extra_ajuste_id_fkey FOREIGN KEY (ajuste_id) REFERENCES ajustes_saldo(id) ON DELETE SET NULL;
alter table public.sittings_traslados add constraint sittings_traslados_asignacion_id_fkey FOREIGN KEY (asignacion_id) REFERENCES asignaciones(id) ON DELETE SET NULL;
alter table public.sittings_traslados add constraint sittings_traslados_familia_id_fkey FOREIGN KEY (familia_id) REFERENCES familias(id) ON DELETE SET NULL;
alter table public.sittings_traslados add constraint sittings_traslados_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id) ON DELETE SET NULL;
alter table public.solicitud_ninieras add constraint solicitud_ninieras_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id) ON DELETE SET NULL;
alter table public.solicitud_ninieras add constraint solicitud_ninieras_solicitud_id_fkey FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id) ON DELETE CASCADE;
alter table public.solicitudes add constraint solicitudes_familia_id_fkey FOREIGN KEY (familia_id) REFERENCES familias(id) ON DELETE SET NULL;
alter table public.pedidos_whatsapp add constraint pedidos_whatsapp_familia_id_fkey FOREIGN KEY (familia_id) REFERENCES familias(id) ON DELETE SET NULL;
alter table public.pedidos_whatsapp add constraint pedidos_whatsapp_solicitud_id_fkey FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- Índices (además de los de las claves primarias y únicas)
-- ----------------------------------------------------------------------------

CREATE INDEX asignaciones_familia_id_idx ON public.asignaciones USING btree (familia_id);
CREATE INDEX asignaciones_ninera_id_idx ON public.asignaciones USING btree (ninera_id);
CREATE INDEX idx_asignaciones_vigencia ON public.asignaciones USING btree (familia_id, vigente_desde, vigente_hasta);
CREATE INDEX idx_candidatas_estado ON public.candidatas USING btree (estado);
CREATE INDEX idx_carsitting_ninera_id ON public.carsitting_datos USING btree (ninera_id);
CREATE INDEX idx_contratos_parte ON public.contratos USING btree (parte_nombre);
CREATE INDEX entrevistas_candidata_id_idx ON public.entrevistas USING btree (candidata_id);
CREATE INDEX idx_fechas_marketing_fecha ON public.fechas_marketing USING btree (fecha);
CREATE INDEX idx_gastos_fecha ON public.gastos_generales USING btree (fecha);
CREATE INDEX idx_hijos_familia_familia_id ON public.hijos_familia USING btree (familia_id);
CREATE INDEX idx_ninieras_activa ON public.ninieras USING btree (activa);
CREATE INDEX ninieras_candidata_id_idx ON public.ninieras USING btree (candidata_id);
CREATE UNIQUE INDEX ninieras_temporada_token_key ON public.ninieras USING btree (temporada_token);
CREATE INDEX idx_resenas_ninera_id ON public.resenas_ninieras USING btree (ninera_id);
CREATE INDEX idx_resenas_ninera_nombre ON public.resenas_ninieras USING btree (ninera_nombre);
CREATE INDEX idx_asignaciones_pausas ON public.asignaciones_pausas USING btree (asignacion_id, desde, hasta);
CREATE INDEX idx_ajustes_saldo_familia ON public.ajustes_saldo USING btree (familia_id) WHERE (familia_id IS NOT NULL);
CREATE INDEX idx_variantes_precio_familia ON public.variantes_precio USING btree (familia_id);
CREATE INDEX idx_variantes_precio_programadas ON public.variantes_precio USING btree (asignacion_id) WHERE (auto_desde IS NOT NULL);
CREATE INDEX idx_ajustes_saldo_ninera ON public.ajustes_saldo USING btree (ninera_id) WHERE (ninera_id IS NOT NULL);
CREATE INDEX idx_gastos_extra_sitting ON public.gastos_extra USING btree (sitting_id);
CREATE INDEX idx_gastos_extra_pendientes ON public.gastos_extra USING btree (pagado_por) WHERE ((NOT cobrado) OR (NOT reintegrado));
CREATE UNIQUE INDEX sittings_fijo_dia_automatico ON public.sittings_traslados USING btree (asignacion_id, fecha) WHERE generado_automatico;
CREATE INDEX idx_sittings_previstos ON public.sittings_traslados USING btree (estado, fecha) WHERE (estado = 'previsto'::text);
CREATE INDEX idx_sittings_asignacion_fecha ON public.sittings_traslados USING btree (asignacion_id, fecha) WHERE (asignacion_id IS NOT NULL);
CREATE INDEX idx_sittings_familia_id ON public.sittings_traslados USING btree (familia_id);
CREATE INDEX idx_sittings_familia_nombre ON public.sittings_traslados USING btree (familia_nombre);
CREATE INDEX idx_sittings_fecha ON public.sittings_traslados USING btree (fecha);
CREATE INDEX idx_sittings_ninera_id ON public.sittings_traslados USING btree (ninera_id);
CREATE INDEX idx_sittings_ninera_nombre ON public.sittings_traslados USING btree (ninera_nombre);
CREATE INDEX idx_sittings_pendiente_cobro ON public.sittings_traslados USING btree (familia_id) WHERE (cobrado = false);
CREATE INDEX idx_sittings_pendiente_pago ON public.sittings_traslados USING btree (ninera_id) WHERE (pagado = false);
CREATE INDEX idx_sittings_historial_sitting ON public.sittings_historial USING btree (sitting_id, cuando DESC);
CREATE INDEX idx_finanzas_historial_fila ON public.finanzas_historial USING btree (tabla, fila_id, cuando DESC);
CREATE INDEX idx_solicitud_ninieras_ninera_id ON public.solicitud_ninieras USING btree (ninera_id);
CREATE INDEX idx_solicitud_ninieras_solicitud_id ON public.solicitud_ninieras USING btree (solicitud_id);
CREATE INDEX idx_solicitudes_familia_id ON public.solicitudes USING btree (familia_id);
CREATE INDEX idx_solicitudes_fecha ON public.solicitudes USING btree (fecha);
CREATE INDEX pedidos_whatsapp_creado_el_idx ON public.pedidos_whatsapp USING btree (creado_el DESC);
CREATE INDEX pedidos_whatsapp_familia_id_idx ON public.pedidos_whatsapp USING btree (familia_id);
CREATE INDEX pedidos_whatsapp_solicitud_id_idx ON public.pedidos_whatsapp USING btree (solicitud_id);
CREATE INDEX pedidos_whatsapp_uso_creado_el_idx ON public.pedidos_whatsapp_uso USING btree (creado_el);

-- ----------------------------------------------------------------------------
-- Row Level Security: todas las tablas con RLS. Las que no tienen política
-- (app_secrets, respaldo_*, whatsapp_eventos_raw) solo son accesibles con la
-- service role (Edge Functions). sittings_historial: solo lectura para la app.
-- ----------------------------------------------------------------------------

alter table public.app_config enable row level security;
alter table public.app_secrets enable row level security;
alter table public.asignaciones enable row level security;
alter table public.borradores enable row level security;
alter table public.candidatas enable row level security;
alter table public.carsitting_datos enable row level security;
alter table public.contratos enable row level security;
alter table public.entrevista_preguntas enable row level security;
alter table public.entrevistas enable row level security;
alter table public.familias enable row level security;
alter table public.fechas_marketing enable row level security;
alter table public.gastos_fijos enable row level security;
alter table public.gastos_generales enable row level security;
alter table public.hijos_familia enable row level security;
alter table public.incidentes enable row level security;
alter table public.intermediaciones_enrique enable row level security;
alter table public.intermediaciones_enrique_pool enable row level security;
alter table public.intermediaciones_eventos enable row level security;
alter table public.intermediaciones_eventos_ninieras enable row level security;
alter table public.juguetes enable row level security;
alter table public.juguetes_movimientos enable row level security;
alter table public.ninieras enable row level security;
alter table public.notif_push_enviadas enable row level security;
alter table public.notif_push_preferencias enable row level security;
alter table public.notificaciones_leidas enable row level security;
alter table public.pedidos_whatsapp enable row level security;
alter table public.pedidos_whatsapp_uso enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.resenas_ninieras enable row level security;
alter table public.respaldo_asignaciones_20261005 enable row level security;
alter table public.respaldo_zona_grupos_20260930 enable row level security;
alter table public.respaldo_zonas_20260930 enable row level security;
alter table public.sittings_historial enable row level security;
alter table public.finanzas_historial enable row level security;
alter table public.sittings_traslados enable row level security;
alter table public.asignaciones_pausas enable row level security;
alter table public.ajustes_saldo enable row level security;
alter table public.variantes_precio enable row level security;
alter table public.gastos_extra enable row level security;
alter table public.respaldo_sittings_traslados_20261006 enable row level security;
alter table public.solicitud_ninieras enable row level security;
alter table public.solicitudes enable row level security;
alter table public.tarifas_traslado_config enable row level security;
alter table public.whatsapp_eventos_raw enable row level security;
alter table public.zona_grupos enable row level security;
alter table public.zonas_confirmadas enable row level security;

-- Usuarias autorizadas (11/10/2026): las políticas no dejan entrar a cualquier cuenta con
-- sesión, solo a las de esta tabla (activas). RLS sin políticas: se administra con SQL.
-- Las cuentas se cargan aparte, por id (ver supabase/migraciones/20261011_usuarias_autorizadas.sql).
create table public.usuarias_autorizadas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rol text not null check (rol in ('duena', 'desarrollo', 'socia')),
  activa boolean not null default true,
  alta_en timestamp with time zone not null default now()
);
alter table public.usuarias_autorizadas enable row level security;
-- Copia de las políticas de antes del cambio (para _DESHACER). Sin políticas: no la ve la app.
create table public.respaldo_politicas_20261011 (
  schemaname name, tablename name, policyname name, permissive text, roles name[], cmd text, qual text, with_check text
);
alter table public.respaldo_politicas_20261011 enable row level security;

create function public.es_usuaria_autorizada()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.usuarias_autorizadas where user_id = auth.uid() and activa)
$$;
revoke execute on function public.es_usuaria_autorizada() from public;
grant execute on function public.es_usuaria_autorizada() to authenticated, anon;

-- Todas las políticas (tablas y Storage, salvo la lectura pública de fotos) piden una
-- cuenta autorizada: (select public.es_usuaria_autorizada()).
create policy app_config_authenticated_all on public.app_config as permissive for all to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy borradores_propios on public.borradores as permissive for all to authenticated
  using ((select public.es_usuaria_autorizada()) and usuaria = (select auth.uid()))
  with check ((select public.es_usuaria_autorizada()) and usuaria = (select auth.uid()));
create policy solo_autenticados_todo on public.asignaciones as permissive for all to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy solo_autenticados_todo on public.candidatas as permissive for all to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy authenticated_all_carsitting_datos on public.carsitting_datos as permissive for all to authenticated
  using ((select public.es_usuaria_autorizada()))
  with check ((select public.es_usuaria_autorizada()));
create policy contratos_authenticated_all on public.contratos as permissive for all to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy "authenticated all" on public.entrevista_preguntas as permissive for all to authenticated
  using ((select public.es_usuaria_autorizada()))
  with check ((select public.es_usuaria_autorizada()));
create policy solo_autenticados_todo on public.entrevistas as permissive for all to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy solo_autenticados_todo on public.familias as permissive for all to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy fechas_marketing_authenticated_all on public.fechas_marketing as permissive for all to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy gastos_fijos_authenticated_all on public.gastos_fijos as permissive for all to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy gastos_generales_authenticated_all on public.gastos_generales as permissive for all to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy "authenticated all" on public.hijos_familia as permissive for all to authenticated
  using ((select public.es_usuaria_autorizada()))
  with check ((select public.es_usuaria_autorizada()));
create policy authenticated_all on public.incidentes as permissive for all to authenticated
  using ((select public.es_usuaria_autorizada()))
  with check ((select public.es_usuaria_autorizada()));
create policy authenticated_all on public.intermediaciones_enrique as permissive for all to authenticated
  using ((select public.es_usuaria_autorizada()))
  with check ((select public.es_usuaria_autorizada()));
create policy authenticated_all on public.intermediaciones_enrique_pool as permissive for all to authenticated
  using ((select public.es_usuaria_autorizada()))
  with check ((select public.es_usuaria_autorizada()));
create policy authenticated_all on public.intermediaciones_eventos as permissive for all to authenticated
  using ((select public.es_usuaria_autorizada()))
  with check ((select public.es_usuaria_autorizada()));
create policy authenticated_all on public.intermediaciones_eventos_ninieras as permissive for all to authenticated
  using ((select public.es_usuaria_autorizada()))
  with check ((select public.es_usuaria_autorizada()));
create policy solo_autenticados_todo on public.juguetes as permissive for all to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy solo_autenticados_todo on public.juguetes_movimientos as permissive for all to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy solo_autenticados_todo on public.ninieras as permissive for all to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy notif_push_enviadas_authenticated_all on public.notif_push_enviadas as permissive for all to authenticated
  using ((select public.es_usuaria_autorizada()))
  with check ((select public.es_usuaria_autorizada()));
create policy notif_push_preferencias_authenticated_all on public.notif_push_preferencias as permissive for all to authenticated
  using ((select public.es_usuaria_autorizada()))
  with check ((select public.es_usuaria_autorizada()));
create policy notificaciones_leidas_authenticated_all on public.notificaciones_leidas as permissive for all to authenticated
  using ((select public.es_usuaria_autorizada()))
  with check ((select public.es_usuaria_autorizada()));
create policy solo_autenticados_todo on public.pedidos_whatsapp as permissive for all to public
  using ((select public.es_usuaria_autorizada())) with check ((select public.es_usuaria_autorizada()));
create policy solo_autorizadas_leer on public.pedidos_whatsapp_uso as permissive for select to public
  using ((select public.es_usuaria_autorizada()));
create policy push_subscriptions_authenticated_all on public.push_subscriptions as permissive for all to authenticated
  using ((select public.es_usuaria_autorizada()))
  with check ((select public.es_usuaria_autorizada()));
create policy resenas_ninieras_authenticated_all on public.resenas_ninieras as permissive for all to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy sittings_historial_leer on public.sittings_historial as permissive for select to authenticated
  using ((select public.es_usuaria_autorizada()));
create policy finanzas_historial_leer on public.finanzas_historial as permissive for select to authenticated
  using ((select public.es_usuaria_autorizada()));
create policy solo_autenticados_todo on public.asignaciones_pausas as permissive for all to public
  using ((select public.es_usuaria_autorizada())) with check ((select public.es_usuaria_autorizada()));
create policy solo_autenticados_todo on public.ajustes_saldo as permissive for all to public
  using ((select public.es_usuaria_autorizada())) with check ((select public.es_usuaria_autorizada()));
create policy solo_autenticados_todo on public.variantes_precio as permissive for all to public
  using ((select public.es_usuaria_autorizada())) with check ((select public.es_usuaria_autorizada()));
create policy solo_autenticados_todo on public.gastos_extra as permissive for all to public
  using ((select public.es_usuaria_autorizada())) with check ((select public.es_usuaria_autorizada()));
create policy sittings_traslados_authenticated_all on public.sittings_traslados as permissive for all to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy solicitud_ninieras_authenticated_all on public.solicitud_ninieras as permissive for all to authenticated
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy solicitudes_authenticated_all on public.solicitudes as permissive for all to authenticated
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy tarifas_traslado_config_authenticated_all on public.tarifas_traslado_config as permissive for all to authenticated
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy "authenticated all" on public.zona_grupos as permissive for all to authenticated
  using ((select public.es_usuaria_autorizada()))
  with check ((select public.es_usuaria_autorizada()));
create policy "authenticated all" on public.zonas_confirmadas as permissive for all to authenticated
  using ((select public.es_usuaria_autorizada()))
  with check ((select public.es_usuaria_autorizada()));

-- ----------------------------------------------------------------------------
-- Storage: 3 buckets públicos de lectura y uno privado (comprobantes, 08/10/2026)
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public) values
  ('candidatas-fotos', 'candidatas-fotos', true),
  ('juguetes-fotos', 'juguetes-fotos', true),
  ('ninieras-fotos', 'ninieras-fotos', true),
  ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;

-- comprobantes: privado, solo usuarias autorizadas (tickets de gastos extra).
create policy comprobantes_autenticados_leer on storage.objects as permissive for select to public
  using (((bucket_id = 'comprobantes'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));
create policy comprobantes_autenticados_subir on storage.objects as permissive for insert to public
  with check (((bucket_id = 'comprobantes'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));
create policy comprobantes_autenticados_borrar on storage.objects as permissive for delete to public
  using (((bucket_id = 'comprobantes'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));

-- Fotos de niñeras y juguetes (12/10/2026, S2): listar el bucket pide una cuenta autorizada.
-- Las fotos se ven igual por su URL pública (los buckets son públicos).
-- candidatas-fotos no tiene políticas desde el 05/10/2026: solo sube la Edge Function
-- candidatas-webhook (clave de servicio) y las fotos se ven por URL pública. Antes había
-- dos políticas que dejaban subir y listar sin login.
create policy juguetes_fotos_authenticated_delete on storage.objects as permissive for delete to public
  using (((bucket_id = 'juguetes-fotos'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));
create policy juguetes_fotos_authenticated_update on storage.objects as permissive for update to public
  using (((bucket_id = 'juguetes-fotos'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));
create policy juguetes_fotos_authenticated_write on storage.objects as permissive for insert to public
  with check (((bucket_id = 'juguetes-fotos'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));
create policy juguetes_fotos_public_read on storage.objects as permissive for select to public
  using (((bucket_id = 'juguetes-fotos'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));
create policy ninieras_fotos_authenticated_delete on storage.objects as permissive for delete to public
  using (((bucket_id = 'ninieras-fotos'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));
create policy ninieras_fotos_authenticated_update on storage.objects as permissive for update to public
  using (((bucket_id = 'ninieras-fotos'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));
create policy ninieras_fotos_authenticated_write on storage.objects as permissive for insert to public
  with check (((bucket_id = 'ninieras-fotos'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));
create policy ninieras_fotos_public_read on storage.objects as permissive for select to public
  using (((bucket_id = 'ninieras-fotos'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));

-- ----------------------------------------------------------------------------
-- Funciones y tareas programadas (pg_cron)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reprogramar_fechas_marketing_vencidas()
 RETURNS TABLE(id uuid, titulo text, fecha_anterior date, fecha_nueva date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  nueva_fecha date;
begin
  for r in
    select f.id, f.titulo, f.fecha, f.notas
    from public.fechas_marketing f
    where f.fecha < current_date
  loop
    nueva_fecha := r.fecha;
    while nueva_fecha < current_date loop
      nueva_fecha := (nueva_fecha + interval '1 year')::date;
    end loop;

    update public.fechas_marketing
    set fecha = nueva_fecha,
        publicado = false,
        notas = case
          when r.notas is null or r.notas = '' then
            'Reprogramada automáticamente el ' || to_char(current_date, 'DD/MM/YYYY') || ' (antes: ' || to_char(r.fecha, 'DD/MM/YYYY') || ').'
          else
            r.notas || ' | Reprogramada automáticamente el ' || to_char(current_date, 'DD/MM/YYYY') || ' (antes: ' || to_char(r.fecha, 'DD/MM/YYYY') || ').'
        end
    where fechas_marketing.id = r.id;

    id := r.id;
    titulo := r.titulo;
    fecha_anterior := r.fecha;
    fecha_nueva := nueva_fecha;
    return next;
  end loop;
  return;
end;
$function$;

revoke execute on function public.reprogramar_fechas_marketing_vencidas() from public, anon, authenticated;
grant execute on function public.reprogramar_fechas_marketing_vencidas() to service_role;

-- Todos los días a las 06:00 UTC (03:00 en Montevideo).
select cron.schedule('reprogramar-fechas-marketing', '0 6 * * *', $$select public.reprogramar_fechas_marketing_vencidas();$$);

-- Cada 10 minutos: dispara la Edge Function de avisos push urgentes. En otro proyecto,
-- cambiar la URL por la de ese proyecto. La función pide la clave x-cron-secret
-- (app_secrets 'cron_push_secret', 13/10/2026): cargarla con un valor al azar.
select cron.schedule('enviar-push-urgentes', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://wvewzamdohrpfhpccvcz.supabase.co/functions/v1/enviar-push-urgentes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select valor from public.app_secrets where clave = 'cron_push_secret')
    ),
    body := '{}'::jsonb
  );
$$);

-- Historial de sittings: cada alta, cambio y baja queda registrada con el mail de quien
-- lo hizo (sale del token de la sesión).
CREATE OR REPLACE FUNCTION public.registrar_historial_sitting()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  usr text;
  diff jsonb := '{}'::jsonb;
  k text;
  viejo jsonb;
  nuevo jsonb;
begin
  begin
    usr := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    usr := null;
  end;
  usr := coalesce(usr, current_user);

  if tg_op = 'INSERT' then
    insert into public.sittings_historial (sitting_id, accion, usuario, fila) values (new.id, 'alta', usr, to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.sittings_historial (sitting_id, accion, usuario, fila) values (old.id, 'baja', usr, to_jsonb(old));
    return old;
  else
    viejo := to_jsonb(old);
    nuevo := to_jsonb(new);
    for k in select jsonb_object_keys(nuevo) loop
      if (viejo -> k) is distinct from (nuevo -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('antes', viejo -> k, 'despues', nuevo -> k));
      end if;
    end loop;
    if diff <> '{}'::jsonb then
      insert into public.sittings_historial (sitting_id, accion, usuario, cambios) values (new.id, 'cambio', usr, diff);
    end if;
    return new;
  end if;
end;
$function$;
revoke execute on function public.registrar_historial_sitting() from public, anon, authenticated;

create trigger sittings_historial_trg
  after insert or update or delete on public.sittings_traslados
  for each row execute function public.registrar_historial_sitting();

-- Historial de gastos generales, saldos a favor y gastos extra (15/10/2026).
-- Misma lógica que registrar_historial_sitting: el mail sale del token de la sesión.
create or replace function public.registrar_historial_finanzas()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  usr text;
  diff jsonb := '{}'::jsonb;
  k text;
  viejo jsonb;
  nuevo jsonb;
begin
  begin
    usr := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    usr := null;
  end;
  usr := coalesce(usr, current_user);

  if tg_op = 'INSERT' then
    insert into public.finanzas_historial (tabla, fila_id, accion, usuario, fila) values (tg_table_name, new.id, 'alta', usr, to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.finanzas_historial (tabla, fila_id, accion, usuario, fila) values (tg_table_name, old.id, 'baja', usr, to_jsonb(old));
    return old;
  else
    viejo := to_jsonb(old);
    nuevo := to_jsonb(new);
    for k in select jsonb_object_keys(nuevo) loop
      if (viejo -> k) is distinct from (nuevo -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('antes', viejo -> k, 'despues', nuevo -> k));
      end if;
    end loop;
    if diff <> '{}'::jsonb then
      insert into public.finanzas_historial (tabla, fila_id, accion, usuario, cambios) values (tg_table_name, new.id, 'cambio', usr, diff);
    end if;
    return new;
  end if;
end;
$function$;
revoke execute on function public.registrar_historial_finanzas() from public, anon, authenticated;

create trigger gastos_generales_historial_trg
  after insert or update or delete on public.gastos_generales
  for each row execute function public.registrar_historial_finanzas();
create trigger ajustes_saldo_historial_trg
  after insert or update or delete on public.ajustes_saldo
  for each row execute function public.registrar_historial_finanzas();
create trigger gastos_extra_historial_trg
  after insert or update or delete on public.gastos_extra
  for each row execute function public.registrar_historial_finanzas();


-- Términos y condiciones (20/10/2026).
-- Fin de un sitting para el cobro a una familia que aceptó los términos: a la media hora
-- siguiente, con 5 minutos de tolerancia (17:05 -> 17:00, 17:06 -> 17:30, 17:36 -> 18:00).
-- Minutos desde las 00:00 del día del sitting (pasada la medianoche, más de 1440). Es la
-- misma regla que redondearFinCobro() en js/core.js: si cambia una, cambia la otra.
create or replace function public.minutos_fin_cobro(p_min integer)
returns integer
language sql
immutable
set search_path to ''
as $function$
  select case when p_min % 30 <= 5 then p_min - p_min % 30 else p_min - p_min % 30 + 30 end
$function$;
revoke execute on function public.minutos_fin_cobro(integer) from public, anon, authenticated;


-- Montos sin centavos (21/10/2026, regla de Paulina y Delfina). Pago a la niñera: ,5 o menos
-- baja (600,5 -> 600; 600,6 -> 601). Cobro a la familia: ,5 o más sube (600,5 -> 601;
-- 600,4 -> 600). Primero se lleva a centavos para que una hora como 50/60 (0,8333...) no
-- deje el ,5 en ,4999... Con negativos redondea igual sobre el valor absoluto. Son las mismas
-- reglas que redondearPago() y redondearCobro() en js/core.js: si cambia una, cambia la otra.
create or replace function public.redondear_pago(p numeric)
returns numeric
language sql
immutable
set search_path to ''
as $function$
  select sign(p) * ceil(abs(round(p, 2)) - 0.5)
$function$;
revoke execute on function public.redondear_pago(numeric) from public, anon, authenticated;

create or replace function public.redondear_cobro(p numeric)
returns numeric
language sql
immutable
set search_path to ''
as $function$
  select round(round(p, 2))
$function$;
revoke execute on function public.redondear_cobro(numeric) from public, anon, authenticated;


-- Cobro y pago de un sitting según la tarifa de la familia (21/10/2026). Misma cuenta que
-- generar_previstos_fijos: un fin igual o antes del inicio es al día siguiente; a la familia que
-- aceptó los términos, desde ese día, se le cobra con el fin redondeado (minutos_fin_cobro); a
-- la niñera, la hora real; montos con redondear_cobro / redondear_pago. Sin tarifa, ese monto
-- va vacío. Es la misma regla que precioSegunHorario() en js/sittings.js (lo prueba
-- supabase/pruebas/paridad_plata.sql): si cambia una, cambia la otra.
create or replace function public.precio_sitting(p_familia_id uuid, p_fecha date, p_hora_inicio time without time zone, p_hora_fin time without time zone)
returns table (horas numeric, horas_cobro numeric, cobro numeric, pago numeric)
language sql
stable
set search_path to ''
as $function$
  with h as (
    select f.cobro_hora, f.pago_hora,
           (extract(epoch from p_hora_fin) - extract(epoch from p_hora_inicio)) / 3600.0
             + case when p_hora_fin <= p_hora_inicio then 24 else 0 end as horas,
           case when f.terminos_aceptados_el is null or p_fecha < f.terminos_aceptados_el then null
                else greatest(public.minutos_fin_cobro(
                       (extract(epoch from p_hora_fin) / 60)::integer
                       + case when p_hora_fin <= p_hora_inicio then 1440 else 0 end)
                     - (extract(epoch from p_hora_inicio) / 60)::integer, 0) / 60.0
           end as horas_cobro
      from public.familias f
     where f.id = p_familia_id and p_hora_inicio is not null and p_hora_fin is not null
  )
  select h.horas, coalesce(h.horas_cobro, h.horas),
         case when coalesce(h.cobro_hora, 0) > 0 then public.redondear_cobro(coalesce(h.horas_cobro, h.horas) * h.cobro_hora) end,
         case when coalesce(h.pago_hora, 0) > 0 then public.redondear_pago(h.horas * h.pago_hora) end
    from h
$function$;
revoke execute on function public.precio_sitting(uuid, date, time without time zone, time without time zone) from public, anon, authenticated;

-- Tope diario del pedido desde WhatsApp (21/10/2026): reserva una llamada al modelo si hoy, en
-- Montevideo, van menos de p_tope entre todas las cuentas (devuelve el id), si no null. Solo la
-- usa la Edge Function pedido-whatsapp con la clave de servicio.
create or replace function public.reservar_llamada_pedido(p_creado_por text, p_probar boolean, p_tope integer)
returns uuid
language plpgsql
volatile
set search_path to ''
as $function$
declare
  v_id uuid;
  v_desde timestamp with time zone := date_trunc('day', now() at time zone 'America/Montevideo') at time zone 'America/Montevideo';
begin
  perform pg_advisory_xact_lock(hashtext('public.reservar_llamada_pedido'));
  if (select count(*) from public.pedidos_whatsapp_uso where creado_el >= v_desde) >= p_tope then
    return null;
  end if;
  insert into public.pedidos_whatsapp_uso (creado_por, probar) values (p_creado_por, coalesce(p_probar, false))
  returning id into v_id;
  return v_id;
end
$function$;
revoke execute on function public.reservar_llamada_pedido(text, boolean, integer) from public, anon, authenticated;


-- Fijos automáticos (06/10/2026). El proceso. Lo corre pg_cron todos los días a las 03:00 de Montevideo (lo programa
--    _ACTIVAR) y la app lo llama después de cada cambio en un fijo, para que la ventana
--    quede al día enseguida. Hace, en orden:
--    a) lo previsto de hoy o antes pasa a 'confirmado' (llegó el día);
--    b) borra los previstos automáticos que ya no corresponden (fijo terminado, otro
--       horario o niñera desde una fecha, día sacado, pausa);
--    c) recalcula los previstos automáticos que nadie tocó (niñera, horario o tarifa nuevos,
--       o el precio del traslado cargado en el fijo);
--    d) crea los que faltan, de mañana a hoy + p_dias, salvo que ese día ya tenga una fila
--       de ese fijo (cargada a mano, "no fue", reemplazo) o de esa familia con esa niñera.
--    Un previsto que alguien edita desde la app deja de ser automático
--    (generado_automatico = false): el proceso no lo vuelve a tocar.
-- De un lado (cobro o pago): primero el total fijo (si hay varios, el último), después los
-- porcentajes y al final las sumas; a centavos y nunca menos de 0. Igual que efectoVariantes().
create or replace function public.efecto_variantes(p_base numeric, p_efectos jsonb)
returns numeric
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v numeric := coalesce(p_base, 0);
  e jsonb;
begin
  for e in select x from jsonb_array_elements(coalesce(p_efectos, '[]'::jsonb)) with ordinality t(x, i) where x->>'modo' = 'total' order by i loop
    v := coalesce((e->>'valor')::numeric, 0);
  end loop;
  for e in select x from jsonb_array_elements(coalesce(p_efectos, '[]'::jsonb)) with ordinality t(x, i) where x->>'modo' = 'porcentaje' order by i loop
    v := v * (1 + coalesce((e->>'valor')::numeric, 0) / 100);
  end loop;
  for e in select x from jsonb_array_elements(coalesce(p_efectos, '[]'::jsonb)) with ordinality t(x, i) where x->>'modo' = 'sumar' order by i loop
    v := v + coalesce((e->>'valor')::numeric, 0);
  end loop;
  return greatest(round(v, 2), 0);
end;
$function$;
revoke execute on function public.efecto_variantes(numeric, jsonb) from public, anon;
grant execute on function public.efecto_variantes(numeric, jsonb) to authenticated;

-- Cobro y pago con las variantes aplicadas, sin centavos (redondear_cobro / redondear_pago).
-- Igual que aplicarVariantes() en js/core.js; la puede usar la app de niñeras más adelante.
create or replace function public.precio_con_variantes(p_cobro numeric, p_pago numeric, p_aplicadas jsonb)
returns jsonb
language sql
immutable
set search_path to ''
as $function$
  select case when p_aplicadas is null then null else jsonb_build_object(
    'cobro', public.redondear_cobro(public.efecto_variantes(p_cobro,
      (select coalesce(jsonb_agg(a->'cobro' order by i), '[]'::jsonb) from jsonb_array_elements(p_aplicadas) with ordinality t(a, i) where jsonb_typeof(a->'cobro') = 'object'))),
    'pago', public.redondear_pago(public.efecto_variantes(p_pago,
      (select coalesce(jsonb_agg(a->'pago' order by i), '[]'::jsonb) from jsonb_array_elements(p_aplicadas) with ordinality t(a, i) where jsonb_typeof(a->'pago') = 'object'))))
  end
$function$;
revoke execute on function public.precio_con_variantes(numeric, numeric, jsonb) from public, anon;
grant execute on function public.precio_con_variantes(numeric, numeric, jsonb) to authenticated;

create or replace function public.generar_previstos_fijos(p_dias integer default 14)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  hoy date := (now() at time zone 'America/Montevideo')::date;
  n_confirmados integer;
  n_borrados integer;
  n_actualizados integer;
  n_creados integer;
begin
  if p_dias is null or p_dias < 1 or p_dias > 60 then
    raise exception 'p_dias tiene que estar entre 1 y 60 (vino %)', p_dias;
  end if;
  -- Dos corridas a la vez (la de las 03:00 y una de la app) se esperan una a la otra.
  perform pg_advisory_xact_lock(hashtext('generar_previstos_fijos'));

  update sittings_traslados set estado = 'confirmado' where estado = 'previsto' and fecha <= hoy;
  get diagnostics n_confirmados = row_count;

  -- Se puede llamar más de una vez en la misma transacción (por ejemplo desde _ACTIVAR).
  drop table if exists pg_temp._previstos_deseados;
  create temporary table _previstos_deseados on commit drop as
  with dias as (
    select a.*, f.nombre as fam_nombre, f.cobro_hora as fam_cobro_hora, f.pago_hora as fam_pago_hora,
           f.terminos_aceptados_el as fam_terminos, d::date as dia
      from asignaciones a
      join familias f on f.id = a.familia_id
     cross join generate_series(hoy + 1, hoy + p_dias, interval '1 day') d
     where jsonb_typeof(a.dias) = 'array'
       and a.dias ? (array['D','L','M','X','J','V','S'])[extract(dow from d)::integer + 1]
       and a.hora_inicio is not null
       and (a.vigente_desde is null or a.vigente_desde <= d::date)
       and (a.vigente_hasta is null or a.vigente_hasta >= d::date)
       and not exists (select 1 from asignaciones_pausas p where p.asignacion_id = a.id and d::date between p.desde and p.hasta)
  ), con_horas as (
    select dias.*,
           coalesce(dias.tipo, 'sitting') as tipo_fijo,
           (dias.hora_fin is not null and dias.hora_fin <= dias.hora_inicio) as cruza,
           case when dias.hora_fin is null then null
                else (extract(epoch from dias.hora_fin) - extract(epoch from dias.hora_inicio)) / 3600.0
                     + case when dias.hora_fin <= dias.hora_inicio then 24 else 0 end
           end as horas,
           -- Términos y condiciones (20/10/2026): desde el día que los aceptó, a la familia se
           -- le cobra con el fin redondeado (minutos_fin_cobro); a la niñera, la hora real.
           case when dias.hora_fin is null then null
                when dias.fam_terminos is null or dias.dia < dias.fam_terminos then null
                else greatest(public.minutos_fin_cobro(
                       (extract(epoch from dias.hora_fin) / 60)::integer
                       + case when dias.hora_fin <= dias.hora_inicio then 1440 else 0 end)
                     - (extract(epoch from dias.hora_inicio) / 60)::integer, 0) / 60.0
           end as horas_cobro
      from dias
  )
  -- Montos sin centavos (21/10/2026): el cobro con redondear_cobro y el pago con redondear_pago.
  , base as (
  select c.id as asignacion_id, c.dia as fecha, c.familia_id, c.fam_nombre as familia_nombre,
         c.ninera_id, c.ninera_nombre, c.tipo_fijo as tipo, c.hora_inicio, c.hora_fin,
         c.cruza as termina_dia_siguiente,
         (array['D','L','M','X','J','V','S'])[extract(dow from c.dia)::integer + 1] as dia_codigo,
         case when c.tipo_fijo = 'traslado' then coalesce(c.cobro_traslado, t.cobro_familia, 0)
              else public.redondear_cobro(coalesce(c.horas_cobro, c.horas, 0) * coalesce(c.fam_cobro_hora, 0)) end as cobro_base,
         case when c.tipo_fijo = 'traslado' then coalesce(c.pago_traslado, t.pago_ninera, 0)
              else public.redondear_pago(coalesce(c.horas, 0) * coalesce(c.fam_pago_hora, 0)) end as pago_base
    from con_horas c
    -- Un traslado no se cobra por hora: el precio cargado en el fijo o, si no tiene, el del
    -- último traslado de ese fijo o de esa familia (lo mismo que precarga la app).
    left join lateral (
      select s.cobro_familia, s.pago_ninera
        from sittings_traslados s
       where c.tipo_fijo = 'traslado' and (c.cobro_traslado is null or c.pago_traslado is null)
         and s.tipo = 'traslado' and not s.cancelado and s.estado = 'confirmado'
         and (s.asignacion_id = c.id or s.familia_id = c.familia_id)
       order by (s.asignacion_id = c.id) desc, s.fecha desc
       limit 1
    ) t on true
  )
  -- Variantes programadas (23/10/2026): las de ese fijo que rigen ese día ("desde el 1/11, los
  -- martes la vuelta la hace el padre"), en el orden en que se crearon. Quedan anotadas en
  -- precio_variantes (la base y cuáles se aplicaron) y el motivo, el de la primera.
  select b.asignacion_id, b.fecha, b.familia_id, b.familia_nombre, b.ninera_id, b.ninera_nombre, b.tipo,
         b.hora_inicio, b.hora_fin, b.termina_dia_siguiente,
         coalesce((public.precio_con_variantes(b.cobro_base, b.pago_base, v.aplicadas)->>'cobro')::numeric, b.cobro_base) as cobro_familia,
         coalesce((public.precio_con_variantes(b.cobro_base, b.pago_base, v.aplicadas)->>'pago')::numeric, b.pago_base) as pago_ninera,
         case when v.aplicadas is null then null
              else jsonb_build_object('base', jsonb_build_object('cobro', b.cobro_base, 'pago', b.pago_base), 'aplicadas', v.aplicadas) end as precio_variantes,
         v.motivo as precio_motivo
    from base b
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'id', vp.id, 'nombre', vp.nombre, 'motivo', vp.motivo, 'programada', true,
               'cobro', case when vp.cobro_modo is null then null else jsonb_build_object('modo', vp.cobro_modo, 'valor', vp.cobro_valor) end,
               'pago', case when vp.pago_modo is null then null else jsonb_build_object('modo', vp.pago_modo, 'valor', vp.pago_valor) end)
               order by vp.created_at, vp.id) as aplicadas,
             (array_agg(vp.motivo order by vp.created_at, vp.id))[1] as motivo
        from variantes_precio vp
       where vp.asignacion_id = b.asignacion_id and vp.activa
         and vp.auto_desde is not null and vp.auto_desde <= b.fecha
         and (vp.auto_hasta is null or vp.auto_hasta >= b.fecha)
         and (vp.auto_dias is null or vp.auto_dias ? b.dia_codigo)
         and vp.aplica_a in (b.tipo, 'ambos')
    ) v on true;

  delete from sittings_traslados s
   where s.generado_automatico and s.estado = 'previsto' and s.fecha > hoy
     and not exists (select 1 from _previstos_deseados d where d.asignacion_id = s.asignacion_id and d.fecha = s.fecha);
  get diagnostics n_borrados = row_count;

  update sittings_traslados s
     set ninera_id = d.ninera_id, ninera_nombre = d.ninera_nombre, familia_nombre = d.familia_nombre,
         tipo = d.tipo, hora_inicio = d.hora_inicio, hora_fin = d.hora_fin,
         termina_dia_siguiente = d.termina_dia_siguiente,
         cobro_familia = d.cobro_familia, pago_ninera = d.pago_ninera,
         precio_variantes = d.precio_variantes, precio_motivo = d.precio_motivo
    from _previstos_deseados d
   where s.generado_automatico and s.estado = 'previsto' and s.fecha > hoy
     and d.asignacion_id = s.asignacion_id and d.fecha = s.fecha
     and (s.ninera_id, s.ninera_nombre, s.familia_nombre, s.tipo, s.hora_inicio, s.hora_fin, s.termina_dia_siguiente, s.cobro_familia, s.pago_ninera, s.precio_variantes, s.precio_motivo)
         is distinct from
         (d.ninera_id, d.ninera_nombre, d.familia_nombre, d.tipo, d.hora_inicio, d.hora_fin, d.termina_dia_siguiente, d.cobro_familia, d.pago_ninera, d.precio_variantes, d.precio_motivo);
  get diagnostics n_actualizados = row_count;

  insert into sittings_traslados (tipo, registrado_por, asignacion_id, familia_id, familia_nombre, ninera_id,
         ninera_nombre, fecha, hora_inicio, hora_fin, termina_dia_siguiente, cobro_familia, pago_ninera,
         precio_variantes, precio_motivo, cobrado, pagado, cancelado, estado, generado_automatico, notas)
  select d.tipo, 'Automático', d.asignacion_id, d.familia_id, d.familia_nombre, d.ninera_id,
         d.ninera_nombre, d.fecha, d.hora_inicio, d.hora_fin, d.termina_dia_siguiente, d.cobro_familia, d.pago_ninera,
         d.precio_variantes, d.precio_motivo, false, false, false, 'previsto', true,
         case when d.tipo = 'traslado' then 'Traslado fijo' else 'Sitting fijo' end || ' — cargado automáticamente'
    from _previstos_deseados d
   where not exists (select 1 from sittings_traslados s where s.asignacion_id = d.asignacion_id and s.fecha = d.fecha)
     and not exists (select 1 from sittings_traslados s
                      where s.asignacion_id is null and s.fecha = d.fecha and s.familia_id = d.familia_id
                        and lower(trim(s.ninera_nombre)) = lower(trim(d.ninera_nombre)));
  get diagnostics n_creados = row_count;

  return jsonb_build_object('confirmados', n_confirmados, 'borrados', n_borrados,
                            'actualizados', n_actualizados, 'creados', n_creados, 'hoy', hoy);
end;
$function$;
revoke execute on function public.generar_previstos_fijos(integer) from public, anon;
grant execute on function public.generar_previstos_fijos(integer) to authenticated;
-- La tarea diaria (cron 'generar-previstos-fijos', 06:00 UTC) la agrega
-- 20261006_fijos_automaticos_ACTIVAR.sql junto con app_config 'fijos_automaticos'.

-- ----------------------------------------------------------------------------
-- Realtime: tablas publicadas (la app se suscribe por módulo, ver agenda.js)
-- ----------------------------------------------------------------------------

alter publication supabase_realtime add table public.app_config;
alter publication supabase_realtime add table public.asignaciones;
alter publication supabase_realtime add table public.asignaciones_pausas;
alter publication supabase_realtime add table public.ajustes_saldo;
alter publication supabase_realtime add table public.variantes_precio;
alter publication supabase_realtime add table public.gastos_extra;
alter publication supabase_realtime add table public.candidatas;
alter publication supabase_realtime add table public.carsitting_datos;
alter publication supabase_realtime add table public.contratos;
alter publication supabase_realtime add table public.entrevistas;
alter publication supabase_realtime add table public.familias;
alter publication supabase_realtime add table public.fechas_marketing;
alter publication supabase_realtime add table public.gastos_fijos;
alter publication supabase_realtime add table public.gastos_generales;
alter publication supabase_realtime add table public.incidentes;
alter publication supabase_realtime add table public.intermediaciones_enrique;
alter publication supabase_realtime add table public.intermediaciones_enrique_pool;
alter publication supabase_realtime add table public.intermediaciones_eventos;
alter publication supabase_realtime add table public.intermediaciones_eventos_ninieras;
alter publication supabase_realtime add table public.juguetes;
alter publication supabase_realtime add table public.juguetes_movimientos;
alter publication supabase_realtime add table public.ninieras;
alter publication supabase_realtime add table public.pedidos_whatsapp;
alter publication supabase_realtime add table public.resenas_ninieras;
alter publication supabase_realtime add table public.sittings_traslados;
alter publication supabase_realtime add table public.solicitud_ninieras;
alter publication supabase_realtime add table public.solicitudes;
alter publication supabase_realtime add table public.tarifas_traslado_config;
