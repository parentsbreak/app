// App de niñeras (fase 1, etapa 2, 27/10/2026): el perfil. La niñera lo completa una sola vez
// (servicios, zonas, datos bancarios y una foto opcional) con ninera_mi_perfil,
// ninera_zonas_disponibles y ninera_guardar_perfil. La foto no reemplaza la del CV: queda como
// "foto propuesta" en el bucket privado y la aprueba una admin desde la ficha. Textos en "tú".

// Lo cargado para la pantalla de perfil: su id arma la ruta de la foto (fotos/<id>/propuesta.jpg).
// La foto elegida se guarda acá hasta "Guardar" (se sube recién ahí), con la URL de su vista previa
// para liberarla después.
let perfilNineraActual = null;
let fotoPerfilElegida = null;
let fotoPerfilPrevia = null;
// Base sin la migración de la etapa 2 (las RPC dan 404 PGRST202): el inicio no muestra "Mi perfil".
let perfilNineraSinMigrar = false;

// Los valores de ninieras.tipo, con el nombre que les dan las dueñas (textos.md, sección 3).
const SERVICIOS_NINERA = [['Niñera', 'Sittings'], ['Traslados', 'Carsittings'], ['Ambas', 'Ambos']];
const FALLA_SUBIR_FOTO = 'No pudimos subir tu foto. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_GUARDAR_PERFIL = 'No pudimos guardar tu perfil. Revisa tu conexión a internet y vuelve a intentar.';
const FOTO_TIPO_INVALIDO = 'La foto tiene que ser JPG o PNG.';
// La base rechaza más de 10 cuentas (demasiadas_cuentas, 27/10/2026): no es un problema de conexión.
const DEMASIADAS_CUENTAS = 'Puedes cargar hasta 10 cuentas.';
const FALLA_ABRIR_PERFIL = 'No pudimos abrir tu perfil. Revisa tu conexión a internet y vuelve a intentar.';

// { perfil, sinMigrar }. Sin la migración, la app sigue como en la etapa 1; cualquier otro error
// (sin conexión) lo decide quien llama.
async function cargarPerfilNinera(){
  const { data, error } = await sbn.rpc('ninera_mi_perfil');
  if(error){
    if(error.code === 'PGRST202'){ perfilNineraSinMigrar = true; return { perfil: null, sinMigrar: true }; }
    throw error;
  }
  perfilNineraSinMigrar = false;
  return { perfil: (Array.isArray(data) ? data[0] : data) || null, sinMigrar: false };
}

// Sin zonas es que nunca lo completó: las fichas cargadas desde el panel ya tienen zona.
function perfilIncompleto(perfil){
  return !perfil.zona;
}

async function cargarZonasNinera(){
  const { data, error } = await sbn.rpc('ninera_zonas_disponibles');
  if(error) throw error;
  return data || [];
}

// dd/mm en Montevideo, aunque el celular tenga otra zona horaria. Por partes y con el cero a mano,
// como fechaCortaApp del panel: es-UY con '2-digit' igual da "2/10".
function fechaCortaNinera(ts){
  const d = ts ? new Date(ts) : null;
  if(!d || isNaN(d)) return '';
  const partes = new Intl.DateTimeFormat('es-UY', { day: 'numeric', month: 'numeric', timeZone: 'America/Montevideo' }).formatToParts(d);
  const p = t => (partes.find(x => x.type === t)?.value || '').padStart(2, '0');
  return `${p('day')}/${p('month')}`;
}

