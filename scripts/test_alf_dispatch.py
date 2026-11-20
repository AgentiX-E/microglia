#!/usr/bin/env python3
"""The dispatcher's guards, exercised without a network and without a payment.

Three of the checks in `alf-dispatch.py` exist to stop money being spent: the green-tree gate, the
"treatments without a control" refusal and the "standalone sweep without a bank" refusal. A guard that is
only ever exercised by paying is a guard nobody has tested, which is why the network is a parameter and the
conclusions below are values.

Run: python3 scripts/test_alf_dispatch.py
"""

import contextlib
import io
import json
import unittest

import alf_dispatch as lane


def arguments(*argv):
    """The parsed command line, so that a test states a dispatch the way an operator would."""
    return lane.parser().parse_args(list(argv))


class RefusalTest(unittest.TestCase):
    def refused(self, *argv):
        """The sentence, asserted to be a refusal rather than a crash."""
        with self.assertRaises(lane.Refused) as caught:
            lane.check(arguments(*argv))
        return str(caught.exception)

    def test_games_without_an_arm_is_a_calibration_of_nothing(self):
        self.assertIn("no arm", self.refused("--games", "134"))

    def test_an_arm_the_lane_does_not_have_is_named_against_the_list_it_has(self):
        message = self.refused("--arm", "placebo", "--games", "134")
        self.assertIn("placebo", message)
        self.assertIn("sham", message)

    def test_a_sweep_whose_arms_are_not_json_is_refused_before_it_is_read(self):
        self.assertIn("not JSON", self.refused("--sweep", "true", "--arms", "none,sham", "--rules", "b.json"))

    def test_an_empty_arm_list_is_refused_rather_than_buying_no_jobs(self):
        self.assertIn("non-empty", self.refused("--sweep", "true", "--arms", "[]", "--rules", "b.json"))

    def test_an_arm_list_that_is_an_object_is_refused(self):
        self.assertIn("non-empty", self.refused("--sweep", "true", "--arms", '{"arm": "none"}', "--rules", "b.json"))

    def test_an_unknown_arm_inside_the_list_stops_the_whole_list(self):
        message = self.refused("--sweep", "true", "--arms", '["none","oracle"]', "--rules", "b.json")
        self.assertIn("oracle", message)

    def test_treatments_without_a_control_are_refused(self):
        message = self.refused("--sweep", "true", "--arms", '["sham"]', "--rules", "b.json")
        self.assertIn("no control", message)

    def test_a_named_control_run_is_what_licenses_leaving_control_out(self):
        self.assertEqual(lane.check(arguments("--sweep", "true", "--arms", '["sham"]', "--rules", "b.json", "--control-run", "44744658304")), ["sham"])

    def test_buying_a_control_and_naming_a_second_one_is_refused(self):
        message = self.refused("--sweep", "true", "--arms", '["none","sham"]', "--rules", "b.json", "--control-run", "1")
        self.assertIn("second one", message)

    def test_a_control_run_without_an_arm_list_says_what_it_would_be_for(self):
        self.assertIn("--arms", self.refused("--control-run", "1"))

    def test_a_chain_without_a_training_pass_is_refused(self):
        self.assertIn("--train", self.refused("--chain", "true"))

    def test_a_sweep_that_also_names_games_is_two_passes_in_one_dispatch(self):
        self.assertIn("drop --games", self.refused("--sweep", "true", "--games", "134", "--arm", "none"))

    def test_a_training_pass_and_a_calibration_in_one_dispatch_is_refused(self):
        self.assertIn("two runs' worth", self.refused("--train", "140", "--games", "134", "--arm", "none"))

    def test_a_standalone_sweep_without_a_bank_is_refused(self):
        message = self.refused("--sweep", "true", "--arms", '["none","sham"]')
        self.assertIn("--rules", message)

    def test_a_retrieval_budget_of_zero_is_refused(self):
        self.assertIn("retrieval budget", self.refused("--sweep", "true", "--rules", "b.json", "--top-k", "0"))

    def test_a_retrieval_budget_that_is_not_a_number_is_refused(self):
        self.assertIn("retrieval budget", self.refused("--sweep", "true", "--rules", "b.json", "--top-k", "k1"))

    def test_a_gate_share_of_one_would_require_accounting_for_every_word(self):
        self.assertIn("share of the observation", self.refused("--sweep", "true", "--rules", "b.json", "--gate-share", "1"))

    def test_a_bank_rebuild_without_a_run_to_read_from_is_refused(self):
        # The mode exists for the failure where the slices are already bought; a dispatch that names no run
        # would distil from nothing while reading like a recovery.
        self.assertIn("train-run-ids", self.refused("--bank-only", "true", "--train", "140"))

    def test_a_bank_rebuild_that_also_names_slices_is_refused(self):
        # Naming shards would buy games the dispatch says it is not buying: a recovery that spends money is not
        # a recovery.
        self.assertIn(
            "train-shards",
            self.refused("--bank-only", "true", "--train", "140", "--train-run-ids", "1", "--train-shards", '["0"]'),
        )

    def test_a_bank_rebuild_without_a_slice_size_is_refused(self):
        self.assertIn("size of the slice", self.refused("--bank-only", "true", "--train-run-ids", "1"))

    def test_a_gate_share_that_is_not_a_number_is_refused(self):
        self.assertIn("not a number", self.refused("--sweep", "true", "--rules", "b.json", "--gate-share", "half"))


