import unittest
from fastapi.testclient import TestClient

from asr_service.app.security import validate_audio_url, validate_source_url
from asr_service.app.main import app


class SecurityTests(unittest.TestCase):
    def test_accepts_bilibili_media_domains(self):
        self.assertEqual(
            validate_audio_url("https://upos-sz-mirrorali.bilivideo.com/a.m4s?token=short"),
            "https://upos-sz-mirrorali.bilivideo.com/a.m4s?token=short",
        )

    def test_rejects_ssrf_and_lookalike_domains(self):
        for url in (
            "http://upos-sz-mirrorali.bilivideo.com/a.m4s",
            "https://bilivideo.com.evil.test/a.m4s",
            "https://127.0.0.1/a.m4s",
            "https://user:pass@hdslb.com/a.m4s",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_audio_url(url)

    def test_source_must_be_a_bilibili_page(self):
        self.assertEqual(
            validate_source_url("https://www.bilibili.com/video/BV1test123"),
            "https://www.bilibili.com/video/BV1test123",
        )
        with self.assertRaises(ValueError):
            validate_source_url("https://evilbilibili.com/video/BV1test123")

    def test_validation_errors_do_not_echo_signed_audio_urls(self):
        response = TestClient(app).post(
            "/v1/jobs",
            headers={"X-Bilibili-ASR-Client": "bilibili-subtitle-edge-v1"},
            json={"audio_urls": "https://a.bilivideo.com/a.m4s?token=secret"},
        )
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("token=secret", response.text)


if __name__ == "__main__":
    unittest.main()
