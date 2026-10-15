FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=8787 HOST=0.0.0.0
EXPOSE 8787
USER node
CMD ["node", "server.js"]
