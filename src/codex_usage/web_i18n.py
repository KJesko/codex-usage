"""Localize trusted web UI resources, never user titles, paths or model IDs.

The Chinese assets remain the source of truth. Exact, reviewed phrase entries
produce the English assets before they reach the browser; no DOM rewriting or
translation service observes user data. Missing entries remain visible in Chinese
and are caught by the asset-coverage test.
"""
import json
import re
from functools import lru_cache
from http.cookies import SimpleCookie, CookieError
from pathlib import Path

PHRASE = re.compile(r'[\u4e00-\u9fff][\u4e00-\u9fff，。；：、（）！？×— ·/]*')


@lru_cache(maxsize=1)
def messages():
    return json.loads(Path(__file__).with_name('locales').joinpath('en.json').read_text(encoding='utf-8'))


def language(cookie):
    try:
        values = SimpleCookie(cookie or '')
        return 'en' if values.get('codex-usage-language') and values['codex-usage-language'].value == 'en' else 'zh-CN'
    except CookieError:
        return 'zh-CN'


@lru_cache(maxsize=1)
def fragments():
    return re.compile('|'.join(re.escape(key) for key in sorted(messages(), key=len, reverse=True)))


def translate(text):
    def replace(match):
        if match[0] in messages():
            return messages()[match[0]]
        # Server messages may interpolate numbers between the same UI phrases.
        return fragments().sub(lambda part: messages()[part[0]], match[0])
    return PHRASE.sub(replace, text)


def asset(source, name, locale):
    if locale != 'en' or name == 'language.js' or not name.endswith(('.html', '.js')):
        return source
    text = source.decode('utf-8')
    def replace(match):
        value = messages().get(match[0], match[0])
        if name.endswith('.js'):
            # Safe in single/double quoted strings and template literals alike.
            value = value.replace('\\', '\\\\').replace("'", r'\u0027').replace('"', r'\u0022').replace('`', r'\u0060').replace('$', r'\u0024')
        return value
    text = PHRASE.sub(replace, text)
    text = text.replace('lang="zh-CN"', 'lang="en-US"') if name.endswith('.html') else text.replace("'zh-CN'", "'en-US'")
    return text.encode('utf-8')


def response(value, locale, key=None):
    """Only application-owned presentation fields; do not touch data or IDs."""
    if locale != 'en':
        return value
    if isinstance(value, dict):
        return {k: response(v, locale, k) for k, v in value.items()}
    if isinstance(value, list):
        return [response(v, locale, key) for v in value]
    if isinstance(value, str) and key in {
        'label', 'message', 'error', 'problem', 'history_problem', 'alerts_problem',
        'reason', 'description',
    }:
        return translate(value)
    return value