class PayloadTest(unittest.TestCase):
    def test_a_bank_rebuild_carries_the_runs_it_reads_and_not_the_slices_it_does_not_drive(self):
        inputs = lane.payload(arguments("--bank-only", "true", "--train", "140", "--train-run-ids", "1,2"))
        self.assertEqual(inputs["bank_only"], "true")
        self.assertEqual(inputs["train_run_ids"], "1,2")
        self.assertEqual(inputs["train"], "140")
        # The legal form is asserted here so the three refusals above are not the only thing the guard does:
        # a guard that rejects everything is a guard nobody can use.
        self.assertNotIn("train_shards", inputs)

    def test_an_unnamed_input_is_left_out_so_the_workflow_keeps_its_own_default(self):
        inputs = lane.payload(arguments("--arm", "none", "--games", "134", "--shard", "0/4"))
        self.assertNotIn("arms", inputs)
        self.assertNotIn("train_shards", inputs)
        self.assertNotIn("top_k", inputs)
        self.assertNotIn("gate_share", inputs)
        self.assertNotIn("train_run_ids", inputs)
        self.assertEqual(inputs["games"], "134")

    def test_a_named_input_is_carried_verbatim(self):
        inputs = lane.payload(
            arguments(
                "--sweep",
                "true",
                "--rules",
                "banks/expel-140.json",
                "--arms",
                '["none","retrieved"]',
                "--top-k",
                "1",
                "--gate-share",
                "0.2",
            )
        )
        self.assertEqual(json.loads(inputs["arms"]), ["none", "retrieved"])
        self.assertEqual(inputs["top_k"], "1")
        self.assertEqual(inputs["gate_share"], "0.2")

    def test_a_chain_carries_the_slices_and_the_runs_it_joins(self):
        inputs = lane.payload(
            arguments(
                "--train",
                "140",
                "--chain",
                "true",
                "--train-shards",
                '["0","1","2"]',
                "--train-run-ids",
                "44738148591",
            )
        )
        self.assertEqual(json.loads(inputs["train_shards"]), ["0", "1", "2"])
        self.assertEqual(inputs["train_run_ids"], "44738148591")

    def test_the_placebo_is_a_two_arm_dispatch_because_a_delta_needs_both_sides(self):
        lane.check(arguments("--sweep", "true", "--rules", "b.json", "--arms", '["none","sham"]'))
        inputs = lane.payload(arguments("--sweep", "true", "--rules", "b.json", "--arms", '["none","sham"]'))
        self.assertEqual(json.loads(inputs["arms"]), ["none", "sham"])


