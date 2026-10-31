# Repo de redirección: la dirección vieja de la app

Desde el 27/10/2026 la app vive en `https://parentsbreak.github.io/app/` (panel) y
`https://parentsbreak.github.io/app/ninera/` (niñeras). GitHub Pages no redirige la dirección vieja
(`diegomarin28.github.io/sistema-parents-break`): el ícono viejo del celular, los bit.ly y los links
personales a `temporada.html` caerían en un 404. Estas tres páginas, publicadas en un repo nuevo con
el nombre viejo, evitan eso. No tienen scripts externos ni datos.

- `index.html`: "La app se mudó" con el botón a la dirección nueva y los pasos para reinstalar el
  ícono. Abierta en el navegador redirige sola (conserva `?` y `#`); abierta desde el ícono viejo
  (app instalada) se queda en la página.
- `ninera/index.html`: lo mismo para la app de niñeras, en tuteo. Los links de invitación
  (`?i=<token>`) llegan enteros a `/app/ninera/`.
- `temporada.html`: la misma redirección al formulario de temporada que tiene la raíz del repo.

## Cómo publicarlo (Diego, después de transferir el repo)

1. En GitHub, con tu cuenta personal: New repository, nombre `sistema-parents-break`, público, sin
   README (el nombre tiene que ser exactamente el viejo).
2. Subí estos archivos tal cual, respetando las carpetas (`index.html`, `ninera/index.html`,
   `temporada.html`; este README puede ir también). Se puede hacer desde la web con "Add file >
   Upload files".
3. Settings > Pages > Build and deployment: Source "Deploy from a branch", rama `main`, carpeta
   `/ (root)`, Save. Tildá "Enforce HTTPS" cuando aparezca.
4. En un par de minutos, `https://diegomarin28.github.io/sistema-parents-break/` tiene que mostrar
   "La app se mudó" (o pasar directo a la nueva si la abrís en el navegador).

No hay nada que mantener: cuando ya nadie use la dirección vieja (meses), el repo se puede borrar.
