# runtime/app/survey_templates.py — plantillas multi-idioma para la encuesta
# NPS post-pedido (mig 057). 6 idiomas alineados con lang_detect.py.
#
# El cliente recibe el mensaje 24h después de pagar, en su idioma detectado.
# Si la detección devuelve None (mensaje muy corto, sin stopwords claras),
# fallback a español. Mantenemos el mensaje breve — clientes WA hostelería
# no leen párrafos.

from __future__ import annotations

# Dict[idioma -> (saludo_func(name), pregunta, agradecimiento)]
# saludo_func recibe el nombre del cliente (puede ser None) y devuelve la
# fórmula de saludo apropiada al idioma.

_SALUDO = {
    "es": lambda n: f"Hola {n}" if n else "Hola",
    "en": lambda n: f"Hi {n}" if n else "Hi",
    "de": lambda n: f"Hallo {n}" if n else "Hallo",
    "fr": lambda n: f"Bonjour {n}" if n else "Bonjour",
    "it": lambda n: f"Ciao {n}" if n else "Ciao",
    "pt": lambda n: f"Olá {n}" if n else "Olá",
}

_PREGUNTA = {
    "es": (
        "👋 Soy del equipo de {tenant}. ¿Cómo te fue con tu pedido de ayer?\n\n"
        "Responde con un número del 1 al 5:\n"
        "1 = mal · 5 = excelente\n\n"
        "Si quieres, añade un comentario después. ¡Gracias!"
    ),
    "en": (
        "👋 I'm from the {tenant} team. How was your order yesterday?\n\n"
        "Reply with a number from 1 to 5:\n"
        "1 = poor · 5 = excellent\n\n"
        "Feel free to add a comment after. Thanks!"
    ),
    "de": (
        "👋 Ich bin vom {tenant}-Team. Wie war Ihre Bestellung gestern?\n\n"
        "Antworten Sie mit einer Zahl von 1 bis 5:\n"
        "1 = schlecht · 5 = ausgezeichnet\n\n"
        "Gern auch ein Kommentar danach. Danke!"
    ),
    "fr": (
        "👋 Je suis de l'équipe {tenant}. Comment s'est passée votre commande d'hier ?\n\n"
        "Répondez avec un chiffre de 1 à 5 :\n"
        "1 = mauvais · 5 = excellent\n\n"
        "Vous pouvez ajouter un commentaire ensuite. Merci !"
    ),
    "it": (
        "👋 Sono del team di {tenant}. Com'è andato il tuo ordine ieri?\n\n"
        "Rispondi con un numero da 1 a 5:\n"
        "1 = male · 5 = eccellente\n\n"
        "Se vuoi, aggiungi un commento dopo. Grazie!"
    ),
    "pt": (
        "👋 Sou da equipa de {tenant}. Como foi o seu pedido ontem?\n\n"
        "Responda com um número de 1 a 5:\n"
        "1 = mau · 5 = excelente\n\n"
        "Pode adicionar um comentário depois. Obrigado!"
    ),
}

_AGRADECIMIENTO_RATING = {
    "es": "¡Gracias por tu feedback! 🙌 Si quieres añadir un comentario, escríbelo aquí.",
    "en": "Thanks for your feedback! 🙌 Feel free to add a comment here.",
    "de": "Danke für Ihr Feedback! 🙌 Sie können gern einen Kommentar dazu schreiben.",
    "fr": "Merci pour votre retour ! 🙌 N'hésitez pas à ajouter un commentaire ici.",
    "it": "Grazie per il tuo feedback! 🙌 Se vuoi, lascia un commento qui.",
    "pt": "Obrigado pelo seu feedback! 🙌 Pode adicionar um comentário aqui se quiser.",
}

_AGRADECIMIENTO_COMENTARIO = {
    "es": "¡Gracias! Lo tendremos en cuenta.",
    "en": "Thanks! We'll take it into account.",
    "de": "Danke! Wir werden es berücksichtigen.",
    "fr": "Merci ! Nous en tiendrons compte.",
    "it": "Grazie! Ne terremo conto.",
    "pt": "Obrigado! Vamos ter isso em conta.",
}


def build_survey_message(lang: str | None, tenant_name: str, customer_name: str | None) -> str:
    """Construye el mensaje de invitación a la encuesta en el idioma dado.
    Si lang es None o no soportado, usa español."""
    code = (lang or "es").lower().split("-")[0]
    if code not in _PREGUNTA:
        code = "es"
    saludo = _SALUDO[code](customer_name.strip() if customer_name else None)
    pregunta = _PREGUNTA[code].format(tenant=tenant_name)
    return f"{saludo} 👋\n\n{pregunta}"


def thanks_for_rating(lang: str | None) -> str:
    """Mensaje tras recibir el rating numérico."""
    code = (lang or "es").lower().split("-")[0]
    if code not in _AGRADECIMIENTO_RATING:
        code = "es"
    return _AGRADECIMIENTO_RATING[code]


def thanks_for_comment(lang: str | None) -> str:
    """Mensaje tras recibir el feedback_text."""
    code = (lang or "es").lower().split("-")[0]
    if code not in _AGRADECIMIENTO_COMENTARIO:
        code = "es"
    return _AGRADECIMIENTO_COMENTARIO[code]