// modo 'primera' (al entrar, sin perfil: no hay "Volver") o 'editar' (desde "Mi perfil").
async function pantallaPerfil(modo, perfil){
  let zonas;
  try{
    zonas = await cargarZonasNinera();
  }catch(e){
    console.error('[ninera_zonas_disponibles]', e);
    if(modo === 'primera') mostrarErrorCargaInicio();
    else toast(FALLA_ABRIR_PERFIL, 'bad');
    return;
  }
  perfilNineraActual = perfil;
  limpiarFotoPerfil();
  marcarRuta('#perfil');
  // Sin tildes ni mayúsculas: una zona cargada a mano en el panel ("pocitos") igual sale marcada.
  const marcadas = new Set(String(perfil.zona || '').split('/').map(z => normaliza(z.trim())).filter(Boolean));
  const cuenta = Array.isArray(perfil.cuenta_bancaria) ? perfil.cuenta_bancaria.join('\n') : (perfil.cuenta_bancaria || '');
  const fechaFoto = fechaCortaNinera(perfil.foto_propuesta_en);
  const enviada = perfil.foto_propuesta_ruta
    ? `<p class="helper">${escaparHtml(fechaFoto ? `Foto enviada el ${fechaFoto}, el equipo la va a revisar.` : 'Foto enviada, el equipo la va a revisar.')}</p>`
    : '';
  pintar(`<main class="pantalla">
    <header class="cabecera">
      <img src="../logo-simbolo.png" alt="" class="cabecera-simbolo">
      <h1>${modo === 'editar' ? 'Mi perfil' : 'Completa esto una sola vez'}</h1>
    </header>
    <fieldset class="grupo">
      <legend>¿Qué servicios realizas?</legend>
      ${SERVICIOS_NINERA.map(([valor, texto]) => `<label class="radio"><input type="radio" name="perfil-tipo" value="${escaparHtml(valor)}"${perfil.tipo === valor ? ' checked' : ''} onchange="mostrarAvisoAutoPerfil()"> ${escaparHtml(texto)}</label>`).join('')}
      <p class="aviso-info" id="perfil-aviso-auto" hidden>Pronto vas a poder cargar los datos del auto desde aquí.</p>
    </fieldset>
    <fieldset class="grupo">
      <legend>Zonas donde puedes tomar servicios</legend>
      ${zonas.map(z => `<label class="chk"><input type="checkbox" class="perfil-zona" value="${escaparHtml(z.nombre)}"${marcadas.has(normaliza(z.nombre)) ? ' checked' : ''}> ${escaparHtml(z.nombre)}</label>`).join('')}
    </fieldset>
    <div class="field">
      <label for="perfil-cuenta">Datos bancarios para pagarte</label>
      <textarea id="perfil-cuenta" rows="3" autocomplete="off">${escaparHtml(cuenta)}</textarea>
      <p class="helper">Una cuenta por renglón: banco, tipo y número (por ejemplo: BROU caja de ahorro 001234567).</p>
    </div>
    <div class="field">
      <label for="perfil-foto">Tu foto (opcional)</label>
      <input type="file" id="perfil-foto" accept="image/*" onchange="elegirFotoPerfil(this)">
      <img id="perfil-foto-previa" class="perfil-foto-previa" alt="Vista previa de tu foto" hidden>
      <p class="helper">La ve el equipo y, si la aprueban, pasa a tu perfil.</p>
      ${enviada}
    </div>
    <p class="error-form" id="perfil-error" role="alert"></p>
    <button class="btn primary ancho" id="perfil-guardar" onclick="conGuardado(this, ()=>guardarPerfilNinera(${argJs(modo)}))">Guardar</button>
    ${modo === 'editar' ? '<button type="button" class="link-boton" onclick="renderInicio()">Volver</button>' : ''}
  </main>`);
  mostrarAvisoAutoPerfil();
}

// Carsittings o Ambos: los datos del auto llegan en la etapa 10 (hoy no se cargan acá).
function mostrarAvisoAutoPerfil(){
  const marcado = document.querySelector('input[name="perfil-tipo"]:checked');
  const aviso = document.getElementById('perfil-aviso-auto');
  if(aviso) aviso.hidden = !(marcado && (marcado.value === 'Traslados' || marcado.value === 'Ambas'));
}

