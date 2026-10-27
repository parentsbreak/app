// App de niñeras (fase 1, 26/10/2026): el inicio. En la etapa 1 no hay pedidos todavía: el saludo,
// el aviso si los avisos están apagados, "No tienes pedidos por ahora." y Mi cuenta. Sin montos ni
// fechas de pago, nunca (textos.md, sección 3). Los pedidos y los próximos sittings llegan en las
// etapas 5 y 6.

// El nombre viene en la cuenta (user_metadata, lo pone ninera-cuenta al crearla o al cambiar la
// contraseña): sirve en cualquier celular y en la app instalada. Se saluda con el primero.
function primerNombreNinera(){
  const nombre = sesionNinera && sesionNinera.user && sesionNinera.user.user_metadata && sesionNinera.user.user_metadata.nombre;
  return typeof nombre === 'string' ? (nombre.trim().split(/\s+/)[0] || '') : '';
}

async function renderInicio(){
  marcarRuta('#inicio');
  const nombre = primerNombreNinera();
  pintar(`<main class="pantalla">
    <header class="cabecera">
      <img src="../logo-simbolo.png" alt="" class="cabecera-simbolo">
      <h1>${nombre ? `Hola, ${escaparHtml(nombre)}` : 'Hola'}</h1>
    </header>
    <div id="inicio-avisos"></div>
    <p class="vacio">No tienes pedidos por ahora.</p>
    <footer class="pie">
      <button type="button" class="link-boton" onclick="abrirMiCuentaNinera()">Mi cuenta</button>
    </footer>
  </main>`);
  const cont = document.getElementById('inicio-avisos');
  // Abierta en el navegador del iPhone (sin avisos ahí): lo que falta es instalarla.
  if(!esAppInstalada() && !avisosSoportados()){
    cont.innerHTML = `<div class="aviso-apagado" role="alert">
      <p>Instala la app para recibir los pedidos.</p>
      <button class="btn primary ancho" onclick="irA('#instalar')">Ver cómo</button>
    </div>`;
    return;
  }
  // Se pinta primero y el aviso se suma después: mirar la suscripción puede tardar un momento.
  if(avisosSoportados() && !(await avisosActivados())){
    if(cont.isConnected) cont.innerHTML = `<div class="aviso-apagado" role="alert">
      <p>Avisos apagados. No te van a llegar los pedidos. Actívalos en Ajustes.</p>
      <button class="btn primary ancho" onclick="conGuardado(this, ()=>activarAvisosNinera('#inicio'))">Activar avisos</button>
    </div>`;
  }
}

// Sin conexión o la base no responde al arrancar: "Reintentar" vuelve a cargar.
function mostrarErrorCargaInicio(){
  mostrarErrorNinera('No pudimos cargar tus pedidos.', 'Revisa tu conexión a internet y vuelve a intentar.');
}

function abrirMiCuentaNinera(){
  abrirModalNinera(`<h2 class="modal-titulo">Mi cuenta</h2>
    <button class="btn ghost ancho" onclick="conGuardado(this, ()=>cerrarSesionNinera())">Cerrar sesión</button>`);
}
