import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend.app.main import app


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_rejects_unsupported_file(self):
        response = self.client.post(
            "/api/coach",
            files={"file": ("question.txt", b"not audio", "text/plain")},
        )
        self.assertEqual(response.status_code, 415)

    @patch(
        "backend.app.api.routes.coach.generate_practice_answer",
        new_callable=AsyncMock,
    )
    @patch("backend.app.api.routes.coach.transcribe_audio")
    def test_accepts_weba_audio(self, transcribe_mock, answer_mock):
        transcribe_mock.return_value = "What is Python language?"
        answer_mock.return_value = " ".join(["practice"] * 55)
        response = self.client.post(
            "/api/coach",
            files={"file": ("question.weba", b"webm audio", "audio/webm")},
        )
        self.assertEqual(response.status_code, 200)

    @patch(
        "backend.app.api.routes.coach.generate_practice_answer",
        new_callable=AsyncMock,
    )
    @patch("backend.app.api.routes.coach.transcribe_audio")
    def test_coach_success(self, transcribe_mock, answer_mock):
        transcribe_mock.return_value = "Tell me about yourself."
        answer_mock.return_value = " ".join(["practice"] * 55)

        response = self.client.post(
            "/api/coach",
            files={"file": ("question.wav", b"RIFFtest", "audio/wav")},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["word_count"], 55)


if __name__ == "__main__":
    unittest.main()
