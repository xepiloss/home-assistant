FROM node:22-alpine

WORKDIR /app

COPY src/ /app/src/
COPY package*.json /app/
COPY run.sh /app/

RUN npm install --omit=dev
RUN chmod +x /app/run.sh  # 실행 권한 추가

CMD ["sh", "/app/run.sh"]
