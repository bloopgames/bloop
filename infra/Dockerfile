FROM oven/bun:latest

COPY server.ts ./
COPY turn.ts ./
COPY dist ./dist
EXPOSE 3000

CMD ["bun", "run", "server.ts"]