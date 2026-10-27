/* ============================================================
   Helpers compartidos por las dos puertas (fase 1, 26/10/2026): el panel de admins
   (index.html) y la app de niñeras (ninera/index.html). Se sacaron de core.js sin cambiarlos.
   Lo cargan las dos primero, antes que cualquier otro archivo de la app.
   - Una función de acá no se redefine en ningún otro archivo (tests/estatico.spec.js).
   - Nada de plata: la app de niñeras no calcula montos. Los redondeos, precios y variantes
     siguen en core.js.
   - Lo que llaman en tiempo de ejecución y no está acá (abrirModal en copiarAlPortapapeles)
     lo pone cada puerta.
   - ZONA_NEGOCIO y guardandoActivo vinieron con fechaNegocioISO y conGuardado; el panel también
     los lee (app-shell.js, postulantes.js, protegerModal en core.js).
   ============================================================ */

// Proyecto de Supabase. La clave publicable puede estar en el código: lo que se ve lo decide
// RLS. El cliente (sb) lo crea cada puerta con su propia sesión.
const SUPABASE_URL = 'https://wvewzamdohrpfhpccvcz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NX4E4FfAkwFQSFo4Rgl0Jg_IcebuaaI';

/* ============================================================
   Escape de datos (05/10/2026, paso 4). Nombres, notas y URLs llegan de la base, y las
   candidatas, desde un formulario público: un apóstrofo (D'Alessandro) rompía los
   onclick y un "<img onerror=...>" se ejecutaba. Todo dato que va a innerHTML o a un
   handler inline pasa por UNO de estos tres:
   - escaparHtml(t): texto o valor de atributo.
   - argJs(v): un dato como argumento de un handler inline -> el handler queda como  f(${argJs(x)})  dentro del atributo.
     Genera un literal JSON escapado para el atributo; el navegador lo desescapa antes
     de correr el JS, así que llega exactamente el mismo valor (string, número o null).
   - urlSegura(u): para href y src. Solo http(s), blob:, data:image, mailto:, tel: o
     rutas relativas; cualquier otra cosa (javascript:...) queda vacía.
   ============================================================ */
