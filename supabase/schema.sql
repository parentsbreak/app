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

-- Cola de avisos (29/10/2026, fase 1, etapa 3; ver 20261029_avisos_chat.sql): push a niñeras y a
-- admins. Va a una niñera (para_ninera_id) o a las admins (para_admin: 'todas' o el mail de una),
-- nunca a las dos ni a ninguna. La clave es única (encolar_aviso no duplica). enviado_en lo pone
-- reclamar_avisos; si el envío falla, enviar-avisos lo vuelve a dejar en null con un enviar_desde
-- más tarde (hasta 3 intentos) y anota error. Solo lectura desde la app.
create table public.avisos (
  id uuid default gen_random_uuid() not null,
  clave text not null,
  para_ninera_id uuid,
  para_admin text,
  tipo text not null,
  titulo text not null,
  cuerpo text,
  url text,
  datos jsonb default '{}'::jsonb not null,
  enviar_desde timestamp with time zone default now() not null,
  enviado_en timestamp with time zone,
  error text,
  intentos integer default 0 not null,
  leido_en timestamp with time zone,
  creado_en timestamp with time zone default now() not null,
  constraint avisos_pkey PRIMARY KEY (id),
  constraint avisos_clave_key UNIQUE (clave),
  constraint avisos_un_destinatario CHECK (((para_ninera_id IS NULL) <> (para_admin IS NULL)))
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
  -- Desde la app de niñeras (02/11/2026, etapa 10): las rutas de las 7 fotos, el envío y la revisión. Las filas del
  -- formulario de Google no tienen enviado_en.
  fotos jsonb,
  enviado_en timestamp with time zone,
  revision text,
  revisado_en timestamp with time zone,
  revisado_por text,
  comentario text,
  aprobado_en timestamp with time zone,
  aprobado_por text,
  aprobado_datos jsonb,
  constraint carsitting_datos_pkey PRIMARY KEY (id),
  constraint carsitting_datos_revision_check check (revision is null or revision in ('pendiente', 'aprobado', 'rehacer')),
  constraint carsitting_datos_comentario_check check (comentario is null or char_length(comentario) <= 500)
);

-- Chat entre cada niñera y las admins (29/10/2026, fase 1, etapa 3): un hilo por niñera, solo
-- texto. El texto no puede quedar vacío (ni solo espacios o renglones en blanco) ni pasar de 2.000
-- caracteres. La niñera escribe con ninera_enviar_mensaje; las admins, insert directo con de = 'admin'.
create table public.chat_mensajes (
  id uuid default gen_random_uuid() not null,
  ninera_id uuid not null,
  de text not null,
  autor text not null,
  texto text not null,
  creado_en timestamp with time zone default now() not null,
  leido_ninera_en timestamp with time zone,
  leido_admin_en timestamp with time zone,
  constraint chat_mensajes_pkey PRIMARY KEY (id),
  constraint chat_mensajes_de_check CHECK ((de = ANY (ARRAY['ninera'::text, 'admin'::text]))),
  constraint chat_mensajes_texto_check CHECK (((char_length(btrim(texto, E' \t\r\n')) >= 1) AND (char_length(btrim(texto, E' \t\r\n')) <= 2000)))
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
  -- "No acepta nuevas" (02/11/2026, etapa 5, decisiones 4.16): la familia solo quiere niñeras que ya
  -- conoce; las sugeridas esconden a las que nunca fueron, con "Mostrar las que nunca fueron".
  solo_conocidas boolean default false not null,
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
  -- Cuenta de la niñera en su app (26/10/2026, fase 1): una cuenta, una ficha. La crea la Edge
  -- Function ninera-cuenta con un mail sintético (mail_sintetico_ninera). app_activada_en: primer
  -- ingreso (ninera_activar_app).
  user_id uuid,
  app_activada_en timestamp with time zone,
  -- Perfil desde la app (27/10/2026, fase 1, etapa 2): cuándo lo completó por primera vez
  -- (ninera_guardar_perfil), el último guardado (un cambio de la cuenta bancaria no pasa en
  -- silencio) y la foto que propuso, a la espera de que una admin la apruebe (no reemplaza la
  -- del CV hasta entonces). La foto vive en el bucket privado ninieras-privado.
  perfil_app_en timestamp with time zone,
  perfil_actualizado_en timestamp with time zone,
  foto_propuesta_ruta text,
  foto_propuesta_en timestamp with time zone,
  temporada_lugares jsonb,
  temporada_lugares_en timestamp with time zone,
  -- CV automático (01/11/2026, 20261104_cv_automatico): las líneas que carga una admin en "CV de
  -- [nombre]" (edad sin fecha de nacimiento, estudios, experiencia, panales, idiomas,
  -- certificaciones, diferenciales; vacía = no va) y con qué se dibujó el último CV (nombre, foto,
  -- líneas), para avisar que quedó viejo. El PNG va a ninieras-fotos y el link a cv_url.
  cv_datos jsonb,
  cv_generado_con jsonb,
  -- Guía (02/11/2026, fase 1, etapa 4, 20261105_guia): RCP presencial Sí / No y la foto del certificado
  -- en ninieras-privado (rcp/<id>/certificado.jpg). Los escribe ninera_guardar_rcp.
  rcp_presencial boolean,
  rcp_certificado_ruta text,
  constraint ninieras_cv_datos_objeto CHECK (cv_datos is null or jsonb_typeof(cv_datos) = 'object'),
  constraint ninieras_cv_generado_con_objeto CHECK (cv_generado_con is null or jsonb_typeof(cv_generado_con) = 'object'),
  constraint ninieras_pkey PRIMARY KEY (id),
  constraint ninieras_user_id_key UNIQUE (user_id)
);

-- Links de invitación y de cambio de contraseña de las niñeras (26/10/2026, fase 1). Los crea
-- crear_invitacion_ninera(); solo sirve el último vigente de cada niñera (reemplazada_en) y una
-- sola vez (usada_en, lo marca ninera-cuenta). Solo admins.
create table public.ninera_invitaciones (
  id uuid default gen_random_uuid() not null,
  ninera_id uuid not null,
  token text not null,
  creada_por text,
  creada_en timestamp with time zone default now() not null,
  vence_en timestamp with time zone not null,
  usada_en timestamp with time zone,
  reemplazada_en timestamp with time zone,
  constraint ninera_invitaciones_pkey PRIMARY KEY (id),
  constraint ninera_invitaciones_token_key UNIQUE (token)
);

-- Días que la niñera marcó que no puede (02/11/2026, etapa 5; textos 4). No la sacan de las
-- sugeridas: la bajan dentro de su grupo. Nadie escribe directo: ella, con ninera_marcar_no_disponible.
create table public.ninera_no_disponible (
  ninera_id uuid not null,
  fecha date not null,
  creado_en timestamp with time zone default now() not null,
  constraint ninera_no_disponible_pkey PRIMARY KEY (ninera_id, fecha)
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
  -- La niñera que pide la madre, tal cual la escribe (02/11/2026, etapa 5); la devuelve pedido-whatsapp.
  ninera_pedida text,
  -- Etapa 11 (03/11/2026): el origen, el destino y la zona de destino de un traslado, como los saca el ticket.
  origen text,
  destino text,
  destino_zona text,
  constraint pedidos_whatsapp_pkey PRIMARY KEY (id),
  constraint pedidos_whatsapp_texto_check CHECK ((char_length(texto) between 1 and 6000)),
  constraint pedidos_whatsapp_estado_check CHECK ((estado = ANY (ARRAY['borrador'::text, 'confirmado'::text, 'descartado'::text]))),
  constraint pedidos_whatsapp_tipo_check CHECK ((tipo = ANY (ARRAY['pedido_nuevo'::text, 'cambio'::text, 'cancelacion'::text, 'otra_cosa'::text]))),
  constraint pedidos_whatsapp_servicio_check CHECK ((servicio = ANY (ARRAY['sitting'::text, 'traslado'::text]))),
  constraint pedidos_whatsapp_chicos_check CHECK ((chicos_cantidad between 1 and 12)),
  constraint pedidos_whatsapp_ninera_pedida_check CHECK (((ninera_pedida IS NULL) OR (char_length(ninera_pedida) <= 80))),
  constraint pedidos_whatsapp_origen_check check (origen is null or char_length(origen) <= 300),
  constraint pedidos_whatsapp_destino_check check (destino is null or char_length(destino) <= 300),
  constraint pedidos_whatsapp_destino_zona_check check (destino_zona is null or char_length(destino_zona) <= 80)
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
  user_id uuid, -- 26/10/2026: la cuenta de la niñera (las admins van por usuario, el mail)
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
  -- Etapa 6 (01/11/2026): el pedido de donde salió este registro (lo escribe "Asignar"). De ahí la
  -- app de niñeras saca las indicaciones, el precio por hora y la marca de horario aproximado.
  solicitud_id uuid,
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

-- Pago por hora de una niñera con una familia (31/10/2026, regla 2 de reglas-del-negocio): manda
-- sobre familias.pago_hora; en un fijo, antes va el precio del fijo (01/11/2026,
-- generar_previstos_fijos). Sin cobro: la familia paga siempre su tarifa. La reutiliza la etapa 5
-- (decisiones 4.18). Solo admins.
create table public.precios_ninera_familia (
  id uuid default gen_random_uuid() not null,
  familia_id uuid not null,
  ninera_id uuid not null,
  pago_hora numeric not null,
  nota text,
  creado_por text,
  creado_en timestamp with time zone default now() not null,
  actualizado_en timestamp with time zone default now() not null,
  constraint precios_ninera_familia_pkey primary key (id),
  constraint precios_ninera_familia_par_key unique (familia_id, ninera_id),
  constraint precios_ninera_familia_pago_check check (pago_hora > 0 and pago_hora < 100000),
  constraint precios_ninera_familia_nota_check check (nota is null or char_length(nota) <= 200)
);
comment on table public.precios_ninera_familia is
  'Pago por hora de una niñera con una familia (regla 2). El pago por hora de un sitting es, en este orden: el precio del fijo (asignaciones.pago_hora, si es mayor que 0), el de esta tabla para esa niñera con esa familia, la tarifa de la familia (familias.pago_hora). Solo admins.';

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
  constraint finanzas_historial_tabla_check CHECK ((tabla = ANY (ARRAY['gastos_generales'::text, 'ajustes_saldo'::text, 'gastos_extra'::text, 'precios_ninera_familia'::text]))),
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
  -- Pedido por la app (02/11/2026, etapa 5; ver 20261102_pedidos_app.sql). origen: 'panel' (como
  -- siempre) o 'app' (lo que se mandó por la app: una sola vez por niñera y pedido). 'acepto' es
  -- "Puedo" y 'no_puedo' "No puedo" (con motivo_no y, solo con 'otro', motivo_texto). precio_hora es
  -- lo que se le ofreció por hora.
  origen text default 'panel' not null,
  precio_hora numeric,
  enviado_en timestamp with time zone,
  respondido_en timestamp with time zone,
  motivo_no text,
  motivo_texto text,
  -- Etapa 6 (01/11/2026; ver 20261103_eleccion_pedidos.sql): seleccionada_en = cuándo le llegó
  -- "¡Quedaste seleccionada!"; visto_en = cuándo lo vio en la app (la tarjeta de arriba y los avisos
  -- de una vez se van). 'cubierto' = se asignó a otra; 'cancelado' = se canceló el pedido.
  seleccionada_en timestamp with time zone,
  visto_en timestamp with time zone,
  -- Etapa 11 (03/11/2026): lo que se le ofreció por el viaje en un traslado (precio_hora queda vacío).
  precio_viaje numeric,
  constraint solicitud_ninieras_pkey PRIMARY KEY (id),
  constraint solicitud_ninieras_estado_check CHECK ((estado = ANY (ARRAY['invitada'::text, 'confirmada'::text, 'rechazada'::text, 'acepto'::text, 'no_puedo'::text, 'cubierto'::text, 'cancelado'::text]))),
  constraint solicitud_ninieras_origen_check CHECK ((origen = ANY (ARRAY['panel'::text, 'app'::text]))),
  constraint solicitud_ninieras_precio_hora_check CHECK (((precio_hora IS NULL) OR ((precio_hora > (0)::numeric) AND (precio_hora < (100000)::numeric)))),
  constraint solicitud_ninieras_motivo_no_check CHECK (((motivo_no IS NULL) OR (motivo_no = ANY (ARRAY['otro_trabajo'::text, 'facultad'::text, 'lejos'::text, 'tarde'::text, 'otro'::text])))),
  constraint solicitud_ninieras_motivo_texto_check CHECK (((motivo_texto IS NULL) OR (char_length(motivo_texto) <= 200))),
  constraint solicitud_ninieras_precio_viaje_check check (precio_viaje is null or (precio_viaje > 0 and precio_viaje < 100000))
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
  -- Pedido por la app (02/11/2026, etapa 5): la niñera que pidió la madre, las notas que ven las
  -- elegidas (etapa 6), el primer envío por la app y hasta cuándo se espera la respuesta.
  ninera_pedida_id uuid,
  notas_para_ninera text,
  enviado_app_en timestamp with time zone,
  responder_hasta timestamp with time zone,
  -- Etapa 6 (01/11/2026): la madre no dio una hora de fin cerrada; solo con la marca va
  -- "(aproximada, se puede extender)" en el aviso del pedido y en la app de niñeras.
  horario_aproximado boolean default false not null,
  -- Etapa 11 (03/11/2026, 20261109_traslados_app): un traslado lleva origen, destino, la zona de destino (zona es la de
  -- origen) y los km. La niñera ve las zonas antes de que la elijan y las direcciones al quedar confirmada.
  origen text,
  destino text,
  destino_zona text,
  km numeric,
  constraint solicitudes_pkey PRIMARY KEY (id),
  constraint solicitudes_estado_check CHECK ((estado = ANY (ARRAY['sin_asignar'::text, 'pendiente_confirmar'::text, 'confirmada'::text, 'cancelada'::text]))),
  constraint solicitudes_tipo_check CHECK ((tipo = ANY (ARRAY['sitting'::text, 'traslado'::text]))),
  constraint solicitudes_notas_para_ninera_check CHECK (((notas_para_ninera IS NULL) OR (char_length(notas_para_ninera) <= 1000))),
  constraint solicitudes_origen_check check (origen is null or char_length(origen) <= 300),
  constraint solicitudes_destino_check check (destino is null or char_length(destino) <= 300),
  constraint solicitudes_destino_zona_check check (destino_zona is null or char_length(destino_zona) <= 80),
  constraint solicitudes_km_check check (km is null or (km > 0 and km < 1000))
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
alter table public.avisos add constraint avisos_para_ninera_id_fkey FOREIGN KEY (para_ninera_id) REFERENCES ninieras(id) ON DELETE CASCADE;
alter table public.chat_mensajes add constraint chat_mensajes_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id) ON DELETE CASCADE;
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
alter table public.ninieras add constraint ninieras_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.ninera_invitaciones add constraint ninera_invitaciones_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id) ON DELETE CASCADE;
alter table public.ninera_no_disponible add constraint ninera_no_disponible_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id) ON DELETE CASCADE;
alter table public.push_subscriptions add constraint push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.resenas_ninieras add constraint resenas_ninieras_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id) ON DELETE SET NULL;
alter table public.asignaciones_pausas add constraint asignaciones_pausas_asignacion_id_fkey FOREIGN KEY (asignacion_id) REFERENCES asignaciones(id) ON DELETE CASCADE;
alter table public.ajustes_saldo add constraint ajustes_saldo_familia_id_fkey FOREIGN KEY (familia_id) REFERENCES familias(id);
alter table public.variantes_precio add constraint variantes_precio_familia_id_fkey FOREIGN KEY (familia_id) REFERENCES familias(id) ON DELETE CASCADE;
alter table public.variantes_precio add constraint variantes_precio_asignacion_id_fkey FOREIGN KEY (asignacion_id) REFERENCES asignaciones(id) ON DELETE SET NULL;
alter table public.precios_ninera_familia add constraint precios_ninera_familia_familia_id_fkey FOREIGN KEY (familia_id) REFERENCES familias(id) ON DELETE CASCADE;
alter table public.precios_ninera_familia add constraint precios_ninera_familia_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id) ON DELETE CASCADE;
alter table public.ajustes_saldo add constraint ajustes_saldo_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id);
alter table public.gastos_extra add constraint gastos_extra_sitting_id_fkey FOREIGN KEY (sitting_id) REFERENCES sittings_traslados(id) ON DELETE CASCADE;
alter table public.gastos_extra add constraint gastos_extra_ajuste_id_fkey FOREIGN KEY (ajuste_id) REFERENCES ajustes_saldo(id) ON DELETE SET NULL;
alter table public.sittings_traslados add constraint sittings_traslados_asignacion_id_fkey FOREIGN KEY (asignacion_id) REFERENCES asignaciones(id) ON DELETE SET NULL;
alter table public.sittings_traslados add constraint sittings_traslados_familia_id_fkey FOREIGN KEY (familia_id) REFERENCES familias(id) ON DELETE SET NULL;
alter table public.sittings_traslados add constraint sittings_traslados_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id) ON DELETE SET NULL;
alter table public.sittings_traslados add constraint sittings_traslados_solicitud_id_fkey FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id) ON DELETE SET NULL;
alter table public.solicitud_ninieras add constraint solicitud_ninieras_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id) ON DELETE SET NULL;
alter table public.solicitud_ninieras add constraint solicitud_ninieras_solicitud_id_fkey FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id) ON DELETE CASCADE;
alter table public.solicitudes add constraint solicitudes_familia_id_fkey FOREIGN KEY (familia_id) REFERENCES familias(id) ON DELETE SET NULL;
alter table public.solicitudes add constraint solicitudes_ninera_pedida_id_fkey FOREIGN KEY (ninera_pedida_id) REFERENCES ninieras(id) ON DELETE SET NULL;
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
CREATE INDEX idx_avisos_pendientes ON public.avisos USING btree (enviado_en, enviar_desde);
CREATE INDEX idx_avisos_ninera ON public.avisos USING btree (para_ninera_id, creado_en DESC);
-- Los avisos de las admins, los más nuevos primero: los lee la campanita todo el tiempo (30/10/2026).
CREATE INDEX idx_avisos_admins ON public.avisos USING btree (creado_en DESC) WHERE (para_admin IS NOT NULL);
CREATE INDEX idx_chat_mensajes_ninera ON public.chat_mensajes USING btree (ninera_id, creado_en);
-- Los mensajes de niñeras sin leer por las admins: los leen Hoy y la campanita todo el tiempo (30/10/2026).
CREATE INDEX idx_chat_mensajes_sin_leer_admin ON public.chat_mensajes USING btree (creado_en DESC)
  WHERE ((de = 'ninera'::text) AND (leido_admin_en IS NULL));
CREATE INDEX idx_contratos_parte ON public.contratos USING btree (parte_nombre);
CREATE INDEX entrevistas_candidata_id_idx ON public.entrevistas USING btree (candidata_id);
CREATE INDEX idx_fechas_marketing_fecha ON public.fechas_marketing USING btree (fecha);
CREATE INDEX idx_gastos_fecha ON public.gastos_generales USING btree (fecha);
CREATE INDEX idx_hijos_familia_familia_id ON public.hijos_familia USING btree (familia_id);
CREATE INDEX idx_ninieras_activa ON public.ninieras USING btree (activa);
CREATE INDEX ninieras_candidata_id_idx ON public.ninieras USING btree (candidata_id);
CREATE UNIQUE INDEX ninieras_temporada_token_key ON public.ninieras USING btree (temporada_token);
CREATE INDEX ninera_invitaciones_ninera_id_idx ON public.ninera_invitaciones USING btree (ninera_id);
CREATE INDEX push_subscriptions_user_id_idx ON public.push_subscriptions USING btree (user_id);
CREATE INDEX idx_resenas_ninera_id ON public.resenas_ninieras USING btree (ninera_id);
CREATE INDEX idx_resenas_ninera_nombre ON public.resenas_ninieras USING btree (ninera_nombre);
CREATE INDEX idx_asignaciones_pausas ON public.asignaciones_pausas USING btree (asignacion_id, desde, hasta);
CREATE INDEX idx_ajustes_saldo_familia ON public.ajustes_saldo USING btree (familia_id) WHERE (familia_id IS NOT NULL);
CREATE INDEX idx_variantes_precio_familia ON public.variantes_precio USING btree (familia_id);
CREATE INDEX idx_precios_ninera_familia_ninera ON public.precios_ninera_familia USING btree (ninera_id);
CREATE INDEX idx_variantes_precio_programadas ON public.variantes_precio USING btree (asignacion_id) WHERE (auto_desde IS NOT NULL);
CREATE INDEX idx_ajustes_saldo_ninera ON public.ajustes_saldo USING btree (ninera_id) WHERE (ninera_id IS NOT NULL);
CREATE INDEX sittings_traslados_solicitud ON public.sittings_traslados USING btree (solicitud_id) WHERE (solicitud_id IS NOT NULL);
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
-- Una niñera recibe un pedido una sola vez por la app (lo del panel no entra: puede haber filas viejas repetidas).
CREATE UNIQUE INDEX solicitud_ninieras_app_unica ON public.solicitud_ninieras USING btree (solicitud_id, ninera_id) WHERE (origen = 'app'::text);
-- Los pedidos de la niñera (ninera_mis_pedidos) y el estado de sus respuestas.
CREATE INDEX solicitud_ninieras_ninera_estado ON public.solicitud_ninieras USING btree (ninera_id, estado);
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
alter table public.avisos enable row level security;
alter table public.borradores enable row level security;
alter table public.candidatas enable row level security;
alter table public.carsitting_datos enable row level security;
alter table public.chat_mensajes enable row level security;
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
alter table public.ninera_invitaciones enable row level security;
alter table public.ninera_no_disponible enable row level security;
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
alter table public.precios_ninera_familia enable row level security;
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
create policy solo_autorizadas_todo on public.ninera_invitaciones as permissive for all to public
  using ((select public.es_usuaria_autorizada())) with check ((select public.es_usuaria_autorizada()));
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
-- Niñeras (26/10/2026): cada cuenta lee, escribe y borra solo sus suscripciones.
create policy push_propias on public.push_subscriptions as permissive for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
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
create policy solo_autorizadas_todo on public.precios_ninera_familia as permissive for all to public
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
-- Storage: 3 buckets públicos de lectura y dos privados (comprobantes, 08/10/2026, y
-- ninieras-privado, 27/10/2026)
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public) values
  ('candidatas-fotos', 'candidatas-fotos', true),
  ('juguetes-fotos', 'juguetes-fotos', true),
  ('ninieras-fotos', 'ninieras-fotos', true),
  ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;

