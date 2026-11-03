// App de niñeras (fase 1, etapa 10, 02/11/2026): el carsitting (decisiones.md 6.7, textos.md 6). Textos en "tú".
// La que hace traslados (Carsittings o Ambos en su perfil) carga una sola vez los datos del auto y de su licencia, con
// 7 fotos, y el equipo lo revisa. En el inicio, una tarjeta mientras falta (o si le pidieron corregir algo, con el
// comentario); #carsitting es la pantalla (el link de los avisos) y "Actualizar los datos del auto" en "Mi perfil"
// vuelve a abrirla. Si ya estaba aprobada y lo actualiza, sigue aprobada mientras el equipo revisa lo nuevo.
// La base guarda (ninera_mi_carsitting, ninera_guardar_carsitting) y avisa al equipo; las fotos van al bucket privado
// ninieras-privado/carsitting/<su id>/<foto>_<8 hex>.jpg (un nombre nuevo cada vez: lo aprobado no se pisa). Con la
// base sin la migración de la etapa 10 (la RPC da 404 PGRST202): ni tarjeta ni pantalla.

let carsittingNinera = null;
let carsittingNineraSinMigrar = false;
// Las fotos elegidas en la pantalla (se achican y suben al enviar) y las ya subidas en un intento que falló después
// (así un reintento no las vuelve a subir).
let fotosCarsittingElegidas = {};
let fotosCarsittingSubidas = {};

const FALLA_CARGAR_CARSITTING = 'No pudimos cargar tus datos de carsitting. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_GUARDAR_CARSITTING = 'No pudimos enviar tus datos. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_SUBIR_FOTO_CARSITTING = 'No pudimos subir las fotos. Revisa tu conexión a internet y vuelve a intentar.';
const INTRO_CARSITTING = 'Marcaste que realizas traslados. Necesitamos estos datos una sola vez.';

// La lectura de la base. null con la base sin migrar; un error de red tira.
async function leerCarsittingNinera(){
  const { data, error } = await sbn.rpc('ninera_mi_carsitting');
  if(error){
    if(error.code === 'PGRST202'){ carsittingNineraSinMigrar = true; carsittingNinera = null; return null; }
    throw error;
  }
  carsittingNineraSinMigrar = false;
  carsittingNinera = data && typeof data === 'object' ? data : null;
  return carsittingNinera;
}

/* ---- La tarjeta del inicio ---- */
function htmlTarjetaCarsitting(c){
  if(!c || !c.hace_traslados) return '';
  if(!c.enviado_en) return `<section class="tarjeta-dia tarjeta-carsitting">
    <h2>Completa tus datos de carsitting</h2>
    <p class="helper">${escaparHtml(INTRO_CARSITTING)}</p>
    <button type="button" class="btn primary ancho" onclick="irA('#carsitting')">Completar</button>
  </section>`;
  if(c.revision === 'rehacer') return `<section class="tarjeta-dia tarjeta-carsitting">
    <h2>Hay que corregir tus datos de carsitting</h2>
    ${c.comentario ? `<p class="dia-estado">${escaparHtml(c.comentario)}</p>` : ''}
    <button type="button" class="btn primary ancho" onclick="irA('#carsitting')">Corregir</button>
  </section>`;
  if(c.revision === 'pendiente' && !c.aprobado_en) return '<p class="aviso-info aviso-carsitting" role="status">Tus datos de carsitting los está revisando el equipo.</p>';
  return '';
}
// Se pide sin esperar al resto del inicio. Si la lectura falla, no se muestra nada (no frena nada: lo vuelve a pedir
// la próxima vez que entra al inicio).
async function cargarTarjetaCarsitting(){
  if(!document.getElementById('inicio-carsitting') || carsittingNineraSinMigrar) return;
  try{
    await leerCarsittingNinera();
  }catch(err){
    console.error('[carsitting] al leer', err);
    return;
  }finally{
    document.getElementById('inicio-carsitting')?.setAttribute('data-cargada', '1');
  }
  const cont = document.getElementById('inicio-carsitting');
  if(cont) cont.innerHTML = htmlTarjetaCarsitting(carsittingNinera);
}

