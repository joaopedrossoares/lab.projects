FROM python:3.12-alpine
WORKDIR /app

# xlrd lê o formato .xls antigo (BIFF) que o DIEESE exporta
RUN pip install --no-cache-dir xlrd==2.0.1

COPY . .

ENV DATA_DIR=/data PORT=8000
EXPOSE 8000
CMD ["python", "server.py"]
