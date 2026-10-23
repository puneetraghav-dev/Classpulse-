# Builds the standalone / Google Meet add-on pages from the same app source as the Claude version.
#   index.html      the full app in any browser tab
#   sidepanel.html  the app inside Google Meet's side panel
#   mainstage.html  the read-only projector view on Google Meet's main stage
import sys, pathlib

HERE = pathlib.Path(__file__).resolve().parent
# Usage: python3 build_meet.py [app source] [output folder]
SRC = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / 'claude-version' / 'classpulse-artifact.html'
OUT = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else HERE
FIREBASE = '10.12.2'
MEET_SDK = 'https://www.gstatic.com/meetjs/addons/1.1.0/meet.addons.js'

app = SRC.read_text(encoding='utf-8')
reset = (':root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
         'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}')

def page(mode, with_meet):
    scripts = [f'<script>window.CLASSPULSE_MODE = "{mode}";</script>']
    for part in ('app', 'auth', 'database'):
        scripts.append(f'<script src="https://www.gstatic.com/firebasejs/{FIREBASE}/firebase-{part}-compat.js"></script>')
    if with_meet:
        scripts.append(f'<script src="{MEET_SDK}"></script>')
    scripts += ['<script src="config.js"></script>', '<script src="runtime-firebase.js"></script>']
    head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<link rel="icon" href="logo.png">\n'
            f'<style>{reset}</style>\n' + '\n'.join(scripts) + '\n</head>\n<body>\n')
    return head + app + '\n</body>\n</html>\n'

OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'index.html').write_text(page('web', False), encoding='utf-8')
(OUT / 'sidepanel.html').write_text(page('sidepanel', True), encoding='utf-8')
(OUT / 'mainstage.html').write_text(page('mainstage', True), encoding='utf-8')
print('built index.html, sidepanel.html, mainstage.html in', OUT)