/* ---- La pantalla (#carsitting) ---- */
async function pantallaCarsitting(){
  marcarRuta('#carsitting');
  mostrarCargaNinera();
  let c;
  try{
    c = await leerCarsittingNinera();
  }catch(err){
    console.error('[carsitting] al abrir', err);
    pintarMensajeNinera(FALLA_CARGAR_CARSITTING, `<button type="button" class="btn primary ancho" onclick="pantallaCarsitting()">Reintentar</button>
      <button type="button" class="link-boton" onclick="renderInicio()">Volver</button>`);
    return;
  }
  if(carsittingNineraSinMigrar || !c) return renderInicio();
  if(!c.hace_traslados){
    pintarMensajeNinera('Esto es para las que realizan traslados. Si los haces, márcalo en Mi perfil.', '<button type="button" class="btn primary ancho" onclick="renderInicio()">Volver al inicio</button>');
    return;
  }
  fotosCarsittingElegidas = {};
  fotosCarsittingSubidas = {};
  const datos = c.datos || {};
  const fotos = c.fotos || {};
  let intro;
  if(!c.enviado_en) intro = `<p class="helper">${escaparHtml(INTRO_CARSITTING)}</p>`;
  else if(c.revision === 'rehacer') intro = `<p class="aviso-info">${escaparHtml(c.comentario ? `Hay que corregir algo: ${c.comentario}` : 'Hay que corregir algo.')}</p>`;
  else if(c.revision === 'pendiente') intro = '<p class="aviso-info">El equipo está revisando tus datos. Si algo cambió, puedes corregirlo.</p>';
  else intro = '<p class="helper">Si cambiaste de auto o se te venció la licencia, actualízalos: el equipo los vuelve a revisar.</p>';
  const campo = k => {
    const valor = typeof datos[k.clave] === 'string' ? datos[k.clave] : '';
    return `<div class="field"><label for="cs-${k.clave}">${escaparHtml(k.etiqueta)}</label>
      <input type="text" id="cs-${k.clave}" maxlength="${LARGO_MAXIMO_CARSITTING}" autocomplete="off"${k.numero ? ' inputmode="numeric"' : ''} value="${escaparHtml(valor)}"></div>`;
  };
  pintar(`<main class="pantalla pantalla-carsitting">
    <header class="cabecera">
      <img src="../logo-simbolo.png" alt="" class="cabecera-simbolo">
      <h1>${c.enviado_en ? 'Datos del auto' : 'Datos de carsitting'}</h1>
    </header>
    ${intro}
    ${GRUPOS_CARSITTING.map(([titulo, campos]) => `<fieldset class="grupo">
      <legend>${escaparHtml(titulo)}</legend>
      ${campos.map(campo).join('')}
    </fieldset>`).join('')}
    <fieldset class="grupo">
      <legend>Fotos</legend>
      ${FOTOS_CARSITTING.map(([clave, etiqueta]) => `<div class="field">
        <label for="cs-foto-${clave}">${escaparHtml(etiqueta)}</label>
        ${fotos[clave] ? '<p class="helper cs-foto-ya">Ya la cargaste. Elige otra solo si quieres cambiarla.</p>' : ''}
        <input type="file" id="cs-foto-${clave}" accept="image/*" onchange="elegirFotoCarsitting(${argJs(clave)}, this)">
      </div>`).join('')}
    </fieldset>
    <p class="error-form" id="cs-error" role="alert"></p>
    <button type="button" class="btn primary ancho" onclick="conGuardado(this, ()=>enviarCarsitting())">Enviar</button>
    <button type="button" class="link-boton" onclick="renderInicio()">Volver</button>
  </main>`);
}

function elegirFotoCarsitting(clave, input){
  const archivo = input.files && input.files[0];
  if(archivo) fotosCarsittingElegidas[clave] = archivo;
  else delete fotosCarsittingElegidas[clave];
  delete fotosCarsittingSubidas[clave];
}