function escaparHtml(t){ return String(t ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function argJs(v){ return escaparHtml(JSON.stringify(v === undefined ? null : v)); }
function urlSegura(u){
  const t = String(u ?? '').trim();
  // El navegador ignora tabs y saltos dentro del esquema ("java\nscript:"): se miran sin ellos.
  const limpio = t.replace(/[\u0000-\u0020\u007f]/g, '');
  if(!limpio) return '';
  if(/^(https?:|blob:|mailto:|tel:|data:image\/)/i.test(limpio) || !/^[a-z][a-z0-9+.-]*:/i.test(limpio)) return escaparHtml(t);
  return '';
}

// Para buscar sin tildes ni mayúsculas (buscadores, nombres parecidos, zonas).
function normaliza(s){ return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }

/* ============================================================
   Cuentas de las niñeras (fase 1, 26/10/2026): entran con el celular y una contraseña. Por
   dentro la cuenta es un mail sintético armado con el celular normalizado, que nadie recibe
   (.invalid es un dominio reservado).
   Una sola regla en tres lugares: normalizar_celular() / mail_sintetico_ninera() en la base
   (migración 20261026_cuentas_ninieras), normalizarCelular() / MAIL_DOMINIO_NINERA en la Edge
   Function ninera-cuenta (cuenta.ts) y estas dos. Si cambia una, cambian las tres: si no, la
   app arma un mail y la cuenta tiene otro, y la niñera no puede entrar. Los mismos 11 casos se
   prueban en las tres (tests/ninera-cuenta.spec.js).
   ============================================================ */
const MAIL_DOMINIO_NINERA = 'ninieras.parentsbreak.invalid';
// Celular uruguayo como '598' + 8 dígitos que empiezan en 9, o null. Solo dígitos; se quita un
// 00 inicial; si empieza en 598, la parte local es el resto; de la parte local se quita un 0
// inicial. Así '+598 99 123 456', '099123456', '99 123 456' y '+598 099 123 456' dan lo mismo.
function normalizarCelular(s){
  const digitos = (typeof s === 'string' ? s : '').replace(/[^0-9]/g, '').replace(/^00/, '');
  const local = (digitos.startsWith('598') ? digitos.slice(3) : digitos).replace(/^0/, '');
  return /^9[0-9]{7}$/.test(local) ? '598' + local : null;
}
// Recibe el celular YA normalizado (el de normalizarCelular o el que devuelve ninera-cuenta) y no
// lo vuelve a normalizar: la cuenta se creó con ese texto tal cual.
function mailSinteticoNinera(celular){ return celular ? `${celular}@${MAIL_DOMINIO_NINERA}` : null; }

/* ---- Push (Web Push + VAPID), las dos puertas ----
   La clave pública con la que se suscribe cada dispositivo. El panel y la app de niñeras usan
   el mismo par de claves (la privada vive en app_secrets, solo la leen las Edge Functions).
   Vino de app-shell.js el 26/10/2026. */
const VAPID_PUBLIC_KEY = 'BPfb5Yy4XNWZVci1Cq7fnwxS-pVApiKii_QOTeRwUEzJMy1D9K1e8RMef4Lp8TBmXX1jhYTRHL9A5318e0ikHkc';
function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for(let i=0;i<rawData.length;++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/* ============================================================
   Fechas en hora de Montevideo (05/10/2026). todayISO() usaba
   new Date().toISOString(), que es UTC: de 21:00 a 24:00 en Uruguay ya devolvía
   el día de mañana (un sitting cargado de noche quedaba con la fecha siguiente).
   Todo "hoy" sale de acá, fijado a America/Montevideo aunque el celular esté en
   otra zona; para sumar días a una fecha "AAAA-MM-DD" usar sumarDiasISO().
   ============================================================ */
const ZONA_NEGOCIO = 'America/Montevideo';
let _fmtFechaNegocio = null;
function fechaNegocioISO(d){
  d = d || new Date();
  try{
    if(!_fmtFechaNegocio) _fmtFechaNegocio = new Intl.DateTimeFormat('en-CA', {timeZone:ZONA_NEGOCIO, year:'numeric', month:'2-digit', day:'2-digit'});
    const p = {};
    _fmtFechaNegocio.formatToParts(d).forEach(x=>{ p[x.type] = x.value; });
    if(p.year && p.month && p.day) return `${p.year}-${p.month}-${p.day}`;
  }catch(e){}
  // Navegador sin soporte de zonas horarias: la fecha local del aparato.
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayISO(){ return fechaNegocioISO(new Date()); }
function currentMonthStr(){ return todayISO().slice(0,7); }
function diaSemanaDeISO(fechaISO){ return ['D','L','M','X','J','V','S'][new Date(fechaISO+'T12:00:00').getDay()]; }
function sumarDiasISO(fechaISO, n){
  const d = new Date(fechaISO+'T12:00:00'); // mediodía: sumar días nunca cruza de fecha por la zona horaria
  d.setDate(d.getDate()+n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Calcula la edad a partir de una fecha de nacimiento (YYYY-MM-DD), a una fecha de
// referencia dada (por default hoy). Reemplaza el viejo criterio de guardar "19 años" como
// texto fijo, que quedaba vieja apenas la persona cumplía años.
function calcularEdad(fechaNacISO, fechaRefISO){
  if(!fechaNacISO) return null;
  const nac = new Date(fechaNacISO+'T00:00:00');
  const ref = new Date((fechaRefISO || todayISO())+'T00:00:00');
  if(isNaN(nac)) return null;
  let edad = ref.getFullYear() - nac.getFullYear();
  const noLlegoAlCumple = (ref.getMonth() < nac.getMonth()) || (ref.getMonth()===nac.getMonth() && ref.getDate() < nac.getDate());
  if(noLlegoAlCumple) edad--;
  return edad;
}

// opciones.deshacer (23/10/2026): suma un botón "Deshacer" y el aviso queda 8 segundos, para
// volver atrás algo reversible (marcar cobrado / pagado) sin un diálogo previo.
function toast(msg, type='good', opciones={}){
  let stack = document.querySelector('.toaststack');
  if(!stack){ stack = document.createElement('div'); stack.className='toaststack'; document.body.appendChild(stack); }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  const irse = () => { if(!el.isConnected || el.classList.contains('leaving')) return; el.classList.add('leaving'); setTimeout(()=>el.remove(), 220); };
  if(opciones.deshacer){
    el.classList.add('con-accion');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-accion';
    btn.textContent = 'Deshacer';
    btn.addEventListener('click', async ()=>{
      if(btn.disabled) return;
      btn.disabled = true;
      irse();
      await opciones.deshacer();
    });
    el.appendChild(btn);
  }
  stack.appendChild(el);
  setTimeout(irse, opciones.deshacer ? 8000 : 3200);
}

/* Envoltorio para escrituras de Supabase (insert/update/delete/upsert): si falla, avisa con
   un mensaje consistente y devuelve false para poder cortar el flujo. Antes algunas escrituras
   sueltas no chequeaban error en absoluto (fallaban en silencio, la pantalla seguía como si
   hubiera funcionado) o usaban un alert() feo del navegador en vez del aviso normal de la app.
   Uso: if(!(await sbGuardar(sb.from('solicitudes').update({...}).eq('id', id), 'la solicitud'))) return; */
/* Doble toque en "Guardar" (05/10/2026, paso 5). El 19/09 quedaron cuatro sittings iguales
   guardados en medio segundo: cada toque disparaba otro insert. Todo botón que escribe en la
   base llama a su función a través de conGuardado(this, ()=>guardarX(...)): el botón queda
   deshabilitado y con la ruedita hasta que el guardado termina (bien o mal), y un segundo
   toque mientras tanto no hace nada. La función de adentro tiene que devolver la promesa
   (async/await) para que el botón se libere recién al final. */
// Cuántos guardados hay en curso: un modal que se cierra o se reemplaza mientras tanto es porque
// se guardó, y su borrador ya no hace falta (protegerModal).
let guardandoActivo = 0;
async function conGuardado(btn, accion){
  if(btn && btn.dataset.guardando) return;
  let htmlAntes = null;
  if(btn){
    btn.dataset.guardando = '1';
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    htmlAntes = btn.innerHTML;
    const fondoOscuro = btn.classList.contains('primary') || (btn.classList.contains('btn') && btn.classList.contains('danger'));
    // El ícono de algunos botones (tacho) se reemplaza; el texto queda, con la ruedita adelante.
    const texto = btn.textContent.trim();
    btn.innerHTML = `<span class="spinner${fondoOscuro?'':' dark'}"></span>${texto ? ' '+escaparHtml(texto) : ''}`;
  }
  guardandoActivo++;
  try {
    return await accion();
  } finally {
    guardandoActivo--;
    // Si el modal se cerró, el botón ya no está en pantalla y no hay nada que restaurar.
    if(btn && btn.isConnected){
      btn.innerHTML = htmlAntes;
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      delete btn.dataset.guardando;
    }
  }
}
async function sbGuardar(consulta, queCosa='los cambios'){
  try {
    const { error } = await consulta;
    if(error){
      console.error('[Supabase] al guardar', queCosa, error);
      toast(`No se pudo guardar ${queCosa}: ${error.message}`, 'bad');
      return false;
    }
    return true;
  } catch(e){
    console.error('[Supabase] al guardar', queCosa, e);
    toast(`No se pudo guardar ${queCosa}. Revisá tu conexión.`, 'bad');
    return false;
  }
}

// Copia un dato con un toque (cuentas y montos para pagar desde el celular, 21/10/2026). Si el
// navegador no deja usar el portapapeles, lo muestra seleccionado para copiarlo a mano.
// Cada puerta pone su modal: abrirModal en el panel (core.js), abrirModalNinera en la app de
// niñeras (ninera/js/base.js), que además le habla de "tú".
async function copiarAlPortapapeles(texto, aviso='Copiado.'){
  try{ await navigator.clipboard.writeText(texto); toast(aviso); }
  catch(e){
    const enPanel = typeof abrirModal === 'function';
    (enPanel ? abrirModal : abrirModalNinera)(`<h2 style="margin:0 0 8px;">${enPanel ? 'Copialo de acá' : 'Cópialo de aquí'}</h2><input type="text" id="copiar-a-mano" readonly value="${escaparHtml(texto)}" style="font-family:'IBM Plex Mono',monospace;">`);
    document.getElementById('copiar-a-mano')?.select();
  }
}

/* Fotos livianas (mejora 9, 06/10/2026): una foto de celular pesa 1-4 MB y la lista de niñeras
   con datos móviles bajaba 10-15 MB. Antes de subirla se achica a 800 px de lado como mucho, en
   JPEG. Si el navegador no la puede leer (por ejemplo HEIC en algunos) o ya es chica, se sube
   tal cual: nunca se pierde la foto por esto.
   Vive en comun.js desde el 27/10/2026 (fase 1, etapa 2): la app de niñeras la usa para la foto
   del perfil, con achicarFoto(file, 1600, 0.8). */
async function achicarFoto(file, ladoMax=800, calidad=0.82){
  try{
    if(!file || !/^image\/(jpeg|png|webp)$/i.test(file.type||'')) return file;
    const url = URL.createObjectURL(file);
    try{
      const img = await new Promise((ok, mal)=>{ const i = new Image(); i.onload = ()=>ok(i); i.onerror = mal; i.src = url; });
      const escala = Math.min(1, ladoMax / Math.max(img.naturalWidth||0, img.naturalHeight||0));
      if(escala >= 1 && file.size <= 300*1024) return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth*escala));
      canvas.height = Math.max(1, Math.round(img.naturalHeight*escala));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); // PNG con transparencia: fondo blanco
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(ok=>canvas.toBlob(ok, 'image/jpeg', calidad));
      if(!blob || blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.[^.]*$/, '')+'.jpg', { type:'image/jpeg' });
    } finally { URL.revokeObjectURL(url); }
  }catch(e){ return file; }
}
