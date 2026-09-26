"""Bundle local assets into a dependency-free, single-file browser game."""
from pathlib import Path

root = Path(__file__).resolve().parent
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'style.css').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
for name in ('scenarios', 'terrain', 'engine', 'renderer', 'app'):
    source = (root / (name + '.js')).read_text(encoding='utf-8')
    html = html.replace('<script src="' + name + '.js"></script>', '<script>\n' + source + '\n</script>')
target = root.parent / 'index.html'
target.write_text(html, encoding='utf-8')
print(target)
