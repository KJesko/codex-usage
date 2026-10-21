import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from codex_usage import web_i18n

STATIC = Path(__file__).resolve().parents[1] / 'src/codex_usage/static'


class WebLanguageTests(unittest.TestCase):
    def test_cookie_validation(self):
        self.assertEqual(web_i18n.language(None), 'zh-CN')
        self.assertEqual(web_i18n.language('codex-usage-language=en'), 'en')
        self.assertEqual(web_i18n.language('codex-usage-language=../en'), 'zh-CN')
        self.assertEqual(web_i18n.language('codex-usage-language=zh-CN'), 'zh-CN')

    def test_user_data_and_numeric_values_are_unchanged(self):
        data = {'title':'用量总览', 'name':'模型分析', 'path':'D:/项目/价格',
                'id':'项目', 'model':'gpt-5.6-terra', 'total':1234,
                'windows':[{'label':'每周额度','remaining_percent':57}],
                'error':'请选择有效的开始和结束日期'}
        result = web_i18n.response(data, 'en')
        for key in ('title','name','path','id','model','total'):
            self.assertEqual(result[key], data[key])
        self.assertEqual(result['windows'][0]['label'], 'Weekly quota')
        self.assertEqual(result['windows'][0]['remaining_percent'],57)
        self.assertEqual(data['windows'][0]['label'], '每周额度')
        self.assertNotRegex(result['error'], '[\u4e00-\u9fff]')
        self.assertEqual(web_i18n.response(data, 'zh-CN'), data)

    def test_assets_covered_and_english_scripts_parse(self):
        with tempfile.TemporaryDirectory() as folder:
            for path in STATIC.iterdir():
                if path.suffix not in ('.js','.html') or path.name == 'language.js':
                    continue
                raw = path.read_bytes()
                self.assertEqual(web_i18n.asset(raw,path.name,'zh-CN'),raw)
                missing = set(web_i18n.PHRASE.findall(raw.decode('utf-8')))-web_i18n.messages().keys()
                self.assertFalse(missing, (path.name,missing))
                translated = web_i18n.asset(raw,path.name,'en')
                if path.suffix == '.js':
                    output=Path(folder)/path.name
                    output.write_bytes(translated)
                    check=subprocess.run(['node','--check',str(output)],capture_output=True,text=True)
                    self.assertEqual(check.returncode,0,check.stderr)

    def test_language_control_can_switch_back(self):
        result = web_i18n.asset((STATIC/'index.html').read_bytes(),'index.html','en').decode()
        self.assertIn('lang="en-US"', result)
        self.assertIn('value="zh-CN"', result)
        self.assertIn('Project analysis', result)
        self.assertIn('value="en"', result)
        raw=(STATIC/'language.js').read_bytes()
        self.assertEqual(web_i18n.asset(raw,'language.js','en'),raw)
