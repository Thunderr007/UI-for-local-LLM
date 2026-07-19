"""Regression tests for universal thinking normalization."""

from __future__ import annotations

import json
import unittest

from server.reasoning_normalize import (
    ReasoningStreamNormalizer,
    apply_think_to_payload,
    extract_structured_thinking,
    looks_like_think_unsupported,
)


class ThinkUnsupportedTests(unittest.TestCase):
    def test_detects_common_errors(self):
        self.assertTrue(
            looks_like_think_unsupported(
                '{"error":"registry.ollama.ai/library/llama3.1:8b does not support thinking"}'
            )
        )
        self.assertTrue(looks_like_think_unsupported('unknown field "think"'))
        self.assertTrue(looks_like_think_unsupported("thinking is not supported"))
        self.assertFalse(looks_like_think_unsupported("model not found"))
        self.assertFalse(looks_like_think_unsupported("thinking supported"))
        self.assertFalse(looks_like_think_unsupported('{"error":"out of memory"}'))


class ApplyThinkTests(unittest.TestCase):
    def test_auto_and_true_enable(self):
        self.assertTrue(apply_think_to_payload({"model": "x"}, "auto")["think"])
        self.assertTrue(apply_think_to_payload({"model": "x"}, "true")["think"])

    def test_false_omits(self):
        self.assertNotIn("think", apply_think_to_payload({"model": "x", "think": True}, "false"))

    def test_level_passthrough(self):
        self.assertEqual(apply_think_to_payload({"model": "x"}, "high")["think"], "high")


class StructuredFieldTests(unittest.TestCase):
    def test_message_thinking(self):
        self.assertEqual(
            extract_structured_thinking({"message": {"thinking": "step 1"}}),
            "step 1",
        )

    def test_reasoning_aliases(self):
        self.assertEqual(
            extract_structured_thinking({"message": {"reasoning_content": "r"}}),
            "r",
        )
        self.assertEqual(extract_structured_thinking({"reasoning": "top"}), "top")


class StreamNormalizerTests(unittest.TestCase):
    def test_structured_thinking_stream(self):
        n = ReasoningStreamNormalizer()
        frames = n.feed_chunk({"message": {"thinking": "a", "content": ""}})
        frames += n.feed_chunk({"message": {"content": "hello"}, "done": True})
        thinking = "".join(
            (f.get("message") or {}).get("thinking", "") for f in frames
        )
        content = "".join((f.get("message") or {}).get("content", "") for f in frames)
        self.assertEqual(thinking, "a")
        self.assertEqual(content, "hello")

    def test_legacy_think_tags(self):
        n = ReasoningStreamNormalizer()
        thinking, content, msg = n.normalize_complete(
            {
                "message": {
                    "role": "assistant",
                    "content": "<think>plan</think>Answer",
                }
            }
        )
        self.assertEqual(thinking, "plan")
        self.assertEqual(content, "Answer")
        self.assertEqual(msg["thinking"], "plan")
        self.assertEqual(msg["content"], "Answer")

    def test_tags_split_across_chunks(self):
        n = ReasoningStreamNormalizer()
        frames = []
        frames += n.feed_chunk({"message": {"content": "<thi"}})
        frames += n.feed_chunk({"message": {"content": "nk>part1"}})
        frames += n.feed_chunk({"message": {"content": " part2</thi"}})
        frames += n.feed_chunk({"message": {"content": "nk>Final"}, "done": True})
        thinking = "".join(
            (f.get("message") or {}).get("thinking", "") for f in frames
        )
        content = "".join((f.get("message") or {}).get("content", "") for f in frames)
        self.assertEqual(thinking, "part1 part2")
        self.assertEqual(content, "Final")

    def test_reasoning_tags(self):
        n = ReasoningStreamNormalizer()
        thinking, content, _ = n.normalize_complete(
            {"message": {"content": "<reasoning>why</reasoning>ok"}}
        )
        self.assertEqual(thinking, "why")
        self.assertEqual(content, "ok")

    def test_no_thinking_plain_model(self):
        n = ReasoningStreamNormalizer()
        thinking, content, msg = n.normalize_complete(
            {"message": {"role": "assistant", "content": "Just an answer."}}
        )
        self.assertEqual(thinking, "")
        self.assertEqual(content, "Just an answer.")
        self.assertNotIn("thinking", msg)

    def test_generate_response_field(self):
        n = ReasoningStreamNormalizer()
        frames = n.feed_chunk({"response": "<think>g</think>out", "done": True})
        thinking = "".join(
            (f.get("message") or {}).get("thinking", "") for f in frames
        )
        content = "".join((f.get("message") or {}).get("content", "") for f in frames)
        self.assertEqual(thinking, "g")
        self.assertEqual(content, "out")

    def test_preserves_tool_calls(self):
        n = ReasoningStreamNormalizer()
        calls = [{"function": {"name": "list_dir", "arguments": {}}}]
        _, _, msg = n.normalize_complete(
            {
                "message": {
                    "role": "assistant",
                    "content": "",
                    "thinking": "check files",
                    "tool_calls": calls,
                }
            }
        )
        self.assertEqual(msg["thinking"], "check files")
        self.assertEqual(msg["tool_calls"], calls)