class GreenTreeTest(unittest.TestCase):
    """The gate that decides whether a purchase happens, with the network replaced by a value."""

    def fake(self, master, gate):
        calls = []

        def call(method, path, token, body=None):
            calls.append(path)
            if path.endswith("/git/ref/heads/master"):
                return {"object": {"sha": master}}
            return {"workflow_runs": [gate]}

        return call, calls

    def test_a_green_ci_on_the_head_licenses_the_dispatch(self):
        call, _ = self.fake("a" * 40, {"head_sha": "a" * 40, "status": "completed", "conclusion": "success"})
        master, gate = lane.green_tree("token", call=call)
        self.assertEqual(master, "a" * 40)
        self.assertEqual(gate["conclusion"], "success")

    def test_ci_that_has_not_seen_the_head_refuses_even_when_it_is_green(self):
        call, _ = self.fake("a" * 40, {"head_sha": "b" * 40, "status": "completed", "conclusion": "success"})
        with self.assertRaises(lane.Refused) as caught:
            lane.green_tree("token", call=call)
        self.assertIn("uncertified", str(caught.exception))

    def test_a_failed_ci_on_the_head_refuses(self):
        call, _ = self.fake("a" * 40, {"head_sha": "a" * 40, "status": "completed", "conclusion": "failure"})
        with self.assertRaises(lane.Refused) as caught:
            lane.green_tree("token", call=call)
        self.assertIn("refusing to dispatch", str(caught.exception))

    def test_ci_still_running_on_the_head_refuses_rather_than_waiting(self):
        call, _ = self.fake("a" * 40, {"head_sha": "a" * 40, "status": "in_progress", "conclusion": None})
        with self.assertRaises(lane.Refused) as caught:
            lane.green_tree("token", call=call)
        self.assertIn("in_progress", str(caught.exception))


class MainTest(unittest.TestCase):
    """The three ways `main` can end without sending anything, and the one way it sends."""

    def run_main(self, *argv, token="t", call=None):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = lane.main(list(argv), token=token, call=call, sleep=lambda _: None)
        return code, out.getvalue(), err.getvalue()

    def test_a_refused_dispatch_prints_one_sentence_and_exits_two(self):
        code, _, err = self.run_main("--games", "134")
        self.assertEqual(code, 2)
        self.assertIn("no arm", err)

    def test_a_dry_run_prints_the_payload_and_never_asks_whether_the_tree_is_green(self):
        def call(method, path, token, body=None):
            raise AssertionError("a dry run must not reach the network")

        code, out, _ = self.run_main("--arm", "none", "--games", "134", "--dry-run", call=call)
        self.assertEqual(code, 0)
        self.assertIn("dry run inputs=", out)

    def test_without_a_token_the_only_thing_left_is_a_dry_run(self):
        code, _, err = self.run_main("--arm", "none", "--games", "134", token="")
        self.assertEqual(code, 2)
        self.assertIn("GH_TOKEN", err)

    def test_a_red_tree_stops_the_dispatch_before_the_post(self):
        seen = []

        def call(method, path, token, body=None):
            seen.append((method, path))
            if path.endswith("/git/ref/heads/master"):
                return {"object": {"sha": "a" * 40}}
            return {"workflow_runs": [{"head_sha": "a" * 40, "status": "completed", "conclusion": "failure"}]}

        code, _, err = self.run_main("--arm", "none", "--games", "134", call=call)
        self.assertEqual(code, 2)
        self.assertIn("refusing to dispatch", err)
        self.assertNotIn("POST", [method for method, _ in seen])

    def test_a_reused_control_is_announced_so_the_readback_knows_where_the_left_side_came_from(self):
        code, out, _ = self.run_main(
            "--sweep",
            "true",
            "--rules",
            "b.json",
            "--arms",
            '["sham"]',
            "--control-run",
            "44744658304",
            "--dry-run",
        )
        self.assertEqual(code, 0)
        self.assertIn("control is the none slices of run 44744658304", out)

    def test_a_green_tree_posts_the_payload_and_reports_the_run_it_found(self):
        posted = {}
        listed = []

        def call(method, path, token, body=None):
            if method == "POST":
                posted.update(body)
                return {}
            if path.endswith("/git/ref/heads/master"):
                return {"object": {"sha": "a" * 40}}
            if "ci.yml/runs" in path:
                return {"workflow_runs": [{"head_sha": "a" * 40, "status": "completed", "conclusion": "success"}]}
            # The listing before the dispatch does not contain the run; the listing after it does. That is
            # the whole of what this script knows about "which run did my dispatch produce".
            listed.append(path)
            if len(listed) == 1:
                return {"workflow_runs": [{"id": 1, "name": "alfworld"}]}
            return {"workflow_runs": [{"id": 2, "name": "alfworld", "status": "queued", "html_url": "u"}, {"id": 1, "name": "alfworld"}]}

        code, out, _ = self.run_main("--arm", "none", "--games", "134", call=call)
        self.assertEqual(code, 0)
        self.assertEqual(posted["ref"], "master")
        self.assertEqual(posted["inputs"]["games"], "134")
        self.assertIn("run 2 queued u", out)


