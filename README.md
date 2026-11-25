# CodeAura Classroom MCQ Exam Portal

A lightweight, zero-dependency classroom MCQ examination platform with separate **Teacher (Sir) Portal** and **Student Portal** for **HTML, CSS, JavaScript, Python**, and custom programming subjects.

## Features

- **Separate Portals:**
  - **Teacher Portal (`/teacher`):** PIN-protected control panel (`1234` default) to select MCQs manually or auto-pick random questions, create/publish live exams, add custom MCQs/subjects, bulk import questions, view student answer sheets, and export results to CSV.
  - **Student Portal (`/student`):** Enter Name & Roll Number, view live exams pushed by Sir, take timed MCQ exams with a Question Navigator palette, and get instant auto-checked Total Marks, Subject-wise Breakdown, and Answer Key Review.
- **Built-in Question Bank (120 MCQs):** 30 MCQs each for HTML, CSS, JavaScript, and Python across Easy, Medium, and Hard levels.
- **Real-Time Live Sync:** Uses Server-Sent Events (`/api/events`) so exams published by Sir appear automatically on connected student screens over classroom Wi-Fi / LAN.
- **Anti-Cheating & Proctoring Controls:** Optional per-exam tab/window-switch detection with auto-submit strike limits, copy-paste/right-click/DevTools-key blocking, Fullscreen enforcement, and **Speed Mode** (per-question countdown timer). Full violation logs appear in Sir's Results table, CSV exports, and emails.
- **Auto-Email on Submit:** Automatically sends a formatted HTML & plain-text marks report (including subject breakdown and checked answer sheet) to Sir and/or the Student via SMTP (Gmail App Password, Outlook, Yahoo, or custom SMTP) whenever a student submits an exam.
- **Secure Auto-Grading:** Answer keys (`correctIndex` & explanations) are stripped before sending questions to students and graded server-side upon submission.

## Quick Start

1. Make sure **Node.js** (v18+) is installed.
2. Start the server:
   - Double-click `start-exam-server.bat`, **or**
   - Run `node server.js`
3. Open in browser:
   - **Home:** `http://localhost:3000/`
   - **Teacher Portal:** `http://localhost:3000/teacher` (Default PIN: `1234`)
   - **Student Portal:** `http://localhost:3000/student` (or share the LAN IP URL printed in the terminal with students on the same Wi-Fi)
