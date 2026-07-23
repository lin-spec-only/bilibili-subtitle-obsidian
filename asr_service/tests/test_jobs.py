import tempfile
import time
import unittest
from pathlib import Path

from asr_service.app.config import Settings
from asr_service.app.jobs import JobManager


class FakeTranscriber:
    def transcribe(self, _path, _duration, _language, _cancel, progress):
        progress(0.9)
        return {
            "language": "zh",
            "body": [{"from": 0, "to": 1.2, "content": "测试转写"}],
        }


def fake_download(_urls, destination, _source, _max_bytes, _timeout, _cancel, progress):
    destination.write_bytes(b"fake-audio")
    progress(0.2)


class JobManagerTests(unittest.TestCase):
    def test_runs_and_reuses_cached_transcription_without_exposing_audio_url(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            settings = Settings(
                host="127.0.0.1", port=8766, data_dir=root / "data",
                model_dir=root / "models", model_name="small", device="cpu",
                compute_type="int8", max_audio_bytes=1024, download_timeout_seconds=10,
            )
            payload = {
                "audio_urls": ["https://a.bilivideo.com/audio.m4s?token=secret"],
                "source_url": "https://www.bilibili.com/video/BV1test123",
                "bvid": "BV1test123", "cid": "456", "part": 1,
                "duration_seconds": 10,
            }
            manager = JobManager(settings, downloader=fake_download, transcriber=FakeTranscriber())
            created = manager.create(payload)
            for _ in range(100):
                result = manager.get(created["id"])
                if result["status"] == "completed":
                    break
                time.sleep(0.01)
            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["result"]["track"]["body"][0]["content"], "测试转写")
            self.assertNotIn("token=secret", str(result))
            cached = manager.create(payload)
            self.assertEqual(cached["status"], "completed")
            self.assertEqual(cached["message"], "已读取本地缓存")
            manager.executor.shutdown(wait=True)


if __name__ == "__main__":
    unittest.main()
