FROM alpine:latest

RUN apk add --no-cache tzdata bash && \
    apk add nodejs npm && \
    apk update npm

RUN npm install -g nodemon

WORKDIR /opt/lux-webrtc

COPY . .
RUN npm rebuild bcrypt --build-from-source
RUN npm install

EXPOSE 8080
CMD [ "nodemon", "server.js" ]