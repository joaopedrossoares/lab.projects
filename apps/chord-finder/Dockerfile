# Usa uma imagem leve do Node.js
FROM node:20-alpine

# Define a pasta de trabalho dentro do container
WORKDIR /app

# Copia os arquivos de dependência e instala (otimiza o cache do Docker)
COPY package*.json ./
RUN npm install

# Copia o restante dos arquivos (HTML, PDF, app.js, etc.)
COPY . .

# A porta que o seu app.js utiliza (estou usando 3000 como exemplo, ajuste se necessário)
EXPOSE 3000

# O comando para iniciar a sua aplicação
CMD ["node", "server.js"]