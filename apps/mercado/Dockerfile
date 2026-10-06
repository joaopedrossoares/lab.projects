FROM node:20-alpine
WORKDIR /app

# Instala dependências primeiro para aproveitar o cache do Docker
COPY package*.json ./
RUN npm install --omit=dev

# Copia o restante do código
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