class CallTest(unittest.TestCase):
    """`call` is the only place a socket is opened, so it is the one place a fake socket is enough.

    The substitution is a class rather than a mock library: what is being checked is the request this
    function *builds* — method, URL, headers, body — and a response object that yields bytes.
    """

    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_):
            self.close()
            return False

    def run_call(self, payload, method="POST", path="/repos/x/dispatches", body=None):
        seen = {}

        def urlopen(request, timeout=None):
            seen["method"] = request.get_method()
            seen["url"] = request.full_url
            seen["headers"] = dict(request.header_items())
            seen["body"] = request.data
            seen["timeout"] = timeout
            return self.Response(payload)

        original = lane.urllib.request.urlopen
        lane.urllib.request.urlopen = urlopen
        try:
            result = lane.call(method, path, "t0ken", {"ref": "master"} if method == "POST" else body)
        finally:
            lane.urllib.request.urlopen = original
        return result, seen

    def test_a_post_carries_its_json_body_and_the_two_headers_github_needs(self):
        result, seen = self.run_call(b'{"id": 7}')
        self.assertEqual(result, {"id": 7})
        self.assertEqual(seen["method"], "POST")
        self.assertEqual(seen["url"], "https://api.github.com/repos/x/dispatches")
        self.assertEqual(seen["body"], b'{"ref": "master"}')
        self.assertEqual(seen["headers"]["Authorization"], "Bearer t0ken")
        self.assertEqual(seen["headers"]["Content-type"], "application/json")

    def test_a_get_opens_no_body_and_asks_for_no_content_type(self):
        result, seen = self.run_call(b'{"object": {"sha": "a"}}', method="GET")
        self.assertEqual(result, {"object": {"sha": "a"}})
        self.assertEqual(seen["method"], "GET")
        self.assertIsNone(seen["body"])
        self.assertNotIn("Content-type", seen["headers"])

    def test_an_empty_response_is_an_empty_object_rather_than_a_parse_error(self):
        result, _ = self.run_call(b"")
        self.assertEqual(result, {})


class PollTest(unittest.TestCase):
    """Which run the dispatch produced, decided by the difference between two listings."""

    def scripted(self, after):
        state = {"listed": 0}

        def call(method, path, token, body=None):
            if method == "POST":
                return {}
            if path.endswith("/git/ref/heads/master"):
                return {"object": {"sha": "a" * 40}}
            if "ci.yml/runs" in path:
                return {"workflow_runs": [{"head_sha": "a" * 40, "status": "completed", "conclusion": "success"}]}
            state["listed"] += 1
            return {"workflow_runs": after if state["listed"] > 1 else [{"id": 1, "name": "alfworld"}]}

        return call

    def run_main(self, call):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = lane.main(["--arm", "none", "--games", "134"], token="t", call=call, sleep=lambda _: None)
        return code, out.getvalue(), err.getvalue()

    def test_a_run_of_another_workflow_is_not_this_dispatchs_run(self):
        code, out, _ = self.run_main(
            self.scripted(
                [
                    {"id": 9, "name": "ci", "status": "queued", "html_url": "wrong"},
                    {"id": 2, "name": "alfworld", "status": "queued", "html_url": "right"},
                ]
            )
        )
        self.assertEqual(code, 0)
        self.assertIn("run 2", out)
        self.assertNotIn("wrong", out)

    def test_a_dispatch_that_produces_no_run_says_so_instead_of_claiming_success(self):
        code, _, err = self.run_main(self.scripted([{"id": 1, "name": "alfworld"}]))
        self.assertEqual(code, 1)
        self.assertIn("no new run appeared", err)


class BoundaryTest(unittest.TestCase):
    """The ends of the two numeric knobs, which are accepted rather than clamped."""

    def test_a_retrieval_budget_of_one_is_the_contrast_amd_measured(self):
        self.assertEqual(lane.check(arguments("--sweep", "true", "--rules", "b.json", "--top-k", "1")), [])

    def test_a_gate_share_of_zero_is_the_registered_arm_and_not_a_refusal(self):
        self.assertEqual(lane.check(arguments("--sweep", "true", "--rules", "b.json", "--gate-share", "0")), [])

    def test_a_gate_share_just_under_one_is_accepted(self):
        self.assertEqual(lane.check(arguments("--sweep", "true", "--rules", "b.json", "--gate-share", "0.99")), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
