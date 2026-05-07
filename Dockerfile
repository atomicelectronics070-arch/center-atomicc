# Use Puppeteer official image - already has Chromium, no apt-get needed
FROM ghcr.io/puppeteer/puppeteer:21.6.1

# Switch to root to install app deps
USER root
WORKDIR /app

# Environment for Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Copy and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy source
COPY . .

EXPOSE 5000

CMD ["node", "src/index.js"]
