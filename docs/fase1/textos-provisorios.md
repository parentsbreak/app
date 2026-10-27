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
- Falla al crear la cuenta, error del servidor: "No pudimos crear tu cuenta. Avisa al equipo de
  Parents' Break."
- Falla al crear la cuenta, sin internet: "No pudimos crear tu cuenta. Revisa tu conexión a internet
  y vuelve a intentar."
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

## Etapa 2: perfil

Los títulos y campos fijos ("Completa esto una sola vez", "¿Qué servicios realizas?", "Sittings /
Carsittings / Ambos", "Zonas donde puedes tomar servicios", "Datos bancarios para pagarte") son los
de `textos.md`. Lo que se sumó:
- Debajo de los datos bancarios: "Banco, tipo y número de cuenta, uno por línea."
- "Tu foto (opcional)" y debajo "La ve el equipo y, si la aprueban, pasa a tu perfil."
- Si ya mandó una foto: "Foto enviada el [dd/mm], el equipo la va a revisar."
- Al marcar Carsittings o Ambos: "Pronto vas a poder cargar los datos del auto desde aquí."
- Botón "Guardar". En "Mi perfil" (la misma pantalla para cambiar algo después), además "Volver".
- Sin zona marcada: "Elige al menos una zona." Sin servicio marcado: "Elige qué servicios realizas."
- Al guardar: "¡Listo! Tu perfil quedó guardado."
- Si la foto no es una imagen que se pueda subir (por ejemplo HEIC o un PDF): "La foto tiene que ser
  JPG o PNG."
- Si falla la foto: "No pudimos subir tu foto. Revisa tu conexión a internet y vuelve a intentar."
- Si falla el perfil: "No pudimos guardar tu perfil. Revisa tu conexión a internet y vuelve a
  intentar."
- Si no se puede abrir "Mi perfil": "No pudimos abrir tu perfil. Revisa tu conexión a internet y
  vuelve a intentar."
- En el inicio, al pie: "Mi perfil" (al lado de "Mi cuenta").
