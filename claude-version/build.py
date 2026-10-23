# Builds index.html, the standalone page (offline demo mode), from the app source classpulse-artifact.html.
# claude.ai wraps the artifact in this same outer page when it is published.
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
src = (HERE / 'classpulse-artifact.html').read_text(encoding='utf-8')
head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
        'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>\n'
        '</head>\n<body>\n')
(HERE / 'index.html').write_text(head + src + '\n</body>\n</html>\n', encoding='utf-8')
print('built', HERE / 'index.html')
