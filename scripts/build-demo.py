"""Build a GitHub Pages demo from an explicit static-asset allowlist.

Never imports the application, discovers Codex directories, or copies user data.
"""
import hashlib
import json
from pathlib import Path
import re
import shutil
import importlib.util

# Load only the pure translator; never initialize the application or user data.
spec = importlib.util.spec_from_file_location('demo_i18n', Path(__file__).resolve().parents[1] / 'src/codex_usage/web_i18n.py')
i18n = importlib.util.module_from_spec(spec)
spec.loader.exec_module(i18n)

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / 'src/codex_usage/static'
OUTPUT = ROOT / 'dist/demo'


def build():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    # An explicit allowlist prevents accidentally publishing unrelated assets.
    assets = ['index.html', 'language.js', 'style.css', 'icon.svg', 'app.js', 'model-charts.js',
              'activity-heatmap.js', 'project-treemap.js', 'quota-dom.js', 'quota-range.js',
              'usage-insights.js', 'quota-tools.js', 'quota-page.js', 'compact-tables.js', 'hint-help.js',
              'web-state.js', 'web-feedback.js', 'themed-select.js']
    for name in assets:
        shutil.copyfile(STATIC / name, OUTPUT / name)
    for name in ['demo-data.js', 'demo-bridge.js', 'demo.css']:
        shutil.copyfile(ROOT / 'demo' / name, OUTPUT / name)
    catalog = json.loads((ROOT / 'src/codex_usage/prices.json').read_text(encoding='utf-8'))
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    (OUTPUT / 'demo-catalog.js').write_text('const DEMO_CATALOG = '+json.dumps(catalog, ensure_ascii=False)+';\nconst DEMO_VERSION = '+json.dumps(version)+';\n', encoding='utf-8')
    html = (OUTPUT / 'index.html').read_text(encoding='utf-8')
    html = html.replace('href="/', 'href="./').replace('src="/', 'src="./')
    html = html.replace('<html lang="zh-CN">', '<html lang="zh-CN" data-demo-root="./">')
    html = html.replace('<script src="./model-charts.js"', '<link rel="stylesheet" href="./demo.css">\n  <script src="./demo-catalog.js" defer></script><script src="./demo-data.js" defer></script><script src="./demo-bridge.js" defer></script>\n  <script src="./model-charts.js"')
    banner = '''<section class="demo-banner" aria-label="模拟演示说明">
      <div class="demo-experience"><div class="demo-label">INTERACTIVE DEMO · <span>全部数据都是模拟的</span></div><strong>从日常工作到异常恢复，亲手试一遍。</strong>
      <p>近 12 个月合成用量 · 6 个虚构项目 · 3 台模拟机器。不会读取你的 Codex、连接账号或 SSH；数据设置仅在当前页面内生效。</p>
      <div class="demo-scenarios" role="group" aria-label="演示场景"><button data-demo-scenario="daily" aria-pressed="true">日常开发</button><button data-demo-scenario="interrupted" aria-pressed="false">连接中断</button><button data-demo-scenario="limit" aria-pressed="false">额度告急</button><button data-demo-scenario="history" aria-pressed="false">长期记录</button></div>
      <p id="demoScenarioNote" role="status">日常开发：三台机器分工、冷启动与热缓存交替，可按项目和模型追踪用量。</p>
      <div class="demo-shortcuts"><button data-demo-tour="appearance">外观与自动保存 ↗</button><button data-demo-tour="coverage">数据更新状态 ↗</button><button id="demoSaveFailure">模拟一次保存失败</button></div></div>
      <div class="demo-actions"><button id="resetDemo" class="text-button">重置演示</button><a href="https://github.com/KJesko/codex-usage" target="_blank" rel="noopener noreferrer">获取源码 ↗</a></div>
    </section>'''
    html = html.replace('<main id="main">', '<main id="main">\n'+banner)
    html = html.replace('<span>网页预览</span>', '<span>模拟演示</span>')
    html = html.replace('正在整理本地用量记录…', '正在生成模拟用量记录…')
    html = html.replace('<span data-help="后台采集">后台日志采集 30 秒 · 账号额度采集 60 秒</span>', '<span>GitHub Pages · 全部数据由浏览器生成 · 非真实账单</span>')
    css = (OUTPUT / 'style.css').read_text(encoding='utf-8')
    css = re.sub(r', url\("/fonts/[^\"]+"\) format\("truetype"\)', '', css)
    (OUTPUT / 'style.css').write_text(css, encoding='utf-8')
    # Keep the official application untouched; clarify shared wording in demo assets.
    substitutions = {
        'app.js': [("view:'overview', tab:'summary', range:'30'", "view:'overview', tab:'summary', range:'all'"),
                   ('当前账号的实时额度、重置卡、使用分段和重置动态。', '模拟账号额度、重置记录与消耗曲线，不连接真实账号。'),
                   ('官方价格核对于', '仓库价格快照日期'),
                   ('单价仅保存在本机', '演示修改仅在当前页面内生效，刷新后恢复'),
                   ('通过官方页面登录，无需复制 Session；这会更新本机 Codex 的登录账号。', '演示登录只恢复模拟账号，不会打开真实登录页面或修改本机账号。'),
                   ('浏览器登录</button>', '模拟登录</button>'),
                   ("'更新于 ' +", "'模拟数据生成于 ' +")],
        'quota-page.js': [('公开重置动态', '公开重置动态（演示中停用）'),
                          ('function forecastMarkup(f){', 'function forecastMarkup(f){\n    if(f?.demo)return `<p class="reset-empty">${esc(f.problem)}</p>`;')],
        'quota-tools.js': [('额度采集未运行', '模拟历史 · 无后台采集')],
        'quota-range.js': [('viewports.get(key)||initialView(q)',
                            'viewports.get(key)||{since:q.range.since,until:q.range.until}'),
                           ('默认显示最近 7 天', '演示默认显示全部历史')],
    }
    for name, replacements in substitutions.items():
        path = OUTPUT / name
        source = path.read_text(encoding='utf-8')
        for old, new in replacements:
            if old not in source:
                raise ValueError(f'Demo adaptation no longer matches {name}: {old}')
            source = source.replace(old, new)
        path.write_text(source, encoding='utf-8')
    # A fresh deployment must not mix the new fixture with cached demo assets.
    def version_asset(match):
        name = match[2]
        digest = hashlib.sha256((OUTPUT / name).read_bytes()).hexdigest()[:12]
        return f'{match[1]}="./{name}?v={digest}"'
    html = re.sub(r'(src|href)="\./([^"?]+)(?:\?[^" ]*)?"', version_asset, html)
    (OUTPUT / 'index.html').write_text(html, encoding='utf-8')
    (OUTPUT / '.nojekyll').write_text('', encoding='utf-8')
    english = OUTPUT / 'en'
    english.mkdir(exist_ok=True)
    for name in assets + ['demo-data.js', 'demo-bridge.js', 'demo.css', 'demo-catalog.js']:
        localized = i18n.asset((OUTPUT / name).read_bytes(), name, 'en')
        if name == 'index.html':
            localized = localized.replace(b'data-demo-root="./"', b'data-demo-root="../"')
        (english / name).write_bytes(localized)
    english_html = (english / 'index.html').read_text(encoding='utf-8')
    english_html = re.sub(r'(src|href)="\./([^"?]+)(?:\?[^" ]*)?"',
        lambda match: f'{match[1]}="./{match[2]}?v={hashlib.sha256((english / match[2]).read_bytes()).hexdigest()[:12]}"',
        english_html)
    (english / 'index.html').write_text(english_html, encoding='utf-8')
    expected = set(assets + ['demo-data.js', 'demo-bridge.js', 'demo.css', 'demo-catalog.js', '.nojekyll', 'en'])
    actual = {p.name for p in OUTPUT.iterdir()}
    if actual != expected:
        raise ValueError('Unexpected files in dist/demo; inspect before publishing: '+repr(actual - expected))
    print('Static demo ready: '+str(OUTPUT))


if __name__ == '__main__':
    build()
