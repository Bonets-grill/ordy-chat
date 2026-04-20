"""Tests del detector de CAPTCHA/bot-block.

Fixtures inline tomados del job 8a1ca351 (Bonets Grill, 2026-04-20) que
reveló el bug: HTTP 200 con HTML de challenge page.
"""

from app.captcha_detect import detectar_captcha


# Muestras literales del job que reportó el bug. Trimmed pero preservando
# el marcador estructural clave.
GOOGLE_RECAPTCHA = """<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN"><html dir="LTR"><head>
<title>https://www.google.com/search?client=safari&amp;kgmid=/g/11s6b73ccw&amp;q=Bonet%E2%80%99s+Grill</title>
<meta http-equiv="content-type" content="text/html; charset=utf-8">
</head><body>
<iframe sandbox="allow-scripts" src="https://www.google.com/recaptcha/enterprise/bframe?hl=es&amp;v=gTpTIWhbKpxADzTzkcabhXN4&amp;k=6LdLLIMbAAAAAIl-KLj9p1ePhM-4LCCDbjtJLqRO"></iframe>
</body></html>"""

TRIPADVISOR_DATADOME = """<html lang="es"><head><title>tripadvisor.es</title><style>#cmsg{animation: A 1.5s;}</style>
<meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0">
<script data-cfasync="false">var dd={'rt':'c','hsh':'2F05D6','host':'geo.captcha-delivery.com'}</script>
<script data-cfasync="false" src="https://ct.captcha-delivery.com/c.js"></script>
<iframe src="https://geo.captcha-delivery.com/captcha/" title="DataDome CAPTCHA"></iframe>
</body></html>"""

CLOUDFLARE_CHALLENGE = """<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>
<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></head>
<body><noscript>Enable JavaScript to proceed.</noscript></body></html>"""

# HTML legítimo — restaurante real que menciona la palabra "captcha" en un
# blog post o FAQ. NO debe detectarse como bot-block.
HTML_LEGITIMO_CON_MENCION = """<!DOCTYPE html><html><head><title>Bonets Grill Icod</title>
<meta name="description" content="Restaurant. We added a captcha to our contact form to reduce spam.">
</head><body><h1>Bienvenidos</h1><p>Nuestra web usa captcha en el formulario.</p></body></html>"""

HTML_LAST_SHOP_LEGITIMO = """<!DOCTYPE html><html lang="en"><head>
<title>Bonets Grill Icod</title>
<meta name="description" content="Enjoy Bonets Grill Icod where and when you want!">
<link rel="canonical" href="https://bonetsgrill.last.shop/en/bonets-grill-icod">
</head><body>Menu content here with chicken wings €8.9</body></html>"""


def test_detecta_recaptcha_enterprise() -> None:
    assert detectar_captcha(GOOGLE_RECAPTCHA) == "recaptcha"


def test_detecta_datadome_por_dominio() -> None:
    # DataDome se detecta por el dominio de su CDN, que aparece en varios
    # marcadores distintos del HTML (script src + iframe src).
    assert detectar_captcha(TRIPADVISOR_DATADOME) == "datadome"


def test_detecta_cloudflare_challenge() -> None:
    assert detectar_captcha(CLOUDFLARE_CHALLENGE) == "cloudflare_challenge"


def test_no_falso_positivo_con_mencion_texto_libre() -> None:
    # Marcador estructural > texto libre. "captcha" en meta description
    # NO debe activar el detector.
    assert detectar_captcha(HTML_LEGITIMO_CON_MENCION) is None


def test_no_falso_positivo_last_shop() -> None:
    # El caso real de Bonets Grill website (last.shop) debe pasar limpio.
    assert detectar_captcha(HTML_LAST_SHOP_LEGITIMO) is None


def test_vacio_o_corto_devuelve_none() -> None:
    assert detectar_captcha("") is None
    assert detectar_captcha(None) is None
    assert detectar_captcha("<html></html>") is None


def test_case_insensitive() -> None:
    # El detector no debe depender de capitalización. Padding para superar
    # el guard _MIN_LEN=100 (CAPTCHAs reales son >500 chars).
    html = (
        "<!DOCTYPE html><html><head><title>Verify</title></head><body>"
        "<script src='https://GOOGLE.COM/RECAPTCHA/API/fallback'></script>"
        "<p>Bot protection active.</p></body></html>"
    )
    assert detectar_captcha(html) == "recaptcha"
