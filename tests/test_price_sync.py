import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
from codex_usage.price_sync import PriceSync, parse_prices, INTERVAL
from codex_usage.pricing import estimate

def fixture():
    table="| Model | Input | Output | Cached input |\n| --- | --- | --- | --- |\n"
    table+="| gpt-5.3-codex | $2 | $10 | - |\n"
    table+="".join(f"| test-{i} | $2 | $10 | $0.2 |\n" for i in range(20))
    return "Flagship models\nStandard\n"+("\n"+table+"\n")*10+"\nFast\n| Model | Input | Output | Cached input |\n| --- | --- | --- | --- |\n| test-0 | $99 | $99 | $99 |\n"

class PriceSyncTests(unittest.TestCase):
    def test_exact_official_rate_supersedes_fallback_alias(self):
        from codex_usage.pricing import price_for
        old = dict(input=2, cached=.2, write=None, output=10)
        updated = {**old, "input":3}
        catalog = {"models":{"canonical":old, "alias":updated}, "aliases":{"alias":"canonical"}}
        self.assertEqual(price_for("alias", catalog=catalog), updated)
        self.assertEqual(price_for("alias", {"canonical":old}, catalog), old)

    def test_standard_only_and_missing_is_not_free(self):
        models,tables=parse_prices(fixture())
        self.assertEqual(models["test-0"]["input"],2)
        self.assertIsNone(models["gpt-5.3-codex"]["cached"])
        self.assertEqual(tables[-1]["tier"],"Fast")
        event=dict(model="gpt-5.3-codex",uncached=10,cached=1,write=0,output=0,context_input=11)
        self.assertIsNone(estimate(event,catalog={"models":models,"aliases":{}})["cost"])
        self.assertAlmostEqual(estimate({**event,"cached":0},catalog={"models":models,"aliases":{}})["cost"],.00002)

    def test_schedule_survives_restart_and_failure_preserves_prices(self):
        with tempfile.TemporaryDirectory() as folder:
            now=[100000]
            path=Path(folder)/"prices.json"
            sync=PriceSync(path,fetcher=fixture,clock=lambda:now[0],needed=lambda:{"test-0"})
            self.assertTrue(sync.sync_due())
            original=sync.catalog()
            fresh=PriceSync(path,fetcher=lambda: "invalid",clock=lambda:now[0],needed=lambda:{"test-0"})
            self.assertFalse(fresh.sync_due())
            now[0]+=INTERVAL
            self.assertFalse(fresh.sync_due())
            self.assertEqual(fresh.catalog(),original)
            self.assertTrue(fresh.status()["error"])
            self.assertEqual(fresh.status()["next_check"],now[0]+INTERVAL)
            again=PriceSync(path,fetcher=fixture,clock=lambda:now[0],needed=lambda:{"test-0"})
            self.assertFalse(again.sync_due())
            now[0]+=INTERVAL
            self.assertTrue(again.sync_due())
            self.assertIsNone(again.status()["error"])

    def test_corrupt_document_rejected(self):
        with self.assertRaises(ValueError):parse_prices("Please sign in")

    def test_custom_price_wins(self):
        row=dict(model="test-0",uncached=1000000,cached=0,write=0,output=0,context_input=100)
        rate=dict(input=7,cached=7,write=7,output=7)
        self.assertEqual(estimate(row,{"test-0":rate}, {"models":parse_prices(fixture())[0],"aliases":{}})["cost"],7)

class DemandTests(unittest.TestCase):
    def test_no_missing_models_never_fetches_and_check_survives_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/"prices.json"
            calls=[]
            fetch=lambda:calls.append(1)
            sync=PriceSync(path,fetcher=fetch,clock=lambda:100000,needed=lambda:set())
            self.assertFalse(sync.sync_due())
            self.assertEqual(calls,[])
            fresh=PriceSync(path,fetcher=fetch,clock=lambda:100001,needed=lambda:set())
            self.assertFalse(fresh.sync_due())
            self.assertEqual(calls,[])

    def test_only_requested_missing_prices_are_added(self):
        with tempfile.TemporaryDirectory() as folder:
            sync=PriceSync(Path(folder)/"p.json",fetcher=fixture,clock=lambda:100000,needed=lambda:{"test-0","unknown"})
            self.assertTrue(sync.sync_due(force=True,requested=["test-0","unused"]))
            self.assertEqual(set(sync.saved["models"]),{"test-0"})
            self.assertNotIn("tables",sync.status())

    def test_daily_updates_existing_used_prices_only(self):
        with tempfile.TemporaryDirectory() as folder:
            now=[100000]
            document=[fixture()]
            sync=PriceSync(Path(folder)/"p.json",fetcher=lambda:document[0],clock=lambda:now[0],
                           needed=lambda:set(),used=lambda:{"test-0"})
            self.assertTrue(sync.sync_due())
            document[0]=fixture().replace("$2 |", "$3 |")
            now[0]+=INTERVAL-1
            self.assertFalse(sync.sync_due())
            now[0]+=1
            self.assertTrue(sync.sync_due())
            self.assertEqual(sync.catalog()["models"]["test-0"]["input"],3)
            self.assertEqual(set(sync.saved["models"]),{"test-0"})

    def test_new_missing_model_fetches_early_without_delaying_daily_sync(self):
        with tempfile.TemporaryDirectory() as folder:
            now=[100000]
            missing=set()
            calls=[]
            def fetch():
                calls.append(now[0])
                return fixture()
            path=Path(folder)/"p.json"
            sync=PriceSync(path,fetcher=fetch,clock=lambda:now[0],needed=lambda:missing,
                           used=lambda:{"test-0"}|missing)
            self.assertTrue(sync.sync_due())
            missing.add("unknown")
            now[0]+=30
            self.assertFalse(sync.sync_due())
            now[0]+=30
            self.assertTrue(sync.sync_due())
            self.assertEqual(sync.status()["next_check"],100000+INTERVAL)
            fresh=PriceSync(path,fetcher=fetch,clock=lambda:now[0],needed=lambda:missing,
                            used=lambda:{"test-0"}|missing)
            now[0]+=60
            self.assertFalse(fresh.sync_due())
            self.assertEqual(len(calls),2)