-- ninieras-privado (27/10/2026, fase 1): hasta 5 MB y solo imágenes (la app las achica antes de
-- subir); la etapa 4 lo amplía si guarda PDF.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ninieras-privado', 'ninieras-privado', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- comprobantes: privado, solo usuarias autorizadas (tickets de gastos extra).
create policy comprobantes_autenticados_leer on storage.objects as permissive for select to public
  using (((bucket_id = 'comprobantes'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));
create policy comprobantes_autenticados_subir on storage.objects as permissive for insert to public
  with check (((bucket_id = 'comprobantes'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));
create policy comprobantes_autenticados_borrar on storage.objects as permissive for delete to public
  using (((bucket_id = 'comprobantes'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));

-- ninieras-privado (27/10/2026, fase 1): sus dos políticas usan ninera_actual(), que se crea más
-- abajo; están después de ninera_mis_sittings(), en "Funciones".

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
create trigger precios_ninera_familia_historial_trg
  after insert or update or delete on public.precios_ninera_familia
  for each row execute function public.registrar_historial_finanzas();

-- actualizado_en de precios_ninera_familia en cada cambio (31/10/2026).
create or replace function public.precios_ninera_familia_tocar()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  new.actualizado_en := now();
  return new;
end;
$function$;
revoke execute on function public.precios_ninera_familia_tocar() from public, anon, authenticated;
create trigger precios_ninera_familia_tocar_trg
  before update on public.precios_ninera_familia
  for each row execute function public.precios_ninera_familia_tocar();


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
-- El pago por hora de una niñera con una familia (31/10/2026): su fila de precios_ninera_familia o,
-- si no hay, la tarifa de la familia si es mayor que 0 (01/11/2026: un 0 o un negativo no cuenta).
-- Null si no hay ninguno de los dos (o si quien pregunta no las puede ver: es invoker). La misma
-- regla que precioHoraNinera() en js/core.js, sin el precio del fijo.
create or replace function public.pago_hora_ninera(p_familia_id uuid, p_ninera_id uuid)
 returns numeric
 language sql
 stable
 set search_path to 'public'
as $function$
  select coalesce(
    (select p.pago_hora from public.precios_ninera_familia p
      where p.familia_id = p_familia_id and p.ninera_id = p_ninera_id),
    (select case when f.pago_hora > 0 then f.pago_hora end from public.familias f where f.id = p_familia_id)
  )
$function$;
revoke execute on function public.pago_hora_ninera(uuid, uuid) from public, anon;
grant execute on function public.pago_hora_ninera(uuid, uuid) to authenticated;

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

-- Cuentas de las niñeras (26/10/2026, fase 1; ver 20261026_cuentas_ninieras.sql).
-- Celular normalizado (regla del 26/10/2026): solo dígitos; se quita un 00 inicial (prefijo
-- internacional); si empieza en 598, el número local es el resto, si no, todo; del número local
-- se quita un 0 inicial (el 0 de larga distancia); el número local tiene que ser de 8 dígitos y
-- empezar en 9 → '598' || local; cualquier otra cosa → null (no se puede invitar: la admin
-- corrige el celular). Así '+598 99 123 456', '099123456', '99123456', '099-123-456',
-- '59899123456', '00598 99 123 456' y '+598 099 123 456' dan siempre '59899123456', y un número
-- de otro país, un fijo o uno incompleto da null.
-- Tiene que dar lo mismo que normalizarCelular() en js/comun.js y en ninera-cuenta.
create or replace function public.normalizar_celular(p text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case when l ~ '^9[0-9]{7}$' then '598' || l end
    from (select regexp_replace(case when d like '598%' then substr(d, 4) else d end, '^0', '') as l
            from (select regexp_replace(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '^00', '') as d) x) y
$function$;

-- Mail sintético de la cuenta de una niñera; null si el celular no normaliza. El dominio vive
-- solo acá en la base: tiene que ser igual a MAIL_DOMINIO_NINERA en js/comun.js y en la Edge
-- Function ninera-cuenta.
create or replace function public.mail_sintetico_ninera(p_celular text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select public.normalizar_celular(p_celular) || '@ninieras.parentsbreak.invalid'
$function$;

-- La niñera de la sesión: su ficha si está activa, o null (admin, cuenta sin ficha, dada de baja
-- o sin sesión). Mismo patrón que es_usuaria_autorizada(): security definer para leer ninieras
-- sin abrirle la tabla, y ejecutable por anon para que una política "to public" no falle.
-- Una cuenta nunca tiene los dos roles (26/10/2026): si una admin quedara vinculada a una ficha
-- por error, sigue siendo admin y no entra como niñera (null).
create or replace function public.ninera_actual()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select id from public.ninieras
   where user_id = auth.uid() and activa
     and not coalesce((select public.es_usuaria_autorizada()), false)
   limit 1
$function$;
revoke execute on function public.ninera_actual() from public;
grant execute on function public.ninera_actual() to authenticated, anon;

create or replace function public.es_ninera()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.ninera_actual() is not null
$function$;
revoke execute on function public.es_ninera() from public;
grant execute on function public.es_ninera() to authenticated, anon;

-- Primer ingreso a la app: anota la fecha una sola vez (nunca la pisa) y la devuelve; null si la
-- sesión no es de una niñera activa. Solo actualiza si estaba vacía, para no disparar un cambio
-- de Realtime en ninieras en cada ingreso.
create or replace function public.ninera_activar_app()
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := public.ninera_actual();
  v_fecha timestamp with time zone;
begin
  if v_id is null then
    return null;
  end if;
  update public.ninieras set app_activada_en = now() where id = v_id and app_activada_en is null;
  select app_activada_en into v_fecha from public.ninieras where id = v_id;
  return v_fecha;
end
$function$;
-- En Supabase anon tiene execute por defecto en public: se le saca a mano.
revoke execute on function public.ninera_activar_app() from public, anon;
grant execute on function public.ninera_activar_app() to authenticated;

-- Link de invitación (o de cambio de contraseña, si ya tiene cuenta) para una niñera. Lo llama
-- la admin desde la ficha, con su sesión. Un link nuevo invalida los anteriores de esa niñera
-- que no se usaron. Token: dos gen_random_uuid() pegados sin guiones (64 hex; sin pgcrypto),
-- como cron_push_secret. La vigencia sale de app_config 'ninieras_app' (7 días si no está o no
-- sirve). No se invita a una niñera dada de baja ni a una con un celular que no normaliza.
create or replace function public.crear_invitacion_ninera(p_ninera_id uuid)
returns table (token text, vence_en timestamp with time zone, es_reset boolean)
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_telefono text;
  v_user_id uuid;
  v_activa boolean;
  v_dias text;
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_vence timestamp with time zone;
begin
  if not coalesce((select public.es_usuaria_autorizada()), false) then
    raise exception 'no_autorizada';
  end if;
  -- for update: si dos admins generan el link a la vez, la segunda espera y reemplaza el de la
  -- primera; nunca quedan dos vigentes.
  select n.telefono, n.user_id, n.activa into v_telefono, v_user_id, v_activa
    from public.ninieras n where n.id = p_ninera_id for update;
  if not found then
    raise exception 'ninera_no_encontrada';
  end if;
  -- Dada de baja: no se invita (igual no vería nada: ninera_actual() pide activa).
  if not v_activa then
    raise exception 'ninera_inactiva';
  end if;
  if public.mail_sintetico_ninera(v_telefono) is null then
    raise exception 'celular_invalido';
  end if;
  -- Vigencia en días: si app_config trae algo que no es un entero positivo (texto, 0, negativo),
  -- 7. Así un valor mal cargado no frena todas las invitaciones ni crea links ya vencidos. El
  -- cast va solo cuando la expresión regular ya dijo que es un entero de 1 a 9999.
  v_dias := (select c.valor ->> 'vigencia_dias' from public.app_config c where c.id = 'ninieras_app');
  v_vence := now() + make_interval(days =>
    case when v_dias ~ '^[1-9][0-9]{0,3}$' then v_dias::int else 7 end);

  update public.ninera_invitaciones i set reemplazada_en = now()
   where i.ninera_id = p_ninera_id and i.usada_en is null and i.reemplazada_en is null;
  insert into public.ninera_invitaciones (ninera_id, token, creada_por, vence_en)
  values (p_ninera_id, v_token, coalesce(auth.email(), auth.uid()::text), v_vence);

  return query select v_token, v_vence, v_user_id is not null;
end
$function$;
revoke execute on function public.crear_invitacion_ninera(uuid) from public, anon;
grant execute on function public.crear_invitacion_ninera(uuid) to authenticated;

-- Configuración de la app de niñeras (como los buckets, va con la estructura): vigencia del
-- link de invitación en días. Sin la fila, crear_invitacion_ninera usa 7.
insert into public.app_config (id, valor) values ('ninieras_app', '{"vigencia_dias": 7}')
on conflict (id) do nothing;

-- Minutos para responder (decisiones 6.3, paso 5) y los tiempos de los avisos de la etapa 6.
-- solo_practica: mientras sea true, por la app solo se mandan pedidos de práctica (decisiones 4.17).
-- Hasta la guía (etapa 4) y la prueba con niñeras reales, a ninguna niñera real le llega un pedido
-- por la app (Diego, 31/10/2026). Se apaga por SQL con el OK de Diego.
-- Sin interfaz en la fase 1: se cambian por SQL.
insert into public.app_config (id, valor)
values ('pedidos_app', '{"min_mismo_dia": 15, "min_otro_dia": 30, "recordatorio_min_antes": 10, "aviso_sin_ninera_horas": 3, "solo_practica": true}'::jsonb)
on conflict (id) do nothing;

-- Perfil de la niñera y sus próximos sittings (27/10/2026, fase 1, etapa 2).
-- "Hoy" en Montevideo, como todayISO() en la app y generar_previstos_fijos: now() es UTC y de
-- 21:00 a 24:00 ya sería mañana.
create or replace function public.hoy_mvd()
returns date
language sql
stable
set search_path to ''
as $function$
  select (now() at time zone 'America/Montevideo')::date
$function$;

-- El inicio de la temporada en curso: el 1 de setiembre (0:00 de Montevideo) de este año si ya
-- llegó setiembre, si no el del año anterior. Lo cargado antes de esa fecha es de otra temporada.
create or replace function public.inicio_temporada_mvd(p_ahora timestamp with time zone default now())
returns timestamp with time zone
language sql
stable
set search_path to ''
as $function$
  select make_timestamp(
           case when extract(month from p_ahora at time zone 'America/Montevideo') >= 9
                then extract(year from p_ahora at time zone 'America/Montevideo')::int
                else extract(year from p_ahora at time zone 'America/Montevideo')::int - 1 end,
           9, 1, 0, 0, 0) at time zone 'America/Montevideo'
$function$;

-- Cómo ve la niñera a la madre: nombre y la inicial del apellido, nunca el apellido completo
-- (docs/fase1, decisiones 5.3). "María Pérez" → "María P.", "Familia Pérez" → "Familia P.",
-- una sola palabra queda igual y sin nombre, "la familia".
create or replace function public.madre_nombre_inicial(p_nombre text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case when cardinality(p) = 0 then 'la familia'
              when cardinality(p) = 1 then p[1]
              else p[1] || ' ' || left(p[cardinality(p)], 1) || '.' end
    from (select array_remove(regexp_split_to_array(coalesce(p_nombre, ''), '\s+'), '') as p) x
$function$;

-- Los chicos de una familia en una línea: "2 chicos (3 y 5 años)". La edad es la misma regla que
-- edadHijo() en core.js: años cumplidos desde la fecha de nacimiento o, si no hay, la edad
-- declarada más los años que pasaron desde que se declaró (nunca negativos: una fecha futura
-- suma 0, como anosCompletosDesde). Un bebé es "menos de 1 año"; el que no
-- tiene edad cuenta pero no va entre paréntesis. Sin hijos cargados, el texto viejo de
-- familias.ninos recortado a 80; sin nada, null.
-- Invoker a propósito: desde ninera_mis_sittings (security definer) corre como su dueña; llamada
-- directo por una niñera no ve hijos ni familias (RLS) y da null.
create or replace function public.chicos_texto(p_familia_id uuid)
returns text
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_n integer;
  v_edades integer[];
  v_partes text[];
  v_ninos text;
begin
  select count(*),
         array_agg(e.edad order by e.orden, e.created_at, e.id) filter (where e.edad is not null)
    into v_n, v_edades
    from (select h.orden, h.created_at, h.id,
                 case when h.fecha_nacimiento is not null
                        then extract(year from age(public.hoy_mvd(), h.fecha_nacimiento))::int
                      when h.edad_declarada is not null
                        then h.edad_declarada + greatest(0, coalesce(extract(year from age(public.hoy_mvd(), h.edad_declarada_en))::int, 0))
                 end as edad
            from public.hijos_familia h
           where h.familia_id = p_familia_id) e;

  if v_n = 0 then
    select nullif(left(btrim(f.ninos), 80), '') into v_ninos from public.familias f where f.id = p_familia_id;
    return v_ninos;
  end if;

  if v_edades is null then
    return v_n || case when v_n = 1 then ' chico' else ' chicos' end;
  end if;

  -- Con un bebé, cada edad lleva su unidad ("menos de 1 año y 3 años"); si no, la unidad va una
  -- sola vez al final ("3 y 5 años").
  if 0 = any (v_edades) then
    v_partes := array(select case when x = 0 then 'menos de 1 año' when x = 1 then '1 año' else x || ' años' end
                        from unnest(v_edades) with ordinality u(x, o) order by o);
  else
    v_partes := array(select x::text from unnest(v_edades) with ordinality u(x, o) order by o);
    v_partes[cardinality(v_partes)] := v_partes[cardinality(v_partes)]
      || case when cardinality(v_edades) = 1 and v_edades[1] = 1 then ' año' else ' años' end;
  end if;

  return v_n || case when v_n = 1 then ' chico (' else ' chicos (' end
    || case when cardinality(v_partes) = 1 then v_partes[1]
            else array_to_string(v_partes[1:cardinality(v_partes) - 1], ', ') || ' y ' || v_partes[cardinality(v_partes)] end
    || ')';
end
$function$;

-- El perfil de la niñera de la sesión (vacío si no es niñera). Es el único lugar, junto con la
-- ficha del panel, que devuelve sus datos bancarios. foto: la del CV, la que ven las madres.
create or replace function public.ninera_mi_perfil()
returns table (id uuid, nombre text, telefono text, tipo text, zona text, barrios text,
               cuenta_bancaria text[], foto text, foto_propuesta_ruta text,
               foto_propuesta_en timestamp with time zone, perfil_app_en timestamp with time zone,
               perfil_actualizado_en timestamp with time zone, app_activada_en timestamp with time zone,
               rcp_presencial boolean, rcp_certificado boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select n.id, n.nombre, n.telefono, n.tipo, n.zona, n.barrios, n.cuenta_bancaria, n.foto,
         n.foto_propuesta_ruta, n.foto_propuesta_en, n.perfil_app_en, n.perfil_actualizado_en,
         n.app_activada_en, n.rcp_presencial, n.rcp_certificado_ruta is not null
    from public.ninieras n
   where n.id = (select public.ninera_actual())
$function$;
-- En Supabase anon tiene execute por defecto en public: se le saca a mano.
revoke execute on function public.ninera_mi_perfil() from public, anon;
grant execute on function public.ninera_mi_perfil() to authenticated;

-- Las zonas para elegir en el perfil (las mismas de la ficha del panel), por orden. Vacío si la
-- sesión no es de una niñera: la tabla sigue cerrada para ella.
create or replace function public.ninera_zonas_disponibles()
returns table (id uuid, nombre text, orden integer, fuera_de_montevideo boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select z.id, z.nombre, z.orden, z.fuera_de_montevideo
    from public.zona_grupos z
   where (select public.ninera_actual()) is not null
   order by z.orden, z.nombre
$function$;
revoke execute on function public.ninera_zonas_disponibles() from public, anon;
grant execute on function public.ninera_zonas_disponibles() to authenticated;

-- Guarda el perfil de la niñera de la sesión. Valida todo antes de escribir (nada a medias):
-- tipo de la lista, al menos una zona y todas de zona_grupos (la app manda los nombres que le dio
-- ninera_zonas_disponibles), y la foto solo en su ruta exacta (fotos/<su id>/propuesta.jpg, la
-- que sube la app con upsert). Las zonas se guardan sin repetir, en el orden en que llegaron. La
-- cuenta: una línea por renglón, sin espacios de más ni renglones vacíos, hasta 120 caracteres
-- cada una. perfil_app_en se pone una sola vez; perfil_actualizado_en, en cada guardado. Sin foto
-- nueva, la propuesta que haya queda como estaba.
create or replace function public.ninera_guardar_perfil(p_tipo text, p_zonas text[], p_cuenta text[], p_foto_ruta text default null)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := public.ninera_actual();
  v_zona text;
  v_cuenta text[];
begin
  if v_id is null then
    raise exception 'no_autorizada';
  end if;
  if p_tipo is null or p_tipo not in ('Niñera', 'Traslados', 'Ambas') then
    raise exception 'tipo_invalido';
  end if;
  if coalesce(cardinality(p_zonas), 0) = 0 then
    raise exception 'sin_zonas';
  end if;
  if exists (select 1 from unnest(p_zonas) z
              where not exists (select 1 from public.zona_grupos g where g.nombre = z)) then
    raise exception 'zona_desconocida';
  end if;
  -- Solo la ruta exacta de su foto: la ruta se guarda y la admin la abre después, así que nada
  -- de otra carpeta, otro nombre ni "..".
  if p_foto_ruta is not null and p_foto_ruta <> 'fotos/' || v_id::text || '/propuesta.jpg' then
    raise exception 'foto_invalida';
  end if;

  select string_agg(z, '/' order by o) into v_zona
    from (select z, min(o) as o from unnest(p_zonas) with ordinality u(z, o) group by z) x;

  select array_agg(left(btrim(l, E' \t\r\n'), 120) order by o) into v_cuenta
    from unnest(p_cuenta) with ordinality u(l, o)
   where btrim(l, E' \t\r\n') <> '';
  -- Una cuenta por renglón (como la ficha del panel y Por pagar): más de 10 no es una persona
  -- cargando sus cuentas sino un error o un abuso, y la fila crece sin tope (27/10/2026).
  if coalesce(cardinality(v_cuenta), 0) > 10 then
    raise exception 'demasiadas_cuentas';
  end if;

  update public.ninieras n
     set tipo = p_tipo,
         zona = v_zona,
         cuenta_bancaria = v_cuenta,
         perfil_app_en = coalesce(n.perfil_app_en, now()),
         perfil_actualizado_en = now(),
         foto_propuesta_ruta = coalesce(p_foto_ruta, n.foto_propuesta_ruta),
         foto_propuesta_en = case when p_foto_ruta is not null then now() else n.foto_propuesta_en end
   where n.id = v_id;
end
$function$;
revoke execute on function public.ninera_guardar_perfil(text, text[], text[], text) from public, anon;
grant execute on function public.ninera_guardar_perfil(text, text[], text[], text) to authenticated;

-- Los próximos sittings de la niñera de la sesión (de hoy a 60 días), sin cancelados. Nunca
-- montos, cobrado / pagado, notas internas ni precios (docs/fase1, decisiones 5.3). La dirección
-- (y el origen / destino de un traslado) solo cuando está confirmado: un previsto todavía puede
-- cambiar de niñera. notas_para_ninera (solo confirmado), horario_aproximado y precio_hora (lo ofrecido, nunca
-- un total) salen del pedido del que vino el registro (solicitud_id, etapa 6).
create or replace function public.ninera_mis_sittings()
returns table (id uuid, tipo text, fecha date, hora_inicio time without time zone,
               hora_fin time without time zone, termina_dia_siguiente boolean, estado text,
               zona text, madre text, direccion text, origen text, destino text, chicos text,
               notas_para_ninera text, horario_aproximado boolean, precio_hora numeric, solicitud_id uuid,
               destino_zona text, precio_viaje numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.id, s.tipo, s.fecha, s.hora_inicio, s.hora_fin, s.termina_dia_siguiente, s.estado,
         case when s.tipo = 'traslado' then coalesce(nullif(btrim(sol.zona), ''), f.zona) else f.zona end,
         public.madre_nombre_inicial(coalesce(f.nombre, s.familia_nombre)),
         case when s.estado = 'confirmado' then f.direccion end,
         case when s.estado = 'confirmado' then s.origen end,
         case when s.estado = 'confirmado' then s.destino end,
         public.chicos_texto(f.id),
         case when s.estado = 'confirmado' then nullif(btrim(sol.notas_para_ninera), '') end,
         coalesce(sol.horario_aproximado, false),
         sn.precio_hora,
         s.solicitud_id,
         case when s.tipo = 'traslado' then nullif(btrim(sol.destino_zona), '') end,
         case when s.tipo = 'traslado' then sn.precio_viaje end
    from public.sittings_traslados s
    left join public.familias f on f.id = s.familia_id
    left join public.solicitudes sol on sol.id = s.solicitud_id
    left join lateral (select x.precio_hora, x.precio_viaje from public.solicitud_ninieras x
                        where x.solicitud_id = s.solicitud_id and x.ninera_id = s.ninera_id and x.estado = 'confirmada'
                        order by x.created_at desc limit 1) sn on true
   where s.ninera_id = (select public.ninera_actual())
     and not s.cancelado
     and s.estado in ('previsto', 'confirmado')
     and s.fecha between public.hoy_mvd() and public.hoy_mvd() + 60
   order by s.fecha, s.hora_inicio
$function$;
revoke execute on function public.ninera_mis_sittings() from public, anon;
grant execute on function public.ninera_mis_sittings() to authenticated;

-- Lo que la niñera de la sesión ve al abrir su temporada: {lugares, al_dia, solo_afuera}, o null si
-- la sesión no es de una niñera. al_dia: la cargó (ella, la página o una admin) en esta temporada.
-- lugares, solo si está al día: los que cargó en la app si siguen valiendo (de esta temporada y sin
-- una respuesta posterior de la página o del formulario), si no armados de temporada ("punta" o
-- "la_paloma" en sus quincenas, "montevideo" en el resto). Sin estar al día es null y la app arma la
-- precarga (diciembre a marzo vacías, Diego 31/10/2026). solo_afuera: todas sus zonas son de grupos
-- de afuera (vive en Punta). Nada de plata ni de otras niñeras.
create or replace function public.ninera_mi_temporada()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := public.ninera_actual();
  v_inicio timestamp with time zone := public.inicio_temporada_mvd();
  n record;
  v_al_dia boolean;
  v_lugares jsonb;
  v_solo_afuera boolean;
begin
  if v_id is null then
    return null;
  end if;
  select ni.zona, ni.temporada, ni.temporada_actualizada_en, ni.temporada_fuente,
         ni.temporada_lugares, ni.temporada_lugares_en
    into n from public.ninieras ni where ni.id = v_id;

  v_al_dia := n.temporada_actualizada_en is not null and n.temporada_actualizada_en >= v_inicio;

  if v_al_dia then
    if n.temporada_lugares is not null and n.temporada_lugares_en >= v_inicio
       and n.temporada_fuente in ('app', 'sistema') then
      v_lugares := n.temporada_lugares;
    else
      select jsonb_object_agg(q::text,
               case when exists (select 1 from public.zona_grupos g
                                  where g.fuera_de_montevideo and lower(btrim(g.nombre)) = 'punta del este'
                                    and coalesce(n.temporada -> g.id::text, '[]'::jsonb) @> to_jsonb(q))
                      then 'punta'
                    when exists (select 1 from public.zona_grupos g
                                  where g.fuera_de_montevideo and lower(btrim(g.nombre)) = 'la paloma'
                                    and coalesce(n.temporada -> g.id::text, '[]'::jsonb) @> to_jsonb(q))
                      then 'la_paloma'
                    else 'montevideo' end)
        into v_lugares
        from generate_series(0, 23) q;
    end if;
  end if;

  -- Cada zona escrita en su ficha ("Punta del Este/La Barra") es el nombre o un barrio de un grupo de
  -- afuera, sin mayúsculas ni tildes.
  select count(*) > 0 and bool_and(exists (
           select 1 from public.zona_grupos g
            where g.fuera_de_montevideo
              and z.clave in (select translate(lower(btrim(x)), 'áéíóúüñ', 'aeiouun')
                                from unnest(array[g.nombre] || g.zonas) x)))
    into v_solo_afuera
    from (select translate(lower(btrim(s)), 'áéíóúüñ', 'aeiouun') as clave
            from regexp_split_to_table(coalesce(n.zona, ''), '[/,]') s
           where btrim(s) <> '') z;

  return jsonb_build_object('lugares', v_lugares, 'al_dia', v_al_dia, 'solo_afuera', coalesce(v_solo_afuera, false));
end
$function$;
revoke execute on function public.ninera_mi_temporada() from public, anon;
grant execute on function public.ninera_mi_temporada() to authenticated;

-- Guarda la temporada de la niñera de la sesión. p_lugares trae las 24 quincenas ("0" a "23") con
-- "montevideo", "punta", "la_paloma", "fuera_pais" o {"otro": "<texto de 1 a 80 caracteres>"}; si
-- falta una, sobra una o un valor no es de la lista, no guarda nada (temporada_invalida). Escribe
-- además temporada en el formato de siempre (el grupo de afuera Punta del Este con sus quincenas, y
-- La Paloma si un día existe ese grupo) y, si marcó un lugar cuyo grupo no está en su zona, se lo
-- agrega (como zonaConTemporada del panel y la página): si no, no aparecería al buscar esa zona.
-- Guardar sin cambios también cuenta: es su confirmación de esta temporada. No toca el comentario
-- ni el link de la página.
create or replace function public.ninera_guardar_temporada(p_lugares jsonb)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := public.ninera_actual();
  v_lugares jsonb;
  v_temporada jsonb := '{}'::jsonb;
  v_zona text;
  g record;
  v_qs jsonb;
begin
  if v_id is null then
    raise exception 'no_autorizada';
  end if;
  if p_lugares is null or jsonb_typeof(p_lugares) <> 'object'
     or (select count(*) from jsonb_object_keys(p_lugares)) <> 24
     or exists (select 1 from jsonb_object_keys(p_lugares) k
                 where k not in (select q::text from generate_series(0, 23) q))
     or exists (select 1 from jsonb_each(p_lugares) e
                 where not (
                   (jsonb_typeof(e.value) = 'string'
                     and e.value #>> '{}' in ('montevideo', 'punta', 'la_paloma', 'fuera_pais'))
                   or (jsonb_typeof(e.value) = 'object'
                     and (select count(*) from jsonb_object_keys(e.value)) = 1
                     and jsonb_typeof(e.value -> 'otro') = 'string'
                     and char_length(btrim(e.value ->> 'otro')) between 1 and 80))) then
    raise exception 'temporada_invalida';
  end if;

  -- Lo de "Otro" se guarda sin espacios de más.
  select jsonb_object_agg(e.key,
           case when jsonb_typeof(e.value) = 'object'
                then jsonb_build_object('otro', btrim(e.value ->> 'otro')) else e.value end)
    into v_lugares
    from jsonb_each(p_lugares) e;

  -- Sin el grupo Punta del Este no hay dónde dejar sus quincenas en Punta: el filtro no la vería.
  if exists (select 1 from jsonb_each(v_lugares) e where e.value = '"punta"')
     and not exists (select 1 from public.zona_grupos z
                      where z.fuera_de_montevideo and lower(btrim(z.nombre)) = 'punta del este') then
    raise exception 'sin_grupo_punta';
  end if;

  select zona into v_zona from public.ninieras where id = v_id;

  -- Un solo grupo por lugar (el primero por orden), por si un día hay dos con el mismo nombre.
  for g in select distinct on (lower(btrim(z.nombre))) z.id, z.nombre, z.zonas,
                  case lower(btrim(z.nombre)) when 'punta del este' then 'punta' else 'la_paloma' end as lugar
             from public.zona_grupos z
            where z.fuera_de_montevideo and lower(btrim(z.nombre)) in ('punta del este', 'la paloma')
            order by lower(btrim(z.nombre)), z.orden, z.id loop
    select coalesce(jsonb_agg(q order by q), '[]'::jsonb) into v_qs
      from generate_series(0, 23) q
     where v_lugares -> q::text = to_jsonb(g.lugar);
    v_temporada := v_temporada || jsonb_build_object(g.id::text, v_qs);
    if jsonb_array_length(v_qs) > 0 and not exists (
         select 1 from regexp_split_to_table(coalesce(v_zona, ''), '[/,]') s
          where translate(lower(btrim(s)), 'áéíóúüñ', 'aeiouun') in
                (select translate(lower(btrim(x)), 'áéíóúüñ', 'aeiouun') from unnest(array[g.nombre] || g.zonas) x)) then
      v_zona := concat_ws('/', nullif(btrim(v_zona), ''), g.nombre);
    end if;
  end loop;

  update public.ninieras
     set temporada_lugares = v_lugares,
         temporada_lugares_en = now(),
         temporada = v_temporada,
         zona = v_zona,
         temporada_actualizada_en = now(),
         temporada_fuente = 'app',
         temporada_propuesta = null,
         temporada_propuesta_en = null
   where id = v_id;
end
$function$;
revoke execute on function public.ninera_guardar_temporada(jsonb) from public, anon;
grant execute on function public.ninera_guardar_temporada(jsonb) to authenticated;

-- ninieras-privado (27/10/2026, fase 1): fotos propuestas por las niñeras
-- (fotos/<ninera_id>/propuesta.jpg; más adelante firmas/, rcp/ y carsitting/). Van acá y no
-- junto a las de comprobantes porque usan ninera_actual(). Cada niñera, solo la ruta exacta de su
-- foto (revisión final del 27/10/2026: con "el segundo tramo es su id" podía subir archivos sin
-- límite a cualquier carpeta). Las etapas 4 y 10 la amplían para sus propias rutas y deciden ahí
-- si la niñera puede borrar (docs/fase1, decisiones 5.3). "for all" porque la app sube con upsert
-- (select, insert o update) a la misma ruta, así nunca quedan fotos huérfanas. Una admin no pasa
-- por esta: ninera_actual() es null para ella; pasa por ninieras_privado_admins (ve, aprueba y
-- borra todo).
create policy ninieras_privado_propio on storage.objects as permissive for all to authenticated
  using (((bucket_id = 'ninieras-privado'::text) AND (name = (('fotos/'::text || (( SELECT public.ninera_actual() AS ninera_actual))::text) || '/propuesta.jpg'::text))))
  with check (((bucket_id = 'ninieras-privado'::text) AND (name = (('fotos/'::text || (( SELECT public.ninera_actual() AS ninera_actual))::text) || '/propuesta.jpg'::text))));
create policy ninieras_privado_admins on storage.objects as permissive for all to public
  using (((bucket_id = 'ninieras-privado'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)))
  with check (((bucket_id = 'ninieras-privado'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));

-- Avisos y chat (29/10/2026, fase 1, etapa 3; ver 20261029_avisos_chat.sql). Van acá porque las
-- políticas usan ninera_actual(). encolar_aviso, reclamar_avisos, programar_avisos,
-- admins_activas_mails, llamar_enviar_avisos y correr_cron_avisos son internas (triggers, cron y
-- clave de servicio); las de la niñera están en la lista permitida de
-- supabase/pruebas/catalogo_seguridad.sql.
-- avisos: solo lectura desde la app. Lo escribe la base (triggers, programar_avisos) y lo marca
-- enviar-avisos con la clave de servicio; la niñera marca leído con ninera_marcar_avisos_leidos.
create policy avisos_ninera_leer on public.avisos as permissive for select to authenticated
  using ((para_ninera_id = ( SELECT public.ninera_actual() AS ninera_actual)));
create policy avisos_admins_leer on public.avisos as permissive for select to public
  using (((para_admin IS NOT NULL) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));

-- chat_mensajes: la niñera solo lee su hilo (escribe y marca leído por sus funciones). Las admins
-- leen todo, escriben solo como admin y marcan leido_admin_en (también en los de la niñera). Nadie
-- borra. Una admin le escribe a cualquier niñera activa que tenga la app (Diego, 29/10/2026): a una
-- sin cuenta el mensaje no le llegaría nunca.
create policy chat_ninera_leer on public.chat_mensajes as permissive for select to authenticated
  using ((ninera_id = ( SELECT public.ninera_actual() AS ninera_actual)));
create policy chat_admins_leer on public.chat_mensajes as permissive for select to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy chat_admins_marcar on public.chat_mensajes as permissive for update to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy chat_admins_escribir on public.chat_mensajes as permissive for insert to public
  with check ((( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada) AND (de = 'admin'::text)
    AND (EXISTS ( SELECT 1 FROM public.ninieras n
                   WHERE ((n.id = chat_mensajes.ninera_id) AND n.activa AND (n.user_id IS NOT NULL))))));
-- Desde la app, un mensaje nuevo trae solo ninera_id, de, autor y texto (id, creado_en y lo leído
-- salen de la base), y lo único que se actualiza después es leido_admin_en: así nadie cambia el
-- texto, el autor ni lo leído por la niñera (las políticas solas no lo frenan).
revoke insert, update on public.chat_mensajes from anon, authenticated;
grant insert (ninera_id, de, autor, texto) on public.chat_mensajes to authenticated;
grant update (leido_admin_en) on public.chat_mensajes to authenticated;

-- Pedido por la app (02/11/2026, etapa 5; ver 20261102_pedidos_app.sql): la niñera lee solo sus
-- días no disponibles y las admins todos; nadie escribe directo (ninera_marcar_no_disponible).
create policy ninera_no_disponible_propios on public.ninera_no_disponible as permissive for select to authenticated
  using ((ninera_id = ( SELECT public.ninera_actual() AS ninera_actual)));
create policy ninera_no_disponible_admins_leer on public.ninera_no_disponible as permissive for select to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
revoke insert, update, delete on public.ninera_no_disponible from anon, authenticated;

-- Encola un aviso; si la clave ya está no hace nada (devuelve false). Es la única forma de
-- escribir en avisos fuera de la clave de servicio: la usan los triggers y programar_avisos.
create or replace function public.encolar_aviso(p_clave text, p_para_ninera uuid, p_para_admin text, p_tipo text,
  p_titulo text, p_cuerpo text, p_url text, p_datos jsonb default '{}'::jsonb,
  p_enviar_desde timestamp with time zone default now())
returns boolean
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  insert into public.avisos (clave, para_ninera_id, para_admin, tipo, titulo, cuerpo, url, datos, enviar_desde)
  values (p_clave, p_para_ninera, p_para_admin, p_tipo, p_titulo, p_cuerpo, p_url,
          coalesce(p_datos, '{}'::jsonb), coalesce(p_enviar_desde, now()))
  on conflict (clave) do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end
$function$;
revoke execute on function public.encolar_aviso(text, uuid, text, text, text, text, text, jsonb, timestamp with time zone) from public, anon, authenticated;

-- Reclama hasta p_max avisos pendientes (los más viejos primero) y los marca como enviados en el
-- mismo update. "for update skip locked": si el trigger y el cron llaman a la vez a enviar-avisos,
-- cada fila la devuelve uno solo. Solo la clave de servicio (enviar-avisos).
create or replace function public.reclamar_avisos(p_max integer default 50)
returns setof public.avisos
language sql
volatile
security definer
set search_path to 'public'
as $function$
  update public.avisos a
     set enviado_en = now(), intentos = a.intentos + 1
   where a.id in (select p.id from public.avisos p
                   where p.enviado_en is null and p.enviar_desde <= now()
                   order by p.enviar_desde
                   limit coalesce(p_max, 50)
                   for update skip locked)
  returning a.*
$function$;
revoke execute on function public.reclamar_avisos(integer) from public, anon, authenticated;
grant execute on function public.reclamar_avisos(integer) to service_role;

-- Regla de avisos de la temporada (decisiones 6.6; Diego, 31/10/2026). Del 1/10 al 31/12, solo de
-- 9:00 a 21:00 de Montevideo, a cada niñera activa con app que no cargó la temporada de este año:
-- el primer aviso (clave temporada:<año>:<id>) y, cada 15 días contados desde ESE aviso, un
-- recordatorio (temporada:<año>:<id>:q<n>). Contar desde su primer aviso y no desde el 1/10 hace que
-- la que entra a la app en noviembre (o el día que se publica esto) reciba uno y no varios
-- atrasados de golpe. Si la carga (desde la app, la página o una admin), no se encola nada más.
-- Una sola consulta por corrida y, fuera de esas fechas y horas, ninguna. p_ahora es para las
-- pruebas; el cron la llama sin nada.
create or replace function public.programar_avisos_temporada(p_ahora timestamp with time zone default now())
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_local timestamp := p_ahora at time zone 'America/Montevideo';
  v_anio integer := extract(year from v_local)::int;
  v_inicio timestamp with time zone := public.inicio_temporada_mvd(p_ahora);
  v_n integer;
begin
  if extract(month from v_local) not between 10 and 12
     or extract(hour from v_local) not between 9 and 20 then
    return 0;
  end if;

  with pendientes as (
    select n.id, a.creado_en as primero_en
      from public.ninieras n
      left join public.avisos a on a.clave = 'temporada:' || v_anio || ':' || n.id
     where n.activa and n.user_id is not null
       and (n.temporada_actualizada_en is null or n.temporada_actualizada_en < v_inicio)
  ), tocan as (
    select p.id, 'temporada:' || v_anio || ':' || p.id as clave,
           '¿Vas a estar en Punta del Este esta temporada?' as titulo,
           'Marca dónde vas a estar cada quincena.' as cuerpo
      from pendientes p where p.primero_en is null
    union all
    select p.id, 'temporada:' || v_anio || ':' || p.id || ':q'
                 || floor(extract(epoch from p_ahora - p.primero_en) / (15 * 86400))::int,
           'Todavía no marcaste tu ubicación en la temporada',
           'Te lleva un minuto.'
      from pendientes p where p.primero_en <= p_ahora - interval '15 days'
  )
  select count(*) filter (where public.encolar_aviso(t.clave, t.id, null, 'temporada', t.titulo, t.cuerpo, '#temporada'))
    into v_n
    from tocan t
   where not exists (select 1 from public.avisos a where a.clave = t.clave);
  return v_n;
end
$function$;
revoke execute on function public.programar_avisos_temporada(timestamp with time zone) from public, anon, authenticated;

-- Las reglas de tiempo de los avisos (decisiones 5.4 y 7). La corre el cron cada minuto, antes de
-- llamar a enviar-avisos. Cada regla es una función programar_avisos_<regla>() que encola con
-- encolar_aviso (idempotente por clave, recalculada del estado actual: si el sitting se canceló o
-- cambió de hora antes de que toque, no se manda) y devuelve cuántos encoló; acá se suman. Las
-- etapas siguientes agregan las suyas.
create or replace function public.programar_avisos()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_total integer := 0;
begin
  v_total := v_total + public.programar_avisos_temporada();  -- etapa 9
  v_total := v_total + public.programar_avisos_pedidos();    -- etapa 6
  v_total := v_total + public.programar_avisos_guia();       -- etapa 4
  v_total := v_total + public.programar_avisos_el_dia();     -- etapa 7
  v_total := v_total + public.programar_avisos_carsitting();  -- etapa 10
  return v_total;
end
$function$;
revoke execute on function public.programar_avisos() from public, anon, authenticated;
grant execute on function public.programar_avisos() to service_role;

-- Los mails de las admins activas: a quién reparte enviar-avisos un aviso para 'todas'. Una admin
-- dada de baja (activa = false) no recibe push. Solo la clave de servicio.
create or replace function public.admins_activas_mails()
returns setof text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select u.email::text
    from auth.users u
    join public.usuarias_autorizadas ua on ua.user_id = u.id
   where ua.activa and u.email is not null
   order by 1
$function$;
revoke execute on function public.admins_activas_mails() from public, anon, authenticated;
grant execute on function public.admins_activas_mails() to service_role;

-- La niñera de la sesión le escribe al equipo. Guarda el texto sin espacios ni renglones en blanco
-- alrededor, de = 'ninera' y el nombre de su ficha como autor (no los elige ella). Devuelve la
-- fila, así la app la agrega al hilo y no la repite cuando llega por Realtime (mismo id).
create or replace function public.ninera_enviar_mensaje(p_texto text)
returns public.chat_mensajes
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := public.ninera_actual();
  v_texto text := btrim(coalesce(p_texto, ''), E' \t\r\n');
  v_fila public.chat_mensajes;
begin
  if v_id is null then
    raise exception 'no_autorizada';
  end if;
  if v_texto = '' then
    raise exception 'mensaje_vacio';
  end if;
  if char_length(v_texto) > 2000 then
    raise exception 'mensaje_largo';
  end if;
  insert into public.chat_mensajes (ninera_id, de, autor, texto)
  select v_id, 'ninera', n.nombre, v_texto from public.ninieras n where n.id = v_id
  returning * into v_fila;
  return v_fila;
end
$function$;
revoke execute on function public.ninera_enviar_mensaje(text) from public, anon;
grant execute on function public.ninera_enviar_mensaje(text) to authenticated;

-- Marca leídos los mensajes del equipo en el hilo de la niñera de la sesión; devuelve cuántos. 0 si
-- no es niñera.
create or replace function public.ninera_marcar_chat_leido()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := public.ninera_actual();
  v_n integer;
begin
  if v_id is null then
    return 0;
  end if;
  update public.chat_mensajes set leido_ninera_en = now()
   where ninera_id = v_id and de = 'admin' and leido_ninera_en is null;
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;
revoke execute on function public.ninera_marcar_chat_leido() from public, anon;
grant execute on function public.ninera_marcar_chat_leido() to authenticated;

-- Marca leídos los avisos de la niñera de la sesión; devuelve cuántos. 0 si no es niñera.
create or replace function public.ninera_marcar_avisos_leidos()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := public.ninera_actual();
  v_n integer;
begin
  if v_id is null then
    return 0;
  end if;
  update public.avisos set leido_en = now()
   where para_ninera_id = v_id and leido_en is null;
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;
revoke execute on function public.ninera_marcar_avisos_leidos() from public, anon;
grant execute on function public.ninera_marcar_avisos_leidos() to authenticated;

-- Cada mensaje encola su aviso (clave por mensaje: nunca dos veces). De una admin, a la niñera:
-- título el autor y "#chat" abre el hilo en su app. De la niñera, a 'todas': título su nombre de
-- la ficha y el link abre su ficha en el panel.
create or replace function public.chat_mensajes_encolar_aviso()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.de = 'admin' then
    perform public.encolar_aviso('chat:' || new.id, new.ninera_id, null, 'chat', new.autor,
      left(new.texto, 120), '#chat', jsonb_build_object('mensaje_id', new.id));
  else
    perform public.encolar_aviso('admin:chat:' || new.id, null, 'todas', 'chat',
      coalesce((select n.nombre from public.ninieras n where n.id = new.ninera_id), new.autor),
      left(new.texto, 120), '?ir=ninieras&ninera=' || new.ninera_id,
      jsonb_build_object('mensaje_id', new.id, 'ninera_id', new.ninera_id));
  end if;
  return null;
end
$function$;
revoke execute on function public.chat_mensajes_encolar_aviso() from public, anon, authenticated;
create trigger chat_mensajes_aviso after insert on public.chat_mensajes
  for each row execute function public.chat_mensajes_encolar_aviso();

-- Pedido por la app (02/11/2026, fase 1, etapa 5; ver 20261102_pedidos_app.sql). Ayudas, mandar el
-- pedido, las respuestas de la niñera y los datos para ordenar las sugeridas.
-- "$1.250": sin centavos y con punto de miles, como el panel. to_char con ',' literal (no 'G'), así
-- no depende del idioma de la base.
create or replace function public.pesos_texto(p_monto numeric)
returns text
language sql
immutable
set search_path to ''
as $function$
  select '$' || replace(to_char(round(p_monto), 'FM999,999,999'), ',', '.')
$function$;

-- La misma regla que normaliza() de js/comun.js (sin tildes y en minúsculas), para cruzar los
-- registros viejos que tienen el nombre pero no el id de la niñera o de la familia.
create or replace function public.normaliza_nombre(p_texto text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select lower(translate(coalesce(p_texto, ''), 'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
                                               'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun'))
$function$;

-- "sáb 07/11": el día de la semana sin depender del idioma de la base.
create or replace function public.dia_corto_texto(p_fecha date)
returns text
language sql
immutable
set search_path to ''
as $function$
  select (array['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'])[extract(dow from p_fecha)::int + 1]
         || ' ' || to_char(p_fecha, 'DD/MM')
$function$;

-- ---- Guía obligatoria y firma anual (02/11/2026, fase 1, etapa 4, 20261105_guia) ----
-- Progreso, repasos y firmas
-- Una fila por lección leída y por repaso aprobado (releer o volver a aprobar pisa la fecha: lo que
-- cuenta para el ciclo es lo hecho después de la última firma). version: la de la guía con que se leyó.
create table public.guia_progreso (
  ninera_id uuid not null references public.ninieras(id) on delete cascade,
  leccion_id text not null,
  version text not null,
  leido_en timestamp with time zone default now() not null,
  constraint guia_progreso_pkey primary key (ninera_id, leccion_id),
  constraint guia_progreso_leccion_check check (leccion_id ~ '^[a-z0-9-]{1,20}$'),
  constraint guia_progreso_version_check check (version ~ '^[0-9]{4}\.[0-9]{2}$')
);
create table public.guia_repasos (
  ninera_id uuid not null references public.ninieras(id) on delete cascade,
  modulo_id text not null,
  version text not null,
  aprobado_en timestamp with time zone default now() not null,
  constraint guia_repasos_pkey primary key (ninera_id, modulo_id),
  constraint guia_repasos_modulo_check check (modulo_id ~ '^[a-z0-9-]{1,20}$'),
  constraint guia_repasos_version_check check (version ~ '^[0-9]{4}\.[0-9]{2}$')
);
-- Cada firma anual queda (no se pisa): la declaración, el nombre tipeado, la imagen de la firma y la
-- versión de la guía (decisiones 4.7).
create table public.guia_firmas (
  id uuid default gen_random_uuid() not null,
  ninera_id uuid not null references public.ninieras(id) on delete cascade,
  version text not null,
  nombre text not null,
  firma_ruta text not null,
  firmado_en timestamp with time zone default now() not null,
  constraint guia_firmas_pkey primary key (id),
  constraint guia_firmas_nombre_check check (char_length(nombre) between 3 and 120),
  constraint guia_firmas_version_check check (version ~ '^[0-9]{4}\.[0-9]{2}$')
);
create index guia_firmas_ninera on public.guia_firmas (ninera_id, firmado_en desc);

-- La niñera lee lo suyo; las admins, todo. Nadie escribe directo: la niñera, con sus funciones.
alter table public.guia_progreso enable row level security;
alter table public.guia_repasos enable row level security;
alter table public.guia_firmas enable row level security;
create policy guia_progreso_propio on public.guia_progreso as permissive for select to authenticated
  using (ninera_id = (select public.ninera_actual()));
create policy guia_progreso_admins_leer on public.guia_progreso as permissive for select to public
  using ((select public.es_usuaria_autorizada()));
create policy guia_repasos_propio on public.guia_repasos as permissive for select to authenticated
  using (ninera_id = (select public.ninera_actual()));
create policy guia_repasos_admins_leer on public.guia_repasos as permissive for select to public
  using ((select public.es_usuaria_autorizada()));
create policy guia_firmas_propio on public.guia_firmas as permissive for select to authenticated
  using (ninera_id = (select public.ninera_actual()));
create policy guia_firmas_admins_leer on public.guia_firmas as permissive for select to public
  using ((select public.es_usuaria_autorizada()));
revoke insert, update, delete on public.guia_progreso, public.guia_repasos, public.guia_firmas from anon, authenticated;

-- Configuración
-- plazo_dias: para las que ya trabajaban, desde que activan la app (decisiones 4.8); gracia_anual_dias:
-- después del año de la firma (4.9). lecciones_obligatorias: las de Protocolos (sin b2, que pasó a Bebés)
-- y las de RCP y primeros auxilios, iguales a ninera/guia/contenido.json (lo controla
-- tests/estatico.spec.js): la base no lee el JSON y las necesita para saber si está completa.
insert into public.app_config (id, valor) values ('guia', jsonb_build_object(
  'plazo_dias', 7,
  'gracia_anual_dias', 7,
  'version_vigente', '2026.10',
  'modulos_obligatorios', jsonb_build_array('protocolos', 'auxilios'),
  'lecciones_obligatorias', jsonb_build_array(
    'pr1', 'pr2', 'pr3', 'pr4', 'pr5', 'pr6', 'pr7',
    'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9', 'x10', 'x11', 'x12', 'x13')))
on conflict (id) do nothing;

-- Storage: la firma y el certificado de RCP (decisiones 5.3)
-- Rutas exactas, como la foto propuesta: la firma solo la del día (firmas/<id>/<AAAA-MM-DD>.png, la
-- puede subir de nuevo ese día y después ya no la toca) y el certificado uno solo
-- (rcp/<id>/certificado.jpg, lo cambia o lo borra cuando quiere). Las admins ya leen y borran todo el
-- bucket (ninieras_privado_admins).
create policy ninieras_privado_firma on storage.objects as permissive for all to authenticated
  using ((bucket_id = 'ninieras-privado'::text) and (name = ('firmas/' || (select public.ninera_actual())::text || '/' || to_char((select public.hoy_mvd()), 'YYYY-MM-DD') || '.png')))
  with check ((bucket_id = 'ninieras-privado'::text) and (name = ('firmas/' || (select public.ninera_actual())::text || '/' || to_char((select public.hoy_mvd()), 'YYYY-MM-DD') || '.png')));
create policy ninieras_privado_rcp on storage.objects as permissive for all to authenticated
  using ((bucket_id = 'ninieras-privado'::text) and (name = ('rcp/' || (select public.ninera_actual())::text || '/certificado.jpg')))
  with check ((bucket_id = 'ninieras-privado'::text) and (name = ('rcp/' || (select public.ninera_actual())::text || '/certificado.jpg')));

-- El estado de la guía de una niñera (decisiones 8)
-- completa: todas las lecciones obligatorias leídas y los repasos obligatorios aprobados después de la
--   última firma (o en cualquier momento si nunca firmó): es lo que hace falta para firmar.
-- firma_vigente: la última firma tiene menos de 365 días. Para firmar hubo que tenerla completa, así
--   que "completa y firmada" (decisiones 8) es "firma vigente"; después de firmar, completa vuelve a
--   false hasta el ciclo siguiente.
-- puede / motivo / hasta, en este orden:
--   inactiva o sin_app: no;
--   firma vigente: sí (motivo null);
--   firmó alguna vez y venció: dentro de gracia_anual_dias sí ('gracia', hasta ese día), si no
--   'firma_vencida';
--   nunca firmó: si tenía sittings registrados antes de activar la app (por id o, en la historia
--   vieja, por el nombre) y está dentro de plazo_dias desde que la activó, sí ('plazo', hasta ese día);
--   si no, 'sin_guia'.
-- Interna (sin execute para nadie): la usan las funciones de abajo.
create or replace function public.guia_estado(p_ninera_id uuid, p_ahora timestamp with time zone default now())
returns table (completa boolean, firma_vigente boolean, puede boolean, motivo text, hasta date,
               ultima_firma timestamp with time zone, version_firma text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_n public.ninieras;
  v_cfg jsonb := coalesce((select valor from public.app_config where id = 'guia'), '{}'::jsonb);
  v_plazo integer := coalesce((v_cfg->>'plazo_dias')::int, 7);
  v_gracia integer := coalesce((v_cfg->>'gracia_anual_dias')::int, 7);
  v_lecciones text[] := array(select jsonb_array_elements_text(coalesce(v_cfg->'lecciones_obligatorias', '[]'::jsonb)));
  v_modulos text[] := array(select jsonb_array_elements_text(coalesce(v_cfg->'modulos_obligatorios', '[]'::jsonb)));
  v_desde timestamp with time zone;
  v_vence timestamp with time zone;
  v_nueva boolean;
begin
  select * into v_n from public.ninieras where id = p_ninera_id;
  if not found then return; end if;
  select f.firmado_en, f.version into ultima_firma, version_firma
    from public.guia_firmas f where f.ninera_id = p_ninera_id order by f.firmado_en desc limit 1;
  v_desde := coalesce(ultima_firma, '-infinity'::timestamptz);
  completa := cardinality(v_lecciones) > 0
    and (select count(*) from public.guia_progreso g
          where g.ninera_id = p_ninera_id and g.leccion_id = any (v_lecciones) and g.leido_en > v_desde) = cardinality(v_lecciones)
    and (select count(*) from public.guia_repasos r
          where r.ninera_id = p_ninera_id and r.modulo_id = any (v_modulos) and r.aprobado_en > v_desde) = cardinality(v_modulos);
  firma_vigente := ultima_firma is not null and p_ahora < ultima_firma + interval '365 days';

  if not v_n.activa then
    puede := false; motivo := 'inactiva';
  elsif v_n.user_id is null then
    puede := false; motivo := 'sin_app';
  elsif firma_vigente then
    puede := true;
  elsif ultima_firma is not null then
    v_vence := ultima_firma + make_interval(days => 365 + v_gracia);
    if p_ahora < v_vence then
      puede := true; motivo := 'gracia'; hasta := (v_vence at time zone 'America/Montevideo')::date;
    else
      puede := false; motivo := 'firma_vencida';
    end if;
  else
    v_nueva := v_n.app_activada_en is null or not exists (
      select 1 from public.sittings_traslados s
       where not s.cancelado
         and s.fecha < (v_n.app_activada_en at time zone 'America/Montevideo')::date
         and (s.ninera_id = v_n.id
              or (s.ninera_id is null
                  and public.normaliza_nombre(btrim(s.ninera_nombre)) = public.normaliza_nombre(btrim(v_n.nombre)))));
    v_vence := v_n.app_activada_en + make_interval(days => v_plazo);
    if not v_nueva and p_ahora < v_vence then
      puede := true; motivo := 'plazo'; hasta := (v_vence at time zone 'America/Montevideo')::date;
    else
      puede := false; motivo := 'sin_guia';
    end if;
  end if;
  return next;
end
$function$;
revoke execute on function public.guia_estado(uuid, timestamp with time zone) from public, anon, authenticated;

-- Si una niñera puede recibir pedidos por la app (decisiones 8). Para las admins (sugeridas_datos) o
-- para la propia niñera; enviar_pedido_app usa guia_estado directo.
create or replace function public.ninera_puede_recibir_pedidos(p_ninera_id uuid)
returns table (puede boolean, motivo text, hasta date)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not coalesce((select public.es_usuaria_autorizada()), false)
     and p_ninera_id is distinct from (select public.ninera_actual()) then
    raise exception 'no_autorizada';
  end if;
  return query select e.puede, e.motivo, e.hasta from public.guia_estado(p_ninera_id) e;
end
$function$;
revoke execute on function public.ninera_puede_recibir_pedidos(uuid) from public, anon;
grant execute on function public.ninera_puede_recibir_pedidos(uuid) to authenticated;

-- La guía de todas las niñeras activas con app, en una sola lectura (lista y ficha del panel). Solo admins.
create or replace function public.guia_estado_ninieras()
returns table (ninera_id uuid, completa boolean, firma_vigente boolean, puede boolean, motivo text, hasta date,
               ultima_firma timestamp with time zone, version_firma text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not coalesce((select public.es_usuaria_autorizada()), false) then
    raise exception 'no_autorizada';
  end if;
  return query
    select n.id, e.completa, e.firma_vigente, e.puede, e.motivo, e.hasta, e.ultima_firma, e.version_firma
      from public.ninieras n cross join lateral public.guia_estado(n.id) e
     where n.activa and n.user_id is not null;
end
$function$;
revoke execute on function public.guia_estado_ninieras() from public, anon;
grant execute on function public.guia_estado_ninieras() to authenticated;

-- La guía de la niñera de la sesión (vacío si no es niñera). Lo leído y aprobado alguna vez (para el
-- índice) y lo del ciclo actual, después de la última firma (para saber qué le falta para firmar).
create or replace function public.ninera_estado_guia()
returns table (completa boolean, firma_vigente boolean, puede boolean, motivo text, hasta date,
               ultima_firma timestamp with time zone, version_firma text,
               lecciones_leidas text[], repasos_aprobados text[], lecciones_ciclo text[], repasos_ciclo text[])
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
begin
  if v_yo is null then return; end if;
  return query
    select e.completa, e.firma_vigente, e.puede, e.motivo, e.hasta, e.ultima_firma, e.version_firma,
           coalesce((select array_agg(g.leccion_id order by g.leccion_id) from public.guia_progreso g where g.ninera_id = v_yo), '{}'),
           coalesce((select array_agg(r.modulo_id order by r.modulo_id) from public.guia_repasos r where r.ninera_id = v_yo), '{}'),
           coalesce((select array_agg(g.leccion_id order by g.leccion_id) from public.guia_progreso g
                      where g.ninera_id = v_yo and g.leido_en > coalesce(e.ultima_firma, '-infinity'::timestamptz)), '{}'),
           coalesce((select array_agg(r.modulo_id order by r.modulo_id) from public.guia_repasos r
                      where r.ninera_id = v_yo and r.aprobado_en > coalesce(e.ultima_firma, '-infinity'::timestamptz)), '{}')
      from public.guia_estado(v_yo) e;
end
$function$;
revoke execute on function public.ninera_estado_guia() from public, anon;
grant execute on function public.ninera_estado_guia() to authenticated;

-- "Ya lo leí": anota (o vuelve a anotar) la lección. Cualquier lección de la guía, obligatoria o no;
-- hasta 200 filas por niñera (la guía tiene 48).
create or replace function public.ninera_marcar_leida(p_leccion_id text, p_version text)
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_en timestamp with time zone;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if p_leccion_id is null or p_leccion_id !~ '^[a-z0-9-]{1,20}$' then raise exception 'leccion_invalida'; end if;
  if p_version is null or p_version !~ '^[0-9]{4}\.[0-9]{2}$' then raise exception 'version_invalida'; end if;
  if (select count(*) from public.guia_progreso where ninera_id = v_yo) >= 200
     and not exists (select 1 from public.guia_progreso where ninera_id = v_yo and leccion_id = p_leccion_id) then
    raise exception 'demasiadas';
  end if;
  insert into public.guia_progreso (ninera_id, leccion_id, version, leido_en)
  values (v_yo, p_leccion_id, p_version, now())
  on conflict (ninera_id, leccion_id) do update set version = excluded.version, leido_en = excluded.leido_en
  returning leido_en into v_en;
  return v_en;
end
$function$;
revoke execute on function public.ninera_marcar_leida(text, text) from public, anon;
grant execute on function public.ninera_marcar_leida(text, text) to authenticated;

-- Repaso aprobado (todas bien). Las respuestas están en el repo público: el celular corrige y la base
-- anota (decisión de Diego, 02/11/2026). Hasta 50 módulos por niñera (la guía tiene 11).
create or replace function public.ninera_aprobar_repaso(p_modulo_id text, p_version text)
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_en timestamp with time zone;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if p_modulo_id is null or p_modulo_id !~ '^[a-z0-9-]{1,20}$' then raise exception 'modulo_invalido'; end if;
  if p_version is null or p_version !~ '^[0-9]{4}\.[0-9]{2}$' then raise exception 'version_invalida'; end if;
  if (select count(*) from public.guia_repasos where ninera_id = v_yo) >= 50
     and not exists (select 1 from public.guia_repasos where ninera_id = v_yo and modulo_id = p_modulo_id) then
    raise exception 'demasiados';
  end if;
  insert into public.guia_repasos (ninera_id, modulo_id, version, aprobado_en)
  values (v_yo, p_modulo_id, p_version, now())
  on conflict (ninera_id, modulo_id) do update set version = excluded.version, aprobado_en = excluded.aprobado_en
  returning aprobado_en into v_en;
  return v_en;
end
$function$;
revoke execute on function public.ninera_aprobar_repaso(text, text) from public, anon;
grant execute on function public.ninera_aprobar_repaso(text, text) to authenticated;

-- La firma anual (decisiones 4.7). La imagen se sube antes a firmas/<id>/<hoy>.png (la ruta la arma la
-- base: la niñera no elige dónde) y la base verifica que esté. Solo con la guía completa. Un segundo
-- toque el mismo día devuelve la misma firma, sin otra fila.
create or replace function public.ninera_firmar_guia(p_nombre text, p_version text)
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_ruta text;
  v_en timestamp with time zone;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if char_length(v_nombre) not between 3 and 120 then raise exception 'nombre_invalido'; end if;
  if p_version is null or p_version !~ '^[0-9]{4}\.[0-9]{2}$' then raise exception 'version_invalida'; end if;
  v_ruta := 'firmas/' || v_yo || '/' || to_char(public.hoy_mvd(), 'YYYY-MM-DD') || '.png';
  select firmado_en into v_en from public.guia_firmas where ninera_id = v_yo and firma_ruta = v_ruta;
  if found then return v_en; end if;
  if not (select e.completa from public.guia_estado(v_yo) e) then raise exception 'guia_incompleta'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'ninieras-privado' and o.name = v_ruta) then
    raise exception 'falta_firma';
  end if;
  insert into public.guia_firmas (ninera_id, version, nombre, firma_ruta)
  values (v_yo, p_version, v_nombre, v_ruta)
  returning firmado_en into v_en;
  return v_en;
end
$function$;
revoke execute on function public.ninera_firmar_guia(text, text) from public, anon;
grant execute on function public.ninera_firmar_guia(text, text) to authenticated;

-- RCP presencial Sí / No y, si lo hizo, la foto del certificado (opcional), ya subida a
-- rcp/<id>/certificado.jpg. Sin curso presencial no queda certificado.
create or replace function public.ninera_guardar_rcp(p_presencial boolean, p_con_certificado boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_ruta text;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if p_presencial is null then raise exception 'rcp_invalido'; end if;
  v_ruta := 'rcp/' || v_yo || '/certificado.jpg';
  if p_presencial and coalesce(p_con_certificado, false)
     and not exists (select 1 from storage.objects o where o.bucket_id = 'ninieras-privado' and o.name = v_ruta) then
    raise exception 'falta_certificado';
  end if;
  update public.ninieras
     set rcp_presencial = p_presencial,
         rcp_certificado_ruta = case when p_presencial and coalesce(p_con_certificado, false) then v_ruta end
   where id = v_yo;
end
$function$;
revoke execute on function public.ninera_guardar_rcp(boolean, boolean) from public, anon;
grant execute on function public.ninera_guardar_rcp(boolean, boolean) to authenticated;

-- Avisos de la guía (textos.md 1), dentro del cron de cada minuto
-- De 9 a 21 de Montevideo, como la temporada. Claves:
--   guia:<id>:falta        la guía la frena ('sin_guia': al activar la app si es nueva, o cuando se le
--                          venció el plazo);
--   guia:<id>:falta:mitad  a mitad del plazo de las que ya trabajaban;
--   guia:<id>:anual:<AAAA-MM-DD de la firma>  se cumplió el año de esa firma.
create or replace function public.programar_avisos_guia(p_ahora timestamp with time zone default now())
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_local timestamp := p_ahora at time zone 'America/Montevideo';
  v_plazo integer := coalesce((select (valor->>'plazo_dias')::int from public.app_config where id = 'guia'), 7);
  v_n integer;
begin
  if extract(hour from v_local) not between 9 and 20 then return 0; end if;
  with est as (
    select n.id, n.app_activada_en, e.*
      from public.ninieras n cross join lateral public.guia_estado(n.id, p_ahora) e
     where n.activa and n.user_id is not null and n.app_activada_en is not null
  ), avisos as (
    select 'guia:' || id || ':falta' as clave, id, 'Te falta la guía para empezar' as titulo,
           'Lee Protocolos y RCP antes de tu primer sitting.' as cuerpo
      from est where motivo = 'sin_guia'
    union all
    select 'guia:' || id || ':falta:mitad', id, 'Te falta la guía para empezar',
           'Lee Protocolos y RCP antes de tu primer sitting.'
      from est where motivo = 'plazo' and p_ahora >= app_activada_en + make_interval(secs => v_plazo * 86400 / 2.0)
    union all
    select 'guia:' || id || ':anual:' || to_char(ultima_firma at time zone 'America/Montevideo', 'YYYY-MM-DD'), id,
           'Repasa la guía', 'Hace un año que hiciste Protocolos y RCP. Repásalos para seguir recibiendo pedidos.'
      from est where ultima_firma is not null and not firma_vigente
  )
  select count(*) filter (where public.encolar_aviso(a.clave, a.id, null, 'guia', a.titulo, a.cuerpo, '#guia'))
    into v_n from avisos a;
  return v_n;
end
$function$;
revoke execute on function public.programar_avisos_guia(timestamp with time zone) from public, anon, authenticated;
grant execute on function public.programar_avisos_guia(timestamp with time zone) to service_role;

-- ---- El día del sitting y el cierre de la niñera (02/11/2026, fase 1, etapa 7, 20261106_el_dia) ----
-- ---- Lo que marca la niñera durante el día ----
-- Una fila por tipo y por sitting: un segundo toque no suma otra. "Voy a llegar tarde" guarda los minutos
-- (10, 20 o 30, que es "30 min o más") y, si los cambia, se actualizan. creado_en es la hora real del
-- toque (la de "Ya entré" es la hora a la que entró).
create table public.sitting_eventos (
  id uuid default gen_random_uuid() not null,
  sitting_id uuid not null references public.sittings_traslados(id) on delete cascade,
  ninera_id uuid not null references public.ninieras(id) on delete cascade,
  tipo text not null,
  minutos integer,
  creado_en timestamp with time zone default now() not null,
  constraint sitting_eventos_pkey primary key (id),
  constraint sitting_eventos_un_tipo unique (sitting_id, tipo),
  constraint sitting_eventos_tipo_check check (tipo = any (array['saliendo', 'tarde', 'entre', 'no_abren', 'no_encuentro', 'busque', 'deje', 'no_estan'])),
  constraint sitting_eventos_minutos_check check ((tipo = 'tarde') = (minutos is not null) and (minutos is null or minutos in (10, 20, 30)))
);

-- El cierre: uno por sitting y una sola vez (si se equivocó, avisa por el chat y la admin corrige con
-- "Otra hora"). volveria: true = "Sí", false = "Prefiero otros perfiles", null = no contestó. El gasto
-- queda acá hasta que la admin elige quién lo paga: ahí se crea el gasto extra y se anota gasto_id.
create table public.sitting_cierres (
  sitting_id uuid not null references public.sittings_traslados(id) on delete cascade,
  ninera_id uuid not null references public.ninieras(id) on delete cascade,
  hora_fin time without time zone, -- vacía en el cierre de un traslado (etapa 11b)
  termina_dia_siguiente boolean default false not null,
  comentarios text,
  calificacion smallint,
  volveria boolean,
  jugaron text,
  comentario_equipo text,
  gasto_monto numeric,
  gasto_concepto text,
  gasto_comprobante text,
  gasto_id uuid references public.gastos_extra(id) on delete set null,
  creado_en timestamp with time zone default now() not null,
  revisado_en timestamp with time zone,
  revisado_por text,
  constraint sitting_cierres_pkey primary key (sitting_id),
  constraint sitting_cierres_calificacion_check check (calificacion between 1 and 5),
  constraint sitting_cierres_sin_hora_check check (hora_fin is not null or not termina_dia_siguiente),
  constraint sitting_cierres_gasto_check check ((gasto_monto is null) = (gasto_comprobante is null)
    and (gasto_monto is null) = (gasto_concepto is null) and (gasto_monto is null or gasto_monto > 0)),
  constraint sitting_cierres_textos_check check (char_length(coalesce(comentarios, '')) <= 2000
    and char_length(coalesce(jugaron, '')) <= 2000 and char_length(coalesce(comentario_equipo, '')) <= 2000)
);
-- Lo que lee Hoy (los cierres sin revisar) y la ficha de la familia (lo último de cada sitting).
create index sitting_cierres_sin_revisar on public.sitting_cierres (creado_en) where revisado_en is null;
create index sitting_cierres_ninera on public.sitting_cierres (ninera_id, creado_en desc);

alter table public.sitting_eventos enable row level security;
alter table public.sitting_cierres enable row level security;
create policy sitting_eventos_propio on public.sitting_eventos as permissive for select to authenticated
  using (ninera_id = (select public.ninera_actual()));
create policy sitting_eventos_admins_leer on public.sitting_eventos as permissive for select to public
  using ((select public.es_usuaria_autorizada()));
create policy sitting_cierres_propio on public.sitting_cierres as permissive for select to authenticated
  using (ninera_id = (select public.ninera_actual()));
create policy sitting_cierres_admins_leer on public.sitting_cierres as permissive for select to public
  using ((select public.es_usuaria_autorizada()));
create policy sitting_cierres_admins_revisar on public.sitting_cierres as permissive for update to public
  using ((select public.es_usuaria_autorizada())) with check ((select public.es_usuaria_autorizada()));
-- Nadie escribe directo salvo la revisión de las admins (solo esas tres columnas).
revoke insert, update, delete on public.sitting_eventos, public.sitting_cierres from anon, authenticated;
grant update (revisado_en, revisado_por, gasto_id) on public.sitting_cierres to authenticated;

-- ---- Configuración (decisiones 7: sin pantalla para editarla en la fase 1) ----
insert into public.app_config (id, valor) values ('el_dia', jsonb_build_object('no_llego_min', 15, 'cierre_recordatorio_min', 30, 'no_salio_min', 0))
on conflict (id) do nothing;

-- ---- El sitting o traslado del día de la niñera ----
-- Interna (sin execute para nadie): el registro p_sitting_id si es de la niñera de la sesión, es un sitting o un
-- traslado, no está cancelado, está confirmado y es de hoy o de ayer (uno que pasa la medianoche, o que cerró
-- tarde). Vacío si no.
create or replace function public.sitting_del_dia_ninera(p_sitting_id uuid)
returns setof public.sittings_traslados
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.* from public.sittings_traslados s
   where s.id = p_sitting_id
     and s.ninera_id = (select public.ninera_actual())
     and s.tipo in ('sitting', 'traslado') and not s.cancelado and s.estado = 'confirmado'
     and s.fecha between public.hoy_mvd() - 1 and public.hoy_mvd()
$function$;
revoke execute on function public.sitting_del_dia_ninera(uuid) from public, anon, authenticated;

-- Lo del día para la app de la niñera: sus sittings y traslados de hoy y los de ayer que no cerró ni revisó una
-- admin, con lo que ya marcó y si ya cerró. Sin plata ni direcciones (están en ninera_mis_sittings). En un
-- traslado, zona es la de origen y destino_zona la de destino (del pedido; un fijo sin pedido, la de la casa y
-- sin destino). Vacío si no es niñera.
create or replace function public.ninera_mi_dia()
returns table (id uuid, fecha date, hora_inicio time without time zone, hora_fin time without time zone,
               termina_dia_siguiente boolean, es_fijo boolean, zona text, madre text, eventos jsonb,
               cerrado_en timestamp with time zone, tipo text, destino_zona text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.id, s.fecha, s.hora_inicio, s.hora_fin, s.termina_dia_siguiente, s.asignacion_id is not null,
         case when s.tipo = 'traslado' then coalesce(nullif(btrim(sol.zona), ''), f.zona) else f.zona end,
         public.madre_nombre_inicial(coalesce(f.nombre, s.familia_nombre)),
         coalesce((select jsonb_agg(jsonb_build_object('tipo', e.tipo, 'minutos', e.minutos, 'en', e.creado_en) order by e.creado_en, e.tipo)
                     from public.sitting_eventos e where e.sitting_id = s.id and e.ninera_id = s.ninera_id), '[]'::jsonb),
         c.creado_en, s.tipo,
         case when s.tipo = 'traslado' then nullif(btrim(sol.destino_zona), '') end
    from public.sittings_traslados s
    left join public.familias f on f.id = s.familia_id
    left join public.solicitudes sol on sol.id = s.solicitud_id
    left join public.sitting_cierres c on c.sitting_id = s.id and c.ninera_id = s.ninera_id
   where s.ninera_id = (select public.ninera_actual())
     and s.tipo in ('sitting', 'traslado') and not s.cancelado and s.estado = 'confirmado'
     and (s.fecha = public.hoy_mvd()
          or (s.fecha = public.hoy_mvd() - 1 and c.sitting_id is null and s.revisado_at is null))
   order by s.fecha, s.hora_inicio
$function$;
revoke execute on function public.ninera_mi_dia() from public, anon;
grant execute on function public.ninera_mi_dia() to authenticated;

-- Sitting: "Estoy saliendo", "Voy a llegar tarde" (con los minutos), "Ya entré", "Estoy afuera y no me abren",
-- "No encuentro la casa". Traslado: "Estoy saliendo", "Voy a llegar tarde", "No están los chicos", "Ya los busqué"
-- y "Ya los dejé" (un tipo de la otra clase: evento_invalido). Tarde y los problemas avisan al instante a las
-- admins, con el link a la tarjeta "Sitting en curso" de Hoy (allí está "Contactarla"). Un segundo toque devuelve
-- la hora del primero; cambiar los minutos de "tarde" avisa de nuevo con los minutos nuevos. Ya cerrado, no.
create or replace function public.ninera_marcar_evento(p_sitting_id uuid, p_tipo text, p_minutos integer default null)
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_s public.sittings_traslados;
  v_nombre text;
  v_familia text;
  v_min integer := case when p_tipo = 'tarde' then p_minutos end;
  v_en timestamp with time zone;
  v_url text;
  v_datos jsonb;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if p_tipo is null or p_tipo not in ('saliendo', 'tarde', 'entre', 'no_abren', 'no_encuentro', 'busque', 'deje', 'no_estan') then
    raise exception 'evento_invalido';
  end if;
  if p_tipo = 'tarde' and (p_minutos is null or p_minutos not in (10, 20, 30)) then
    raise exception 'minutos_invalidos';
  end if;
  select * into v_s from public.sitting_del_dia_ninera(p_sitting_id);
  if not found then raise exception 'no_existe'; end if;
  if (v_s.tipo = 'traslado' and p_tipo in ('entre', 'no_abren', 'no_encuentro'))
     or (v_s.tipo = 'sitting' and p_tipo in ('busque', 'deje', 'no_estan')) then
    raise exception 'evento_invalido';
  end if;
  if exists (select 1 from public.sitting_cierres c where c.sitting_id = v_s.id) then raise exception 'ya_cerrado'; end if;

  insert into public.sitting_eventos (sitting_id, ninera_id, tipo, minutos)
  values (v_s.id, v_yo, p_tipo, v_min)
  on conflict (sitting_id, tipo) do update set minutos = excluded.minutos
    where public.sitting_eventos.minutos is distinct from excluded.minutos
  returning creado_en into v_en;
  if v_en is null then
    -- Mismo toque otra vez (o los mismos minutos): no cambia nada ni vuelve a avisar.
    select creado_en into v_en from public.sitting_eventos where sitting_id = v_s.id and tipo = p_tipo;
    return v_en;
  end if;

  select nombre into v_nombre from public.ninieras where id = v_yo;
  v_familia := coalesce((select f.nombre from public.familias f where f.id = v_s.familia_id), v_s.familia_nombre);
  v_url := '?ir=hoy&sitting=' || v_s.id;
  v_datos := jsonb_build_object('sitting_id', v_s.id, 'ninera_id', v_yo);
  if p_tipo = 'tarde' then
    perform public.encolar_aviso('admin:sitting:' || v_s.id || ':tarde:' || v_min, null, 'todas', 'el_dia',
      v_nombre || ' va a llegar ' || case when v_min = 30 then '30 min o más' else v_min || ' min' end || ' tarde',
      case when v_s.tipo = 'traslado' then 'Al traslado de ' || v_familia || '.' else 'A lo de ' || v_familia || '.' end,
      v_url, v_datos);
  elsif p_tipo = 'no_abren' then
    perform public.encolar_aviso('admin:sitting:' || v_s.id || ':no_abren', null, 'todas', 'el_dia',
      v_nombre || ' está afuera y no le abren', v_familia || '.', v_url, v_datos);
  elsif p_tipo = 'no_encuentro' then
    perform public.encolar_aviso('admin:sitting:' || v_s.id || ':no_encuentro', null, 'todas', 'el_dia',
      v_nombre || ' no encuentra la casa', v_familia || '.', v_url, v_datos);
  elsif p_tipo = 'no_estan' then
    perform public.encolar_aviso('admin:sitting:' || v_s.id || ':no_estan', null, 'todas', 'el_dia',
      v_nombre || ' llegó y no están los chicos', 'Traslado de ' || v_familia || '.', v_url, v_datos);
  end if;
  return v_en;
end
$function$;
revoke execute on function public.ninera_marcar_evento(uuid, text, integer) from public, anon;
grant execute on function public.ninera_marcar_evento(uuid, text, integer) to authenticated;

-- El cierre (decisiones 6.4): la hora real (con "al día siguiente" si pasó la medianoche), comentarios,
-- calificación, si volvería, a qué jugaron, comentarios para el equipo y, si hubo, el gasto (monto, en qué
-- y la foto ya subida a comprobantes/ninieras/<su id>/<sitting>.jpg: la ruta la arma la base). Una sola
-- vez: un segundo envío devuelve la hora del primero sin cambiar nada. No cierra uno que una admin ya
-- revisó en "Cierre de los fijos". Avisa a las admins que terminó y, si corresponde, del gasto y del
-- comentario. Solo sittings: un traslado se cierra con ninera_cerrar_traslado (etapa 11b).
create or replace function public.ninera_cerrar_sitting(p_sitting_id uuid, p_hora_fin time without time zone,
  p_dia_siguiente boolean, p_comentarios text, p_calificacion integer, p_volveria boolean, p_jugaron text,
  p_comentario_equipo text, p_gasto_monto numeric default null, p_gasto_concepto text default null)
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_s public.sittings_traslados;
  v_dia boolean := coalesce(p_dia_siguiente, false);
  v_fin timestamp with time zone;
  v_comentarios text := nullif(btrim(coalesce(p_comentarios, '')), '');
  v_jugaron text := nullif(btrim(coalesce(p_jugaron, '')), '');
  v_equipo text := nullif(btrim(coalesce(p_comentario_equipo, '')), '');
  v_concepto text := nullif(btrim(regexp_replace(coalesce(p_gasto_concepto, ''), '\s+', ' ', 'g')), '');
  v_ruta text;
  v_nombre text;
  v_familia text;
  v_en timestamp with time zone;
  v_datos jsonb;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  select * into v_s from public.sitting_del_dia_ninera(p_sitting_id);
  if not found or v_s.tipo <> 'sitting' then raise exception 'no_existe'; end if;
  select creado_en into v_en from public.sitting_cierres where sitting_id = v_s.id;
  if found then return v_en; end if;
  if v_s.revisado_at is not null then raise exception 'ya_revisado'; end if;

  -- La hora: después del inicio el mismo día, o antes (o igual: 24 h) con "al día siguiente", como el
  -- registro del panel (cruceMedianocheMalMarcado). No más de 15 minutos en el futuro.
  if p_hora_fin is null then raise exception 'hora_invalida'; end if;
  if v_s.hora_inicio is not null
     and ((not v_dia and p_hora_fin <= v_s.hora_inicio) or (v_dia and p_hora_fin > v_s.hora_inicio)) then
    raise exception 'hora_invalida';
  end if;
  v_fin := ((v_s.fecha + case when v_dia then 1 else 0 end) + p_hora_fin) at time zone 'America/Montevideo';
  if v_fin > now() + interval '15 minutes' then raise exception 'hora_futura'; end if;

  if char_length(coalesce(v_comentarios, '')) > 2000 or char_length(coalesce(v_jugaron, '')) > 2000
     or char_length(coalesce(v_equipo, '')) > 2000 then
    raise exception 'texto_largo';
  end if;
  if p_calificacion is not null and p_calificacion not between 1 and 5 then raise exception 'calificacion_invalida'; end if;

  if p_gasto_monto is not null then
    if p_gasto_monto <= 0 or p_gasto_monto >= 100000 then raise exception 'gasto_invalido'; end if;
    if v_concepto is null or char_length(v_concepto) > 120 then raise exception 'gasto_sin_concepto'; end if;
    v_ruta := 'ninieras/' || v_yo || '/' || v_s.id || '.jpg';
    if not exists (select 1 from storage.objects o where o.bucket_id = 'comprobantes' and o.name = v_ruta) then
      raise exception 'falta_comprobante';
    end if;
  else
    v_concepto := null;
  end if;

  insert into public.sitting_cierres (sitting_id, ninera_id, hora_fin, termina_dia_siguiente, comentarios, calificacion,
                                      volveria, jugaron, comentario_equipo, gasto_monto, gasto_concepto, gasto_comprobante)
  values (v_s.id, v_yo, p_hora_fin, v_dia, v_comentarios, p_calificacion, p_volveria, v_jugaron, v_equipo,
          p_gasto_monto, v_concepto, v_ruta)
  returning creado_en into v_en;

  select nombre into v_nombre from public.ninieras where id = v_yo;
  v_familia := coalesce((select f.nombre from public.familias f where f.id = v_s.familia_id), v_s.familia_nombre);
  v_datos := jsonb_build_object('sitting_id', v_s.id, 'ninera_id', v_yo);
  perform public.encolar_aviso('admin:sitting:' || v_s.id || ':cerro', null, 'todas', 'cierres',
    v_nombre || ' terminó en ' || v_familia || ' a las ' || to_char(p_hora_fin, 'HH24:MI'), 'Revisá el registro.',
    '?ir=hoy', v_datos);
  if p_gasto_monto is not null then
    perform public.encolar_aviso('admin:sitting:' || v_s.id || ':gasto', null, 'todas', 'cierres',
      v_nombre || ' cargó un gasto de ' || public.pesos_texto(p_gasto_monto), 'Con comprobante. Elegí quién lo paga.',
      '?ir=hoy', v_datos);
  end if;
  if v_comentarios is not null then
    perform public.encolar_aviso('admin:sitting:' || v_s.id || ':comentario', null, 'todas', 'cierres',
      v_nombre || ' dejó un comentario del sitting con ' || v_familia, 'Leelo ahora.', '?ir=hoy', v_datos);
  end if;
  return v_en;
end
$function$;
revoke execute on function public.ninera_cerrar_sitting(uuid, time without time zone, boolean, text, integer, boolean, text, text, numeric, text) from public, anon;
grant execute on function public.ninera_cerrar_sitting(uuid, time without time zone, boolean, text, integer, boolean, text, text, numeric, text) to authenticated;

-- El cierre de un traslado (decisiones 6.10): sin hora (es un viaje), "Comentarios extras" y, si hubo, el gasto
-- (peajes o estacionamiento: monto, en qué y la foto ya subida a comprobantes/ninieras/<su id>/<traslado>.jpg, la
-- misma ruta que un sitting). No hace falta haber marcado "Ya los dejé". Una sola vez: un segundo envío devuelve la
-- hora del primero sin cambiar nada. No cierra uno que una admin ya revisó. Avisa a las admins que cerró y, si
-- corresponde, del gasto y del comentario. Un sitting va por ninera_cerrar_sitting (acá, no_existe).
create or replace function public.ninera_cerrar_traslado(p_sitting_id uuid, p_comentarios text,
  p_gasto_monto numeric default null, p_gasto_concepto text default null)
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_s public.sittings_traslados;
  v_comentarios text := nullif(btrim(coalesce(p_comentarios, '')), '');
  v_concepto text := nullif(btrim(regexp_replace(coalesce(p_gasto_concepto, ''), '\s+', ' ', 'g')), '');
  v_ruta text;
  v_nombre text;
  v_familia text;
  v_en timestamp with time zone;
  v_datos jsonb;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  select * into v_s from public.sitting_del_dia_ninera(p_sitting_id);
  if not found or v_s.tipo <> 'traslado' then raise exception 'no_existe'; end if;
  select creado_en into v_en from public.sitting_cierres where sitting_id = v_s.id;
  if found then return v_en; end if;
  if v_s.revisado_at is not null then raise exception 'ya_revisado'; end if;
  if char_length(coalesce(v_comentarios, '')) > 2000 then raise exception 'texto_largo'; end if;

  if p_gasto_monto is not null then
    if p_gasto_monto <= 0 or p_gasto_monto >= 100000 then raise exception 'gasto_invalido'; end if;
    if v_concepto is null or char_length(v_concepto) > 120 then raise exception 'gasto_sin_concepto'; end if;
    v_ruta := 'ninieras/' || v_yo || '/' || v_s.id || '.jpg';
    if not exists (select 1 from storage.objects o where o.bucket_id = 'comprobantes' and o.name = v_ruta) then
      raise exception 'falta_comprobante';
    end if;
  else
    v_concepto := null;
  end if;

  insert into public.sitting_cierres (sitting_id, ninera_id, hora_fin, termina_dia_siguiente, comentarios,
                                      gasto_monto, gasto_concepto, gasto_comprobante)
  values (v_s.id, v_yo, null, false, v_comentarios, p_gasto_monto, v_concepto, v_ruta)
  returning creado_en into v_en;

  select nombre into v_nombre from public.ninieras where id = v_yo;
  v_familia := coalesce((select f.nombre from public.familias f where f.id = v_s.familia_id), v_s.familia_nombre);
  v_datos := jsonb_build_object('sitting_id', v_s.id, 'ninera_id', v_yo);
  perform public.encolar_aviso('admin:sitting:' || v_s.id || ':cerro', null, 'todas', 'cierres',
    v_nombre || ' cerró el traslado de ' || v_familia, 'Revisalo en Hoy.', '?ir=hoy', v_datos);
  if p_gasto_monto is not null then
    perform public.encolar_aviso('admin:sitting:' || v_s.id || ':gasto', null, 'todas', 'cierres',
      v_nombre || ' cargó un gasto de ' || public.pesos_texto(p_gasto_monto), 'Con comprobante. Elegí quién lo paga.',
      '?ir=hoy', v_datos);
  end if;
  if v_comentarios is not null then
    perform public.encolar_aviso('admin:sitting:' || v_s.id || ':comentario', null, 'todas', 'cierres',
      v_nombre || ' dejó un comentario del traslado de ' || v_familia, 'Leelo ahora.', '?ir=hoy', v_datos);
  end if;
  return v_en;
end
$function$;
revoke execute on function public.ninera_cerrar_traslado(uuid, text, numeric, text) from public, anon;
grant execute on function public.ninera_cerrar_traslado(uuid, text, numeric, text) to authenticated;

-- ---- Storage: la foto del comprobante (decisiones 5.3) ----
-- Una sola ruta por sitting, comprobantes/ninieras/<su id>/<id del sitting>.jpg, y solo mientras el sitting
-- es suyo, de hoy o de ayer, y no lo cerró (después ya no la toca). La puede subir de nuevo hasta cerrar
-- (para reemplazar una foto mal sacada hace falta poder leerla y pisarla: "for all" sobre esa única ruta).
-- Otras rutas del bucket no las ve ni las lista. Las admins ya leen y borran todo el bucket.
-- Ayuda de la política (security definer: la niñera no lee sittings_traslados).
create or replace function public.ninera_ruta_comprobante(p_nombre text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_id uuid;
begin
  if v_yo is null or p_nombre is null
     or p_nombre !~ ('^ninieras/' || v_yo::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then
    return false;
  end if;
  v_id := substring(p_nombre from '([0-9a-f-]{36})\.jpg$')::uuid;
  return exists (select 1 from public.sitting_del_dia_ninera(v_id) s
                  where not exists (select 1 from public.sitting_cierres c where c.sitting_id = s.id));
end
$function$;
revoke execute on function public.ninera_ruta_comprobante(text) from public, anon;
grant execute on function public.ninera_ruta_comprobante(text) to authenticated;
-- (select ninera_actual()) se evalúa una vez por consulta: a una admin que lee el bucket no se le llama la
-- función por cada archivo.
create policy comprobantes_ninera_gasto on storage.objects as permissive for all to authenticated
  using ((bucket_id = 'comprobantes'::text) and ((select public.ninera_actual()) is not null) and public.ninera_ruta_comprobante(name))
  with check ((bucket_id = 'comprobantes'::text) and ((select public.ninera_actual()) is not null) and public.ninera_ruta_comprobante(name));

-- ---- Avisos de tiempo del día (textos.md 1 y 7), dentro del cron de cada minuto ----
-- A la niñera (sittings y traslados con niñera con app, confirmados, sin revisar):
--   sitting:<id>:24h    de 24 a 23 h antes del inicio (no fijos);
--   sitting:<id>:1h     de 1 h a 30 min antes del inicio (no fijos);
--   sitting:<id>:fin    a la hora de fin prevista, hasta el recordatorio, si no cerró (solo sittings);
--   sitting:<id>:fin30  sitting: cierre_recordatorio_min después del fin, hasta 3 h después, si no cerró;
--                       traslado: cierre_recordatorio_min después de "Ya los dejé", hasta 3 h después, si no cerró.
-- A las admins:
--   admin:sitting:<id>:no_llego    no_llego_min después del inicio sin "Ya entré" ni cierre, hasta 2 h después
--                                  (sittings no fijos);
--   admin:sitting:<id>:no_salio    no_salio_min después de la hora de salida sin ningún toque ni cierre, hasta 2 h
--                                  después (traslados no fijos);
--   admin:sitting:<id>:sin_cierre  cierre_recordatorio_min después de "Ya los dejé" sin cierre, hasta 3 h
--                                  después (traslados, también fijos).
-- Sin hora de fin no hay avisos de fin de un sitting: la niñera cierra desde la tarjeta del día. Un traslado sin
-- "Ya los dejé" no tiene aviso de cierre. Las ventanas evitan que uno asignado tarde (o el día que se publica
-- esto) reciba avisos atrasados de golpe. Con solo_practica prendido, solo los de práctica (pedido_puede_avisar).
-- p_ahora es para las pruebas.
create or replace function public.programar_avisos_el_dia(p_ahora timestamp with time zone default now())
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_cfg jsonb := coalesce((select valor from public.app_config where id = 'el_dia'), '{}'::jsonb);
  v_no_llego integer := coalesce((v_cfg->>'no_llego_min')::int, 15);
  v_no_salio integer := coalesce((v_cfg->>'no_salio_min')::int, 0);
  v_rec integer := coalesce((v_cfg->>'cierre_recordatorio_min')::int, 30);
  v_hoy date := (p_ahora at time zone 'America/Montevideo')::date;
  v_dias text[] := array['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  v_total integer := 0;
  v_inicio timestamp with time zone;
  v_fin timestamp with time zone;
  v_lugar text;
  v_traslado boolean;
  v_que text;
  r record;
begin
  for r in
    select s.id, s.tipo, s.fecha, s.hora_inicio, s.hora_fin, s.termina_dia_siguiente, s.asignacion_id is not null as es_fijo,
           s.ninera_id, n.nombre as ninera, coalesce(f.nombre, s.familia_nombre) as familia, nullif(btrim(f.zona), '') as zona,
           exists (select 1 from public.sitting_eventos e where e.sitting_id = s.id and e.tipo = 'entre') as entro,
           exists (select 1 from public.sitting_eventos e where e.sitting_id = s.id) as marco_algo,
           (select e.creado_en from public.sitting_eventos e where e.sitting_id = s.id and e.tipo = 'deje') as dejo_en,
           exists (select 1 from public.sitting_cierres c where c.sitting_id = s.id) as cerro
      from public.sittings_traslados s
      join public.ninieras n on n.id = s.ninera_id
      left join public.familias f on f.id = s.familia_id
     where s.fecha between v_hoy - 1 and v_hoy + 1
       and s.tipo in ('sitting', 'traslado') and not s.cancelado and s.estado = 'confirmado' and s.revisado_at is null
       and s.hora_inicio is not null
       and n.activa and n.user_id is not null
       and public.pedido_puede_avisar(s.familia_id, s.familia_nombre, n.nombre)
  loop
    v_traslado := r.tipo = 'traslado';
    v_que := case when v_traslado then 'traslado' else 'sitting' end;
    v_inicio := (r.fecha + r.hora_inicio) at time zone 'America/Montevideo';
    v_fin := case when r.hora_fin is not null
                  then ((r.fecha + case when r.termina_dia_siguiente then 1 else 0 end) + r.hora_fin) at time zone 'America/Montevideo' end;
    v_lugar := case when v_traslado then '' else coalesce(', en ' || r.zona, '') end;
    if not r.es_fijo then
      if p_ahora >= v_inicio - interval '24 hours' and p_ahora < v_inicio - interval '23 hours'
         and public.encolar_aviso('sitting:' || r.id || ':24h', r.ninera_id, null, 'sitting', '¡Hola! Mañana tienes un ' || v_que,
               v_dias[extract(dow from r.fecha)::int + 1] || ' ' || to_char(r.fecha, 'DD/MM') || ' a las '
                 || to_char(r.hora_inicio, 'HH24:MI') || v_lugar || '.',
               '#inicio', jsonb_build_object('sitting_id', r.id)) then
        v_total := v_total + 1;
      end if;
      if p_ahora >= v_inicio - interval '1 hour' and p_ahora < v_inicio - interval '30 minutes'
         and public.encolar_aviso('sitting:' || r.id || ':1h', r.ninera_id, null, 'sitting', 'Tu ' || v_que || ' empieza en 1 hora',
               to_char(r.hora_inicio, 'HH24:MI') || v_lugar || '.', '#inicio', jsonb_build_object('sitting_id', r.id)) then
        v_total := v_total + 1;
      end if;
      if not v_traslado and not r.entro and not r.cerro
         and p_ahora >= v_inicio + make_interval(mins => v_no_llego) and p_ahora < v_inicio + interval '2 hours'
         and public.encolar_aviso('admin:sitting:' || r.id || ':no_llego', null, 'todas', 'el_dia',
               r.ninera || ' no marcó que llegó',
               'El sitting con ' || r.familia || ' empezaba a las ' || to_char(r.hora_inicio, 'HH24:MI') || '.',
               '?ir=hoy&sitting=' || r.id, jsonb_build_object('sitting_id', r.id, 'ninera_id', r.ninera_id)) then
        v_total := v_total + 1;
      end if;
      -- Cualquier toque ("Estoy saliendo", "Voy a llegar tarde", "No están los chicos", "Ya los busqué" o "Ya los
      -- dejé") dice que está en camino: el aviso es para la que no dio ninguna señal.
      if v_traslado and not r.marco_algo and not r.cerro
         and p_ahora >= v_inicio + make_interval(mins => v_no_salio) and p_ahora < v_inicio + interval '2 hours'
         and public.encolar_aviso('admin:sitting:' || r.id || ':no_salio', null, 'todas', 'el_dia',
               r.ninera || ' no marcó que salió',
               'El traslado de ' || r.familia || ' salía a las ' || to_char(r.hora_inicio, 'HH24:MI') || '.',
               '?ir=hoy&sitting=' || r.id, jsonb_build_object('sitting_id', r.id, 'ninera_id', r.ninera_id)) then
        v_total := v_total + 1;
      end if;
    end if;
    if not v_traslado and v_fin is not null and not r.cerro then
      if p_ahora >= v_fin and p_ahora < v_fin + make_interval(mins => v_rec)
         and public.encolar_aviso('sitting:' || r.id || ':fin', r.ninera_id, null, 'sitting', '¿Ya te retiraste del hogar?',
               'Cuéntanos hasta qué hora estuviste.', '#sitting/' || r.id || '/cierre', jsonb_build_object('sitting_id', r.id)) then
        v_total := v_total + 1;
      end if;
      if p_ahora >= v_fin + make_interval(mins => v_rec) and p_ahora < v_fin + interval '3 hours'
         and public.encolar_aviso('sitting:' || r.id || ':fin30', r.ninera_id, null, 'sitting', 'Te falta cerrar el sitting',
               'Cuéntanos hasta qué hora estuviste.', '#sitting/' || r.id || '/cierre', jsonb_build_object('sitting_id', r.id)) then
        v_total := v_total + 1;
      end if;
    end if;
    if v_traslado and r.dejo_en is not null and not r.cerro
       and p_ahora >= r.dejo_en + make_interval(mins => v_rec) and p_ahora < r.dejo_en + interval '3 hours' then
      if public.encolar_aviso('sitting:' || r.id || ':fin30', r.ninera_id, null, 'sitting', 'Te falta cerrar el traslado',
           'Cuéntanos si hubo algún gasto.', '#sitting/' || r.id || '/cierre', jsonb_build_object('sitting_id', r.id)) then
        v_total := v_total + 1;
      end if;
      if public.encolar_aviso('admin:sitting:' || r.id || ':sin_cierre', null, 'todas', 'cierres',
           r.ninera || ' no cerró el traslado',
           'Dejó a los chicos de ' || r.familia || ' a las ' || to_char(r.dejo_en at time zone 'America/Montevideo', 'HH24:MI') || '.',
           '?ir=hoy', jsonb_build_object('sitting_id', r.id, 'ninera_id', r.ninera_id)) then
        v_total := v_total + 1;
      end if;
    end if;
  end loop;
  return v_total;
end
$function$;
revoke execute on function public.programar_avisos_el_dia(timestamp with time zone) from public, anon, authenticated;
grant execute on function public.programar_avisos_el_dia(timestamp with time zone) to service_role;


-- Mandar el pedido por la app (admin)
-- p_envios: [{"ninera_id": "...", "precio_hora": 300}, ...]. En una sola transacción: valida el
-- pedido y cada niñera, crea su fila (estado 'invitada', origen 'app'), le encola el aviso
-- pedido:<sn>:nuevo y deja el pedido 'pendiente_confirmar' con su hora límite. Una niñera a la que
-- ya le llegó este pedido se saltea sin error (no se le manda dos veces). Devuelve a cuántas se
-- mandó. Los errores van por raise con un código corto (el panel los traduce) y el nombre de la
-- niñera en el hint.
-- Práctica (decisiones 4.17): un pedido de una familia "(práctica)" va solo a niñeras "(práctica)"
-- y al revés (con o sin tilde); la pantalla no deja tildarlas, y esto es la red por si algo se
-- escapa. Con app_config 'pedidos_app'.solo_practica, un pedido real no se manda por la app.
-- Los chicos tienen que estar cargados uno por uno (hijos_familia): el texto libre viejo de
-- familias.ninos puede tener nombres y apellido, y el pedido les llega a varias antes de elegir.
create or replace function public.enviar_pedido_app(p_solicitud_id uuid, p_envios jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_s public.solicitudes;
  v_fam public.familias;
  v_n public.ninieras;
  v_e jsonb;
  v_id uuid;
  v_precio numeric;
  v_sn uuid;
  v_chicos text;
  v_zona text;
  v_horario text;
  v_practica boolean;
  v_cfg jsonb;
  v_min integer;
  v_cant integer := 0;
  v_puede boolean;
  v_motivo text;
  v_traslado boolean;
begin
  if not coalesce((select public.es_usuaria_autorizada()), false) then
    raise exception 'no_autorizada';
  end if;
  if p_envios is null or jsonb_typeof(p_envios) <> 'array' or jsonb_array_length(p_envios) = 0 then
    raise exception 'sin_ninieras';
  end if;
  if jsonb_array_length(p_envios) > 40 then
    raise exception 'demasiadas_ninieras';
  end if;

  -- El pedido, bloqueado: dos admins mandando a la vez no lo pisan.
  select * into v_s from public.solicitudes where id = p_solicitud_id for update;
  if not found then raise exception 'no_existe'; end if;
  if v_s.estado not in ('sin_asignar', 'pendiente_confirmar') then raise exception 'cerrado'; end if;
  v_traslado := v_s.tipo = 'traslado';
  if v_s.fecha < public.hoy_mvd() then raise exception 'pasado'; end if;
  select * into v_fam from public.familias where id = v_s.familia_id;
  if not found then raise exception 'sin_familia'; end if;
  if not exists (select 1 from public.hijos_familia h where h.familia_id = v_fam.id) then
    raise exception 'sin_chicos';
  end if;
  v_chicos := public.chicos_texto(v_fam.id);

  v_cfg := coalesce((select valor from public.app_config where id = 'pedidos_app'), '{}'::jsonb);
  v_practica := position('(practica)' in public.normaliza_nombre(v_fam.nombre)) > 0;
  if not v_practica and coalesce((v_cfg->>'solo_practica')::boolean, true) then
    raise exception 'solo_practica';
  end if;
  if v_traslado then
    -- Un traslado: las direcciones (las ve la elegida) y las dos zonas (las ven todas antes de responder).
    if nullif(btrim(coalesce(v_s.origen, '')), '') is null or nullif(btrim(coalesce(v_s.destino, '')), '') is null then
      raise exception 'sin_origen_destino';
    end if;
    if nullif(btrim(coalesce(v_s.zona, '')), '') is null or nullif(btrim(coalesce(v_s.destino_zona, '')), '') is null then
      raise exception 'sin_zonas';
    end if;
    v_zona := 'De ' || btrim(v_s.zona) || ' a ' || btrim(v_s.destino_zona);
    v_horario := 'A las ' || to_char(v_s.hora_inicio, 'HH24:MI');
  else
    v_zona := 'Zona: ' || coalesce(nullif(btrim(v_s.zona), ''), nullif(btrim(v_fam.zona), ''));
    -- Textos 1: "(aproximada, se puede extender)" solo con la marca horario_aproximado (etapa 6); sin
    -- fin, "sin hora de fin"; si termina pasada la medianoche, "del día siguiente".
    v_horario := to_char(v_s.hora_inicio, 'HH24:MI')
      || case when v_s.hora_fin is null then ', sin hora de fin'
              else ' – ' || to_char(v_s.hora_fin, 'HH24:MI')
                   || case when v_s.termina_dia_siguiente then ' del día siguiente' else '' end
                   || case when v_s.horario_aproximado then ' (aproximada, se puede extender)' else '' end end;
  end if;

  for v_e in select * from jsonb_array_elements(p_envios) loop
    begin
      v_id := (v_e->>'ninera_id')::uuid;
      v_precio := (v_e->>(case when v_traslado then 'precio_viaje' else 'precio_hora' end))::numeric;
    exception when others then
      raise exception 'envio_invalido';
    end;
    if v_precio is null or v_precio <= 0 or v_precio >= 100000 then
      raise exception 'precio_invalido' using hint = coalesce((select nombre from public.ninieras where id = v_id), '');
    end if;
    select * into v_n from public.ninieras where id = v_id;
    -- Ya no está en la base: no hay nombre, va su id y el panel lo busca en la lista que está mirando.
    if not found then raise exception 'ninera_no_existe' using hint = coalesce(v_id::text, ''); end if;
    if not v_n.activa then raise exception 'ninera_inactiva' using hint = v_n.nombre; end if;
    if v_n.user_id is null then raise exception 'ninera_sin_app' using hint = v_n.nombre; end if;
    if not v_traslado and v_n.tipo = 'Traslados' then raise exception 'ninera_solo_traslados' using hint = v_n.nombre; end if;
    if v_traslado and v_n.tipo is distinct from 'Traslados' and v_n.tipo is distinct from 'Ambas' then
      raise exception 'ninera_no_hace_traslados' using hint = v_n.nombre;
    end if;
    if (position('(practica)' in public.normaliza_nombre(v_n.nombre)) > 0) <> v_practica then
      raise exception 'practica_mezclada' using hint = v_n.nombre;
    end if;
    -- El carsitting (etapa 11): sin aprobar no recibe pedidos de traslado por la app, tampoco la de práctica.
    if v_traslado and not public.carsitting_aprobado(v_n.id) then
      raise exception 'sin_carsitting' using hint = v_n.nombre;
    end if;
    -- La guía (etapa 4, decisiones 8): sin la guía o con la firma vencida no recibe pedidos por la app,
    -- tampoco la de práctica. detail: el motivo ('sin_guia', 'firma_vencida').
    select g.puede, g.motivo into v_puede, v_motivo from public.guia_estado(v_n.id) g;
    if not coalesce(v_puede, false) then
      raise exception 'ninera_sin_guia' using hint = v_n.nombre, detail = coalesce(v_motivo, '');
    end if;

    v_sn := null;
    insert into public.solicitud_ninieras (solicitud_id, ninera_id, ninera_nombre, estado, origen, precio_hora, precio_viaje, enviado_en)
    values (v_s.id, v_n.id, v_n.nombre, 'invitada', 'app',
            case when v_traslado then null else v_precio end, case when v_traslado then v_precio end, now())
    on conflict (solicitud_id, ninera_id) where origen = 'app' do nothing
    returning id into v_sn;
    if v_sn is not null then
      v_cant := v_cant + 1;
      perform public.encolar_aviso('pedido:' || v_sn || ':nuevo', v_n.id, null, 'pedido',
        case when v_traslado then 'Traslado ' else 'Sitting ' end || to_char(v_s.fecha, 'DD/MM'),
        concat_ws(E'\n', v_horario, v_zona, v_chicos,
          case when v_traslado then 'Precio: ' || public.pesos_texto(v_precio) || ' por viaje'
               else 'Precio por hora: ' || public.pesos_texto(v_precio) end),
        '#pedido/' || v_sn, jsonb_build_object('solicitud_ninera_id', v_sn));
    end if;
  end loop;

  if v_cant > 0 then
    v_min := case when v_s.fecha = public.hoy_mvd()
                  then coalesce((v_cfg->>'min_mismo_dia')::int, 15)
                  else coalesce((v_cfg->>'min_otro_dia')::int, 30) end;
    update public.solicitudes
       set estado = 'pendiente_confirmar',
           enviado_app_en = coalesce(enviado_app_en, now()),
           responder_hasta = now() + make_interval(mins => v_min)
     where id = v_s.id;
  end if;
  return v_cant;
end
$function$;
revoke execute on function public.enviar_pedido_app(uuid, jsonb) from public, anon;
grant execute on function public.enviar_pedido_app(uuid, jsonb) to authenticated;

-- ¿Se le puede mandar un aviso de pedidos a esta niñera por este pedido? Con solo_practica prendido,
-- solo si la familia y la niñera son las dos de práctica ("(práctica)" con o sin tilde, la misma
-- regla que enviar_pedido_app). Apagado, siempre.
create or replace function public.pedido_puede_avisar(p_familia_id uuid, p_familia_nombre text, p_ninera_nombre text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select not coalesce((select (valor->>'solo_practica')::boolean from public.app_config where id = 'pedidos_app'), true)
      or (position('(practica)' in public.normaliza_nombre(coalesce((select f.nombre from public.familias f where f.id = p_familia_id), p_familia_nombre))) > 0
          and position('(practica)' in public.normaliza_nombre(p_ninera_nombre)) > 0)
$function$;
revoke execute on function public.pedido_puede_avisar(uuid, text, text) from public, anon, authenticated;

-- ---- La ficha de la familia y los avisos de cambios y cancelaciones (02/11/2026, fase 1, etapa 8, 20261107_ficha_cambios) ----
-- ---- La ficha de la familia (decisiones 6.5) ----
-- Una por sitting (la niñera la puede corregir hasta el fin del día siguiente); datos: los campos de la ficha de
-- la guía original (la familia, la fecha y la niñera las pone la base: son las del sitting). Si el sitting se
-- borra, la ficha queda (es de la familia).
create table public.fichas_familia (
  id uuid default gen_random_uuid() not null,
  familia_id uuid not null references public.familias(id) on delete cascade,
  sitting_id uuid references public.sittings_traslados(id) on delete set null,
  ninera_id uuid not null references public.ninieras(id) on delete cascade,
  datos jsonb not null,
  creada_en timestamp with time zone default now() not null,
  actualizada_en timestamp with time zone default now() not null,
  constraint fichas_familia_pkey primary key (id),
  constraint fichas_familia_sitting_key unique (sitting_id),
  constraint fichas_familia_datos_check check (jsonb_typeof(datos) = 'object')
);
create index fichas_familia_familia on public.fichas_familia (familia_id, actualizada_en desc);

-- Los cambios de horario avisados y lo que respondió la niñera ("Ok" / "A esa hora no puedo"). Uno por aviso: de
-- un día (sitting_id) o de un fijo desde una fecha (es_fijo, sin sitting_id).
create table public.cambios_horario (
  id uuid default gen_random_uuid() not null,
  ninera_id uuid not null references public.ninieras(id) on delete cascade,
  familia_id uuid references public.familias(id) on delete cascade,
  familia_nombre text,
  sitting_id uuid references public.sittings_traslados(id) on delete cascade,
  solicitud_id uuid,
  es_fijo boolean default false not null,
  desde date not null,
  hora_inicio time without time zone,
  hora_fin time without time zone,
  termina_dia_siguiente boolean default false not null,
  creado_en timestamp with time zone default now() not null,
  respuesta boolean,
  respondido_en timestamp with time zone,
  -- Etapa 11 (03/11/2026): de un sitting o de un traslado (la tarjeta lo dice).
  tipo text default 'sitting' not null,
  constraint cambios_horario_pkey primary key (id),
  constraint cambios_horario_tipo_check check (tipo in ('sitting', 'traslado'))
);
create index cambios_horario_ninera on public.cambios_horario (ninera_id, creado_en desc);

alter table public.fichas_familia enable row level security;
alter table public.cambios_horario enable row level security;
create policy fichas_familia_admins_leer on public.fichas_familia as permissive for select to public
  using ((select public.es_usuaria_autorizada()));
create policy cambios_horario_propio on public.cambios_horario as permissive for select to authenticated
  using (ninera_id = (select public.ninera_actual()));
create policy cambios_horario_admins_leer on public.cambios_horario as permissive for select to public
  using ((select public.es_usuaria_autorizada()));
-- La niñera no lee fichas_familia directo (tiene teléfonos de otras familias): solo por ninera_ficha_familia.
-- Nadie escribe directo: la niñera, con sus funciones; los avisos, la base.
revoke insert, update, delete on public.fichas_familia, public.cambios_horario from anon, authenticated;

-- Los campos de la ficha (el orden de la guía original): 15 textos y 6 casillas.
create or replace function public.ficha_familia_campos()
returns table (clave text, es_casilla boolean)
language sql
immutable
set search_path to ''
as $function$
  select * from (values
    ('direccion', false), ('chicos', false), ('tel_madre', false), ('tel_padre', false), ('otro_adulto', false),
    ('emergencia', false), ('mutualista', false), ('alergias', false), ('medicacion', false), ('salud', false),
    ('comidas', false), ('sueno', false), ('reglas', false), ('retira', false), ('otros', false),
    ('c_botiquin', true), ('c_llaves', true), ('c_linterna', true), ('c_telefonos', true), ('c_medicacion', true),
    ('c_adrenalina', true)) as c(clave, es_casilla)
$function$;
revoke execute on function public.ficha_familia_campos() from public, anon, authenticated;

-- Guardar (o corregir) la ficha de su sitting: de hoy o de ayer, suyo, confirmado y no cancelado. Solo los campos
-- de la ficha (los textos hasta 1.000 caracteres; las casillas true / false); lo vacío no se guarda.
create or replace function public.ninera_guardar_ficha_familia(p_sitting_id uuid, p_datos jsonb)
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_s public.sittings_traslados;
  v_datos jsonb := '{}'::jsonb;
  v_c record;
  v_valor jsonb;
  v_en timestamp with time zone;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then raise exception 'ficha_invalida'; end if;
  if exists (select 1 from jsonb_object_keys(p_datos) k where k not in (select clave from public.ficha_familia_campos())) then
    raise exception 'ficha_invalida';
  end if;
  select * into v_s from public.sittings_traslados s
   where s.id = p_sitting_id and s.ninera_id = v_yo and s.tipo = 'sitting' and not s.cancelado and s.estado = 'confirmado'
     and s.fecha between public.hoy_mvd() - 1 and public.hoy_mvd();
  if not found or v_s.familia_id is null then raise exception 'no_existe'; end if;
  for v_c in select * from public.ficha_familia_campos() loop
    v_valor := p_datos -> v_c.clave;
    if v_valor is null or v_valor = 'null'::jsonb then continue; end if;
    if v_c.es_casilla then
      if jsonb_typeof(v_valor) <> 'boolean' then raise exception 'ficha_invalida'; end if;
      if v_valor = 'true'::jsonb then v_datos := v_datos || jsonb_build_object(v_c.clave, true); end if;
    else
      if jsonb_typeof(v_valor) <> 'string' then raise exception 'ficha_invalida'; end if;
      if char_length(btrim(v_valor #>> '{}')) > 1000 then raise exception 'texto_largo'; end if;
      if btrim(v_valor #>> '{}') <> '' then v_datos := v_datos || jsonb_build_object(v_c.clave, btrim(v_valor #>> '{}')); end if;
    end if;
  end loop;
  insert into public.fichas_familia (familia_id, sitting_id, ninera_id, datos)
  values (v_s.familia_id, v_s.id, v_yo, v_datos)
  on conflict (sitting_id) do update set datos = excluded.datos, actualizada_en = now()
  returning actualizada_en into v_en;
  return v_en;
end
$function$;
revoke execute on function public.ninera_guardar_ficha_familia(uuid, jsonb) from public, anon;
grant execute on function public.ninera_guardar_ficha_familia(uuid, jsonb) to authenticated;

-- La última ficha de la familia de su sitting (de cualquier niñera, sin decir cuál: datos de otras niñeras no) y
-- si es la suya de ese sitting. Solo mientras el sitting es suyo (previsto o confirmado, no cancelado) y no
-- terminó: desde que queda confirmada hasta el fin de su sitting (sin hora de fin, hasta el fin de ese día).
-- Después, hasta el día siguiente, solo la suya de ese sitting. Vacío si no hay ficha o no corresponde.
create or replace function public.ninera_ficha_familia(p_sitting_id uuid)
returns table (datos jsonb, actualizada_en timestamp with time zone, es_de_este_sitting boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_s public.sittings_traslados;
  v_fin timestamp with time zone;
begin
  if v_yo is null then return; end if;
  select * into v_s from public.sittings_traslados s
   where s.id = p_sitting_id and s.ninera_id = v_yo and s.tipo = 'sitting' and not s.cancelado
     and s.estado in ('previsto', 'confirmado');
  if not found or v_s.familia_id is null then return; end if;
  v_fin := case when v_s.hora_fin is not null
                then ((v_s.fecha + case when v_s.termina_dia_siguiente then 1 else 0 end) + v_s.hora_fin) at time zone 'America/Montevideo'
                else (v_s.fecha + 1)::timestamp at time zone 'America/Montevideo' end;
  -- Hasta el fin de su sitting: la última de la familia (la suya de este sitting primero).
  if now() < v_fin then
    return query
      select f.datos, f.actualizada_en, f.sitting_id is not distinct from v_s.id
        from public.fichas_familia f
       where f.familia_id = v_s.familia_id
       order by (f.sitting_id is not distinct from v_s.id) desc, f.actualizada_en desc
       limit 1;
    return;
  end if;
  -- Ya terminó: solo la suya de este sitting, hasta el día siguiente (para corregirla), y nunca la de otra niñera.
  if v_s.fecha >= public.hoy_mvd() - 1 then
    return query
      select f.datos, f.actualizada_en, true from public.fichas_familia f where f.sitting_id = v_s.id and f.ninera_id = v_yo;
  end if;
end
$function$;
revoke execute on function public.ninera_ficha_familia(uuid) from public, anon;
grant execute on function public.ninera_ficha_familia(uuid) to authenticated;

-- ---- Avisos de cambios y cancelaciones (textos.md 1; los nuevos, en textos-provisorios.md) ----

-- Si se le puede avisar de un sitting a esta niñera: activa, con app y, con solo_practica prendido, solo si la
-- familia y la niñera son de práctica (pedido_puede_avisar). Interna.
create or replace function public.sitting_puede_avisar(p_ninera_id uuid, p_familia_id uuid, p_familia_nombre text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.ninieras n
                  where n.id = p_ninera_id and n.activa and n.user_id is not null
                    and public.pedido_puede_avisar(p_familia_id, p_familia_nombre, n.nombre))
$function$;
revoke execute on function public.sitting_puede_avisar(uuid, uuid, text) from public, anon, authenticated;

-- "de 16:00 a 19:00", "de 22:00 a 02:00 del día siguiente", "desde las 16:00".
create or replace function public.horario_texto(p_hi time without time zone, p_hf time without time zone, p_termina boolean)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case when p_hi is null then 'sin horario'
              when p_hf is null then 'desde las ' || to_char(p_hi, 'HH24:MI')
              else 'de ' || to_char(p_hi, 'HH24:MI') || ' a ' || to_char(p_hf, 'HH24:MI')
                   || case when p_termina then ' del día siguiente' else '' end end
$function$;
revoke execute on function public.horario_texto(time without time zone, time without time zone, boolean) from public, anon, authenticated;

-- El aviso de un sitting a una niñera (uno por día). p_tipo:
--   cancelado  "Se canceló tu sitting del [día]" / "Con [madre]. Si tienes dudas, escríbenos." (textos.md 1)
--   sin        "Ya no vas al sitting del [día]" / "El equipo hizo un cambio. Si tienes dudas, escríbenos."
--   nuevo      "Tienes un sitting el [día]" / "[hora], en [zona]. Mira los datos en la app." Si sale de un pedido y
--              ya tiene su fila confirmada, no: le llegó "¡Quedaste seleccionada!".
--   cambio     "Cambió el horario de tu sitting del [día]" / "Ahora es de [hi] a [hf]. Mira los detalles.", con su
--              fila en cambios_horario para "Ok" / "A esa hora no puedo" (#cambio/<id>).
-- Solo si el sitting (el de antes para cancelado y sin, el nuevo para nuevo y cambio) todavía no empezó. Las claves de
-- cancelado, sin y nuevo llevan el número de la transacción (reactivar y volver a cancelar es un hecho nuevo); la del
-- cambio, el horario nuevo (el mismo cambio no se repite). Interna.
create or replace function public.aviso_sitting_ninera(p_tipo text, p_sitting_id uuid, p_ninera_id uuid, p_familia_id uuid,
  p_familia_nombre text, p_fecha date, p_hi time without time zone, p_hf time without time zone, p_termina boolean,
  p_solicitud_id uuid default null, p_fecha_antes date default null, p_servicio text default 'sitting')
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_madre text;
  v_zona text;
  v_dia text := public.dia_corto_texto(p_fecha);
  v_cambio uuid;
  v_datos jsonb := jsonb_build_object('sitting_id', p_sitting_id);
  v_traslado boolean := p_servicio = 'traslado';
  v_que text := case when p_servicio = 'traslado' then 'traslado' else 'sitting' end;
begin
  if p_ninera_id is null or p_fecha is null then return; end if;
  if ((p_fecha + coalesce(p_hi, '00:00'::time)) at time zone 'America/Montevideo') <= now() then return; end if;
  if not public.sitting_puede_avisar(p_ninera_id, p_familia_id, p_familia_nombre) then return; end if;
  select public.madre_nombre_inicial(coalesce(f.nombre, p_familia_nombre)), nullif(btrim(f.zona), '')
    into v_madre, v_zona from (select 1) x left join public.familias f on f.id = p_familia_id;
  if p_tipo = 'cancelado' then
    perform public.encolar_aviso('sitting:' || p_sitting_id || ':cancelado:' || txid_current(), p_ninera_id, null, 'sitting',
      'Se canceló tu ' || v_que || ' del ' || v_dia, 'Con ' || rtrim(v_madre, '.') || '. Si tienes dudas, escríbenos.', '#inicio', v_datos);
  elsif p_tipo = 'sin' then
    perform public.encolar_aviso('sitting:' || p_sitting_id || ':sin:' || p_ninera_id || ':' || txid_current(), p_ninera_id, null, 'sitting',
      'Ya no vas al ' || v_que || ' del ' || v_dia, 'El equipo hizo un cambio. Si tienes dudas, escríbenos.', '#inicio', v_datos);
  elsif p_tipo = 'nuevo' then
    if p_solicitud_id is not null and exists (select 1 from public.solicitud_ninieras sn
         where sn.solicitud_id = p_solicitud_id and sn.ninera_id = p_ninera_id and sn.estado = 'confirmada') then
      return;
    end if;
    perform public.encolar_aviso('sitting:' || p_sitting_id || ':nuevo:' || p_ninera_id || ':' || txid_current(), p_ninera_id, null, 'sitting',
      'Tienes un ' || v_que || ' el ' || v_dia,
      case when v_traslado then coalesce('A las ' || to_char(p_hi, 'HH24:MI'), 'Sin horario')
           else coalesce(to_char(p_hi, 'HH24:MI'), 'Sin horario') || coalesce(', en ' || v_zona, '') end
        || '. Mira los datos en la app.',
      '#inicio', v_datos);
  elsif p_tipo = 'cambio' then
    v_cambio := gen_random_uuid();
    if public.encolar_aviso('sitting:' || p_sitting_id || ':cambio:' || p_fecha || ':' || coalesce(to_char(p_hi, 'HH24MI'), '') || '-'
           || case when v_traslado then '' else coalesce(to_char(p_hf, 'HH24MI'), '') || case when p_termina then 'd' else '' end end,
         p_ninera_id, null, 'sitting',
         'Cambió el horario de tu ' || v_que || ' del ' || public.dia_corto_texto(coalesce(p_fecha_antes, p_fecha)),
         'Ahora es ' || case when p_fecha_antes is not null and p_fecha_antes <> p_fecha then 'el ' || v_dia || ', ' else '' end
           || case when v_traslado then coalesce('a las ' || to_char(p_hi, 'HH24:MI'), 'sin horario')
                   else public.horario_texto(p_hi, p_hf, p_termina) end || '. Mira los detalles.',
         '#cambio/' || v_cambio, v_datos || jsonb_build_object('cambio_id', v_cambio)) then
      insert into public.cambios_horario (id, ninera_id, familia_id, familia_nombre, sitting_id, solicitud_id, es_fijo, desde,
                                          hora_inicio, hora_fin, termina_dia_siguiente, tipo)
      values (v_cambio, p_ninera_id, p_familia_id, p_familia_nombre, p_sitting_id, p_solicitud_id, false, p_fecha, p_hi,
              case when v_traslado then null else p_hf end, case when v_traslado then false else coalesce(p_termina, false) end, v_que);
    end if;
  end if;
end
$function$;
revoke execute on function public.aviso_sitting_ninera(text, uuid, uuid, uuid, text, date, time without time zone, time without time zone, boolean, uuid, date, text) from public, anon, authenticated;

-- Los triggers (uno por sentencia: lo que tocó la sentencia entera en old / new table). Mientras corre
-- generar_previstos_fijos (pb.previstos = '1') no avisa: anota en una tabla temporal y avisar_cambios_previstos
-- manda el resumen por fijo al final. Si no, por fila:
--   update: se canceló → cancelado; se reactivó → nuevo; cambió la niñera → sin a la de antes y nuevo a la nueva;
--           cambió el día o el horario → cambio;
--   insert: un sitting puntual nuevo (sin asignacion_id; los días de un fijo los carga la base) → nuevo;
--   delete: se borró un sitting que no estaba cancelado → cancelado.
create or replace function public.sittings_avisos_cambios()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
begin
  begin
    if coalesce(current_setting('pb.previstos', true), '') = '1' then
      create temporary table if not exists _pb_cambios_previstos (
        accion text, id uuid, fecha date, tipo text, cancelado boolean, ninera_id uuid, ninera_nombre text,
        familia_id uuid, familia_nombre text, asignacion_id uuid, hora_inicio time without time zone,
        hora_fin time without time zone, termina_dia_siguiente boolean) on commit drop;
      if tg_op in ('UPDATE', 'DELETE') then
        insert into _pb_cambios_previstos
          select 'antes', o.id, o.fecha, o.tipo, o.cancelado, o.ninera_id, o.ninera_nombre, o.familia_id, o.familia_nombre,
                 o.asignacion_id, o.hora_inicio, o.hora_fin, o.termina_dia_siguiente from viejas o;
      end if;
      if tg_op in ('UPDATE', 'INSERT') then
        insert into _pb_cambios_previstos
          select 'despues', n.id, n.fecha, n.tipo, n.cancelado, n.ninera_id, n.ninera_nombre, n.familia_id, n.familia_nombre,
                 n.asignacion_id, n.hora_inicio, n.hora_fin, n.termina_dia_siguiente from nuevas n;
      end if;
      return null;
    end if;

    if tg_op = 'UPDATE' then
      for r in
        select o.id, n.tipo, o.fecha as f0, n.fecha as f1, o.cancelado as c0, n.cancelado as c1, o.ninera_id as n0, n.ninera_id as n1,
               o.hora_inicio as hi0, n.hora_inicio as hi1, o.hora_fin as hf0, n.hora_fin as hf1,
               o.termina_dia_siguiente as t0, n.termina_dia_siguiente as t1, n.familia_id, n.familia_nombre, n.solicitud_id
          from viejas o join nuevas n on n.id = o.id
         where n.tipo in ('sitting', 'traslado')
           and ((o.cancelado, o.ninera_id, o.fecha, o.hora_inicio) is distinct from (n.cancelado, n.ninera_id, n.fecha, n.hora_inicio)
                or (n.tipo = 'sitting' and (o.hora_fin, o.termina_dia_siguiente) is distinct from (n.hora_fin, n.termina_dia_siguiente)))
      loop
        if not r.c0 and r.c1 then
          perform public.aviso_sitting_ninera('cancelado', r.id, r.n0, r.familia_id, r.familia_nombre, r.f0, r.hi0, r.hf0, r.t0, null, null, r.tipo);
        elsif r.c0 and not r.c1 then
          perform public.aviso_sitting_ninera('nuevo', r.id, r.n1, r.familia_id, r.familia_nombre, r.f1, r.hi1, r.hf1, r.t1, r.solicitud_id, null, r.tipo);
        elsif not r.c1 and r.n0 is distinct from r.n1 then
          perform public.aviso_sitting_ninera('sin', r.id, r.n0, r.familia_id, r.familia_nombre, r.f0, r.hi0, r.hf0, r.t0, null, null, r.tipo);
          perform public.aviso_sitting_ninera('nuevo', r.id, r.n1, r.familia_id, r.familia_nombre, r.f1, r.hi1, r.hf1, r.t1, r.solicitud_id, null, r.tipo);
        elsif not r.c1 then
          perform public.aviso_sitting_ninera('cambio', r.id, r.n1, r.familia_id, r.familia_nombre, r.f1, r.hi1, r.hf1, r.t1, r.solicitud_id, r.f0, r.tipo);
        end if;
      end loop;
    elsif tg_op = 'INSERT' then
      for r in select * from nuevas n where n.tipo in ('sitting', 'traslado') and not n.cancelado and n.asignacion_id is null loop
        perform public.aviso_sitting_ninera('nuevo', r.id, r.ninera_id, r.familia_id, r.familia_nombre, r.fecha, r.hora_inicio, r.hora_fin,
          r.termina_dia_siguiente, r.solicitud_id, null, r.tipo);
      end loop;
    elsif tg_op = 'DELETE' then
      for r in select * from viejas o where o.tipo in ('sitting', 'traslado') and not o.cancelado loop
        perform public.aviso_sitting_ninera('cancelado', r.id, r.ninera_id, r.familia_id, r.familia_nombre, r.fecha, r.hora_inicio, r.hora_fin,
          r.termina_dia_siguiente, null, null, r.tipo);
      end loop;
    end if;
  exception when others then
    -- Un aviso nunca frena un guardado (plata, Agenda, fijos): queda en el log de la base.
    raise warning 'sittings_avisos_cambios: %', sqlerrm;
  end;
  return null;
end
$function$;
revoke execute on function public.sittings_avisos_cambios() from public, anon, authenticated;
create trigger sittings_avisos_insert after insert on public.sittings_traslados
  referencing new table as nuevas for each statement execute function public.sittings_avisos_cambios();
create trigger sittings_avisos_update after update on public.sittings_traslados
  referencing old table as viejas new table as nuevas for each statement execute function public.sittings_avisos_cambios();
create trigger sittings_avisos_delete after delete on public.sittings_traslados
  referencing old table as viejas for each statement execute function public.sittings_avisos_cambios();

-- El resumen de los fijos (Diego, 02/11/2026): lo que generar_previstos_fijos cambió en los días previstos (después
-- de hoy), comparado por niñera y familia, día por día (un cambio "desde una fecha" cierra el fijo y abre otro: los
-- días del viejo se borran y los del nuevo se crean). Un aviso por fijo, no uno por día:
--   mismo día antes y después con otro horario → "Cambió el horario de tu fijo con [madre]" / "Desde el [día], de
--     [hi] a [hf]. Mira los detalles." (con su fila en cambios_horario para responder);
--   días que estaban y ya no: con una pausa → "Tu fijo con [madre] se pausa" / "Del [día] al [día]. Si tienes
--     dudas, escríbenos."; si esos días pasaron a otra niñera → "Ya no vas al fijo con [madre] desde el [día]" / "El
--     equipo hizo un cambio. Si tienes dudas, escríbenos."; si el fijo terminó → "Tu fijo con [madre] termina el
--     [día]" / "Si tienes dudas, escríbenos."; si no, cambiaron los días;
--   días nuevos: si no tenía ningún día de un fijo con esa familia → "Tienes un fijo nuevo con [madre]" / "Desde el
--     [día], a las [hi], en [zona]. Mira los datos en la app."; los que se suman al final de la ventana (la corrida de
--     cada noche) no cuentan; otros → "Cambiaron los días de tu fijo con [madre]" / "Mira tus próximos sittings en la
--     app.".
-- La clave lleva el número de la transacción: cada corrida es un hecho nuevo. Interna; un error no frena nada.
create or replace function public.avisar_cambios_previstos(p_hoy date)
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  g record;
  v_total integer := 0;
  v_madre text;
  v_zona text;
  v_clave text;
  v_cambio uuid;
  v_titulo text;
  v_cuerpo text;
  v_pausa record;
  v_termina date;
  v_max date;
  v_dias boolean;
  v_fijo text;
  v_traslado boolean;
begin
  if to_regclass('pg_temp._pb_cambios_previstos') is null then return 0; end if;
  begin
    for g in
      with c as (
        select x.*, coalesce(x.tipo, 'sitting') as servicio from _pb_cambios_previstos x
         where coalesce(x.tipo, 'sitting') in ('sitting', 'traslado') and not coalesce(x.cancelado, false) and x.fecha > p_hoy
           and x.ninera_id is not null
      ), a as (
        select distinct on (ninera_id, familia_id, servicio, fecha) * from c where accion = 'antes'
         order by ninera_id, familia_id, servicio, fecha, hora_inicio
      ), d as (
        select distinct on (ninera_id, familia_id, servicio, fecha) * from c where accion = 'despues'
         order by ninera_id, familia_id, servicio, fecha, hora_inicio
      ), pares as (
        select coalesce(a.ninera_id, d.ninera_id) as ninera_id, coalesce(a.familia_id, d.familia_id) as familia_id,
               coalesce(a.servicio, d.servicio) as servicio,
               coalesce(d.familia_nombre, a.familia_nombre) as familia_nombre, coalesce(a.fecha, d.fecha) as fecha,
               a.id is not null as habia, d.id is not null as hay,
               a.id is not null and d.id is not null
                 and case when coalesce(a.servicio, d.servicio) = 'traslado' then a.hora_inicio is distinct from d.hora_inicio
                          else (a.hora_inicio, a.hora_fin, a.termina_dia_siguiente) is distinct from (d.hora_inicio, d.hora_fin, d.termina_dia_siguiente) end
                 as cambio,
               d.hora_inicio, d.hora_fin, d.termina_dia_siguiente
          from a full join d on d.ninera_id = a.ninera_id and d.familia_id is not distinct from a.familia_id
                            and d.servicio = a.servicio and d.fecha = a.fecha
      )
      select p.ninera_id, p.familia_id, p.servicio, max(p.familia_nombre) as familia_nombre,
             min(p.fecha) filter (where p.cambio) as desde_cambio,
             min(p.fecha) filter (where p.habia and not p.hay) as desde_quita,
             max(p.fecha) filter (where p.habia and not p.hay) as hasta_quita,
             array_agg(p.fecha order by p.fecha) filter (where p.hay and not p.habia) as sumas
        from pares p
       where p.cambio or p.habia <> p.hay
       group by p.ninera_id, p.familia_id, p.servicio
    loop
      if not public.sitting_puede_avisar(g.ninera_id, g.familia_id, g.familia_nombre) then continue; end if;
      select public.madre_nombre_inicial(coalesce(f.nombre, g.familia_nombre)), nullif(btrim(f.zona), '')
        into v_madre, v_zona from (select 1) x left join public.familias f on f.id = g.familia_id;
      v_traslado := g.servicio = 'traslado';
      v_fijo := case when v_traslado then 'fijo de traslados' else 'fijo' end;
      v_clave := 'fijo:' || coalesce(g.familia_id::text, '-') || ':' || g.ninera_id || ':' || case when v_traslado then 'traslado:' else '' end;
      v_dias := false;

      if g.desde_cambio is not null then
        select * into v_pausa from _pb_cambios_previstos
         where accion = 'despues' and ninera_id = g.ninera_id and familia_id is not distinct from g.familia_id
           and coalesce(tipo, 'sitting') = g.servicio and fecha = g.desde_cambio
         order by hora_inicio limit 1;
        v_cambio := gen_random_uuid();
        if public.encolar_aviso(v_clave || 'horario:' || txid_current(), g.ninera_id, null, 'sitting',
             'Cambió el horario de tu ' || v_fijo || ' con ' || v_madre,
             'Desde el ' || public.dia_corto_texto(g.desde_cambio) || ', '
               || case when v_traslado then coalesce('a las ' || to_char(v_pausa.hora_inicio, 'HH24:MI'), 'sin horario')
                       else public.horario_texto(v_pausa.hora_inicio, v_pausa.hora_fin, v_pausa.termina_dia_siguiente) end
               || '. Mira los detalles.',
             '#cambio/' || v_cambio, jsonb_build_object('cambio_id', v_cambio)) then
          insert into public.cambios_horario (id, ninera_id, familia_id, familia_nombre, es_fijo, desde, hora_inicio, hora_fin,
                                              termina_dia_siguiente, tipo)
          values (v_cambio, g.ninera_id, g.familia_id, g.familia_nombre, true, g.desde_cambio, v_pausa.hora_inicio,
                  case when v_traslado then null else v_pausa.hora_fin end,
                  case when v_traslado then false else coalesce(v_pausa.termina_dia_siguiente, false) end, g.servicio);
          v_total := v_total + 1;
        end if;
      end if;

      if g.desde_quita is not null then
        select p.desde, p.hasta into v_pausa from public.asignaciones_pausas p join public.asignaciones a on a.id = p.asignacion_id
         where a.ninera_id = g.ninera_id and a.familia_id is not distinct from g.familia_id and coalesce(a.tipo, 'sitting') = g.servicio
           and g.desde_quita between p.desde and p.hasta
         order by p.created_at desc limit 1;
        if found then
          v_titulo := 'Tu ' || v_fijo || ' con ' || v_madre || ' se pausa';
          v_cuerpo := 'Del ' || public.dia_corto_texto(greatest(v_pausa.desde, g.desde_quita)) || ' al ' || public.dia_corto_texto(v_pausa.hasta)
                      || '. Si tienes dudas, escríbenos.';
        elsif exists (select 1 from _pb_cambios_previstos x
                       where x.accion = 'despues' and x.familia_id is not distinct from g.familia_id and x.ninera_id is distinct from g.ninera_id
                         and coalesce(x.tipo, 'sitting') = g.servicio
                         and x.fecha between g.desde_quita and g.hasta_quita and not coalesce(x.cancelado, false)) then
          v_titulo := 'Ya no vas al ' || v_fijo || ' con ' || v_madre || ' desde el ' || public.dia_corto_texto(g.desde_quita);
          v_cuerpo := 'El equipo hizo un cambio. Si tienes dudas, escríbenos.';
        elsif not exists (select 1 from public.asignaciones a
                           where a.ninera_id = g.ninera_id and a.familia_id is not distinct from g.familia_id
                             and coalesce(a.tipo, 'sitting') = g.servicio
                             and (a.vigente_hasta is null or a.vigente_hasta >= g.desde_quita)) then
          select max(a.vigente_hasta) into v_termina from public.asignaciones a
           where a.ninera_id = g.ninera_id and a.familia_id is not distinct from g.familia_id and coalesce(a.tipo, 'sitting') = g.servicio;
          v_titulo := 'Tu ' || v_fijo || ' con ' || v_madre || ' termina el ' || public.dia_corto_texto(coalesce(v_termina, g.desde_quita - 1));
          v_cuerpo := 'Si tienes dudas, escríbenos.';
        else
          v_dias := true;
        end if;
        if not v_dias and public.encolar_aviso(v_clave || 'quita:' || txid_current(), g.ninera_id, null, 'sitting', v_titulo, v_cuerpo,
             '#inicio', jsonb_build_object('familia_id', g.familia_id)) then
          v_total := v_total + 1;
        end if;
      end if;

      if g.sumas is not null then
        if not exists (select 1 from public.sittings_traslados s
                        where s.ninera_id = g.ninera_id and s.familia_id is not distinct from g.familia_id and s.asignacion_id is not null
                          and s.tipo = g.servicio
                          and s.id not in (select x.id from _pb_cambios_previstos x where x.accion = 'despues' and x.id is not null)) then
          select * into v_pausa from _pb_cambios_previstos
           where accion = 'despues' and ninera_id = g.ninera_id and familia_id is not distinct from g.familia_id
             and coalesce(tipo, 'sitting') = g.servicio and fecha = g.sumas[1]
           order by hora_inicio limit 1;
          if public.encolar_aviso(v_clave || 'nuevo:' || txid_current(), g.ninera_id, null, 'sitting',
               case when v_traslado then 'Tienes un fijo nuevo de traslados con ' else 'Tienes un fijo nuevo con ' end || v_madre,
               'Desde el ' || public.dia_corto_texto(g.sumas[1]) || ', a las ' || coalesce(to_char(v_pausa.hora_inicio, 'HH24:MI'), '-')
                 || case when v_traslado then '' else coalesce(', en ' || v_zona, '') end || '. Mira los datos en la app.',
               '#inicio', jsonb_build_object('familia_id', g.familia_id)) then
            v_total := v_total + 1;
          end if;
        else
          -- Lo que se suma al final de la ventana (la corrida de cada noche agrega un día) no es un cambio.
          select max(s.fecha) into v_max from public.sittings_traslados s
           where s.ninera_id = g.ninera_id and s.familia_id is not distinct from g.familia_id and s.asignacion_id is not null
             and s.tipo = g.servicio
             and s.id not in (select x.id from _pb_cambios_previstos x where x.accion = 'despues' and x.id is not null);
          if exists (select 1 from unnest(g.sumas) f where f < v_max) then v_dias := true; end if;
        end if;
      end if;

      if v_dias and public.encolar_aviso(v_clave || 'dias:' || txid_current(), g.ninera_id, null, 'sitting',
           'Cambiaron los días de tu ' || v_fijo || ' con ' || v_madre, 'Mira tus próximos sittings en la app.',
           '#inicio', jsonb_build_object('familia_id', g.familia_id)) then
        v_total := v_total + 1;
      end if;
    end loop;
  exception when others then
    raise warning 'avisar_cambios_previstos: %', sqlerrm;
  end;
  truncate _pb_cambios_previstos;
  return v_total;
end
$function$;
revoke execute on function public.avisar_cambios_previstos(date) from public, anon, authenticated;

-- ---- La respuesta al cambio de horario ----
-- Sus cambios sin responder, de hoy en adelante, para la tarjeta del inicio (#cambio/<id>). La familia como la ve en
-- el resto de la app. Vacío si no es niñera.
create or replace function public.ninera_mis_cambios()
returns table (id uuid, es_fijo boolean, desde date, hora_inicio time without time zone, hora_fin time without time zone,
               termina_dia_siguiente boolean, madre text, zona text, creado_en timestamp with time zone, tipo text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select c.id, c.es_fijo, c.desde, c.hora_inicio, c.hora_fin, c.termina_dia_siguiente,
         public.madre_nombre_inicial(coalesce(f.nombre, c.familia_nombre)), nullif(btrim(f.zona), ''), c.creado_en, c.tipo
    from public.cambios_horario c
    left join public.familias f on f.id = c.familia_id
   where c.ninera_id = (select public.ninera_actual()) and c.respuesta is null and c.desde >= public.hoy_mvd()
   order by c.creado_en
$function$;
revoke execute on function public.ninera_mis_cambios() from public, anon;
grant execute on function public.ninera_mis_cambios() to authenticated;

-- "Ok" (p_ok true) o "A esa hora no puedo" (false), una vez. "No puedo" avisa a las admins para buscar a otra; el
-- registro queda como está (decide una admin, decisiones 6.5). Un segundo toque devuelve la primera respuesta.
create or replace function public.ninera_responder_cambio(p_cambio_id uuid, p_ok boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_c public.cambios_horario;
  v_nombre text;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if p_ok is null then raise exception 'respuesta_invalida'; end if;
  select * into v_c from public.cambios_horario where id = p_cambio_id and ninera_id = v_yo for update;
  if not found then raise exception 'no_existe'; end if;
  if v_c.respuesta is not null then return v_c.respuesta; end if;
  update public.cambios_horario set respuesta = p_ok, respondido_en = now() where id = v_c.id;
  if not p_ok then
    select nombre into v_nombre from public.ninieras where id = v_yo;
    perform public.encolar_aviso('admin:cambio:' || v_c.id || ':no_puede', null, 'todas', 'el_dia',
      case when v_c.es_fijo then v_nombre || ' no puede el nuevo horario de su fijo con ' || coalesce(v_c.familia_nombre, 'la familia')
           else v_nombre || ' no puede el ' || public.dia_corto_texto(v_c.desde) || ' ' || public.horario_texto(v_c.hora_inicio, v_c.hora_fin, v_c.termina_dia_siguiente) end,
      case when v_c.es_fijo then 'Desde el ' || public.dia_corto_texto(v_c.desde) || ', ' || public.horario_texto(v_c.hora_inicio, v_c.hora_fin, v_c.termina_dia_siguiente) || '. Buscá a otra.'
           else 'Buscá a otra.' end,
      case when v_c.solicitud_id is not null then '?ir=agenda&solicitud=' || v_c.solicitud_id else '?ir=agenda' end,
      jsonb_build_object('cambio_id', v_c.id, 'ninera_id', v_yo, 'sitting_id', v_c.sitting_id));
  end if;
  return p_ok;
end
$function$;
revoke execute on function public.ninera_responder_cambio(uuid, boolean) from public, anon;
grant execute on function public.ninera_responder_cambio(uuid, boolean) to authenticated;

-- ---- El carsitting desde la app de niñeras (02/11/2026, fase 1, etapa 10, 20261108_carsitting_app) ----
-- Una fila por niñera desde la app (las del formulario no tienen enviado_en y pueden repetirse).
create unique index carsitting_datos_app_ninera on public.carsitting_datos (ninera_id) where enviado_en is not null;

-- Los campos del formulario "Carsitters datos" (los textos de la app en ninera/js/carsitting.js): todos obligatorios
-- salvo el número de la libreta.
create or replace function public.carsitting_campos()
returns table (clave text, obligatorio boolean)
language sql
immutable
set search_path to ''
as $function$
  select * from (values
    ('nombre_completo', true), ('cedula', true), ('numero_licencia', true), ('anio_licencia', true),
    ('modelo_auto', true), ('anio_fabricacion', true), ('color_auto', true), ('matricula', true), ('padron', true),
    ('libreta_propiedad', false), ('compania_seguro', true), ('tipo_seguro', true), ('cantidad_asientos', true),
    ('cantidad_cinturones', true)) as c(clave, obligatorio)
$function$;
revoke execute on function public.carsitting_campos() from public, anon, authenticated;

-- Las 7 fotos, todas obligatorias (Diego, 02/11/2026: frente y dorso por separado, reemplaza a las 5 de 6.7).
create or replace function public.carsitting_fotos()
returns setof text
language sql
immutable
set search_path to ''
as $function$
  select unnest(array['licencia_frente', 'licencia_dorso', 'libreta_frente', 'libreta_dorso', 'asientos', 'auto_dentro', 'auto_fuera'])
$function$;
revoke execute on function public.carsitting_fotos() from public, anon, authenticated;

-- Con solo_practica prendido, los avisos a niñeras solo a las de práctica (la regla de pedido_puede_avisar sin familia).
create or replace function public.carsitting_puede_avisar(p_ninera_nombre text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select not coalesce((select (valor->>'solo_practica')::boolean from public.app_config where id = 'pedidos_app'), true)
      or position('(practica)' in public.normaliza_nombre(p_ninera_nombre)) > 0
$function$;
revoke execute on function public.carsitting_puede_avisar(text) from public, anon, authenticated;

-- Lo suyo, para la pantalla y la tarjeta del inicio: si hace traslados, lo que cargó (los textos y las rutas de sus
-- fotos, que solo ella y las admins pueden abrir) y cómo está la revisión. null si no es niñera.
create or replace function public.ninera_mi_carsitting()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
           'hace_traslados', n.tipo in ('Traslados', 'Ambas'),
           'datos', case when c.id is null then null else
             (select jsonb_object_agg(k.clave, to_jsonb(c) -> k.clave) from public.carsitting_campos() k) end,
           'fotos', c.fotos,
           'revision', c.revision,
           'comentario', case when c.revision = 'rehacer' then c.comentario end,
           'enviado_en', c.enviado_en,
           'aprobado_en', c.aprobado_en)
    from public.ninieras n
    left join public.carsitting_datos c on c.ninera_id = n.id and c.enviado_en is not null
   where n.id = (select public.ninera_actual())
$function$;
revoke execute on function public.ninera_mi_carsitting() from public, anon;
grant execute on function public.ninera_mi_carsitting() to authenticated;

-- Enviar (o actualizar) los datos. p_datos: los campos (texto, hasta 120 caracteres; los vacíos no cuentan);
-- p_fotos: {clave: ruta} de las fotos nuevas, ya subidas a su carpeta; las que no manda quedan las que tenía. Al
-- final tienen que estar todos los obligatorios y las 7 fotos. Queda 'pendiente' (si estaba aprobada, sigue
-- aprobada con lo anterior: aprobado_en no se toca) y les avisa a las admins. Errores: no_autorizada,
-- no_hace_traslados, datos_invalidos, dato_largo, faltan_datos (hint: la clave), foto_invalida (hint: la clave),
-- faltan_fotos (hint: la clave).
create or replace function public.ninera_guardar_carsitting(p_datos jsonb, p_fotos jsonb default '{}'::jsonb)
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_n public.ninieras;
  v_antes public.carsitting_datos;
  v_fila jsonb := '{}'::jsonb;
  v_fotos jsonb;
  v_c record;
  v_valor text;
  v_clave text;
  v_ruta text;
  v_en timestamp with time zone := now();
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  select * into v_n from public.ninieras where id = v_yo;
  if v_n.tipo is distinct from 'Traslados' and v_n.tipo is distinct from 'Ambas' then raise exception 'no_hace_traslados'; end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object'
     or exists (select 1 from jsonb_each(p_datos) e
                 where e.key not in (select clave from public.carsitting_campos()) or jsonb_typeof(e.value) not in ('string', 'null')) then
    raise exception 'datos_invalidos';
  end if;
  for v_c in select * from public.carsitting_campos() loop
    v_valor := nullif(btrim(p_datos ->> v_c.clave), '');
    if char_length(v_valor) > 120 then raise exception 'dato_largo' using hint = v_c.clave; end if;
    if v_c.obligatorio and v_valor is null then raise exception 'faltan_datos' using hint = v_c.clave; end if;
    v_fila := v_fila || jsonb_build_object(v_c.clave, v_valor);
  end loop;
  select * into v_antes from public.carsitting_datos where ninera_id = v_yo and enviado_en is not null for update;
  v_fotos := coalesce(v_antes.fotos, '{}'::jsonb);
  if p_fotos is null then p_fotos := '{}'::jsonb; end if;
  if jsonb_typeof(p_fotos) <> 'object' then raise exception 'foto_invalida'; end if;
  for v_clave, v_ruta in select e.key, e.value #>> '{}' from jsonb_each(p_fotos) e loop
    if v_clave not in (select public.carsitting_fotos())
       or v_ruta is null or v_ruta !~ ('^carsitting/' || v_yo::text || '/' || v_clave || '_[0-9a-f]{8}\.jpg$')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'ninieras-privado' and o.name = v_ruta) then
      raise exception 'foto_invalida' using hint = coalesce(v_clave, '');
    end if;
    v_fotos := v_fotos || jsonb_build_object(v_clave, v_ruta);
  end loop;
  for v_clave in select public.carsitting_fotos() loop
    if not (v_fotos ? v_clave) then raise exception 'faltan_fotos' using hint = v_clave; end if;
  end loop;

  insert into public.carsitting_datos (ninera_id, ninera_nombre, nombre_completo, cedula, numero_licencia, anio_licencia,
    modelo_auto, anio_fabricacion, color_auto, matricula, padron, libreta_propiedad, compania_seguro, tipo_seguro,
    cantidad_asientos, cantidad_cinturones, fotos, enviado_en, revision)
  values (v_yo, v_n.nombre, v_fila->>'nombre_completo', v_fila->>'cedula', v_fila->>'numero_licencia', v_fila->>'anio_licencia',
    v_fila->>'modelo_auto', v_fila->>'anio_fabricacion', v_fila->>'color_auto', v_fila->>'matricula', v_fila->>'padron',
    v_fila->>'libreta_propiedad', v_fila->>'compania_seguro', v_fila->>'tipo_seguro', v_fila->>'cantidad_asientos',
    v_fila->>'cantidad_cinturones', v_fotos, v_en, 'pendiente')
  on conflict (ninera_id) where enviado_en is not null do update set
    ninera_nombre = excluded.ninera_nombre, nombre_completo = excluded.nombre_completo, cedula = excluded.cedula,
    numero_licencia = excluded.numero_licencia, anio_licencia = excluded.anio_licencia, modelo_auto = excluded.modelo_auto,
    anio_fabricacion = excluded.anio_fabricacion, color_auto = excluded.color_auto, matricula = excluded.matricula,
    padron = excluded.padron, libreta_propiedad = excluded.libreta_propiedad, compania_seguro = excluded.compania_seguro,
    tipo_seguro = excluded.tipo_seguro, cantidad_asientos = excluded.cantidad_asientos,
    cantidad_cinturones = excluded.cantidad_cinturones, fotos = excluded.fotos, enviado_en = excluded.enviado_en,
    revision = 'pendiente', revisado_en = null, revisado_por = null, comentario = null;

  -- La clave lleva la hora del reloj (no la de la transacción): cada envío es un aviso.
  perform public.encolar_aviso('admin:carsitting:' || v_yo || ':' || to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSUS'), null, 'todas', 'carsitting',
    v_n.nombre || case when v_antes.aprobado_en is not null then ' actualizó los datos del auto' else ' completó el carsitting' end,
    'Revisalo.', '?ir=hoy', jsonb_build_object('ninera_id', v_yo));
  return v_en;
end
$function$;
revoke execute on function public.ninera_guardar_carsitting(jsonb, jsonb) from public, anon;
grant execute on function public.ninera_guardar_carsitting(jsonb, jsonb) to authenticated;

-- Sus fotos: solo en su carpeta, con el nombre de una de las 7 y 8 hex al azar (cada envío sube archivos nuevos, así
-- lo aprobado antes no se pisa mientras se revisa lo nuevo). Las admins ven y borran todo (ninieras_privado_admins).
create policy ninieras_privado_carsitting on storage.objects as permissive for all to authenticated
  using ((bucket_id = 'ninieras-privado'::text)
         and (name ~ ('^carsitting/' || (select public.ninera_actual())::text
                      || '/(licencia_frente|licencia_dorso|libreta_frente|libreta_dorso|asientos|auto_dentro|auto_fuera)_[0-9a-f]{8}\.jpg$')))
  with check ((bucket_id = 'ninieras-privado'::text)
              and (name ~ ('^carsitting/' || (select public.ninera_actual())::text
                           || '/(licencia_frente|licencia_dorso|libreta_frente|libreta_dorso|asientos|auto_dentro|auto_fuera)_[0-9a-f]{8}\.jpg$')));

-- La revisión de una admin (una fila de la app que estaba 'pendiente'):
--   'aprobado' → aprobado_en / aprobado_por y lo que se aprobó (aprobado_datos), y "Tu carsitting quedó aprobado" /
--                "Gracias por completar los datos." (orquestador, 02/11/2026: neutro, los pedidos de traslado son la
--                etapa 11);
--   'rehacer'  → el comentario (obligatorio) le llega por el chat, con el nombre de quien revisó: el chat ya le manda
--                el push.
-- En la misma transacción: si el chat no se puede escribir, la revisión no queda.
create or replace function public.carsitting_al_revisar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n public.ninieras;
begin
  if new.enviado_en is null or old.revision is distinct from 'pendiente' or new.revision not in ('aprobado', 'rehacer') then
    return new;
  end if;
  select * into v_n from public.ninieras where id = new.ninera_id;
  new.revisado_en := coalesce(new.revisado_en, now());
  if new.revision = 'aprobado' then
    new.comentario := null;
    new.aprobado_en := new.revisado_en;
    new.aprobado_por := new.revisado_por;
    new.aprobado_datos := (select jsonb_object_agg(k.clave, to_jsonb(new) -> k.clave) from public.carsitting_campos() k)
                          || jsonb_build_object('fotos', new.fotos);
    if v_n.activa and v_n.user_id is not null and public.carsitting_puede_avisar(v_n.nombre) then
      perform public.encolar_aviso('carsitting:' || new.ninera_id || ':aprobado:' || to_char(new.revisado_en at time zone 'UTC', 'YYYYMMDDHH24MISSUS'),
        new.ninera_id, null, 'carsitting', 'Tu carsitting quedó aprobado', 'Gracias por completar los datos.', '#carsitting',
        jsonb_build_object('carsitting_id', new.id));
    end if;
  else
    new.comentario := nullif(btrim(new.comentario), '');
    if new.comentario is null then raise exception 'falta_comentario'; end if;
    if v_n.user_id is not null then
      insert into public.chat_mensajes (ninera_id, de, autor, texto)
      values (new.ninera_id, 'admin', coalesce(nullif(btrim(new.revisado_por), ''), 'Parents'' Break'),
              'Hay que corregir algo de tus datos de carsitting: ' || new.comentario);
    end if;
  end if;
  return new;
end
$function$;
revoke execute on function public.carsitting_al_revisar() from public, anon, authenticated;
create trigger carsitting_al_revisar before update of revision on public.carsitting_datos
  for each row execute function public.carsitting_al_revisar();

-- ---- Los avisos de tiempo (dentro del cron de cada minuto) ----
-- A las activas con app que hacen traslados (Traslados o Ambas) y no lo completaron (sin fila de la app) o tienen
-- que corregirlo ('rehacer'):
--   carsitting:<id>:completar       la primera vez, de 9 a 21 (sin fila de la app);
--   carsitting:<id>:semana:<lunes>  los lunes a las 10, si ya le llegó el primero antes de ese lunes (o le pidieron
--                                   corregirlo antes de ese lunes).
create or replace function public.programar_avisos_carsitting(p_ahora timestamp with time zone default now())
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_local timestamp := p_ahora at time zone 'America/Montevideo';
  v_hoy date := v_local::date;
  v_n integer;
begin
  if extract(hour from v_local) not between 9 and 20 then return 0; end if;
  with faltan as (
    select n.id, c.id is null as sin_fila, c.revisado_en
      from public.ninieras n
      left join public.carsitting_datos c on c.ninera_id = n.id and c.enviado_en is not null
     where n.activa and n.user_id is not null and n.app_activada_en is not null and n.tipo in ('Traslados', 'Ambas')
       and (c.id is null or c.revision = 'rehacer')
       and public.carsitting_puede_avisar(n.nombre)
  ), avisos as (
    select 'carsitting:' || f.id || ':completar' as clave, f.id, 'Completa tus datos de carsitting' as titulo,
           'Marcaste que realizas traslados. Necesitamos estos datos una sola vez.' as cuerpo
      from faltan f where f.sin_fila
    union all
    select 'carsitting:' || f.id || ':semana:' || v_hoy, f.id, 'Te faltan tus datos de carsitting',
           'Los necesitamos para tus traslados. Complétalos en la app.'
      from faltan f
     where extract(isodow from v_local) = 1 and extract(hour from v_local) = 10
       and (exists (select 1 from public.avisos a where a.clave = 'carsitting:' || f.id || ':completar'
                       and a.creado_en < (v_hoy::timestamp at time zone 'America/Montevideo'))
            or (not f.sin_fila and f.revisado_en < (v_hoy::timestamp at time zone 'America/Montevideo')))
  )
  select count(*) filter (where public.encolar_aviso(a.clave, a.id, null, 'carsitting', a.titulo, a.cuerpo, '#carsitting'))
    into v_n from avisos a;
  return v_n;
end
$function$;
revoke execute on function public.programar_avisos_carsitting(timestamp with time zone) from public, anon, authenticated;
grant execute on function public.programar_avisos_carsitting(timestamp with time zone) to service_role;

-- ---- El freno del carsitting (03/11/2026, fase 1, etapa 11, 20261109_traslados_app) ----
-- Tiene el carsitting aprobado desde la app (etapa 10): aprobado una vez, queda aprobado aunque mande una
-- actualización. Las filas del formulario de Google no cuentan (no tienen enviado_en). Interna.
create or replace function public.carsitting_aprobado(p_ninera_id uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select exists (select 1 from public.carsitting_datos c
                  where c.ninera_id = p_ninera_id and c.enviado_en is not null and c.aprobado_en is not null)
$function$;
revoke execute on function public.carsitting_aprobado(uuid) from public, anon, authenticated;


-- Una admin confirma a una niñera: "¡Quedaste seleccionada!" y "Ya se cubrió" (etapa 6)
-- Corre cuando una fila de solicitud_ninieras pasa a 'confirmada' (o se inserta así: "Asignar" a una
-- que no recibió el pedido por la app, Diego 01/11/2026). Solo pedidos de sitting (los traslados no
-- van por la app, decisiones 4.2).
--   - Las demás filas de la app que seguían abiertas ('invitada' o 'acepto') pasan a 'cubierto'; a
--     las que habían dicho "Puedo" (respondido_en) les llega "Gracias por responder" (4.19).
--   - Si la elegida tiene app y el pedido es de hoy en adelante, "¡Quedaste seleccionada!" y
--     seleccionada_en (la tarjeta de arriba en su inicio, hasta que la ve).
-- Los avisos, solo si pedido_puede_avisar. Las claves son una por fila: no se repiten.
create or replace function public.solicitud_ninieras_al_confirmar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_s public.solicitudes;
  v_n public.ninieras;
  v_otra record;
begin
  if tg_op = 'UPDATE' and old.estado = 'confirmada' then return null; end if;
  select * into v_s from public.solicitudes where id = new.solicitud_id;
  if not found then return null; end if;

  for v_otra in
    update public.solicitud_ninieras x
       set estado = 'cubierto'
     where x.solicitud_id = new.solicitud_id and x.id <> new.id and x.origen = 'app'
       and x.estado in ('invitada', 'acepto')
    returning x.id, x.ninera_id, x.ninera_nombre, x.respondido_en
  loop
    if v_otra.respondido_en is not null and v_s.fecha >= public.hoy_mvd()
       and public.pedido_puede_avisar(v_s.familia_id, v_s.familia_nombre, v_otra.ninera_nombre) then
      perform public.encolar_aviso('pedido:' || v_otra.id || ':cubierto', v_otra.ninera_id, null, 'pedido',
        'Gracias por responder',
        case when v_s.tipo = 'traslado' then 'Este traslado' else 'Este sitting' end
          || ' ya quedó cubierto. ¡Te tendremos en cuenta para el próximo!',
        '#inicio', jsonb_build_object('solicitud_ninera_id', v_otra.id));
    end if;
  end loop;

  if new.ninera_id is null or new.seleccionada_en is not null or v_s.fecha < public.hoy_mvd() then return null; end if;
  select * into v_n from public.ninieras where id = new.ninera_id;
  if not found or v_n.user_id is null
     or not public.pedido_puede_avisar(v_s.familia_id, v_s.familia_nombre, v_n.nombre) then
    return null;
  end if;
  update public.solicitud_ninieras set seleccionada_en = now() where id = new.id;
  perform public.encolar_aviso('pedido:' || new.id || ':seleccionada', v_n.id, null, 'pedido',
    '¡Quedaste seleccionada!',
    public.dia_corto_texto(v_s.fecha) || ' a las ' || to_char(v_s.hora_inicio, 'HH24:MI') || '. Ya tienes todos los datos en la app.',
    '#pedido/' || new.id, jsonb_build_object('solicitud_ninera_id', new.id));
  return null;
end
$function$;
revoke execute on function public.solicitud_ninieras_al_confirmar() from public, anon, authenticated;
-- Solo cuando cambia el estado: el update de seleccionada_en de adentro no lo vuelve a disparar.
create trigger solicitud_ninieras_al_confirmar after insert or update of estado on public.solicitud_ninieras
  for each row when (new.estado = 'confirmada')
  execute function public.solicitud_ninieras_al_confirmar();

-- Se cancela el pedido: "Se canceló el pedido del [día]" (etapa 6)
-- Las filas de la app abiertas pasan a 'cancelado'; a las que dijeron "Puedo", el aviso (4.19). Desde la etapa 8, la
-- elegida y su registro también (le llega "Se canceló tu sitting").
create or replace function public.solicitudes_al_cancelar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_otra record;
begin
  for v_otra in
    update public.solicitud_ninieras x
       set estado = 'cancelado'
     where x.solicitud_id = new.id and x.origen = 'app' and x.estado in ('invitada', 'acepto')
    returning x.id, x.ninera_id, x.ninera_nombre, x.respondido_en
  loop
    if v_otra.respondido_en is not null and new.fecha >= public.hoy_mvd()
       and public.pedido_puede_avisar(new.familia_id, new.familia_nombre, v_otra.ninera_nombre) then
      perform public.encolar_aviso('pedido:' || v_otra.id || ':cancelado', v_otra.ninera_id, null, 'pedido',
        'Se canceló el pedido del ' || public.dia_corto_texto(new.fecha), 'Gracias por responder.',
        '#inicio', jsonb_build_object('solicitud_ninera_id', v_otra.id));
    end if;
  end loop;
  -- Ya asignado (etapa 8): la elegida y su registro.
  update public.solicitud_ninieras x set estado = 'cancelado' where x.solicitud_id = new.id and x.estado = 'confirmada';
  update public.sittings_traslados s
     set cancelado = true, cobro_familia = 0, pago_ninera = 0, cobrado = true, pagado = true, generado_automatico = false,
         notas = concat_ws(' — ', nullif(btrim(s.notas), ''), 'Pedido cancelado')
   where s.solicitud_id = new.id and not s.cancelado and not s.cobrado and not s.pagado and s.fecha >= public.hoy_mvd();
  return null;
end
$function$;
revoke execute on function public.solicitudes_al_cancelar() from public, anon, authenticated;
create trigger solicitudes_al_cancelar after update of estado on public.solicitudes
  for each row when (new.estado = 'cancelada' and old.estado is distinct from 'cancelada')
  execute function public.solicitudes_al_cancelar();

-- Lo de la niñera
-- Sus pedidos abiertos: los que todavía no respondió ('invitada', "Pedidos por responder") y los que
-- dijo que puede ('acepto', "Esperando confirmación"). Un pedido de un día que ya pasó no aparece.
-- Una sola vez (etapa 6): la elegida ('confirmada' con seleccionada_en) hasta que abre los datos, y
-- 'cubierto' / 'cancelado' de las que dijeron "Puedo" hasta que lo ve en el inicio (visto_en).
-- Nunca la familia, la dirección, el cobro ni las notas.
create or replace function public.ninera_mis_pedidos()
returns table (id uuid, estado text, fecha date, hora_inicio time without time zone,
               hora_fin time without time zone, termina_dia_siguiente boolean, zona text, chicos text,
               precio_hora numeric, responder_hasta timestamp with time zone,
               enviado_en timestamp with time zone, respondido_en timestamp with time zone,
               horario_aproximado boolean, solicitud_id uuid,
               tipo text, destino_zona text, precio_viaje numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select sn.id, sn.estado, s.fecha, s.hora_inicio, s.hora_fin, s.termina_dia_siguiente,
         coalesce(nullif(btrim(s.zona), ''), nullif(btrim(f.zona), '')),
         case when exists (select 1 from public.hijos_familia h where h.familia_id = s.familia_id)
              then public.chicos_texto(s.familia_id) end,
         sn.precio_hora, s.responder_hasta, sn.enviado_en, sn.respondido_en,
         s.horario_aproximado, s.id,
         s.tipo, case when s.tipo = 'traslado' then nullif(btrim(s.destino_zona), '') end, sn.precio_viaje
    from public.solicitud_ninieras sn
    join public.solicitudes s on s.id = sn.solicitud_id
    left join public.familias f on f.id = s.familia_id
   where sn.ninera_id = (select public.ninera_actual())
     and s.fecha >= public.hoy_mvd()
     and ((sn.origen = 'app' and sn.estado in ('invitada', 'acepto') and s.estado in ('sin_asignar', 'pendiente_confirmar'))
          or (sn.estado = 'confirmada' and sn.seleccionada_en is not null and sn.visto_en is null and s.estado = 'confirmada')
          or (sn.origen = 'app' and sn.estado in ('cubierto', 'cancelado') and sn.respondido_en is not null and sn.visto_en is null))
   order by s.fecha, s.hora_inicio
$function$;
revoke execute on function public.ninera_mis_pedidos() from public, anon;
grant execute on function public.ninera_mis_pedidos() to authenticated;

-- La niñera vio la tarjeta de "Seleccionada" (abrió los datos) o el aviso de "cubierto" / "cancelado"
-- del inicio: no se le vuelve a mostrar. Solo sus filas. true si marcó algo.
create or replace function public.ninera_marcar_pedido_visto(p_sn_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  update public.solicitud_ninieras
     set visto_en = now()
   where id = p_sn_id and ninera_id = v_yo and visto_en is null
     and estado in ('confirmada', 'cubierto', 'cancelado');
  return found;
end
$function$;
revoke execute on function public.ninera_marcar_pedido_visto(uuid) from public, anon;
grant execute on function public.ninera_marcar_pedido_visto(uuid) to authenticated;

-- Avisos de tiempo de los pedidos (decisiones 7, etapa 6)
-- Corre cada minuto dentro de programar_avisos (cron enviar-avisos). p_ahora es para las pruebas.
-- Cada aviso tiene su clave (no se repite) y una ventana: si el cron estuvo parado, no salen avisos
-- viejos de golpe (2 horas para los de las admins; el recordatorio, solo antes de responder_hasta).
--   - pedido:<sn>:recordatorio: a la que sigue sin responder, recordatorio_min_antes (10) antes de
--     responder_hasta.
--   - admin:pedido:<sol>:perfiles: hay al menos una que puede y nadie elegida, 15 min (pedido para el
--     mismo día del envío) o 30 min (otro día) después del primer envío.
--   - admin:pedido:<sol>:nadie: nadie respondió nada, min_nadie (30) después del primer envío.
--   - admin:pedido:<sol>:3h: pedido de hoy sin niñera (mandado por la app o no), aviso_sin_ninera_horas
--     (3) antes del inicio. Mientras solo_practica esté prendido, solo de familias de práctica (Diego,
--     01/11/2026: se prende con todo lo demás antes de la prueba con niñeras reales).
create or replace function public.programar_avisos_pedidos(p_ahora timestamp with time zone default now())
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_cfg jsonb := coalesce((select valor from public.app_config where id = 'pedidos_app'), '{}'::jsonb);
  v_hoy date := (p_ahora at time zone 'America/Montevideo')::date;
  v_rec integer := coalesce((v_cfg->>'recordatorio_min_antes')::int, 10);
  v_nadie integer := coalesce((v_cfg->>'min_nadie')::int, 30);
  v_horas integer := coalesce((v_cfg->>'aviso_sin_ninera_horas')::int, 3);
  v_solo_practica boolean := coalesce((v_cfg->>'solo_practica')::boolean, true);
  v_total integer := 0;
  v_min integer;
  v_inicio timestamp with time zone;
  r record;
begin
  -- Recordatorio a la niñera.
  for r in
    select sn.id, sn.ninera_id, s.fecha, s.tipo
      from public.solicitud_ninieras sn
      join public.solicitudes s on s.id = sn.solicitud_id
     where sn.origen = 'app' and sn.estado = 'invitada'
       and s.estado in ('sin_asignar', 'pendiente_confirmar') and s.fecha >= v_hoy
       and s.responder_hasta is not null
       and p_ahora >= s.responder_hasta - make_interval(mins => v_rec) and p_ahora < s.responder_hasta
  loop
    if public.encolar_aviso('pedido:' || r.id || ':recordatorio', r.ninera_id, null, 'pedido',
         case when r.tipo = 'traslado' then 'Traslado ' else 'Sitting ' end || to_char(r.fecha, 'DD/MM'),
         '¡Hola! Avísame por favor si estarías disponible.',
         '#pedido/' || r.id, jsonb_build_object('solicitud_ninera_id', r.id)) then
      v_total := v_total + 1;
    end if;
  end loop;

  -- Perfiles para la madre y nadie respondió.
  for r in
    select s.id, s.familia_nombre, s.fecha, s.enviado_app_en,
           (select count(*) from public.solicitud_ninieras x
             where x.solicitud_id = s.id and x.origen = 'app' and x.estado = 'acepto')::int as pueden,
           (select count(*) from public.solicitud_ninieras x
             where x.solicitud_id = s.id and x.origen = 'app' and x.respondido_en is not null)::int as respondieron
      from public.solicitudes s
     where s.estado = 'pendiente_confirmar' and s.enviado_app_en is not null and s.fecha >= v_hoy
       and p_ahora < s.enviado_app_en + interval '3 hours'
  loop
    v_min := case when r.fecha = (r.enviado_app_en at time zone 'America/Montevideo')::date
                  then coalesce((v_cfg->>'min_mismo_dia')::int, 15)
                  else coalesce((v_cfg->>'min_otro_dia')::int, 30) end;
    if r.pueden > 0
       and p_ahora >= r.enviado_app_en + make_interval(mins => v_min)
       and p_ahora < r.enviado_app_en + make_interval(mins => v_min) + interval '2 hours'
       and public.encolar_aviso('admin:pedido:' || r.id || ':perfiles', null, 'todas', 'pedidos',
             case when r.pueden = 1 then 'Puede 1 niñera para el pedido de ' else 'Pueden ' || r.pueden || ' niñeras para el pedido de ' end
               || r.familia_nombre,
             'Mandale los perfiles a la madre.', '?ir=agenda&solicitud=' || r.id, jsonb_build_object('solicitud_id', r.id)) then
      v_total := v_total + 1;
    end if;
    if r.respondieron = 0
       and p_ahora >= r.enviado_app_en + make_interval(mins => v_nadie)
       and p_ahora < r.enviado_app_en + make_interval(mins => v_nadie) + interval '2 hours'
       and public.encolar_aviso('admin:pedido:' || r.id || ':nadie', null, 'todas', 'pedidos',
             'Nadie respondió el pedido de ' || r.familia_nombre, 'Preguntale a más niñeras.',
             '?ir=agenda&solicitud=' || r.id, jsonb_build_object('solicitud_id', r.id)) then
      v_total := v_total + 1;
    end if;
  end loop;

  -- Pedido de hoy sin niñera, 3 horas antes.
  for r in
    select s.id, s.familia_nombre, s.hora_inicio, s.estado, s.fecha
      from public.solicitudes s
      left join public.familias f on f.id = s.familia_id
     where s.estado in ('sin_asignar', 'pendiente_confirmar') and s.fecha = v_hoy
       and (not v_solo_practica
            or position('(practica)' in public.normaliza_nombre(coalesce(f.nombre, s.familia_nombre))) > 0)
  loop
    v_inicio := (r.fecha + r.hora_inicio) at time zone 'America/Montevideo';
    if p_ahora >= v_inicio - make_interval(hours => v_horas) and p_ahora < v_inicio
       and public.encolar_aviso('admin:pedido:' || r.id || ':3h', null, 'todas', 'pedidos',
             r.familia_nombre || ' hoy a las ' || to_char(r.hora_inicio, 'HH24:MI') || ' sigue sin niñera',
             case when r.estado = 'pendiente_confirmar' then 'Mirá las respuestas.' else 'Elegí a quién mandárselo.' end,
             '?ir=agenda&solicitud=' || r.id, jsonb_build_object('solicitud_id', r.id)) then
      v_total := v_total + 1;
    end if;
  end loop;
  return v_total;
end
$function$;
revoke execute on function public.programar_avisos_pedidos(timestamp with time zone) from public, anon, authenticated;
grant execute on function public.programar_avisos_pedidos(timestamp with time zone) to service_role;

-- Responde un pedido suyo: 'acepto' ("Puedo") o 'no_puedo' con el motivo (textos 4; el texto libre
-- solo con 'otro'). Una sola respuesta: el update lleva la condición del estado anterior, así dos
-- toques o dos celulares no responden dos veces. Puede responder pasada la hora límite mientras el
-- pedido siga abierto (decisiones 4.11). Devuelve 'ok', 'ya_respondido' o 'cerrado'. Un "Puedo"
-- avisa al instante a las admins (admin:pedido:<sn>:acepto).
create or replace function public.responder_pedido(p_sn_id uuid, p_respuesta text, p_motivo text default null,
  p_motivo_texto text default null)
returns text
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_sn public.solicitud_ninieras;
  v_s public.solicitudes;
  v_texto text := nullif(btrim(coalesce(p_motivo_texto, '')), '');
  v_n integer;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if p_respuesta is null or p_respuesta not in ('acepto', 'no_puedo') then raise exception 'respuesta_invalida'; end if;
  if p_respuesta = 'no_puedo' then
    if p_motivo is null or p_motivo not in ('otro_trabajo', 'facultad', 'lejos', 'tarde', 'otro') then
      raise exception 'motivo_invalido';
    end if;
    if p_motivo <> 'otro' then v_texto := null; end if;
    if char_length(v_texto) > 200 then raise exception 'motivo_largo'; end if;
  else
    p_motivo := null;
    v_texto := null;
  end if;

  -- Un pedido de otra o que no existe dan lo mismo: no se dice si existe.
  select * into v_sn from public.solicitud_ninieras where id = p_sn_id and ninera_id = v_yo and origen = 'app';
  if not found then raise exception 'no_existe'; end if;
  -- for share: que nadie lo asigne ni lo cancele entre el chequeo y la respuesta.
  select * into v_s from public.solicitudes where id = v_sn.solicitud_id for share;
  if v_s.estado not in ('sin_asignar', 'pendiente_confirmar') or v_s.fecha < public.hoy_mvd() then
    return 'cerrado';
  end if;

  update public.solicitud_ninieras
     set estado = p_respuesta, respondido_en = now(), motivo_no = p_motivo, motivo_texto = v_texto
   where id = p_sn_id and estado = 'invitada';
  get diagnostics v_n = row_count;
  if v_n = 0 then return 'ya_respondido'; end if;

  if p_respuesta = 'acepto' then
    perform public.encolar_aviso('admin:pedido:' || p_sn_id || ':acepto', null, 'todas', 'pedidos',
      v_sn.ninera_nombre || ' aceptó el pedido de ' || v_s.familia_nombre,
      public.dia_corto_texto(v_s.fecha) || ' ' || to_char(v_s.hora_inicio, 'HH24:MI'),
      '?ir=agenda&solicitud=' || v_s.id, jsonb_build_object('solicitud_id', v_s.id));
  end if;
  return 'ok';
end
$function$;
revoke execute on function public.responder_pedido(uuid, text, text, text) from public, anon;
grant execute on function public.responder_pedido(uuid, text, text, text) to authenticated;

-- Marca (o con p_quitar, desmarca) días en que no puede, de hoy a 90 días, hasta 62 por vez.
-- Devuelve cuántos cambió.
create or replace function public.ninera_marcar_no_disponible(p_fechas date[], p_quitar boolean default false)
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_n integer;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if p_fechas is null or cardinality(p_fechas) = 0 then return 0; end if;
  if cardinality(p_fechas) > 62 then raise exception 'demasiados_dias'; end if;
  if exists (select 1 from unnest(p_fechas) d where d is null or d < public.hoy_mvd() or d > public.hoy_mvd() + 90) then
    raise exception 'fecha_fuera_de_rango';
  end if;
  if coalesce(p_quitar, false) then
    delete from public.ninera_no_disponible where ninera_id = v_yo and fecha = any (p_fechas);
  else
    insert into public.ninera_no_disponible (ninera_id, fecha)
    select v_yo, d from (select distinct unnest(p_fechas) as d) x
    on conflict do nothing;
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;
revoke execute on function public.ninera_marcar_no_disponible(date[], boolean) from public, anon;
grant execute on function public.ninera_marcar_no_disponible(date[], boolean) to authenticated;

-- Lo que el panel necesita para ordenar las sugeridas
-- Una sola lectura en lugar de bajar toda la historia de sittings (lo que hacía "Asignar niñera").
-- Invoker a propósito: corre con la RLS de quien llama (una admin ve todo; una niñera, nada).
-- 204 de 641 registros no tienen ninera_id y 315 no tienen familia_id (31/10/2026): el historial
-- se agrupa por id y, sin id, por el nombre normalizado (ninera_clave); el panel lo cruza con su
-- lista. La familia del pedido se reconoce por id o, en los registros sin id, por el nombre.
-- Devuelve {"historial": [{ninera_id, ninera_clave, veces_familia, total, veces_familia_traslado,
--                          total_traslado, semana, edades, max_chicos}],
--           "por_ninera": [{ninera_id, no_puedo_seguidos, incidente_familia, no_disponible}]}.
--   veces_familia: sittings con esa familia; total: sittings en general; veces_familia_traslado y
--   total_traslado: lo mismo con los traslados ("Elegir niñeras" también se usa para un traslado, y
--   ahí cuenta quién ya los hace; el panel elige según el tipo del pedido); semana: los sittings que
--   tiene de lunes a domingo de la semana del pedido (previstos incluidos); edades:
--   las edades (al día del sitting) de los chicos que cuidó; max_chicos: la familia con más chicos
--   que cuidó. Sin cancelados; sin previstos salvo en semana.
create or replace function public.sugeridas_datos(p_familia_id uuid, p_familia_nombre text, p_fecha date)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with regs0 as (
    -- Un registro sin familia_id se reconoce por el nombre (así cuentan también sus chicos y edades).
    select s.id, s.ninera_id, s.fecha, s.tipo, s.estado,
           coalesce(s.familia_id,
                    (select f.id from public.familias f
                      where public.normaliza_nombre(btrim(f.nombre)) = public.normaliza_nombre(btrim(s.familia_nombre))
                      order by f.created_at, f.id limit 1)) as familia_id,
           s.familia_nombre,
           case when s.ninera_id is null then public.normaliza_nombre(btrim(s.ninera_nombre)) end as ninera_clave
      from public.sittings_traslados s
     where not s.cancelado
       and (s.ninera_id is not null or nullif(btrim(s.ninera_nombre), '') is not null)
  ), regs as (
    select r.*,
           (r.familia_id = p_familia_id
             or (r.familia_id is null and public.normaliza_nombre(btrim(r.familia_nombre)) = public.normaliza_nombre(btrim(p_familia_nombre)))) as con_familia
      from regs0 r
  ), hijos as (
    select h.familia_id, h.fecha_nacimiento, h.edad_declarada, h.edad_declarada_en
      from public.hijos_familia h
  ), edades as (
    select r.ninera_id, r.ninera_clave,
           case when h.fecha_nacimiento is not null then extract(year from age(r.fecha, h.fecha_nacimiento))::int
                when h.edad_declarada is not null
                  then h.edad_declarada + trunc((r.fecha - coalesce(h.edad_declarada_en, r.fecha)) / 365.25)::int
           end as edad
      from regs r join hijos h on h.familia_id = r.familia_id
     where r.tipo = 'sitting' and r.estado <> 'previsto'
  ), chicos as (
    select familia_id, count(*)::int as n from public.hijos_familia group by familia_id
  ), historial as (
    select r.ninera_id, r.ninera_clave,
           count(*) filter (where r.tipo = 'sitting' and r.estado <> 'previsto' and r.con_familia)::int as veces_familia,
           count(*) filter (where r.tipo = 'sitting' and r.estado <> 'previsto')::int as total,
           count(*) filter (where r.tipo = 'traslado' and r.estado <> 'previsto' and r.con_familia)::int as veces_familia_traslado,
           count(*) filter (where r.tipo = 'traslado' and r.estado <> 'previsto')::int as total_traslado,
           count(*) filter (where r.tipo = 'sitting'
                              and r.fecha between date_trunc('week', p_fecha)::date and date_trunc('week', p_fecha)::date + 6)::int as semana,
           max(c.n) filter (where r.tipo = 'sitting' and r.estado <> 'previsto') as max_chicos
      from regs r left join chicos c on c.familia_id = r.familia_id
     group by r.ninera_id, r.ninera_clave
  ), historial_edades as (
    select e.ninera_id, e.ninera_clave, array_agg(distinct e.edad order by e.edad) filter (where e.edad between 0 and 18) as edades
      from edades e group by e.ninera_id, e.ninera_clave
  ), respuestas as (
    -- "No puedo" seguidos: los que respondió después de su último "Puedo". "Asignar" (y la etapa 6)
    -- pasan el "Puedo" a 'confirmada' y conserva respondido_en: también cuenta. Una asignada sin
    -- responder (confirmada sin respondido_en) no es un "Puedo".
    select sn.ninera_id,
           count(*) filter (where sn.estado = 'no_puedo'
             and sn.respondido_en > coalesce(ua.ultimo, '-infinity'::timestamptz))::int as no_puedo_seguidos
      from public.solicitud_ninieras sn
      left join (select x.ninera_id, max(x.respondido_en) as ultimo
                   from public.solicitud_ninieras x
                  where x.origen = 'app' and x.estado in ('acepto', 'confirmada') and x.respondido_en is not null
                  group by x.ninera_id) ua on ua.ninera_id = sn.ninera_id
     where sn.origen = 'app' and sn.ninera_id is not null
     group by sn.ninera_id
  ), calificaciones as (
    -- La última respuesta a "¿Te gustaría volver a esa casa?" de cada niñera con esta familia (etapa 7).
    select distinct on (c.ninera_id) c.ninera_id, c.volveria
      from public.sitting_cierres c
      join public.sittings_traslados s on s.id = c.sitting_id
     where c.volveria is not null
       and (s.familia_id = p_familia_id
            or (s.familia_id is null and public.normaliza_nombre(btrim(s.familia_nombre)) = public.normaliza_nombre(btrim(p_familia_nombre))))
     order by c.ninera_id, c.creado_en desc
  )
  select jsonb_build_object(
    'historial', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ninera_id', h.ninera_id, 'ninera_clave', h.ninera_clave, 'veces_familia', h.veces_familia,
               'total', h.total, 'veces_familia_traslado', h.veces_familia_traslado, 'total_traslado', h.total_traslado,
               'semana', h.semana, 'edades', coalesce(to_jsonb(he.edades), '[]'::jsonb),
               'max_chicos', h.max_chicos))
        from historial h
        left join historial_edades he
          on he.ninera_id is not distinct from h.ninera_id and he.ninera_clave is not distinct from h.ninera_clave), '[]'::jsonb),
    'por_ninera', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ninera_id', n.id,
               'no_puedo_seguidos', coalesce(rp.no_puedo_seguidos, 0),
               'incidente_familia', exists (select 1 from public.incidentes i
                                             where (i.ninera_id = n.id
                                                    or (i.ninera_id is null and public.normaliza_nombre(btrim(i.ninera_nombre)) = public.normaliza_nombre(btrim(n.nombre))))
                                               and (i.familia_id = p_familia_id
                                                    or (i.familia_id is null and public.normaliza_nombre(btrim(i.familia_nombre)) = public.normaliza_nombre(btrim(p_familia_nombre))))),
               'no_disponible', exists (select 1 from public.ninera_no_disponible d where d.ninera_id = n.id and d.fecha = p_fecha),
               -- La guía (etapa 4): solo de las que tienen app (las demás no reciben por la app).
               'guia_puede', g.puede, 'guia_motivo', g.motivo, 'guia_hasta', g.hasta,
               'prefiere_otros', coalesce(not ca.volveria, false)))
        from public.ninieras n
        left join respuestas rp on rp.ninera_id = n.id
        left join calificaciones ca on ca.ninera_id = n.id
        left join lateral (select * from public.ninera_puede_recibir_pedidos(n.id) where n.user_id is not null) g on true), '[]'::jsonb))
$function$;
revoke execute on function public.sugeridas_datos(uuid, text, date) from public, anon;
grant execute on function public.sugeridas_datos(uuid, text, date) to authenticated;

-- Aviso "Pedido nuevo" a las otras admins
-- Cuando un pedido pegado de WhatsApp pasa a la Agenda (el panel le pone solicitud_id), les llega a
-- las demás admins (no a la que lo pegó: datos.excepto, como el chat). Catálogo de avisos,
-- admin:pedido:<sol>:nuevo.
create or replace function public.pedidos_whatsapp_aviso_nuevo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_s public.solicitudes;
begin
  select * into v_s from public.solicitudes where id = new.solicitud_id;
  if found then
    perform public.encolar_aviso('admin:pedido:' || v_s.id || ':nuevo', null, 'todas', 'pedidos',
      'Pedido nuevo de ' || v_s.familia_nombre,
      public.dia_corto_texto(v_s.fecha) || ', ' || to_char(v_s.hora_inicio, 'HH24:MI')
        || coalesce(' a ' || to_char(v_s.hora_fin, 'HH24:MI'), '') || '. Revisalo.',
      '?ir=agenda&solicitud=' || v_s.id,
      jsonb_build_object('solicitud_id', v_s.id, 'excepto', new.creado_por));
  end if;
  return null;
end
$function$;
revoke execute on function public.pedidos_whatsapp_aviso_nuevo() from public, anon, authenticated;
create trigger pedidos_whatsapp_aviso_nuevo after update of solicitud_id on public.pedidos_whatsapp
  for each row when (old.solicitud_id is null and new.solicitud_id is not null)
  execute function public.pedidos_whatsapp_aviso_nuevo();

-- Llama a enviar-avisos con la URL fija y la clave del cron de enviar-push-urgentes (app_secrets
-- 'cron_push_secret'). Si no está la clave o el post falla, no hace nada: los avisos quedan en la
-- cola y los manda el cron en el próximo minuto. Nunca frena a quien la llama (ni el mensaje del
-- chat que encoló el aviso). La usan el trigger avisos_enviar_ya y correr_cron_avisos.
create or replace function public.llamar_enviar_avisos()
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_secreto text;
begin
  select s.valor into v_secreto from public.app_secrets s where s.clave = 'cron_push_secret';
  if v_secreto is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://wvewzamdohrpfhpccvcz.supabase.co/functions/v1/enviar-avisos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{}'::jsonb,
    -- pg_net corta a los 5 s por defecto; enviar-avisos tarda hasta su plazo total de un minuto
    -- (PLAZO_TOTAL_MS en envio.ts, 30/10/2026). Si no espera, la respuesta queda como timeout.
    timeout_milliseconds := 60000
  );
exception when others then
  raise warning 'llamar_enviar_avisos: no se pudo llamar a enviar-avisos (%); lo manda el cron', sqlerrm;
end
$function$;
revoke execute on function public.llamar_enviar_avisos() from public, anon, authenticated;

-- Un aviso para ya (chat, y en las etapas siguientes pedido nuevo, aceptó...) llama enseguida a
-- enviar-avisos, sin esperar al cron. Una vez por sentencia, no por fila (29/10/2026, revisión):
-- un pedido a varias niñeras o programar_avisos encolan muchos de una vez y una sola llamada los
-- reclama todos. Si la sentencia no insertó ninguno para ya (solo para más tarde, o "on conflict do
-- nothing" que no insertó nada), no llama.
create or replace function public.avisos_disparar_envio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if exists (select 1 from nuevos where nuevos.enviar_desde <= now()) then
    perform public.llamar_enviar_avisos();
  end if;
  return null;
end
$function$;
revoke execute on function public.avisos_disparar_envio() from public, anon, authenticated;
create trigger avisos_enviar_ya after insert on public.avisos
  referencing new table as nuevos
  for each statement execute function public.avisos_disparar_envio();

-- Lo que corre el cron cada minuto: programa los avisos que tocan y, si hay alguno pendiente, llama
-- a enviar-avisos. Sin pendientes no la llama: así no son 1.440 llamadas por día que no hacen nada.
-- En una función (y no en el texto del cron) para poder probarla.
create or replace function public.correr_cron_avisos()
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
begin
  perform public.programar_avisos();
  if exists (select 1 from public.avisos a where a.enviado_en is null and a.enviar_desde <= now()) then
    perform public.llamar_enviar_avisos();
  end if;
end
$function$;
revoke execute on function public.correr_cron_avisos() from public, anon, authenticated;
grant execute on function public.correr_cron_avisos() to service_role;

-- Cada minuto (enviar-push-urgentes corre cada 10; este va cada minuto para que los avisos programados
-- salgan a tiempo). Deja 1.440 filas por día en cron.job_run_details: ver Pendientes en CLAUDE.md.
-- En otro proyecto, cambiar la URL en llamar_enviar_avisos.
select cron.schedule('enviar-avisos', '* * * * *', $$select public.correr_cron_avisos();$$);


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
  -- Solo una admin o la tarea programada (26/10/2026). Desde las cuentas de niñeras, un JWT
  -- "authenticated" ya no es siempre de una admin, y esta función es security definer: sin esto,
  -- una niñera podría llamarla y escribir previstos en sittings_traslados. pg_cron (la corrida de
  -- las 03:00) y la clave de servicio no traen 'sub' (auth.uid() es null) y pasan; la sesión de
  -- una niñera sí lo trae y no está en usuarias_autorizadas.
  if (select auth.uid()) is not null and not coalesce((select public.es_usuaria_autorizada()), false) then
    raise exception 'no_autorizada';
  end if;
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
              -- Pago por hora (01/11/2026, precio por niñera con cada familia): el precio del fijo si
              -- está cargado (más que 0: un 0 o un negativo es no cargado, como en la app), si no el de
              -- esa niñera con esa familia, si no la tarifa. Igual que precioHoraNinera() en
              -- js/core.js. c.pago_hora es asignaciones.pago_hora.
              else public.redondear_pago(coalesce(c.horas, 0) * coalesce(case when c.pago_hora > 0 then c.pago_hora end,
                     (select p.pago_hora from public.precios_ninera_familia p
                       where p.familia_id = c.familia_id and p.ninera_id = c.ninera_id),
                     c.fam_pago_hora, 0)) end as pago_base
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

  -- Etapa 8 (02/11/2026): de acá hasta el final, lo que cambie en los previstos no avisa fila por fila
  -- (sittings_avisos_cambios lo anota): al terminar, avisar_cambios_previstos manda un aviso resumido por fijo.
  perform set_config('pb.previstos', '1', true);

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

  perform set_config('pb.previstos', '', true);
  perform public.avisar_cambios_previstos(hoy);

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
alter publication supabase_realtime add table public.avisos;
alter publication supabase_realtime add table public.ajustes_saldo;
alter publication supabase_realtime add table public.variantes_precio;
alter publication supabase_realtime add table public.precios_ninera_familia;
alter publication supabase_realtime add table public.gastos_extra;
alter publication supabase_realtime add table public.candidatas;
alter publication supabase_realtime add table public.carsitting_datos;
alter publication supabase_realtime add table public.chat_mensajes;
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
