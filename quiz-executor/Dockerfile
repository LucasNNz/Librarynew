FROM mcr.microsoft.com/playwright:v1.58.2-noble
WORKDIR /app/quiz-executor
COPY quiz-executor/package*.json ./
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/* && npm install --omit=dev && npx playwright install --with-deps chrome
ENV CHROME_EXECUTABLE=/opt/google/chrome/chrome
COPY quiz-executor/runner.mjs quiz-executor/audio-mux.mjs ./
COPY public/quiz-studio /app/public/quiz-studio
USER pwuser
CMD ["node", "runner.mjs"]
