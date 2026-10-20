import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.api.routes.meeting import looks_like_question


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

    def test_accepts_text_resume(self):
        response = self.client.post(
            "/api/profile/resume",
            files={"file": ("resume.txt", b"Python developer with API testing experience.", "text/plain")},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("Python developer", response.json()["text"])

    def test_enhanced_question_detection(self):
        self.assertTrue(looks_like_question("Tell us about your deployment approach"))
        self.assertTrue(looks_like_question("Could you explain the project structure"))
        self.assertFalse(looks_like_question("The deployment completed on Friday."))

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