function etiquetaCarsitting(clave){
  return CAMPOS_CARSITTING.find(c => c.clave === clave)?.etiqueta || FOTOS_CARSITTING.find(([k]) => k === clave)?.[1] || '';
}
function mensajeErrorCarsitting(err){
  const motivo = err?.message || '';
  const que = etiquetaCarsitting(err?.hint || '');
  if(/no_autorizada/.test(motivo)) return CUENTA_NO_ACTIVA;
  if(/no_hace_traslados/.test(motivo)) return 'Esto es para las que realizan traslados. Si los haces, márcalo en Mi perfil.';
  if(/faltan_datos/.test(motivo)) return que ? `Completa: ${que}.` : 'Completa todos los datos.';
  if(/dato_largo/.test(motivo)) return `${que || 'Un dato'} es demasiado largo: hasta ${LARGO_MAXIMO_CARSITTING} caracteres.`;
  if(/faltan_fotos/.test(motivo)) return que ? `Falta la foto: ${que}.` : 'Faltan fotos.';
  if(/foto_invalida/.test(motivo)) return que ? `Vuelve a elegir la foto: ${que}.` : 'Vuelve a elegir las fotos.';
  return FALLA_GUARDAR_CARSITTING;
}
function sufijoFotoCarsitting(){
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Primero lo que falta (sin subir nada), después las fotos nuevas y al final la base. El aviso de error no se borra al
// empezar (como en el cierre: si la pantalla se mueve, un segundo toque cae en otro botón).
async function enviarCarsitting(){
  const aviso = document.getElementById('cs-error');
  if(!aviso) return;
  const datos = {};
  for(const c of CAMPOS_CARSITTING){
    datos[c.clave] = (document.getElementById(`cs-${c.clave}`)?.value || '').trim();
    if(!c.opcional && !datos[c.clave]){ aviso.textContent = `Completa: ${c.etiqueta}.`; return; }
  }
  const yaCargadas = (carsittingNinera && carsittingNinera.fotos) || {};
  const falta = FOTOS_CARSITTING.find(([clave]) => !yaCargadas[clave] && !fotosCarsittingElegidas[clave]);
  if(falta){ aviso.textContent = `Falta la foto: ${falta[1]}.`; return; }
  const fotos = { ...fotosCarsittingSubidas };
  for(const [clave, archivoOriginal] of Object.entries(fotosCarsittingElegidas)){
    if(fotos[clave]) continue;
    const archivo = await achicarFoto(archivoOriginal, 1600, 0.8);
    if(!/^image\/(jpeg|png|webp)$/.test(archivo.type || '')){ aviso.textContent = `${FOTO_TIPO_INVALIDO} (${etiquetaCarsitting(clave)})`; return; }
    const ruta = `carsitting/${nineraIdSesion}/${clave}_${sufijoFotoCarsitting()}.jpg`;
    try{
      const { error } = await sbn.storage.from('ninieras-privado').upload(ruta, archivo, { upsert: false, contentType: archivo.type });
      if(error) throw error;
    }catch(err){
      console.error('[carsitting] al subir una foto', err);
      aviso.textContent = FALLA_SUBIR_FOTO_CARSITTING;
      return;
    }
    fotos[clave] = ruta;
    fotosCarsittingSubidas[clave] = ruta;
  }
  try{
    const { error } = await sbn.rpc('ninera_guardar_carsitting', { p_datos: datos, p_fotos: fotos });
    if(error) throw error;
  }catch(err){
    console.error('[carsitting] al enviar', err);
    aviso.textContent = mensajeErrorCarsitting(err);
    return;
  }
  fotosCarsittingElegidas = {};
  fotosCarsittingSubidas = {};
  pintarMensajeNinera('¡Listo! Gracias.', `<p class="helper">El equipo lo va a revisar.</p>
    <button type="button" class="btn primary ancho" onclick="renderInicio()">Volver al inicio</button>`);
}