function elegirFotoPerfil(input){
  const file = input.files && input.files[0];
  limpiarFotoPerfil();
  const img = document.getElementById('perfil-foto-previa');
  if(!file){ if(img){ img.hidden = true; img.removeAttribute('src'); } return; }
  fotoPerfilElegida = file;
  fotoPerfilPrevia = URL.createObjectURL(file);
  if(img){ img.src = fotoPerfilPrevia; img.hidden = false; }
}

function limpiarFotoPerfil(){
  if(fotoPerfilPrevia) URL.revokeObjectURL(fotoPerfilPrevia);
  fotoPerfilPrevia = null;
  fotoPerfilElegida = null;
}

// Primero la foto (si eligió una) y después el perfil. Si algo falla no se repinta nada: el aviso
// queda arriba del botón y lo escrito sigue ahí para reintentar. La foto va siempre a la misma ruta
// con upsert (decisiones de la etapa 2, 27/10/2026): si subió y después falló el perfil, el
// reintento la pisa, nunca quedan fotos huérfanas. Los dos modos terminan en el inicio; `modo`
// viaja desde el botón por si la primera vez tiene que seguir a otra pantalla en una etapa próxima.
async function guardarPerfilNinera(modo){
  const aviso = document.getElementById('perfil-error');
  const perfil = perfilNineraActual;
  if(!aviso || !perfil) return;
  aviso.textContent = '';
  const servicio = document.querySelector('input[name="perfil-tipo"]:checked');
  const zonas = Array.from(document.querySelectorAll('.perfil-zona:checked'), c => c.value);
  if(!servicio){ aviso.textContent = 'Elige qué servicios realizas.'; return; }
  if(!zonas.length){ aviso.textContent = 'Elige al menos una zona.'; return; }
  const cuenta = document.getElementById('perfil-cuenta').value.split('\n').map(l => l.trim()).filter(Boolean);

  let fotoRuta = null;
  if(fotoPerfilElegida){
    const ruta = `fotos/${perfil.id}/propuesta.jpg`;
    // achicarFoto devuelve el original si ya es chica o si no la puede leer (HEIC que el navegador
    // no convirtió, un PDF renombrado). El bucket acepta solo JPG, PNG y WEBP: sin este control la
    // base la rechazaba y el aviso hablaba de la conexión. Se sube con su tipo real (27/10/2026):
    // supabase-js manda un File en un formulario con el tipo del archivo, no el de contentType.
    const archivo = await achicarFoto(fotoPerfilElegida, 1600, 0.8);
    if(!/^image\/(jpeg|png|webp)$/.test(archivo.type || '')){
      aviso.textContent = FOTO_TIPO_INVALIDO;
      return;
    }
    try{
      const { error } = await sbn.storage.from('ninieras-privado').upload(ruta, archivo, { upsert: true, contentType: archivo.type });
      if(error) throw error;
    }catch(e){
      console.error('[perfil] al subir la foto', e);
      aviso.textContent = FALLA_SUBIR_FOTO;
      return;
    }
    fotoRuta = ruta;
  }

  try{
    const { error } = await sbn.rpc('ninera_guardar_perfil', { p_tipo: servicio.value, p_zonas: zonas, p_cuenta: cuenta, p_foto_ruta: fotoRuta });
    if(error) throw error;
  }catch(e){
    console.error('[perfil] al guardar', e);
    aviso.textContent = /demasiadas_cuentas/.test(e?.message || '') ? DEMASIADAS_CUENTAS : FALLA_GUARDAR_PERFIL;
    return;
  }
  limpiarFotoPerfil();
  toast('¡Listo! Tu perfil quedó guardado.');
  await renderInicio();
}

// "Mi perfil" (pie del inicio): lo lee de nuevo, por si cambió desde otro celular o desde el panel.
async function abrirMiPerfil(){
  let cargado;
  try{
    cargado = await cargarPerfilNinera();
  }catch(e){
    console.error('[ninera_mi_perfil]', e);
    toast(FALLA_ABRIR_PERFIL, 'bad');
    return;
  }
  if(cargado.sinMigrar || !cargado.perfil){ await renderInicio(); return; }
  await pantallaPerfil('editar', cargado.perfil);
}