class ModelSupportTests(unittest.TestCase):
    def test_thinking_from_caps_and_name(self):
        from server.app import model_support

        self.assertTrue(
            model_support({"name": "llama3.1:8b", "capabilities": ["thinking"]})[
                "thinking"
            ]
        )
        self.assertTrue(
            model_support({"name": "deepseek-r1:14b", "capabilities": []})["thinking"]
        )
        self.assertFalse(
            model_support({"name": "llama3.1:8b", "capabilities": []})["thinking"]
        )

    def test_merge_capabilities_aliases(self):
        from server.app import _merge_capabilities

        self.assertIn("thinking", _merge_capabilities(["reasoning"], ["tools"]))


class StreamStressTests(unittest.TestCase):
    def test_ollama_like_incremental_stream(self):
        n = ReasoningStreamNormalizer()
        lines = [
            json.dumps({"message": {"role": "assistant", "thinking": "Hmm"}, "done": False}),
            json.dumps({"message": {"role": "assistant", "thinking": "..."}, "done": False}),
            json.dumps({"message": {"role": "assistant", "content": "Hi"}, "done": False}),
            json.dumps(
                {
                    "message": {"role": "assistant", "content": "!"},
                    "done": True,
                    "eval_count": 2,
                }
            ),
        ]
        frames = []
        for line in lines:
            frames.extend(n.feed_line(line))
        thinking = "".join((f.get("message") or {}).get("thinking", "") for f in frames)
        content = "".join((f.get("message") or {}).get("content", "") for f in frames)
        self.assertEqual(thinking, "Hmm...")
        self.assertEqual(content, "Hi!")
        self.assertTrue(any(f.get("done") for f in frames))
        self.assertEqual(
            next(f for f in frames if f.get("done")).get("eval_count"), 2
        )

    def test_malformed_lines_are_skipped(self):
        n = ReasoningStreamNormalizer()
        self.assertEqual(n.feed_line("not-json"), [])
        self.assertEqual(n.feed_line(""), [])

    def test_error_chunk_passthrough(self):
        n = ReasoningStreamNormalizer()
        frames = n.feed_chunk({"error": "boom"})
        self.assertEqual(frames, [{"error": "boom"}])


class CatalogFingerprintJsParity(unittest.TestCase):
    """Mirror the JS identity fingerprint logic for regression safety."""

    def test_empty_and_digest_change(self):
        def fp(models):
            return "\0".join(
                sorted(
                    f"{m.get('name','')}\t{m.get('digest','')}\t{m.get('modified_at','')}"
                    for m in models
                )
            )

        self.assertEqual(fp([]), "")
        a = fp([{"name": "m", "digest": "d1", "modified_at": "t1"}])
        b = fp([{"name": "m", "digest": "d2", "modified_at": "t1"}])
        self.assertNotEqual(a, b)


if __name__ == "__main__":
    unittest.main()
