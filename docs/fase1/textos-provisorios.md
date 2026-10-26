# Textos provisorios de la fase 1 (para que los vean Paulina y Delfina)

Textos que la app necesitó y no están en `textos.md`. Los escribió Claude siguiendo las reglas de
ese archivo (en "tú", sin plata, sin suponer que quien lee es admin). Si las dueñas cambian
alguno, se corrige en el código en un PR y se mueve a `textos.md`. Se van sumando por etapa.

## Etapa 1: cuenta, invitación, instalar, avisos

Pantalla de invitación y contraseña:
- "Repite la contraseña" (segundo campo).
- "Entrarás con tu celular ••• 001 y esta contraseña." (debajo de los campos; los 3 números son los
  últimos del celular de la niñera).
- "Guardar contraseña" (botón).
- Cuando el link es para cambiar la contraseña (ya tenía cuenta): título "Crea una contraseña nueva"
  y texto "[nombre], con esta contraseña vas a entrar a la app de Parents' Break."
- Link inválido (no vencido): "Este link no es válido. Pídele uno nuevo al equipo por WhatsApp."
- Cuenta dada de baja: "Tu cuenta no está activa. Escríbenos por WhatsApp."
- Celular mal cargado en la ficha: "Tu número de celular no es válido. Avísale al equipo para
  corregirlo."
- Falla al crear la cuenta: "No pudimos crear tu cuenta. Revisa tu conexión a internet y vuelve a
  intentar."
- Desde un link vencido o inválido, botón "Entrar con mi celular".

Entrar:
- "Entra a tu cuenta", "Celular", "Contraseña", "Escribe tu contraseña", botón "Entrar".
- Celular mal escrito: "Revisa el número de celular".
- Contraseña incorrecta: "El celular o la contraseña no son correctos".
- Muchos intentos seguidos: "Demasiados intentos. Espera un minuto y vuelve a intentar."
- Sin internet: "No pudimos entrar. Revisa tu conexión a internet y vuelve a intentar."
- "¿Olvidaste tu contraseña?" → "Pídele un link nuevo al equipo por WhatsApp."

Instalar:
- Después de los 4 pasos: "Después de instalarla, entra con tu celular y la contraseña que creaste."
  (en el iPhone, la app instalada no comparte la sesión con Safari).
- Botón "Ya la instalé".
- En el inicio, si abrió la app en el navegador sin instalarla: "Instala la app para recibir los
  pedidos." con el botón "Ver cómo".

Avisos:
- Botón "Activar avisos" y link "Ahora no".
- "Avisos activados."
- "Los avisos siguen apagados. Actívalos en Ajustes."
- "Este celular no puede recibir avisos desde el navegador. Instala la app y ábrela desde el ícono."
- "No pudimos activar los avisos. Revisa tu conexión a internet y vuelve a intentar."

Inicio y cuenta:
- Saludo "Hola, [nombre]" (solo "Hola" si no tenemos el nombre).
- "Mi cuenta" (link al pie) → "Cerrar sesión".
- "No pudimos cerrar la sesión. Revisa tu conexión a internet y vuelve a intentar."
- "No pudimos abrir la app." (error de arranque, con "Reintentar").
- Copiar un texto cuando el celular no deja usar el portapapeles: "Cópialo de aquí", "Copiar el
  link", "Link copiado."

Mensaje de WhatsApp para cambiar la contraseña (lo manda la admin desde la ficha):
- "¡Hola [niñera]! Con este link puedes crear una contraseña nueva: [link]. Vale por [N] días."
